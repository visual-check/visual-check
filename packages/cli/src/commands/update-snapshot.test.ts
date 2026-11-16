import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { BrokenStory, StoryCapture, StoryHosts, StoryToCapture } from '../capture/capture-session.js'
import type { Tolerance } from '../config/define-config.js'
import { greyPng, type PixelChange, whitePixels } from '../visual-diff/images.fixture.js'
import { createVisualDiff, type VisualDiff } from '../visual-diff/visual-diff.js'
import type { SnapshotToCapture } from './plan-snapshots.js'
import type { CaptureStory } from './snapshot-result.js'
import { type UpdateTools, updateSnapshot } from './update-snapshot.js'

/**
 * A black PNG file of 10 × 10 pixels.
 */
const black = new Uint8Array(await greyPng(10, 10, 0))

/**
 * A white PNG file of 10 × 10 pixels, whose 100 pixels all differ from `black`'s.
 */
const white = new Uint8Array(await greyPng(10, 10, 255))

/**
 * A mid grey PNG file of 10 × 10 pixels, whose 100 pixels all differ from `black`'s and `white`'s.
 */
const grey = new Uint8Array(await greyPng(10, 10, 128))

/**
 * A dark grey PNG file of 10 × 10 pixels, whose 100 pixels all differ from `black`'s, `white`'s and `grey`'s.
 */
const darkGrey = new Uint8Array(await greyPng(10, 10, 64))

/**
 * A file the browser could return that isn't a PNG file, so it can't be decoded.
 */
const notPng = new TextEncoder().encode('not a PNG')

/**
 * `black` with 3 white pixels: within the default tolerance of `black`, beyond it of `white`.
 */
const threeWhite = new Uint8Array(await greyPng(10, 10, 0, whitePixels(3, 10)))

/**
 * `white` with 3 black pixels: within the default tolerance of `white`, beyond it of `black`.
 */
const threeBlack = new Uint8Array(
  await greyPng(
    10,
    10,
    255,
    whitePixels(3, 10).map((change): PixelChange => ({ ...change, rgba: [0, 0, 0, 255] })),
  ),
)

/**
 * `black` with its first 25 pixels white: 25 differ from `black`, 15 from `tenWhite`.
 */
const twentyFiveWhite = new Uint8Array(await greyPng(10, 10, 0, whitePixels(25, 10)))

/**
 * `black` with its first 10 pixels white, which `twentyFiveWhite` has white too: 10 differ from `black`.
 */
const tenWhite = new Uint8Array(await greyPng(10, 10, 0, whitePixels(10, 10)))

/**
 * A black PNG file of 10 × 12 pixels: the size differs from `black`'s.
 */
const taller = new Uint8Array(await greyPng(10, 12, 0))

/**
 * The tolerance a story gets when it sets none: the config's defaults.
 */
const defaultTolerance: Required<Tolerance> = { color: 0.01, pixels: 20 }

/**
 * The broken story a load gives when Storybook reports the story finished with an error.
 */
const brokenStory: BrokenStory = { reason: 'error', message: 'Storybook reported the story finished with an error.' }

/**
 * The detail of a story whose page changed in the second after its first capture, by 100 pixels.
 */
const changedDetail =
  'broken: The story changed in the second after its capture: 100 differ, 20 allowed. Use its wait hook to wait ' +
  'until it settles.'

/**
 * The detail of a story none of whose 3 loads agreed.
 */
const unstableDetail = "broken: No two of the story's 3 loads agreed, so its baseline wasn't written."

/**
 * The visual diff every test compares with, closed after the last test.
 */
const visualDiff = createVisualDiff()

afterAll(async () => {
  await visualDiff.close()
})

/**
 * What `update` is given in most tests: the real visual diff, and no wait before it captures a page again.
 */
const tools: UpdateTools = { visualDiff, recaptureDelayMs: 0 }

/**
 * The baselines folders the tests made, removed after each test.
 */
const folders: string[] = []

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

/**
 * One load of the story's page as the fake gives it: a snapshot with what it comes with, or a broken story.
 */
