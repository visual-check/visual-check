import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { BrokenStory, StoryCapture } from '../capture/capture-session.js'
import type { PageError } from '../capture/driver/driver.js'
import { greyPng, whitePixels } from '../visual-diff/images.fixture.js'
import { createVisualDiff } from '../visual-diff/visual-diff.js'
import type { SnapshotToCapture } from './plan-snapshots.js'
import type { CaptureStory } from './snapshot-result.js'
import { type SnapshotTools, takeSnapshot } from './take-snapshot.js'

/**
 * A black PNG file of 10 × 10 pixels.
 */
const black = new Uint8Array(await greyPng(10, 10, 0))

/**
 * A white PNG file of 10 × 10 pixels, whose 100 pixels all differ from `black`'s.
 */
const white = new Uint8Array(await greyPng(10, 10, 255))

/**
 * A grey PNG file of 10 × 10 pixels, whose 100 pixels all differ from `black`'s and `white`'s.
 */
const grey = new Uint8Array(await greyPng(10, 10, 128))

/**
 * `black` with 3 white pixels: within the default tolerance of `black`.
 */
const threeWhite = new Uint8Array(await greyPng(10, 10, 0, whitePixels(3, 10)))

/**
 * A page error a capture's page raised: an uncaught error.
 */
const thrown: PageError = { kind: 'error', text: 'Uncaught Error: Boom' }

/**
 * Another page error a capture's page raised: a load of a file that got an HTTP 404.
 */
const missingLoad: PageError = { kind: 'load', text: 'http://web.test/missing.json', loadError: 'HTTP 404' }

/**
 * A third page error a capture's page raised: a `console.error`.
 */
const logged: PageError = { kind: 'console.error', text: 'Failed to fetch' }

/**
 * The broken story a capture gives when Storybook reports the story finished with an error.
 */
const brokenStory: BrokenStory = { reason: 'error', message: 'Storybook reported the story finished with an error.' }

/**
 * The visual diff every test compares with, closed after the last test.
 */
const visualDiff = createVisualDiff()

afterAll(async () => {
  await visualDiff.close()
})

/**
 * The folders the tests made, removed after each test.
 */
const folders: string[] = []

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

/**
 * Builds the snapshot of story `a`, with a baselines folder of its own holding `baseline` as its baseline when given
 * and nothing when not.
 */
function snapshotOf(baseline?: Uint8Array): SnapshotToCapture {
  const folder = mkdtempSync(join(tmpdir(), 'visual-check-take-'))

  folders.push(folder)

  if (baseline !== undefined) {
    writeFileSync(join(folder, 'a.png'), baseline)
  }

  return {
    storybook: { name: 'web', dir: '/web', configDir: '/web/.storybook', baselines: folder, url: 'http://web.test' },
    story: { id: 'a', title: 'Title', name: 'Name', importPath: './a.stories.tsx' },
    mode: undefined,
    key: 'a',
    selected: true,
    options: {},
    tolerance: { color: 0.01, pixels: 20 },
    pageErrorPolicy: { check: 'fail', expected: [], storyExpected: [] },
    viewport: { width: 10, height: 10, deviceScaleFactor: 1, touch: false },
    globals: {},
  }
}

/**
 * The tools of `test`, with `retries` retries, capturing a missing baseline when `captureMissing` says so. It writes
 * no images.
 */
function testTools(retries: number, captureMissing = false): SnapshotTools {
  return {
    command: 'test',
    visualDiff,
    retries,
    captureMissing,
    writeImages: async () => ({ baseline: null, snapshot: null, diff: null }),
  }
}

/**
 * The tools of `update`, which captures a page again at once.
 */
const updateTools: SnapshotTools = { command: 'update', visualDiff, recaptureDelayMs: 0 }

/**
 * A capture the fake gives: a snapshot, or a broken story, with the page errors its page raised.
 */
type FakeCapture =
  | {
      /**
       * The snapshot, which the page shows the same when captured again.
       */
      snapshot: Uint8Array
      /**
       * The page errors its page raised.
       */
      pageErrors: PageError[]
    }
  | {
      /**
       * Why the story can't be captured.
       */
      broken: BrokenStory
      /**
       * The page errors its page raised.
       */
      pageErrors: PageError[]
    }

/**
 * A fake `CaptureStory` that gives `captures` in order, one per call, and throws when asked for more. Like a capture
 * session, it calls the story's `captureAgainIf` with a snapshot, and gives the same page captured again when it
 * resolves true.
 */
function captureStoryOf(captures: readonly FakeCapture[]): CaptureStory {
  const queue = [...captures]

  return async (story): Promise<StoryCapture> => {
    const capture = queue.shift()

    if (capture === undefined) {
      throw new Error('The test gave too few captures.')
    }

    if ('broken' in capture) {
      return capture
    }

    const captured = { ...capture, completingMs: undefined, console: [] }

    return (await story.captureAgainIf?.(capture.snapshot)) === true
      ? { ...captured, capturedAgain: capture.snapshot }
      : captured
  }
}

