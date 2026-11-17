import { afterEach, describe, expect, it } from 'vitest'
import { decodePng, greyPng, pixelAt, reencodePng } from './images.fixture.js'
import {
  createThreadPool,
  createVisualDiff,
  diffThreadCount,
  ImageDecodeError,
  type VisualDiff,
  VisualDiffError,
  type VisualDiffResult,
} from './visual-diff.js'

/**
 * The default tolerance.
 */
const defaults = { color: 0.01, pixels: 20 } as const

/**
 * The thread script, as Vitest runs it.
 */
const threadScript = new URL('./diff-thread.ts', import.meta.url)

/**
 * A thread script that stops at once with exit code 1.
 */
const crashingScript = new URL('data:text/javascript,process.exit(1)')

/**
 * A thread script that answers every task with the error a comparison failed with.
 */
const failingScript = new URL(
  `data:text/javascript,${encodeURIComponent(
    "import { parentPort } from 'node:worker_threads'\n" +
      "parentPort.on('message', () => parentPort.postMessage({ error: 'vips: out of memory' }))\n",
  )}`,
)

/**
 * A thread script that answers every task with a comparison's `passed`, as no decode check may.
 */
const passingScript = new URL(
  `data:text/javascript,${encodeURIComponent(
    "import { parentPort } from 'node:worker_threads'\n" +
      "parentPort.on('message', () => parentPort.postMessage({ result: { outcome: 'passed' } }))\n",
  )}`,
)

/**
 * A thread script that throws as it starts.
 */
const throwingScript = new URL(`data:text/javascript,${encodeURIComponent("throw new Error('no libvips')")}`)

/**
 * A comparison of two different one-byte files, which needs a thread.
 */
const differingRequest = { baseline: Uint8Array.of(1), snapshot: Uint8Array.of(2), tolerance: defaults, scale: 1 }

/**
 * Gives each settled comparison's error message, or its outcome when it resolved.
 */
function messagesOf(results: PromiseSettledResult<VisualDiffResult>[]): string[] {
  return results.map((result) =>
    result.status === 'rejected' ? (result.reason as Error).message : result.value.outcome,
  )
}

describe('diffThreadCount', () => {
  it.each([
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 2],
    [7, 3],
    [8, 4],
    [64, 4],
  ])('gives %s CPUs %s threads', (cpus, expected) => {
    expect(diffThreadCount(cpus)).toBe(expected)
  })
})

