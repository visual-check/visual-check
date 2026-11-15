import { Buffer } from 'node:buffer'
import { availableParallelism } from 'node:os'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { Tolerance } from '../config/define-config.js'

/**
 * The most threads the pool runs, however many CPUs the machine has.
 */
const maximumThreads = 4

/**
 * What a thread is started with, so the thread script answers only the pool and stays quiet when a test imports it.
 * The thread script repeats it, because it can't import this file.
 */
const threadMarker = 'visual-check:visual-diff'

/**
 * The thread script, beside this file and with its extension: `.ts` when Vitest runs the sources, `.js` once built.
 * Node runs the `.ts` script through its default type stripping, which needs Node 22.18 or later.
 */
const threadScript = new URL(`./diff-thread${extname(fileURLToPath(import.meta.url))}`, import.meta.url)

/**
 * An image's width and height, in image pixels.
 *
 * @public
 */
export interface ImageSize {
  /**
   * The width.
   */
  width: number
  /**
   * The height.
   */
  height: number
}

/**
 * A snapshot to compare with its baseline.
 *
 * @public
 */
export interface VisualDiffRequest {
  /**
   * The baseline's PNG file, as stored.
   */
  baseline: Uint8Array
  /**
   * The snapshot's PNG file, as the browser returned it.
   */
  snapshot: Uint8Array
  /**
   * The story's tolerance, with every part set.
   */
  tolerance: Required<Tolerance>
  /**
   * The device scale factor the snapshot was captured at, which a count of CSS pixels scales with.
   */
  scale: number
}

/**
 * A snapshot that differs from its baseline beyond tolerance, or in size.
 *
 * @public
 */
export interface VisualDiffFailure {
  /**
   * Marks a snapshot that differs.
   */
  outcome: 'differs'
  /**
   * Why it differs: more differing pixels than allowed, or a different width or height.
   */
  reason: 'pixels' | 'size'
  /**
   * What the report says, such as `84 differ, 80 allowed (20 at scale 2)` or `size changed: 1280×2400 → 1280×2432`.
   */
  message: string
  /**
   * How many image pixels differ. On a size difference the padding counts too.
   */
  differ: number
  /**
   * How many differing image pixels the tolerance allows.
   */
  allowed: number
  /**
   * The baseline's size.
   */
  baselineSize: ImageSize
  /**
   * The snapshot's size.
   */
  snapshotSize: ImageSize
  /**
   * The visual diff, as a PNG file.
   */
  diff: Uint8Array
}

/**
 * How a snapshot compares with its baseline: within tolerance, or differing.
 *
 * @public
 */
export type VisualDiffResult = { outcome: 'passed' } | VisualDiffFailure

/**
 * What the pool asks a thread to do: compare a snapshot with its baseline, or decode a baseline to check that it
 * can be.
 */
export type ThreadTask =
  | {
      /**
       * Marks a comparison.
       */
      kind: 'compare'
      /**
       * What to compare.
       */
      request: VisualDiffRequest
    }
  | {
      /**
       * Marks a decode check.
       */
      kind: 'decode'
      /**
       * The baseline's PNG file, as stored.
       */
      file: Uint8Array
    }

/**
 * What a thread gives for one task: a comparison's result, a decode check's `decodable`, or the image it couldn't
 * decode and the decoder's reason.
 */
export type ThreadResult =
  | VisualDiffResult
  | { outcome: 'decodable' }
  | { outcome: 'undecodable'; image: 'baseline' | 'snapshot'; reason: string }

/**
 * What a thread answers for one task: its result, or the error the thread failed with.
 */
export type ThreadReply = { result: ThreadResult } | { error: string }

/**
 * The baseline or the snapshot isn't an image that can be decoded, such as a truncated or corrupt PNG file.
 *
 * @public
 */
export class ImageDecodeError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `ImageDecodeError`.
   */
  override name = 'ImageDecodeError'

  /**
   * Which image couldn't be decoded.
   */
  readonly image: 'baseline' | 'snapshot'

  /**
   * The decoder's reason, such as `Input buffer contains unsupported image format`.
   */
  readonly reason: string

  /**
   * Keeps which image couldn't be decoded and the decoder's reason.
   */
  constructor(image: 'baseline' | 'snapshot', reason: string) {
    super(`Couldn't decode the ${image}: ${reason}.`)
    this.image = image
    this.reason = reason
  }
}