describe('takeSnapshot', () => {
  it('gives a story whose stories file failed to load no page errors', async () => {
    const { storybook, story, key } = snapshotOf()
    const item = { storybook, story, mode: undefined, key, selected: true, broken: brokenStory }

    expect(await takeSnapshot(item, captureStoryOf([]), testTools(2))).toMatchObject({
      status: 'broken',
      gatheredPageErrors: [],
    })
  })

  it('gives a missing baseline it took no capture of no page errors', async () => {
    expect(await takeSnapshot(snapshotOf(), captureStoryOf([]), testTools(2))).toMatchObject({
      status: 'missing',
      gatheredPageErrors: [],
    })
  })

  it("gives the page errors of a missing baseline's capture", async () => {
    const captures = [{ snapshot: white, pageErrors: [thrown] }]

    expect(await takeSnapshot(snapshotOf(), captureStoryOf(captures), testTools(2, true))).toMatchObject({
      status: 'missing',
      gatheredPageErrors: [thrown],
    })
  })

  it('gives the page errors of a capture that passed', async () => {
    const captures = [{ snapshot: threeWhite, pageErrors: [thrown] }]

    expect(await takeSnapshot(snapshotOf(black), captureStoryOf(captures), testTools(2))).toMatchObject({
      status: 'passed',
      gatheredPageErrors: [thrown],
    })
  })

  it("gathers the page errors of every retry of test's, a broken one included", async () => {
    const captures: FakeCapture[] = [
      { snapshot: white, pageErrors: [thrown] },
      { snapshot: white, pageErrors: [missingLoad] },
      { broken: brokenStory, pageErrors: [logged] },
    ]

    expect(await takeSnapshot(snapshotOf(black), captureStoryOf(captures), testTools(3))).toMatchObject({
      status: 'differs',
      attempts: 3,
      gatheredPageErrors: [thrown, missingLoad, logged],
    })
  })

  it('gathers the page errors of a retry that passed', async () => {
    const captures = [
      { snapshot: white, pageErrors: [] },
      { snapshot: black, pageErrors: [missingLoad] },
    ]

    expect(await takeSnapshot(snapshotOf(black), captureStoryOf(captures), testTools(2))).toMatchObject({
      status: 'passed',
      flaky: true,
      gatheredPageErrors: [missingLoad],
    })
  })

  it('lists a page error raised on several captures once, in the order first seen', async () => {
    const captures = [
      { snapshot: white, pageErrors: [thrown] },
      { snapshot: white, pageErrors: [missingLoad, { ...thrown }] },
      { snapshot: white, pageErrors: [{ ...missingLoad }] },
    ]
    const result = await takeSnapshot(snapshotOf(black), captureStoryOf(captures), testTools(2))

    expect(result.gatheredPageErrors).toEqual([thrown, missingLoad])
  })

  it('gives the page errors of a broken first capture', async () => {
    const captures = [{ broken: brokenStory, pageErrors: [thrown, missingLoad] }]

    expect(await takeSnapshot(snapshotOf(black), captureStoryOf(captures), testTools(2))).toMatchObject({
      status: 'broken',
      gatheredPageErrors: [thrown, missingLoad],
    })
  })

  it("gathers the page errors of all 3 of update's loads", async () => {
    const captures = [
      { snapshot: white, pageErrors: [thrown] },
      { snapshot: threeWhite, pageErrors: [missingLoad] },
      { snapshot: black, pageErrors: [logged] },
    ]

    expect(await takeSnapshot(snapshotOf(), captureStoryOf(captures), updateTools)).toMatchObject({
      status: 'written',
      attempts: 3,
      gatheredPageErrors: [thrown, missingLoad, logged],
    })
  })

  it('gathers the page errors of all 3 loads of a story none of whose loads agree', async () => {
    const captures = [
      { snapshot: black, pageErrors: [thrown] },
      { snapshot: white, pageErrors: [missingLoad] },
      { snapshot: grey, pageErrors: [logged] },
    ]

    expect(await takeSnapshot(snapshotOf(), captureStoryOf(captures), updateTools)).toMatchObject({
      status: 'broken',
      gatheredPageErrors: [thrown, missingLoad, logged],
    })
  })

  it('gives the page errors of the one load of a baseline update keeps', async () => {
    const captures = [{ snapshot: threeWhite, pageErrors: [thrown] }]

    expect(await takeSnapshot(snapshotOf(black), captureStoryOf(captures), updateTools)).toMatchObject({
      status: 'kept',
      gatheredPageErrors: [thrown],
    })
  })

  it("gathers the page errors of update's first load and of a second that broke", async () => {
    const captures: FakeCapture[] = [
      { snapshot: white, pageErrors: [thrown] },
      { broken: brokenStory, pageErrors: [missingLoad] },
    ]

    expect(await takeSnapshot(snapshotOf(), captureStoryOf(captures), updateTools)).toMatchObject({
      status: 'broken',
      attempts: 2,
      gatheredPageErrors: [thrown, missingLoad],
    })
  })
})