describe('createVisualDiff', () => {
  /**
   * The visual diff under test, closed after each test.
   */
  let visualDiff: VisualDiff | undefined

  afterEach(async () => {
    await visualDiff?.close()
    visualDiff = undefined
  })

  it('passes identical files without decoding them', async () => {
    visualDiff = createVisualDiff()

    expect(
      await visualDiff.compare({
        baseline: Uint8Array.of(1, 2, 3),
        snapshot: Uint8Array.of(1, 2, 3),
        tolerance: defaults,
        scale: 1,
      }),
    ).toEqual({ outcome: 'passed' })
  })

  it('resolves several comparisons at once on its threads, leaving the files as they were', async () => {
    visualDiff = createVisualDiff()

    const baseline = await greyPng(8, 8, 128)
    const samePixels = await reencodePng(baseline, 0)
    const changed = await greyPng(8, 8, 128, [{ x: 3, y: 4, rgba: [0, 0, 0, 255] }])
    const baselineBytes = [...baseline]

    expect(samePixels).not.toEqual(baseline)

    const requests = Array.from({ length: 10 }, (_, index) => ({
      baseline,
      snapshot: index % 2 === 0 ? changed : samePixels,
      tolerance: { ...defaults, pixels: 0 },
      scale: 1,
    }))

    const results = await Promise.all(requests.map((request) => visualDiff?.compare(request)))

    expect(results.filter((result) => result?.outcome === 'passed')).toHaveLength(5)

    for (const result of results.filter((item) => item?.outcome === 'differs')) {
      expect(result).toMatchObject({ reason: 'pixels', message: '1 differ, 0 allowed' })

      const diff = await decodePng((result as { diff: Uint8Array }).diff)

      expect(pixelAt(diff.pixels, 8, 3, 4)).toEqual([255, 45, 135, 255])
    }

    expect([...baseline]).toEqual(baselineBytes)
  })

  it('sends the regions to its thread', async () => {
    visualDiff = createVisualDiff()

    const result = await visualDiff.compare({
      baseline: await greyPng(4, 3, 128),
      snapshot: await greyPng(4, 3, 128, [{ x: 2, y: 1, rgba: [0, 0, 0, 255] }]),
      tolerance: { ...defaults, pixels: 0 },
      scale: 1,
      regions: [
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 2, y: 1, width: 1, height: 1 },
      ],
    })

    expect(result).toMatchObject({ outcome: 'differs', regionsHit: [1] })
  })

  it('rejects an undecodable baseline with an ImageDecodeError that names it', async () => {
    visualDiff = createVisualDiff()

    const comparison = visualDiff.compare({
      baseline: Uint8Array.of(1, 2, 3),
      snapshot: await greyPng(2, 2, 128),
      tolerance: defaults,
      scale: 1,
    })

    await expect(comparison).rejects.toThrow(ImageDecodeError)
    await expect(comparison).rejects.toMatchObject({ image: 'baseline' })
  })

  it('checks on its threads that a baseline decodes, giving the reason when it does not', async () => {
    visualDiff = createVisualDiff()

    const garbage = new TextEncoder().encode('not a PNG file')
    const [decodable, undecodable] = await Promise.all([
      visualDiff.undecodableReasonOf(await greyPng(4, 4, 128)),
      visualDiff.undecodableReasonOf(garbage),
    ])

    expect(decodable).toBeUndefined()
    expect(undecodable).toBe('Input buffer contains unsupported image format')
    expect(new TextDecoder().decode(garbage)).toBe('not a PNG file')
  })

  it('rejects a decode check once closed', async () => {
    visualDiff = createVisualDiff()
    await visualDiff.close()

    await expect(visualDiff.undecodableReasonOf(await greyPng(4, 4, 128))).rejects.toThrow('The visual diff is closed.')
  })

  it('closes, and rejects any comparison after that, identical files included', async () => {
    visualDiff = createVisualDiff()
    await visualDiff.compare({
      baseline: await greyPng(2, 2, 128),
      snapshot: await greyPng(2, 2, 129),
      tolerance: defaults,
      scale: 1,
    })

    await expect(visualDiff.close()).resolves.toBeUndefined()
    await expect(
      visualDiff.compare({ baseline: Uint8Array.of(1), snapshot: Uint8Array.of(1), tolerance: defaults, scale: 1 }),
    ).rejects.toThrow('The visual diff is closed.')
  })

  it('closes without having started a thread', async () => {
    visualDiff = createVisualDiff()

    await expect(visualDiff.close()).resolves.toBeUndefined()
  })
})