/**
 * Compares snapshots with their baselines in a pool of threads.
 *
 * @public
 */
export interface VisualDiff {
  /**
   * Compares a snapshot with its baseline by the tolerance. Identical files pass at once.
   *
   * @throws {ImageDecodeError} When the files differ and one of them can't be decoded.
   * @throws {Error} When the visual diff is closed.
   */
  compare: (request: VisualDiffRequest) => Promise<VisualDiffResult>
  /**
   * Decodes a baseline on a thread, as a comparison decodes it, to check that it can be. Gives the decoder's reason
   * when it can't, such as `Input buffer contains unsupported image format`, or `undefined` when it can.
   *
   * @throws {Error} When the visual diff is closed.
   */
  undecodableReasonOf: (file: Uint8Array) => Promise<string | undefined>
  /**
   * Stops every thread. A comparison or decode check still waiting or running is rejected.
   */
  close: () => Promise<void>
}

/**
 * A comparison or decode check waiting for a thread, or running on one.
 */
interface Job {
  /**
   * What the thread does.
   */
  task: ThreadTask
  /**
   * Settles the job with the thread's result.
   */
  resolve: (result: ThreadResult) => void
  /**
   * Settles the job with an error.
   */
  reject: (error: Error) => void
}

/**
 * A thread of the pool and the job it runs, if any.
 */
interface Thread {
  /**
   * The thread.
   */
  worker: Worker
  /**
   * The job it runs, or `undefined` while it's idle.
   */
  job?: Job
  /**
   * The error the thread failed with, once it has.
   */
  failure?: Error
}

/**
 * Gives how many threads compare images on a machine with `cpus` CPUs: half of them, at least 1 and at most 4.
 */
export function diffThreadCount(cpus: number): number {
  return Math.min(maximumThreads, Math.max(1, Math.floor(cpus / 2)))
}

/**
 * Settles `job` with what its thread answered.
 */
function settle(job: Job, reply: ThreadReply): void {
  if ('error' in reply) {
    job.reject(new Error(reply.error))
  } else {
    job.resolve(reply.result)
  }
}

/**
 * Gives the message that sends a task to a thread, with only the task's own fields, so nothing else of the caller's
 * objects is copied.
 */
function messageOf(task: ThreadTask): ThreadTask {
  if (task.kind === 'decode') {
    return { kind: 'decode', file: task.file }
  }

  const { baseline, snapshot, tolerance, scale } = task.request

  return { kind: 'compare', request: { baseline, snapshot, tolerance, scale } }
}

/**
 * Gives a comparison's result from what its thread gave.
 *
 * @throws {ImageDecodeError} When the thread couldn't decode one of the files.
 * @throws {Error} When the thread gave a decode check's result, which a comparison rules out.
 */
function comparisonOf(result: ThreadResult): VisualDiffResult {
  if (result.outcome === 'undecodable') {
    throw new ImageDecodeError(result.image, result.reason)
  }

  if (result.outcome === 'decodable') {
    throw new Error("A visual diff thread gave a decode check's result for a comparison.")
  }

  return result
}

/**
 * Gives a decode check's result from what its thread gave: the decoder's reason, or `undefined` when the file decodes.
 *
 * @throws {Error} When the thread gave a comparison's result, which a decode check rules out.
 */
function decodeCheckOf(result: ThreadResult): string | undefined {
  if (result.outcome === 'undecodable') {
    return result.reason
  }

  if (result.outcome !== 'decodable') {
    throw new Error("A visual diff thread gave a comparison's result for a decode check.")
  }

  return undefined
}

/**
 * Gives `error` as an `Error`, wrapping any other thrown value.
 */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Loads sharp on the main thread. sharp's docs ask for this before any thread uses it: on glibc Linux, libvips must
 * stay loaded until every thread has exited, or a thread can crash or hang as it exits.
 */
async function loadSharp(): Promise<void> {
  await import('sharp')
}

/**
 * Makes a visual diff that runs `script` in up to `threadLimit` threads, started only when a task needs one.
 * Before the first thread starts, `load` loads sharp on the main thread, once. `createVisualDiff` gives it the thread
 * script, the machine's thread count and the real load. Tests give it others.
 */