type FakeLoad =
  | {
      /**
       * The snapshot the load's last attempt captures.
       */
      snapshot: Uint8Array
      /**
       * The same page captured again on this load, when `captureAgainIf` asks for it. `snapshot` when not given.
       */
      later?: Uint8Array
      /**
       * How long Storybook's `completing` render step took. Unknown when not given.
       */
      completingMs?: number
      /**
       * The hosts the story reaches. None listed when not given.
       */
      hosts?: StoryHosts
      /**
       * The snapshots of the attempts before the last, in order, each of whose second capture navigated away, so the
       * session tried again. None when not given.
       */
      retriedFrom?: Uint8Array[]
      /**
       * Whether the load gives no second capture even when `captureAgainIf` resolves true, which a capture session
       * never does. It gives one when not given.
       */
      ignoresAgain?: boolean
    }
  | {
      /**
       * Why the load can't be captured.
       */
      broken: BrokenStory
    }

/**
 * A fake `CaptureStory` and what it saw.
 */
interface FakeCaptures {
  /**
   * Each story it was asked to capture, one per load, in order.
   */
  stories: StoryToCapture[]
  /**
   * What each call of a story's `captureAgainIf` resolved with, in order.
   */
  answers: boolean[]
  /**
   * How long each call of a story's `captureAgainIf` took to resolve, in ms, in order.
   */
  waits: number[]
  /**
   * Gives the loads in order, calling the story's `captureAgainIf` as a capture session does.
   */
  captureStory: CaptureStory
}

/**
 * Builds a fake `CaptureStory` that gives `loads` in order, one per call. Like a capture session, it calls the story's
 * `captureAgainIf` with the snapshot of each attempt that captured one, and gives the same page captured again as
 * `capturedAgain` when the last call resolves true, unless the load ignores it. A broken load calls nothing. When
 * `captureAgainIf` rejects, the capture rejects with the same error. It throws when asked for more loads than it has.
 */
function fakeCapturesOf(loads: readonly FakeLoad[]): FakeCaptures {
  const queue = [...loads]
  const fake: FakeCaptures = {
    stories: [],
    answers: [],
    waits: [],
    captureStory: async (story) => {
      fake.stories.push(story)

      const load = queue.shift()

      if (load === undefined) {
        throw new Error('The test gave too few loads.')
      }

      if ('broken' in load) {
        return load
      }

      /**
       * Calls the story's `captureAgainIf` with the snapshot, recording what it resolved with and how long it took.
       * Resolves false at once when the story has none.
       */
      const ask = async (snapshot: Uint8Array): Promise<boolean> => {
        if (story.captureAgainIf === undefined) {
          return false
        }

        const asked = performance.now()
        const answer = await story.captureAgainIf(snapshot)

        fake.waits.push(performance.now() - asked)
        fake.answers.push(answer)

        return answer
      }

      for (const earlier of load.retriedFrom ?? []) {
        await ask(earlier)
      }

      const { snapshot, later = snapshot, completingMs, hosts } = load
      const capture: StoryCapture = { snapshot, completingMs, console: [], ...(hosts === undefined ? {} : { hosts }) }

      return (await ask(snapshot)) && load.ignoresAgain !== true ? { ...capture, capturedAgain: later } : capture
    },
  }

  return fake
}

/**
 * A snapshot to update and where its baseline is.
 */
interface SnapshotSetup {
  /**
   * The snapshot.
   */
  item: SnapshotToCapture
  /**
   * The path of its baseline.
   */
  path: string
}

/**
 * Builds the default capture of story `a` with a baselines folder of its own, holding `baseline` as its baseline when
 * given and nothing when not. Its tolerance is `tolerance`, the defaults when not given.
 */
function snapshotOf(baseline?: Uint8Array, tolerance: Required<Tolerance> = defaultTolerance): SnapshotSetup {
  const folder = mkdtempSync(join(tmpdir(), 'visual-check-update-'))
  const path = join(folder, 'a.png')

  folders.push(folder)

  if (baseline !== undefined) {
    writeFileSync(path, baseline)
  }

  return {
    item: {
      storybook: { name: 'web', dir: '/web', configDir: '/web/.storybook', baselines: folder, url: 'http://web.test' },
      story: { id: 'a', title: 'Title', name: 'Name', importPath: './a.stories.tsx' },
      mode: undefined,
      key: 'a',
      selected: true,
      options: {},
      tolerance,
      viewport: { width: 10, height: 10, deviceScaleFactor: 1, touch: false },
      globals: {},
    },
    path,
  }
}

/**
 * Reads a baseline's bytes.
 */
function bytesAt(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path))
}

