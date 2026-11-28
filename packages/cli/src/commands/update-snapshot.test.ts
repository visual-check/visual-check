import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { BrokenStory, StoryCapture, StoryHosts, StoryToCapture } from '../capture/capture-session.js'
import type { ConsoleMessage } from '../capture/driver/driver.js'
import type { Tolerance } from '../config/define-config.js'
import type { ReportImages } from '../report/report-document.js'
import type { ReportImageBytes } from '../report/report-folder.js'
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
 * The broken story of a story whose page changed in the second after its first capture, by 100 pixels.
 */
const changedStory: BrokenStory = {
  reason: 'changed-after-capture',
  message:
    'The story changed in the second after its capture: 100 differ, 20 allowed. Use its wait hook to wait until it ' +
    'settles.',
}

/**
 * The broken story of a story none of whose 3 loads agreed.
 */
const unstableStory: BrokenStory = {
  reason: 'unstable',
  message: "No two of the story's 3 loads agreed, so its baseline wasn't written.",
}

/**
 * The result of a story whose page changed in the second after its first capture, by 100 pixels.
 */
const changedResult = {
  status: 'broken',
  detail: `broken: ${changedStory.message}`,
  attempts: 1,
  broken: changedStory,
  console: [],
}

/**
 * The result of a story none of whose 3 loads agreed.
 */
const unstableResult = {
  status: 'broken',
  detail: `broken: ${unstableStory.message}`,
  attempts: 3,
  broken: unstableStory,
  console: [],
}

/**
 * What the report keeps of the first load's comparison with a baseline all 100 of whose pixels it differs from.
 */