export function createThreadPool(script: URL, threadLimit: number, load: () => Promise<void> = loadSharp): VisualDiff {
  const threads: Thread[] = []
  const queue: Job[] = []
  let closed = false
  let loaded = false
  let loading: Promise<void> | undefined

  /**
   * Runs `job` on `thread`. Files are copied to the thread rather than moved, so the caller's buffers stay usable. A
   * task that can't be sent rejects the job, and the thread takes the next one.
   */
  const run = (thread: Thread, job: Job): void => {
    thread.job = job
    thread.worker.ref()

    try {
      thread.worker.postMessage(messageOf(job.task))
    } catch (error) {
      runNext(thread)
      job.reject(asError(error))
    }
  }

  /**
   * Gives `thread` the next waiting job, or lets it idle without keeping the process alive.
   */
  const runNext = (thread: Thread): void => {
    const next = queue.shift()

    if (next === undefined) {
      delete thread.job
      thread.worker.unref()
    } else {
      run(thread, next)
    }
  }

  /**
   * Settles the job `thread` runs with `reply`, after giving the thread its next job.
   */
  const answer = (thread: Thread, reply: ThreadReply): void => {
    const job = thread.job

    runNext(thread)

    if (job !== undefined) {
      settle(job, reply)
    }
  }

  /**
   * Starts a thread. When it stops, its job is rejected, and a new thread takes the next waiting job unless the pool
   * is closed.
   */
  const start = (): Thread => {
    const thread: Thread = { worker: new Worker(script, { workerData: threadMarker }) }

    thread.worker.on('message', (reply: ThreadReply) => {
      answer(thread, reply)
    })
    thread.worker.on('messageerror', (error) => {
      answer(thread, { error: error.message })
    })
    thread.worker.on('error', (error) => {
      thread.failure = error
    })
    thread.worker.on('exit', (code) => {
      threads.splice(threads.indexOf(thread), 1)
      thread.job?.reject(
        closed
          ? new Error('The visual diff closed before the comparison finished.')
          : (thread.failure ?? new Error(`A visual diff thread stopped with exit code ${code}.`)),
      )

      const next = queue.shift()

      if (!closed && next !== undefined) {
        run(start(), next)
      }
    })
    threads.push(thread)

    return thread
  }

  /**
   * Loads sharp on the main thread the first time it's called, and gives the same load after that. A failed load
   * fails every comparison that needs a thread.
   */
  const loadOnce = async (): Promise<void> => {
    loading ??= load().then(() => {
      loaded = true
    })

    await loading
  }

  /**
   * Runs the task on an idle thread, a new one or the next one free. Once sharp is loaded, a task takes its thread or
   * its place in the queue at once.
   */
  const runTask = async (task: ThreadTask): Promise<ThreadResult> => {
    if (!loaded) {
      await loadOnce()

      if (closed) {
        throw new Error('The visual diff closed before the comparison started.')
      }
    }

    return new Promise((resolve, reject) => {
      const job: Job = { task, resolve, reject }
      const idle = threads.find((thread) => thread.job === undefined)

      if (idle !== undefined) {
        run(idle, job)
      } else if (threads.length < threadLimit) {
        run(start(), job)
      } else {
        queue.push(job)
      }
    })
  }

  /**
   * Passes identical files at once, and otherwise runs the comparison on a thread.
   */
  const compare = async (request: VisualDiffRequest): Promise<VisualDiffResult> => {
    if (closed) {
      throw new Error('The visual diff is closed.')
    }

    if (Buffer.compare(request.baseline, request.snapshot) === 0) {
      return { outcome: 'passed' }
    }

    return comparisonOf(await runTask({ kind: 'compare', request }))
  }

  /**
   * Runs the decode check on a thread.
   */
  const undecodableReasonOf = async (file: Uint8Array): Promise<string | undefined> => {
    if (closed) {
      throw new Error('The visual diff is closed.')
    }

    return decodeCheckOf(await runTask({ kind: 'decode', file }))
  }

  /**
   * Rejects the waiting jobs, then stops every thread, which rejects the running ones.
   */
  const close = async (): Promise<void> => {
    closed = true

    for (const job of queue.splice(0)) {
      job.reject(new Error('The visual diff closed before the comparison started.'))
    }

    await Promise.all(threads.map((thread) => thread.worker.terminate()))
  }

  return { compare, undecodableReasonOf, close }
}

/**
 * Makes a visual diff that starts its threads only when a comparison needs one: half the machine's CPUs, at least 1
 * and at most 4. Call `close` once done.
 *
 * @public
 */
export function createVisualDiff(): VisualDiff {
  return createThreadPool(threadScript, diffThreadCount(availableParallelism()))
}