describe('updateSnapshot', () => {
  it('writes a missing baseline from the second load when the story renders the same way twice', async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: threeWhite }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toEqual({
      status: 'written',
      detail: 'written: missing',
    })
    expect(bytesAt(path)).toEqual(threeWhite)
    expect(fake.stories).toHaveLength(2)
    expect(fake.answers).toEqual([true])
  })

  it('asks to capture the page again on the first load only', async () => {
    const { item } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: white }, { snapshot: white }])

    await updateSnapshot(item, fake.captureStory, tools)

    expect(fake.stories.map((story) => story.captureAgainIf !== undefined)).toEqual([true, false, false])
    expect(fake.stories.map(({ id, url }) => ({ id, url }))).toEqual(
      Array.from({ length: 3 }, () => ({ id: 'a', url: 'http://web.test/iframe.html?id=a&viewMode=story' })),
    )
  })

  it('keeps a baseline within tolerance after one load and one capture, without waiting', async () => {
    const { item, path } = snapshotOf(black)
    const fake = fakeCapturesOf([{ snapshot: threeWhite }])

    expect(await updateSnapshot(item, fake.captureStory, { visualDiff, recaptureDelayMs: 60_000 })).toEqual({
      status: 'kept',
      detail: 'kept',
    })
    expect(bytesAt(path)).toEqual(black)
    expect(fake.stories).toHaveLength(1)
    expect(fake.answers).toEqual([false])
  })

  it('breaks a story whose page changed after its first capture, with one load and nothing written', async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black, later: white }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toStrictEqual({
      status: 'broken',
      detail: changedDetail,
    })
    expect(existsSync(path)).toBe(false)
    expect(fake.stories).toHaveLength(1)
  })

  it('leaves a failing baseline untouched when the page changed after its first capture', async () => {
    const { item, path } = snapshotOf(grey)
    const fake = fakeCapturesOf([{ snapshot: black, later: white }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toStrictEqual({
      status: 'broken',
      detail: changedDetail,
    })
    expect(bytesAt(path)).toEqual(grey)
    expect(fake.stories).toHaveLength(1)
  })

  it('breaks a story whose page changed size after its first capture', async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black, later: taller }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toStrictEqual({
      status: 'broken',
      detail:
        'broken: The story changed in the second after its capture: size changed: 10×10 → 10×12. Use its wait hook ' +
        'to wait until it settles.',
    })
    expect(existsSync(path)).toBe(false)
  })

  it('writes the third load, flaky, when it agrees with the second and the first two disagree', async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: white }, { snapshot: threeWhite }, { snapshot: black }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toEqual({
      status: 'written',
      detail: 'written: missing · flaky',
      flaky: true,
    })
    expect(bytesAt(path)).toEqual(black)
    expect(fake.stories).toHaveLength(3)
  })

  it('writes the third load, flaky, when it agrees with the first alone', async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: white }, { snapshot: threeWhite }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toEqual({
      status: 'written',
      detail: 'written: missing · flaky',
      flaky: true,
    })
    expect(bytesAt(path)).toEqual(threeWhite)
  })

  it('breaks a story none of whose 3 loads agree, writing nothing', async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: white }, { snapshot: grey }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toStrictEqual({
      status: 'broken',
      detail: unstableDetail,
    })
    expect(existsSync(path)).toBe(false)
    expect(fake.stories).toHaveLength(3)
  })

  it('leaves a failing baseline untouched when none of the 3 loads agree', async () => {
    const { item, path } = snapshotOf(darkGrey)
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: white }, { snapshot: grey }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toStrictEqual({
      status: 'broken',
      detail: unstableDetail,
    })
    expect(bytesAt(path)).toEqual(darkGrey)
  })

  it('keeps a failing baseline, flaky, when the second load is within tolerance of it', async () => {
    const { item, path } = snapshotOf(black)
    const fake = fakeCapturesOf([{ snapshot: white }, { snapshot: threeWhite }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toEqual({
      status: 'kept',
      detail: 'kept · flaky',
      flaky: true,
    })
    expect(bytesAt(path)).toEqual(black)
    expect(fake.stories).toHaveLength(2)
  })

  it("rewrites a failing baseline from the second load when it agrees with the first, with the first's message", async () => {
    const { item, path } = snapshotOf(black)
    const fake = fakeCapturesOf([{ snapshot: white }, { snapshot: threeBlack }])
    const result = await updateSnapshot(item, fake.captureStory, tools)

    expect(result).toEqual({ status: 'written', detail: 'written: differs: 100 differ, 20 allowed' })
    expect(result.flaky).toBeUndefined()
    expect(bytesAt(path)).toEqual(threeBlack)
    expect(fake.stories).toHaveLength(2)
  })

  it('rewrites a failing baseline from the third load, flaky, when the third decides', async () => {
    const { item, path } = snapshotOf(black)
    const fake = fakeCapturesOf([{ snapshot: white }, { snapshot: grey }, { snapshot: threeBlack }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toEqual({
      status: 'written',
      detail: 'written: differs: 100 differ, 20 allowed · flaky',
      flaky: true,
    })
    expect(bytesAt(path)).toEqual(threeBlack)
    expect(fake.stories).toHaveLength(3)
  })

  it('keeps a failing baseline the second load is within tolerance of, even when the first two loads agree', async () => {
    const tolerance = { color: 0.01, pixels: 15 }
    const { item, path } = snapshotOf(black, tolerance)
    const fake = fakeCapturesOf([{ snapshot: twentyFiveWhite }, { snapshot: tenWhite }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toEqual({
      status: 'kept',
      detail: 'kept · flaky',
      flaky: true,
    })
    expect(bytesAt(path)).toEqual(black)
    expect(fake.stories).toHaveLength(2)
  })

  it("decides whether loads agree by the story's tolerance", async () => {
    const lenient = snapshotOf(undefined, { color: 0.01, pixels: 3 })
    const lenientFake = fakeCapturesOf([{ snapshot: black, later: threeWhite }, { snapshot: threeWhite }])

    expect(await updateSnapshot(lenient.item, lenientFake.captureStory, tools)).toEqual({
      status: 'written',
      detail: 'written: missing',
    })
    expect(lenientFake.stories).toHaveLength(2)

    const strict = snapshotOf(undefined, { color: 0.01, pixels: 0 })
    const strictFake = fakeCapturesOf([{ snapshot: black }, { snapshot: threeWhite }, { snapshot: threeWhite }])

    expect(await updateSnapshot(strict.item, strictFake.captureStory, tools)).toEqual({
      status: 'written',
      detail: 'written: missing · flaky',
      flaky: true,
    })
    expect(strictFake.stories).toHaveLength(3)
  })

  it('takes loads of different sizes to disagree', async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: taller }, { snapshot: taller }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toEqual({
      status: 'written',
      detail: 'written: missing · flaky',
      flaky: true,
    })
    expect(bytesAt(path)).toEqual(taller)
    expect(fake.stories).toHaveLength(3)
  })

  it('gives a broken first load as it is', async () => {
    const { item } = snapshotOf(black)
    const fake = fakeCapturesOf([{ broken: brokenStory }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toStrictEqual({
      status: 'broken',
      detail: `broken: ${brokenStory.message}`,
    })
    expect(fake.stories).toHaveLength(1)
  })

  it('gives a broken second load as it is, writing nothing', async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black }, { broken: brokenStory }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toStrictEqual({
      status: 'broken',
      detail: `broken: ${brokenStory.message}`,
    })
    expect(existsSync(path)).toBe(false)
  })

  it('gives a broken third load as it is, leaving the baseline untouched', async () => {
    const { item, path } = snapshotOf(grey)
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: white }, { broken: brokenStory }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toStrictEqual({
      status: 'broken',
      detail: `broken: ${brokenStory.message}`,
    })
    expect(bytesAt(path)).toEqual(grey)
  })

  it("gives the first load's completing time and hosts", async () => {
    const hostsOf = (host: string): StoryHosts => ({ requests: [host], remoteContent: [] })
    const written = snapshotOf()
    const writtenFake = fakeCapturesOf([
      { snapshot: black, completingMs: 3, hosts: hostsOf('first.test') },
      { snapshot: white, completingMs: 200, hosts: hostsOf('second.test') },
      { snapshot: white, completingMs: 300, hosts: hostsOf('third.test') },
    ])

    expect(await updateSnapshot(written.item, writtenFake.captureStory, tools)).toStrictEqual({
      status: 'written',
      detail: 'written: missing · flaky',
      completingMs: 3,
      hosts: hostsOf('first.test'),
      flaky: true,
    })

    const kept = snapshotOf(black)
    const keptFake = fakeCapturesOf([
      { snapshot: white, completingMs: 3, hosts: hostsOf('first.test') },
      { snapshot: black, completingMs: 200, hosts: hostsOf('second.test') },
    ])

    expect(await updateSnapshot(kept.item, keptFake.captureStory, tools)).toStrictEqual({
      status: 'kept',
      detail: 'kept · flaky',
      completingMs: 3,
      hosts: hostsOf('first.test'),
      flaky: true,
    })
  })

  it('goes by the latest comparison when an attempt of the first load is tried again', async () => {
    const kept = snapshotOf(black)
    const keptFake = fakeCapturesOf([{ snapshot: threeWhite, retriedFrom: [white] }])

    expect(await updateSnapshot(kept.item, keptFake.captureStory, tools)).toEqual({ status: 'kept', detail: 'kept' })
    expect(keptFake.answers).toEqual([true, false])
    expect(keptFake.stories).toHaveLength(1)

    const written = snapshotOf(black)
    const writtenFake = fakeCapturesOf([{ snapshot: white, retriedFrom: [taller] }, { snapshot: white }])

    expect(await updateSnapshot(written.item, writtenFake.captureStory, tools)).toEqual({
      status: 'written',
      detail: 'written: differs: 100 differ, 20 allowed',
    })
    expect(writtenFake.answers).toEqual([true, true])
  })

  it('asks for the second capture no sooner than the delay after its first', async () => {
    const { item } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: black }])

    await updateSnapshot(item, fake.captureStory, { visualDiff, recaptureDelayMs: 100 })

    expect(fake.answers).toEqual([true])
    expect(fake.waits[0]).toBeGreaterThanOrEqual(95)
  })

  it('compares with the baseline while it waits, not before', async () => {
    let compares = 0
    const slowDiff: VisualDiff = {
      ...visualDiff,
      compare: async (request) => {
        compares += 1

        // Only the first comparison, the one with the baseline, is slow.
        if (compares === 1) {
          await sleep(300)
        }

        return await visualDiff.compare(request)
      },
    }
    const { item } = snapshotOf(black)
    const fake = fakeCapturesOf([{ snapshot: white }, { snapshot: white }])

    await updateSnapshot(item, fake.captureStory, { visualDiff: slowDiff, recaptureDelayMs: 300 })

    // Back to back, the comparison and the wait would take 600 ms or more.
    expect(fake.answers).toEqual([true])
    expect(fake.waits[0]).toBeGreaterThanOrEqual(295)
    expect(fake.waits[0]).toBeLessThan(500)
  })

  it("rejects when the first load's page wasn't captured again although it was asked for", async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black, ignoresAgain: true }, { snapshot: black }])

    await expect(updateSnapshot(item, fake.captureStory, tools)).rejects.toThrow(
      "The capture session didn't capture the story's page again.",
    )
    expect(fake.answers).toEqual([true])
    expect(fake.stories).toHaveLength(1)
    expect(existsSync(path)).toBe(false)
  })

  it('reads the baseline before any capture', async () => {
    const { item } = snapshotOf()

    rmSync(item.storybook.baselines, { recursive: true })
    writeFileSync(item.storybook.baselines, 'a file where the baselines folder should be')

    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: black }])

    await expect(updateSnapshot(item, fake.captureStory, tools)).rejects.toMatchObject({
      name: 'BaselineError',
      action: 'read',
    })
    expect(fake.stories).toHaveLength(0)
  })

  it("rejects with the baseline's decode error from the first load's comparison", async () => {
    const { item } = snapshotOf(new TextEncoder().encode('not a PNG file'))
    const fake = fakeCapturesOf([{ snapshot: black }])

    await expect(updateSnapshot(item, fake.captureStory, tools)).rejects.toMatchObject({
      name: 'BaselineError',
      action: 'decode',
    })
  })
})

describe('updateSnapshot with a capture that cannot be decoded', () => {
  it.each([
    ['earlier', [{ snapshot: notPng }, { snapshot: black }]],
    ['later', [{ snapshot: black }, { snapshot: notPng }]],
  ] as const)(
    'rejects with a SnapshotDecodeError naming the snapshot when the %s of two loads is not a PNG',
    async (_, loads) => {
      const { item } = snapshotOf()
      const fake = fakeCapturesOf([...loads])

      await expect(updateSnapshot(item, fake.captureStory, tools)).rejects.toMatchObject({
        name: 'SnapshotDecodeError',
        storybook: 'web',
        key: 'a',
        reason: 'Input buffer contains unsupported image format',
      })
    },
  )
})