const allDifferComparison = {
  reason: 'pixels',
  message: '100 differ, 20 allowed',
  differ: 100,
  allowed: 20,
  baselineSize: { width: 10, height: 10 },
  snapshotSize: { width: 10, height: 10 },
}

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
       * The console messages of the load's page. None when not given.
       */
      console?: ConsoleMessage[]
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
      /**
       * The console messages of the load's page. Left out when not given, as for a load with no page.
       */
      console?: ConsoleMessage[]
      /**
       * The image of the load's page as it was when the story broke. None when not given.
       */
      image?: Uint8Array
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
        return { ...load, pageErrors: [] }
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

      const { snapshot, later = snapshot, completingMs, hosts, console = [] } = load
      const capture: StoryCapture = {
        snapshot,
        completingMs,
        console,
        pageErrors: [],
        ...(hosts === undefined ? {} : { hosts }),
      }

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
      pageErrorPolicy: { check: 'fail', expected: [], storyExpected: [] },
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
      attempts: 2,
      writtenFor: 'missing',
      console: [],
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
      attempts: 1,
    })
    expect(bytesAt(path)).toEqual(black)
    expect(fake.stories).toHaveLength(1)
    expect(fake.answers).toEqual([false])
  })

  it('breaks a story whose page changed after its first capture, with one load and nothing written', async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black, later: white }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toStrictEqual(changedResult)
    expect(existsSync(path)).toBe(false)
    expect(fake.stories).toHaveLength(1)
  })

  it('leaves a failing baseline untouched when the page changed after its first capture', async () => {
    const { item, path } = snapshotOf(grey)
    const fake = fakeCapturesOf([{ snapshot: black, later: white }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toStrictEqual(changedResult)
    expect(bytesAt(path)).toEqual(grey)
    expect(fake.stories).toHaveLength(1)
  })

  it('breaks a story whose page changed size after its first capture', async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black, later: taller }])

    const message =
      'The story changed in the second after its capture: size changed: 10×10 → 10×12. Use its wait hook to wait ' +
      'until it settles.'

    expect(await updateSnapshot(item, fake.captureStory, tools)).toStrictEqual({
      ...changedResult,
      detail: `broken: ${message}`,
      broken: { reason: 'changed-after-capture', message },
    })
    expect(existsSync(path)).toBe(false)
  })

  it('writes the third load, flaky, when it agrees with the second and the first two disagree', async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: white }, { snapshot: threeWhite }, { snapshot: black }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toEqual({
      status: 'written',
      detail: 'written: missing · flaky',
      attempts: 3,
      writtenFor: 'missing',
      flaky: true,
      console: [],
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
      attempts: 3,
      writtenFor: 'missing',
      flaky: true,
      console: [],
    })
    expect(bytesAt(path)).toEqual(threeWhite)
  })

  it('breaks a story none of whose 3 loads agree, writing nothing', async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: white }, { snapshot: grey }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toStrictEqual(unstableResult)
    expect(existsSync(path)).toBe(false)
    expect(fake.stories).toHaveLength(3)
  })

  it('leaves a failing baseline untouched when none of the 3 loads agree', async () => {
    const { item, path } = snapshotOf(darkGrey)
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: white }, { snapshot: grey }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toStrictEqual(unstableResult)
    expect(bytesAt(path)).toEqual(darkGrey)
  })

  it('keeps a failing baseline, flaky, when the second load is within tolerance of it', async () => {
    const { item, path } = snapshotOf(black)
    const fake = fakeCapturesOf([{ snapshot: white }, { snapshot: threeWhite }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toEqual({
      status: 'kept',
      detail: 'kept · flaky',
      attempts: 2,
      flaky: true,
    })
    expect(bytesAt(path)).toEqual(black)
    expect(fake.stories).toHaveLength(2)
  })

  it("rewrites a failing baseline from the second load when it agrees with the first, with the first's message", async () => {
    const { item, path } = snapshotOf(black)
    const fake = fakeCapturesOf([{ snapshot: white }, { snapshot: threeBlack }])
    const result = await updateSnapshot(item, fake.captureStory, tools)

    expect(result).toEqual({
      status: 'written',
      detail: 'written: differs: 100 differ, 20 allowed',
      attempts: 2,
      writtenFor: 'differs',
      comparison: allDifferComparison,
      console: [],
    })
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
      attempts: 3,
      writtenFor: 'differs',
      comparison: allDifferComparison,
      flaky: true,
      console: [],
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
      attempts: 2,
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
      attempts: 2,
      writtenFor: 'missing',
      console: [],
    })
    expect(lenientFake.stories).toHaveLength(2)

    const strict = snapshotOf(undefined, { color: 0.01, pixels: 0 })
    const strictFake = fakeCapturesOf([{ snapshot: black }, { snapshot: threeWhite }, { snapshot: threeWhite }])

    expect(await updateSnapshot(strict.item, strictFake.captureStory, tools)).toEqual({
      status: 'written',
      detail: 'written: missing · flaky',
      attempts: 3,
      writtenFor: 'missing',
      flaky: true,
      console: [],
    })
    expect(strictFake.stories).toHaveLength(3)
  })

  it('takes loads of different sizes to disagree', async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: taller }, { snapshot: taller }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toEqual({
      status: 'written',
      detail: 'written: missing · flaky',
      attempts: 3,
      writtenFor: 'missing',
      flaky: true,
      console: [],
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
      attempts: 1,
      broken: brokenStory,
    })
    expect(fake.stories).toHaveLength(1)
  })

  it('gives a broken second load as it is, writing nothing', async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black }, { broken: brokenStory }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toStrictEqual({
      status: 'broken',
      detail: `broken: ${brokenStory.message}`,
      attempts: 2,
      broken: brokenStory,
    })
    expect(existsSync(path)).toBe(false)
  })

  it('gives a broken third load as it is, leaving the baseline untouched', async () => {
    const { item, path } = snapshotOf(grey)
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: white }, { broken: brokenStory }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toStrictEqual({
      status: 'broken',
      detail: `broken: ${brokenStory.message}`,
      attempts: 3,
      broken: brokenStory,
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
      attempts: 3,
      completingMs: 3,
      hosts: hostsOf('first.test'),
      writtenFor: 'missing',
      flaky: true,
      console: [],
    })

    const kept = snapshotOf(black)
    const keptFake = fakeCapturesOf([
      { snapshot: white, completingMs: 3, hosts: hostsOf('first.test') },
      { snapshot: black, completingMs: 200, hosts: hostsOf('second.test') },
    ])

    expect(await updateSnapshot(kept.item, keptFake.captureStory, tools)).toStrictEqual({
      status: 'kept',
      detail: 'kept · flaky',
      attempts: 2,
      completingMs: 3,
      hosts: hostsOf('first.test'),
      flaky: true,
    })
  })

  it('goes by the latest comparison when an attempt of the first load is tried again', async () => {
    const kept = snapshotOf(black)
    const keptFake = fakeCapturesOf([{ snapshot: threeWhite, retriedFrom: [white] }])

    expect(await updateSnapshot(kept.item, keptFake.captureStory, tools)).toEqual({
      status: 'kept',
      detail: 'kept',
      attempts: 1,
    })
    expect(keptFake.answers).toEqual([true, false])
    expect(keptFake.stories).toHaveLength(1)

    const written = snapshotOf(black)
    const writtenFake = fakeCapturesOf([{ snapshot: white, retriedFrom: [taller] }, { snapshot: white }])

    expect(await updateSnapshot(written.item, writtenFake.captureStory, tools)).toEqual({
      status: 'written',
      detail: 'written: differs: 100 differ, 20 allowed',
      attempts: 2,
      writtenFor: 'differs',
      comparison: allDifferComparison,
      console: [],
    })
    expect(writtenFake.answers).toEqual([true, true])
  })

  it('gives the console messages of the load it writes or breaks on', async () => {
    const consoleOf = (text: string): ConsoleMessage[] => [{ kind: 'console.log', text }]
    const second = snapshotOf()
    const secondFake = fakeCapturesOf([
      { snapshot: black, console: consoleOf('first') },
      { snapshot: black, console: consoleOf('second') },
    ])

    expect(await updateSnapshot(second.item, secondFake.captureStory, tools)).toMatchObject({
      status: 'written',
      console: consoleOf('second'),
    })

    const third = snapshotOf()
    const thirdFake = fakeCapturesOf([
      { snapshot: black, console: consoleOf('first') },
      { snapshot: white, console: consoleOf('second') },
      { snapshot: white, console: consoleOf('third') },
    ])

    expect(await updateSnapshot(third.item, thirdFake.captureStory, tools)).toMatchObject({
      status: 'written',
      console: consoleOf('third'),
    })

    const changed = snapshotOf()
    const changedFake = fakeCapturesOf([{ snapshot: black, later: white, console: consoleOf('first') }])

    expect(await updateSnapshot(changed.item, changedFake.captureStory, tools)).toMatchObject({
      status: 'broken',
      console: consoleOf('first'),
    })

    const broken = snapshotOf()
    const brokenFake = fakeCapturesOf([
      { snapshot: black, console: consoleOf('first') },
      { broken: brokenStory, console: consoleOf('second') },
    ])

    expect(await updateSnapshot(broken.item, brokenFake.captureStory, tools)).toMatchObject({
      status: 'broken',
      attempts: 2,
      console: consoleOf('second'),
    })
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

describe('updateSnapshot with rewrite', () => {
  /**
   * What the addon's Update gives: the real visual diff, no wait before it captures a page again, and `rewrite`.
   */
  const rewriteTools: UpdateTools = { ...tools, rewrite: true }

  it('rewrites a baseline within tolerance from the second load after capturing the first again', async () => {
    const { item, path } = snapshotOf(black)
    const fake = fakeCapturesOf([{ snapshot: threeWhite }, { snapshot: tenWhite }])

    expect(await updateSnapshot(item, fake.captureStory, rewriteTools)).toEqual({
      status: 'written',
      detail: 'written: within tolerance',
      attempts: 2,
      writtenFor: 'within-tolerance',
      console: [],
    })
    expect(bytesAt(path)).toEqual(tenWhite)
    expect(fake.answers).toEqual([true])
    expect(fake.stories).toHaveLength(2)
  })

  it('writes a baseline the second load is within tolerance of, when the first differed', async () => {
    const { item, path } = snapshotOf(black, { color: 0.01, pixels: 15 })
    const fake = fakeCapturesOf([{ snapshot: twentyFiveWhite }, { snapshot: tenWhite }])

    expect(await updateSnapshot(item, fake.captureStory, rewriteTools)).toEqual({
      status: 'written',
      detail: 'written: differs: 25 differ, 15 allowed',
      attempts: 2,
      writtenFor: 'differs',
      comparison: { ...allDifferComparison, message: '25 differ, 15 allowed', differ: 25, allowed: 15 },
      console: [],
    })
    expect(bytesAt(path)).toEqual(tenWhite)
  })

  it('writes a missing baseline as without rewrite', async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: threeWhite }])

    expect(await updateSnapshot(item, fake.captureStory, rewriteTools)).toEqual({
      status: 'written',
      detail: 'written: missing',
      attempts: 2,
      writtenFor: 'missing',
      console: [],
    })
    expect(bytesAt(path)).toEqual(threeWhite)
  })

  it('leaves a baseline identical byte for byte to the capture to write untouched, after 2 loads', async () => {
    const { item, path } = snapshotOf(black)
    const past = new Date('2020-01-01T00:00:00Z')

    utimesSync(path, past, past)

    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: black }])
    const writes: string[] = []
    const writeBaseline = async (to: string): Promise<void> => {
      writes.push(to)
    }

    expect(await updateSnapshot(item, fake.captureStory, { ...rewriteTools, writeBaseline })).toEqual({
      status: 'kept',
      detail: 'kept: identical',
      attempts: 2,
      console: [],
    })
    expect(writes).toEqual([])
    expect(bytesAt(path)).toEqual(black)
    expect(statSync(path).mtimeMs).toBe(past.getTime())
    expect(fake.stories).toHaveLength(2)
  })

  it('keeps an identical baseline, flaky, when the third load decided', async () => {
    const { item, path } = snapshotOf(black)
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: white }, { snapshot: black }])

    expect(await updateSnapshot(item, fake.captureStory, rewriteTools)).toEqual({
      status: 'kept',
      detail: 'kept: identical · flaky',
      attempts: 3,
      flaky: true,
      console: [],
    })
    expect(bytesAt(path)).toEqual(black)
  })

  it('breaks a story whose page changed after its first capture, leaving the baseline untouched', async () => {
    const kept = snapshotOf(black)
    const keptFake = fakeCapturesOf([{ snapshot: black, later: white }])

    expect(await updateSnapshot(kept.item, keptFake.captureStory, rewriteTools)).toStrictEqual(changedResult)
    expect(bytesAt(kept.path)).toEqual(black)

    const missing = snapshotOf()
    const missingFake = fakeCapturesOf([{ snapshot: black, later: white }])

    expect(await updateSnapshot(missing.item, missingFake.captureStory, rewriteTools)).toStrictEqual(changedResult)
    expect(existsSync(missing.path)).toBe(false)
  })

  it('breaks a story none of whose 3 loads agree, leaving the baseline untouched', async () => {
    const kept = snapshotOf(black)
    const keptFake = fakeCapturesOf([{ snapshot: black }, { snapshot: white }, { snapshot: grey }])

    expect(await updateSnapshot(kept.item, keptFake.captureStory, rewriteTools)).toStrictEqual(unstableResult)
    expect(bytesAt(kept.path)).toEqual(black)

    const missing = snapshotOf()
    const missingFake = fakeCapturesOf([{ snapshot: black }, { snapshot: white }, { snapshot: grey }])

    expect(await updateSnapshot(missing.item, missingFake.captureStory, rewriteTools)).toStrictEqual(unstableResult)
    expect(existsSync(missing.path)).toBe(false)
  })

  it('writes with the writer it is given, never to the file system', async () => {
    const { item, path } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: threeWhite }])
    const writes: [string, Uint8Array][] = []
    const writeBaseline = async (to: string, bytes: Uint8Array): Promise<void> => {
      writes.push([to, bytes])
    }

    expect(await updateSnapshot(item, fake.captureStory, { ...rewriteTools, writeBaseline })).toEqual({
      status: 'written',
      detail: 'written: missing',
      attempts: 2,
      writtenFor: 'missing',
      console: [],
    })
    expect(writes).toEqual([[path, threeWhite]])
    expect(existsSync(path)).toBe(false)
  })

  it("rejects with the baseline's decode error from the first load's comparison", async () => {
    const { item } = snapshotOf(new TextEncoder().encode('not a PNG file'))
    const fake = fakeCapturesOf([{ snapshot: black }])

    await expect(updateSnapshot(item, fake.captureStory, rewriteTools)).rejects.toMatchObject({
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

/**
 * A fake `writeImages` and what it was given.
 */
interface FakeImages {
  /**
   * The images of each call, in order.
   */
  written: Partial<ReportImageBytes>[]
  /**
   * Keeps the images it's given and gives a path for each, as the report folder names it.
   */
  writeImages: NonNullable<UpdateTools['writeImages']>
}

/**
 * Builds a fake `writeImages` that keeps the images of each call and gives `images/web/a.<kind>.png` for each image
 * given, `null` for the rest.
 */
function fakeImagesOf(): FakeImages {
  const fake: FakeImages = {
    written: [],
    writeImages: async (_item, images) => {
      // A baseline read from its file is a Buffer: kept as plain bytes, it compares with the images the tests give.
      fake.written.push(
        Object.fromEntries(Object.entries(images).map(([kind, bytes]) => [kind, new Uint8Array(bytes)])),
      )

      const pathOf = (kind: keyof ReportImages): string | null =>
        images[kind] === undefined ? null : `images/web/a.${kind}.png`

      return {
        baseline: pathOf('baseline'),
        snapshot: pathOf('snapshot'),
        diff: pathOf('diff'),
        compared: pathOf('compared'),
      }
    },
  }

  return fake
}

/**
 * Gives the visual diff of a later capture against an earlier one, by the default tolerance.
 */
async function diffOf(earlier: Uint8Array, later: Uint8Array): Promise<Uint8Array> {
  const result = await visualDiff.compare({ baseline: earlier, snapshot: later, tolerance: defaultTolerance, scale: 1 })

  if (result.outcome === 'passed') {
    throw new Error('The captures agree.')
  }

  return result.diff
}

describe('updateSnapshot with writeImages', () => {
  it('keeps the first capture, the page captured again and their diff of a story that changed after its capture', async () => {
    const { item } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black, later: white }])
    const images = fakeImagesOf()

    expect(await updateSnapshot(item, fake.captureStory, { ...tools, writeImages: images.writeImages })).toStrictEqual({
      ...changedResult,
      images: {
        baseline: null,
        snapshot: 'images/web/a.snapshot.png',
        diff: 'images/web/a.diff.png',
        compared: 'images/web/a.compared.png',
      },
    })
    expect(images.written).toEqual([{ compared: black, snapshot: white, diff: await diffOf(black, white) }])
  })

  it('keeps a copy of the baseline of a story that changed after its capture', async () => {
    const { item, path } = snapshotOf(grey)
    const fake = fakeCapturesOf([{ snapshot: black, later: white }])
    const images = fakeImagesOf()

    const result = await updateSnapshot(item, fake.captureStory, { ...tools, writeImages: images.writeImages })

    expect(result.images?.baseline).toBe('images/web/a.baseline.png')
    expect(images.written).toEqual([
      { baseline: grey, compared: black, snapshot: white, diff: await diffOf(black, white) },
    ])
    expect(bytesAt(path)).toEqual(grey)
  })

  it('keeps the first load, the third and their diff of a story none of whose loads agree, not the second', async () => {
    const { item } = snapshotOf(darkGrey)
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: white }, { snapshot: grey }])
    const images = fakeImagesOf()

    expect(await updateSnapshot(item, fake.captureStory, { ...tools, writeImages: images.writeImages })).toStrictEqual({
      ...unstableResult,
      images: {
        baseline: 'images/web/a.baseline.png',
        snapshot: 'images/web/a.snapshot.png',
        diff: 'images/web/a.diff.png',
        compared: 'images/web/a.compared.png',
      },
    })
    expect(images.written).toEqual([
      { baseline: darkGrey, compared: black, snapshot: grey, diff: await diffOf(black, grey) },
    ])
  })

  it('asks every load for an image of its page should it break', async () => {
    const { item } = snapshotOf()
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: white }, { snapshot: grey }])

    await updateSnapshot(item, fake.captureStory, { ...tools, writeImages: fakeImagesOf().writeImages })

    expect(fake.stories.map((story) => story.imageWhenBroken)).toEqual([true, true, true])
  })

  it.each([1, 2, 3])(
    'keeps the image of the page of a load %i that broke, with a copy of the baseline',
    async (load) => {
      const { item } = snapshotOf(darkGrey)
      const captured = [{ snapshot: black }, { snapshot: white }].slice(0, load - 1)
      const fake = fakeCapturesOf([...captured, { broken: brokenStory, console: [], image: grey }])
      const images = fakeImagesOf()

      expect(
        await updateSnapshot(item, fake.captureStory, { ...tools, writeImages: images.writeImages }),
      ).toStrictEqual({
        status: 'broken',
        detail: `broken: ${brokenStory.message}`,
        attempts: load,
        broken: brokenStory,
        console: [],
        images: {
          baseline: 'images/web/a.baseline.png',
          snapshot: 'images/web/a.snapshot.png',
          diff: null,
          compared: null,
        },
      })
      expect(images.written).toEqual([{ baseline: darkGrey, snapshot: grey }])
    },
  )

  it('keeps only a copy of the baseline of a load that broke with no image of its page', async () => {
    const { item } = snapshotOf(darkGrey)
    const fake = fakeCapturesOf([{ broken: brokenStory }])
    const images = fakeImagesOf()

    const result = await updateSnapshot(item, fake.captureStory, { ...tools, writeImages: images.writeImages })

    expect(result.images).toEqual({ baseline: 'images/web/a.baseline.png', snapshot: null, diff: null, compared: null })
    expect(images.written).toEqual([{ baseline: darkGrey }])
  })

  it('keeps no image of a load that broke with no image of its page and no baseline', async () => {
    const { item } = snapshotOf()
    const fake = fakeCapturesOf([{ broken: brokenStory }])
    const images = fakeImagesOf()

    const result = await updateSnapshot(item, fake.captureStory, { ...tools, writeImages: images.writeImages })

    expect(result.images).toBeUndefined()
    expect(images.written).toEqual([])
  })

  it('keeps no image of a snapshot it writes or keeps', async () => {
    const written = snapshotOf()
    const kept = snapshotOf(black)
    const images = fakeImagesOf()
    const withImages = { ...tools, writeImages: images.writeImages }

    const results = [
      await updateSnapshot(
        written.item,
        fakeCapturesOf([{ snapshot: black }, { snapshot: black }]).captureStory,
        withImages,
      ),
      await updateSnapshot(kept.item, fakeCapturesOf([{ snapshot: black }]).captureStory, withImages),
    ]

    expect(results.map(({ status, images }) => ({ status, images }))).toEqual([
      { status: 'written', images: undefined },
      { status: 'kept', images: undefined },
    ])
    expect(images.written).toEqual([])
  })

  it('asks for no image of a broken page and keeps none without writeImages', async () => {
    const { item } = snapshotOf(darkGrey)
    const fake = fakeCapturesOf([{ snapshot: black }, { snapshot: white }, { snapshot: grey }])

    expect(await updateSnapshot(item, fake.captureStory, tools)).toStrictEqual(unstableResult)
    expect(fake.stories.map((story) => story.imageWhenBroken)).toEqual([undefined, undefined, undefined])
  })
})
