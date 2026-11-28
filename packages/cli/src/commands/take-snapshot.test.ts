import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { BrokenStory, StoryCapture, StoryToCapture } from '../capture/capture-session.js'
import type { PageError } from '../capture/driver/driver.js'
import type { JudgedPageError } from '../page-errors/judge-page-errors.js'
import type { PageErrorPolicy } from '../page-errors/page-error-policy.js'
import type { RealRequestPolicy } from '../real-network-requests/real-request-policy.js'
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
 * Gives a page error as listed when it fails the run.
 */
function failing(error: PageError): JudgedPageError {
  return { ...error, severity: 'fail' }
}

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
 * The page error policy of a story that sets no page error options under the default config.
 */
const failOnAll: PageErrorPolicy = { check: 'fail', expected: [], storyExpected: [] }

/**
 * The real network request policy of a story that sets no `realRequests` under the default config.
 */
const unchecked: RealRequestPolicy = { check: 'off', silenceHosts: [] }

/**
 * Builds the snapshot of story `a`, with a baselines folder of its own holding `baseline` as its baseline when given
 * and nothing when not, judging its page errors by `pageErrorPolicy` and its real network requests by
 * `realRequestPolicy`.
 */
function snapshotOf(
  baseline?: Uint8Array,
  pageErrorPolicy = failOnAll,
  realRequestPolicy = unchecked,
): SnapshotToCapture {
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
    pageErrorPolicy,
    realRequestPolicy,
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
    writeImages: async () => ({ baseline: null, snapshot: null, diff: null, compared: null }),
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
      /**
       * The hosts of the real network requests its page made, given only when the story asks for them. None when not
       * given.
       */
      requestHosts?: string[]
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
      /**
       * The hosts of the real network requests its page made, given only when the story asks for them. None when not
       * given.
       */
      requestHosts?: string[]
    }

/**
 * A fake `CaptureStory` that gives `captures` in order, one per call, and throws when asked for more. Like a capture
 * session, it gives a capture's request hosts only when the story asks for them with `watchRequests`, calls the story's
 * `captureAgainIf` with a snapshot, and gives the same page captured again when it resolves true. Each story it was
 * asked to capture is kept in `asked`, when given.
 */