describe('createThreadPool', () => {
  /**
   * The pool under test, closed after each test.
   */
  let pool: VisualDiff | undefined

  afterEach(async () => {
    await pool?.close()
    pool = undefined
  })

  it('rejects the running comparison and the waiting ones on close', async () => {
    pool = createThreadPool(threadScript, 1)

    const request = {
      baseline: await greyPng(1000, 1000, 128),
      snapshot: await greyPng(1000, 1000, 0),
      tolerance: defaults,
      scale: 1,
    }

    // A first comparison loads sharp and starts the thread, so the next ones take the thread or the queue at once.
    await pool.compare({ ...request, baseline: await greyPng(2, 2, 128), snapshot: await greyPng(2, 2, 0) })

    const settled = Promise.allSettled([pool.compare(request), pool.compare(request), pool.compare(request)])

    await pool.close()

    expect(messagesOf(await settled)).toEqual([
      'The visual diff closed before the comparison finished.',
      'The visual diff closed before the comparison started.',
      'The visual diff closed before the comparison started.',
    ])
  })

  it('rejects the comparisons waiting for sharp to load on close', async () => {
    let finishLoading: () => void = () => undefined

    pool = createThreadPool(threadScript, 1, async () => {
      await new Promise<void>((resolve) => {
        finishLoading = resolve
      })
    })

    const request = { baseline: Uint8Array.of(1), snapshot: Uint8Array.of(2), tolerance: defaults, scale: 1 }
    const settled = Promise.allSettled([pool.compare(request), pool.compare(request)])

    await pool.close()
    finishLoading()

    expect(messagesOf(await settled)).toEqual([
      'The visual diff closed before the comparison started.',
      'The visual diff closed before the comparison started.',
    ])
  })

  it('rejects every comparison that needs a thread with a VisualDiffError when sharp fails to load', async () => {
    let loads = 0

    pool = createThreadPool(threadScript, 1, async () => {
      loads += 1

      throw new Error('Could not load the "sharp" module using the linux-x64 runtime')
    })

    const settled = await Promise.allSettled([pool.compare(differingRequest), pool.compare(differingRequest)])

    for (const result of settled) {
      expect(result).toMatchObject({
        status: 'rejected',
        reason: {
          kind: 'sharp-unavailable',
          reason: 'Could not load the "sharp" module using the linux-x64 runtime',
          message: 'Couldn\'t load sharp: Could not load the "sharp" module using the linux-x64 runtime.',
        },
      })
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(VisualDiffError)
    }

    expect(loads).toBe(1)
    expect(await pool.compare({ ...differingRequest, snapshot: Uint8Array.of(1) })).toEqual({ outcome: 'passed' })
  })

  it("keeps sharp's own reason and leaves out the solutions it lists", async () => {
    pool = createThreadPool(threadScript, 1, async () => {
      throw new Error(
        'Could not load the "sharp" module using the linux-x64 runtime\n' +
          'ERR_DLOPEN_FAILED: libvips-cpp.so.42: cannot open shared object file\n' +
          'Possible solutions:\n' +
          '- Ensure optional dependencies can be installed:\n' +
          '    npm install --include=optional sharp',
      )
    })

    await expect(pool.compare(differingRequest)).rejects.toMatchObject({
      kind: 'sharp-unavailable',
      reason:
        'Could not load the "sharp" module using the linux-x64 runtime; ' +
        'ERR_DLOPEN_FAILED: libvips-cpp.so.42: cannot open shared object file',
    })
  })

  it("rejects a decode check whose thread gives a comparison's result", async () => {
    pool = createThreadPool(passingScript, 1)

    await expect(pool.undecodableReasonOf(Uint8Array.of(1))).rejects.toThrow(
      "A visual diff thread gave a comparison's result for a decode check.",
    )
  })

  it('rejects the comparison of a thread that stops with a VisualDiffError, and starts another for the next one', async () => {
    pool = createThreadPool(crashingScript, 1)

    const settled = await Promise.allSettled([pool.compare(differingRequest), pool.compare(differingRequest)])

    for (const result of settled) {
      expect(result).toMatchObject({
        status: 'rejected',
        reason: {
          kind: 'thread-stopped',
          reason: 'exit code 1',
          message: 'A visual diff thread stopped: exit code 1.',
        },
      })
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(VisualDiffError)
    }
  })

  it('gives the error a thread failed with as the reason it stopped', async () => {
    pool = createThreadPool(throwingScript, 1)

    await expect(pool.compare(differingRequest)).rejects.toMatchObject({
      kind: 'thread-stopped',
      reason: 'no libvips',
    })
  })

  it('rejects the comparison a thread answers with an error with a VisualDiffError', async () => {
    pool = createThreadPool(failingScript, 1)

    const comparison = pool.compare(differingRequest)

    await expect(comparison).rejects.toThrow(VisualDiffError)
    await expect(comparison).rejects.toMatchObject({ kind: 'thread-stopped', reason: 'vips: out of memory' })
  })
})
