// Starts the thread that reads a config afresh, and is that thread's script. Node runs this file as it is, including as
// `.ts` under Vitest, where `./x.js` doesn't lead to `./x.ts`. So it imports Node's built-in modules, packages and types
// only, and the thread loads the module that reads configs through jiti, which finds either.
import { once } from 'node:events'
import {
  isMainThread,
  MessageChannel,
  type MessagePort,
  receiveMessageOnPort,
  Worker,
  workerData,
} from 'node:worker_threads'
import { createJiti } from 'jiti'
import type { Config } from './define-config.js'
import type * as LoadConfig from './load-config.js'

/**
 * What marks a thread as one that reads a config.
 */
const threadMarker = 'visual-check:config'

/**
 * What the thread is started with.
 */
interface ThreadData {
  /**
   * Tells the thread from every other that loads this file.
   */
  marker: typeof threadMarker
  /**
   * The absolute path of the config file.
   */
  path: string
  /**
   * The absolute folder that paths in messages are relative to.
   */
  cwd: string
  /**
   * Where the thread posts its answer. It isn't `parentPort`, which the config may post to.
   */
  port: MessagePort
}

/**
 * What the thread answers with, once: the valid config, the error that reading it failed with, a `ConfigError` or any
 * other, or that the config waits for a promise that never settles.
 */
type ThreadReply = { config: Config } | { error: { message: string; isConfigError: boolean } } | { unsettled: true }

/**
 * Reads the config at `path` in a thread of its own, waits until the thread has stopped, which it does once it has
 * answered, and gives the answer. The thread is stopped early when the signal aborts.
 *
 * @throws {Error} When the signal aborts, when the config throws outside its own run, with that error, and when the
 * thread stops with no answer.
 */
export async function askConfigThread(
  path: string,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<ThreadReply> {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { marker: threadMarker, path, cwd, port: port2 } satisfies ThreadData,
    transferList: [port2],
  })

  // `once` stops listening when the signal aborts, and an error with no listener would end the process.
  worker.on('error', () => {})

  try {
    const [code] = await once(worker, 'exit', { signal })
    const received = receiveMessageOnPort(port1)

    if (received === undefined) {
      throw new Error(`its thread stopped with exit code ${code} before it gave a config.`)
    }

    return received.message
  } finally {
    port1.close()
    // Not awaited: a thread in a blocking call stops only after it.
    worker.terminate()
  }
}

/**
 * Reads the config in the thread and gives the answer.
 */
async function replyFor({ path, cwd }: ThreadData): Promise<ThreadReply> {
  const jiti = createJiti(import.meta.url, { tryNative: false, fsCache: false, tsconfigPaths: false, alias: {} })
  const { readConfig } = await jiti.import<typeof LoadConfig>('./load-config.js')

  try {
    return { config: await readConfig(path, cwd) }
  } catch (error) {
    return error instanceof Error
      ? { error: { message: error.message, isConfigError: error.name === 'ConfigError' } }
      : { error: { message: String(error), isConfigError: false } }
  }
}

/**
 * Posts the thread's one answer, then ends the thread, whatever the config left running.
 */
async function answer(data: ThreadData): Promise<void> {
  // Nothing is left to run, and there is no answer yet.
  process.once('beforeExit', () => data.port.postMessage({ unsettled: true } satisfies ThreadReply))
  data.port.postMessage(await replyFor(data))
  process.exit()
}

/**
 * Whether a thread was started with what `askConfigThread` starts one with.
 */
function isThreadData(data: unknown): data is ThreadData {
  return typeof data === 'object' && data !== null && 'marker' in data && data.marker === threadMarker
}

if (!isMainThread && isThreadData(workerData)) {
  answer(workerData)
}