function captureStoryOf(captures: readonly FakeCapture[], asked: StoryToCapture[] = []): CaptureStory {
  const queue = [...captures]

  return async (story): Promise<StoryCapture> => {
    asked.push(story)

    const next = queue.shift()

    if (next === undefined) {
      throw new Error('The test gave too few captures.')
    }

    const { requestHosts = [], ...rest } = next
    const capture = story.watchRequests === true ? { ...rest, requestHosts } : rest

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
      pageErrors: [],
      staleExpectedPageErrors: [],
    })
  })

  it('gives a missing baseline it took no capture of no page errors', async () => {
    expect(await takeSnapshot(snapshotOf(), captureStoryOf([]), testTools(2))).toMatchObject({
      status: 'missing',
      pageErrors: [],
      staleExpectedPageErrors: [],
    })
  })

  it("gives the page errors of a missing baseline's capture", async () => {
    const captures = [{ snapshot: white, pageErrors: [thrown] }]

    expect(await takeSnapshot(snapshotOf(), captureStoryOf(captures), testTools(2, true))).toMatchObject({
      status: 'missing',
      pageErrors: [failing(thrown)],
    })
  })

  it('gives the page errors of a capture that passed', async () => {
    const captures = [{ snapshot: threeWhite, pageErrors: [thrown] }]

    expect(await takeSnapshot(snapshotOf(black), captureStoryOf(captures), testTools(2))).toMatchObject({
      status: 'passed',
      pageErrors: [failing(thrown)],
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
      pageErrors: [failing(thrown), failing(missingLoad), failing(logged)],
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
      pageErrors: [failing(missingLoad)],
    })
  })

  it('lists a page error raised on several captures once, in the order first seen', async () => {
    const captures = [
      { snapshot: white, pageErrors: [thrown] },
      { snapshot: white, pageErrors: [missingLoad, { ...thrown }] },
      { snapshot: white, pageErrors: [{ ...missingLoad }] },
    ]
    const result = await takeSnapshot(snapshotOf(black), captureStoryOf(captures), testTools(2))

    expect(result.pageErrors).toEqual([failing(thrown), failing(missingLoad)])
  })

  it('gives the page errors of a broken first capture', async () => {
    const captures = [{ broken: brokenStory, pageErrors: [thrown, missingLoad] }]

    expect(await takeSnapshot(snapshotOf(black), captureStoryOf(captures), testTools(2))).toMatchObject({
      status: 'broken',
      pageErrors: [failing(thrown), failing(missingLoad)],
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
      pageErrors: [failing(thrown), failing(missingLoad), failing(logged)],
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
      pageErrors: [failing(thrown), failing(missingLoad), failing(logged)],
    })
  })

  it('gives the page errors of the one load of a baseline update keeps', async () => {
    const captures = [{ snapshot: threeWhite, pageErrors: [thrown] }]

    expect(await takeSnapshot(snapshotOf(black), captureStoryOf(captures), updateTools)).toMatchObject({
      status: 'kept',
      pageErrors: [failing(thrown)],
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
      pageErrors: [failing(thrown), failing(missingLoad)],
    })
  })

  it("judges the page errors by the snapshot's policy, dropping expected ones and giving stale entries", async () => {
    const policy: PageErrorPolicy = { check: 'warn', expected: ['Boom', 'Not raised'], storyExpected: ['Not raised'] }
    const captures = [{ snapshot: threeWhite, pageErrors: [thrown, logged] }]

    expect(await takeSnapshot(snapshotOf(black, policy), captureStoryOf(captures), testTools(2))).toMatchObject({
      status: 'passed',
      pageErrors: [{ ...logged, severity: 'warn' }],
      staleExpectedPageErrors: ['"Not raised"'],
    })
  })

  it('gives no stale entries for a broken snapshot', async () => {
    const policy: PageErrorPolicy = { check: 'fail', expected: ['Not raised'], storyExpected: ['Not raised'] }
    const captures = [{ broken: brokenStory, pageErrors: [thrown] }]

    expect(await takeSnapshot(snapshotOf(black, policy), captureStoryOf(captures), testTools(2))).toMatchObject({
      status: 'broken',
      pageErrors: [failing(thrown)],
      staleExpectedPageErrors: [],
    })
  })

  it('gives no stale entries for a missing baseline it took no capture of', async () => {
    const policy: PageErrorPolicy = { check: 'fail', expected: ['Not raised'], storyExpected: ['Not raised'] }

    expect(await takeSnapshot(snapshotOf(undefined, policy), captureStoryOf([]), testTools(2))).toMatchObject({
      status: 'missing',
      staleExpectedPageErrors: [],
    })
  })

  it("lists nothing by the policy's 'off'", async () => {
    const policy: PageErrorPolicy = { check: 'off', expected: [], storyExpected: ['Not raised'] }
    const captures = [
      { snapshot: white, pageErrors: [thrown] },
      { snapshot: white, pageErrors: [logged] },
    ]

    expect(await takeSnapshot(snapshotOf(undefined, policy), captureStoryOf(captures), updateTools)).toMatchObject({
      status: 'written',
      pageErrors: [],
      staleExpectedPageErrors: [],
    })
  })

  describe('real network requests', () => {
    /**
     * The policy of a story that fails `test` on its real network requests and silences `silenced.test`.
     */
    const failing: RealRequestPolicy = { check: 'fail', silenceHosts: ['silenced.test'] }

    it("asks test's every capture to watch requests and lists each host of every capture once, a broken retry's included", async () => {
      const asked: StoryToCapture[] = []
      const captures: FakeCapture[] = [
        { snapshot: white, pageErrors: [], requestHosts: ['api.test'] },
        { broken: brokenStory, pageErrors: [], requestHosts: ['api.test', 'silenced.test:8443', 'ws.test'] },
      ]
      const result = await takeSnapshot(
        snapshotOf(black, failOnAll, failing),
        captureStoryOf(captures, asked),
        testTools(2),
      )

      expect(result).toMatchObject({
        status: 'differs',
        attempts: 2,
        realRequests: [
          { host: 'api.test', severity: 'fail' },
          { host: 'ws.test', severity: 'fail' },
        ],
      })
      expect(asked.map(({ watchRequests }) => watchRequests)).toEqual([true, true])
    })

    it("lists them by 'warn' without changing the status of a broken capture", async () => {
      const captures = [{ broken: brokenStory, pageErrors: [], requestHosts: ['api.test'] }]
      const result = await takeSnapshot(
        snapshotOf(black, failOnAll, { check: 'warn', silenceHosts: [] }),
        captureStoryOf(captures),
        testTools(2),
      )

      expect(result).toMatchObject({ status: 'broken', realRequests: [{ host: 'api.test', severity: 'warn' }] })
    })

    it("doesn't ask to watch requests and lists none by the policy's 'off'", async () => {
      const asked: StoryToCapture[] = []
      const captures = [{ snapshot: threeWhite, pageErrors: [], requestHosts: ['api.test'] }]
      const result = await takeSnapshot(snapshotOf(black), captureStoryOf(captures, asked), testTools(2))

      expect(result).toMatchObject({ status: 'passed', realRequests: [] })
      expect(asked[0]).not.toHaveProperty('watchRequests')
    })

    it("never asks update's loads to watch requests, and lists none, whatever the policy", async () => {
      const asked: StoryToCapture[] = []
      const captures = [
        { snapshot: black, pageErrors: [], requestHosts: ['api.test'] },
        { snapshot: black, pageErrors: [], requestHosts: ['api.test'] },
      ]
      const result = await takeSnapshot(
        snapshotOf(undefined, failOnAll, failing),
        captureStoryOf(captures, asked),
        updateTools,
      )

      expect(result).toMatchObject({ status: 'written', realRequests: [] })
      expect(asked.map((story) => 'watchRequests' in story)).toEqual([false, false])
    })

    it('lists none for a snapshot it took no capture of', async () => {
      const { storybook, story, key } = snapshotOf()
      const item = { storybook, story, mode: undefined, key, selected: true, broken: brokenStory }

      expect(await takeSnapshot(item, captureStoryOf([]), testTools(2))).toMatchObject({ realRequests: [] })
      expect(
        await takeSnapshot(snapshotOf(undefined, failOnAll, failing), captureStoryOf([]), testTools(2)),
      ).toMatchObject({ status: 'missing', realRequests: [] })
    })
  })
})
