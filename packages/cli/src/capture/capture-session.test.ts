import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finishedAnswer, timedOutAnswer } from '../storybook/preview-script.fixture.js'
import { storyWaitExpression } from '../storybook/preview-script.js'
import { waitHookExpression } from '../storybook/wait-hook.js'
import {
  type CaptureSettings,
  gridProblemOf,
  openCaptureSession,
  overflowProblemOf,
  remoteContentBoxesOf,
  remoteHostsOf,
} from './capture-session.js'
import {
  BrowserExitedError,
  CaptureTooLargeError,
  type ConsoleMessage,
  PageCrashedError,
  PageLoadError,
  PageNavigatedAwayError,
  PageTimeoutError,
} from './driver/driver.js'
import { animationsTimedOutAnswer, mediaTimedOutAnswer, settledAnswer } from './end-state.fixture.js'
import { defaultSnapshot, FakeDriver, type FakePageBehaviour } from './fake-driver.fixture.js'
import { fontsTimedOutAnswer, imagesTimedOutAnswer, readyAnswer } from './page-script.fixture.js'
import {
  assetsReadyExpression,
  endStateExpression,
  framesAfterGrowthExpression,
  pageInitScript,
  prepareCaptureExpression,
} from './page-script.js'

/**
 * The settings every session in these tests captures with.
 */
const settings: CaptureSettings = {
  readyTimeoutMs: 10_000,
  timezone: 'Europe/Warsaw',
  locale: 'pl-PL',
  colorScheme: 'dark',
  maskColor: '#00FF00',
  listHosts: false,
  brokenImageTimeLimitMs: 5_000,
}

/**
 * The story most tests capture.
 */
const primary = {
  id: 'button--primary',
  url: 'http://localhost:6006/iframe.html?id=button--primary&viewMode=story',
  viewport: { width: 1280, height: 720, deviceScaleFactor: 2, touch: false },
}

/**
 * Another story, for tests that capture twice.
 */
const secondary = {
  id: 'button--secondary',
  url: 'http://localhost:6006/iframe.html?id=button--secondary&viewMode=story',
  viewport: { width: 375, height: 667, deviceScaleFactor: 3, touch: true },
}

/**
 * Builds the capture preparation expression for a story without element or masks, with this time limit.
 */
function plainPrepExpression(timeoutMs: number): string {
  return prepareCaptureExpression({ element: null, masks: [], maskColor: '#00FF00', findRemote: false }, timeoutMs)
}

/**
 * Lets `ms` pass on the clock the session measures time with.
 */
function pass(ms: number): void {
  vi.advanceTimersByTime(ms)
}

/**
 * The answer of a wait hook that ran and settled well.
 */
const ran = { outcome: 'done' }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('openCaptureSession', () => {
  it('opens no page until the first capture', () => {
    const driver = new FakeDriver()

    openCaptureSession(driver, settings)
    expect(driver.setups).toEqual([])
  })

  it("opens its page with the settings, Storybook's test-runner user agent and the page script, watching no requests", async () => {
    const driver = new FakeDriver()

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.setups).toEqual([
      {
        userAgentSuffix: ' StorybookTestRunner',
        timezone: 'Europe/Warsaw',
        locale: 'pl-PL',
        colorScheme: 'dark',
        initScript: pageInitScript,
        watchRequests: false,
      },
    ])
  })

  it('watches requests on its page when the settings list hosts', async () => {
    const driver = new FakeDriver()

    await openCaptureSession(driver, { ...settings, listHosts: true }).capture(primary)
    expect(driver.setups[0]?.watchRequests).toBe(true)
  })

  it('keeps using its page while captures succeed', async () => {
    const driver = new FakeDriver()
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await session.capture(secondary)
    expect(driver.setups).toHaveLength(1)
    expect(driver.methods()).not.toContain('1:close')
  })
})

describe('the hosts of a capture', () => {
  const listing = { ...settings, listHosts: true }

  it("are the page's request hosts, read after the capture, and the hosts of the remote content found", async () => {
    let captured = false
    const remote = [
      { host: 'images.example.com', x: 1, y: 2, width: 3, height: 4 },
      { host: 'cdn.example.com:8443', x: 5, y: 6, width: 7, height: 8 },
      { host: 'images.example.com', x: 9, y: 9, width: 9, height: 9 },
    ]
    const driver = new FakeDriver({
      pages: [
        {
          capturePrep: async () => ({ outcome: 'ready', box: null, remote }),
          capture: async () => {
            captured = true

            return defaultSnapshot
          },
          requestHosts: () => (captured ? ['api.example.com'] : []),
        },
      ],
    })

    expect(await openCaptureSession(driver, listing).capture(primary)).toEqual({
      snapshot: defaultSnapshot,
      console: [],
      hosts: { requests: ['api.example.com'], remoteContent: ['images.example.com', 'cdn.example.com:8443'] },
    })
    expect(driver.calls).toContainEqual({
      page: 1,
      method: 'evaluate',
      args: [
        prepareCaptureExpression({ element: null, masks: [], maskColor: '#00FF00', findRemote: true }, 10_000),
        11_000,
      ],
    })
  })

  it("leave out the remote content the story's host masks cover", async () => {
    const remote = [
      { host: 'images.example.com', x: 1, y: 2, width: 3, height: 4 },
      { host: 'fonts.example.com', x: 5, y: 6, width: 7, height: 8 },
    ]
    const driver = new FakeDriver({ pages: [{ capturePrep: async () => ({ outcome: 'ready', box: null, remote }) }] })
    const story = { ...primary, masks: [{ name: 'images', host: 'Images.Example.com' }] }

    expect(await openCaptureSession(driver, listing).capture(story)).toEqual({
      snapshot: defaultSnapshot,
      console: [],
      hosts: { requests: [], remoteContent: ['fonts.example.com'] },
    })
  })

  it('come without remote content boxes unless the story asks for them', async () => {
    const remote = [{ host: 'images.example.com', x: 1, y: 2, width: 3, height: 4 }]
    const driver = new FakeDriver({ pages: [{ capturePrep: async () => ({ outcome: 'ready', box: null, remote }) }] })
    const capture = await openCaptureSession(driver, listing).capture(primary)

    expect(capture).toEqual({
      snapshot: defaultSnapshot,
      console: [],
      hosts: { requests: [], remoteContent: ['images.example.com'] },
    })
    expect(capture).not.toHaveProperty('remoteContent')
  })

  it('come with the remote content boxes too when the story asks for them', async () => {
    const remote = [{ host: 'images.example.com', x: 1, y: 2, width: 3, height: 4 }]
    const driver = new FakeDriver({ pages: [{ capturePrep: async () => ({ outcome: 'ready', box: null, remote }) }] })
    const story = { ...primary, findRemoteContent: true, viewport: { ...primary.viewport, deviceScaleFactor: 1 } }

    expect(await openCaptureSession(driver, listing).capture(story)).toEqual({
      snapshot: defaultSnapshot,
      console: [],
      remoteContent: [{ host: 'images.example.com', x: 1, y: 2, width: 3, height: 4 }],
      hosts: { requests: [], remoteContent: ['images.example.com'] },
    })
  })

  it('list no remote content when the page gives none, as when its search timed out', async () => {
    expect(await openCaptureSession(new FakeDriver(), listing).capture(primary)).toEqual({
      snapshot: defaultSnapshot,
      console: [],
      hosts: { requests: [], remoteContent: [] },
    })
  })

  it('are left out of the snapshot when the settings do not list them', async () => {
    const driver = new FakeDriver({ pages: [{ requestHosts: () => ['api.example.com'] }] })
    const capture = await openCaptureSession(driver, settings).capture(primary)

    expect(capture).toStrictEqual({ snapshot: defaultSnapshot, completingMs: undefined, console: [] })
    expect(driver.setups[0]?.watchRequests).toBe(false)
  })
})

describe('remoteHostsOf', () => {
  it('lists each host once, in the order found', () => {
    const remote = [
      { host: 'images.example.com', x: 0, y: 0, width: 1, height: 1 },
      { host: 'cdn.example.com:8443', x: 0, y: 0, width: 1, height: 1 },
      { host: 'images.example.com', x: 2, y: 2, width: 1, height: 1 },
      { host: 'fonts.example.com', x: 0, y: 0, width: 1, height: 1 },
    ]

    expect(remoteHostsOf(remote, [])).toEqual(['images.example.com', 'cdn.example.com:8443', 'fonts.example.com'])
  })

  it('leaves out a host a host mask covers by its host or its hostname, in lowercase', () => {
    const remote = [
      { host: 'images.example.com', x: 0, y: 0, width: 1, height: 1 },
      { host: 'cdn.example.com:8443', x: 0, y: 0, width: 1, height: 1 },
      { host: 'api.example.com:9000', x: 0, y: 0, width: 1, height: 1 },
      { host: 'fonts.example.com', x: 0, y: 0, width: 1, height: 1 },
    ]
    const masks = [
      { name: 'images', host: 'Images.Example.com' },
      { name: 'cdn', host: 'cdn.example.com' },
      { name: 'api', host: 'api.example.com:9000' },
      { name: 'fonts', selector: 'fonts.example.com' },
    ]

    expect(remoteHostsOf(remote, masks)).toEqual(['fonts.example.com'])
  })

  it('keeps a host with a port when the mask names another port', () => {
    const remote = [{ host: 'cdn.example.com:8443', x: 0, y: 0, width: 1, height: 1 }]

    expect(remoteHostsOf(remote, [{ name: 'cdn', host: 'cdn.example.com:9000' }])).toEqual(['cdn.example.com:8443'])
  })

  it('lists none when the remote content is unknown', () => {
    expect(remoteHostsOf(undefined, [])).toEqual([])
  })
})

describe('a capture', () => {
  it('sets the viewport, loads the story, waits for it to finish and for its images and fonts, runs its wait hook, brings it to its end state, paints its masks and captures the full page', async () => {
    const driver = new FakeDriver()

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls).toEqual([
      { page: 1, method: 'setViewport', args: [{ width: 1280, height: 720, deviceScaleFactor: 2, touch: false }] },
      { page: 1, method: 'goto', args: [primary.url, 10_000] },
      { page: 1, method: 'evaluate', args: [storyWaitExpression('button--primary', 10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'growViewportToContent', args: [] },
      { page: 1, method: 'evaluate', args: [waitHookExpression('button--primary', 10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [endStateExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [plainPrepExpression(10_000), 11_000] },
      { page: 1, method: 'capture', args: ['full-page'] },
    ])
  })

  it('checks images and fonts again before the masks when the end state changed anything', async () => {
    const driver = new FakeDriver({ pages: [{ endStateWait: async () => settledAnswer(true) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      snapshot: defaultSnapshot,
      console: [],
    })
    expect(driver.calls.slice(3)).toEqual([
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'growViewportToContent', args: [] },
      { page: 1, method: 'evaluate', args: [waitHookExpression('button--primary', 10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [endStateExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [plainPrepExpression(10_000), 11_000] },
      { page: 1, method: 'capture', args: ['full-page'] },
    ])
  })

  it("sets each story's own viewport", async () => {
    const driver = new FakeDriver()
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await session.capture(secondary)
    expect(driver.calls.filter(({ method }) => method === 'setViewport').map(({ args }) => args)).toEqual([
      [{ width: 1280, height: 720, deviceScaleFactor: 2, touch: false }],
      [{ width: 375, height: 667, deviceScaleFactor: 3, touch: true }],
    ])
  })

  it('gives each step only the time readyTimeout has left', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          setViewport: async () => pass(500),
          goto: async () => pass(3000),
          storyWait: async () => {
            pass(2000)

            return finishedAnswer()
          },
          assetsWait: async () => {
            pass(1500)

            return readyAnswer()
          },
          endStateWait: async () => {
            pass(1500)

            return settledAnswer(true)
          },
        },
      ],
    })

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls[1]?.args).toEqual([primary.url, 9500])
    expect(driver.calls[2]?.args).toEqual([storyWaitExpression('button--primary', 6500), 7500])
    expect(driver.calls[3]?.args).toEqual([assetsReadyExpression(4500), 5500])
    expect(driver.calls[5]?.args).toEqual([waitHookExpression('button--primary', 3000), 4000])
    expect(driver.calls[6]?.args).toEqual([endStateExpression(3000), 4000])
    expect(driver.calls[7]?.args).toEqual([assetsReadyExpression(1500), 2500])
    expect(driver.calls[8]?.args).toEqual([plainPrepExpression(0), 1000])
  })

  it('rounds the time left up to whole ms', async () => {
    const driver = new FakeDriver({ pages: [{ setViewport: async () => pass(500.4) }] })

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls[1]?.args).toEqual([primary.url, 9500])
  })

  it('starts each capture with the whole of readyTimeout', async () => {
    const driver = new FakeDriver({ pages: [{ goto: async () => pass(3000) }] })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await session.capture(secondary)
    expect(driver.calls[11]).toEqual({ page: 1, method: 'goto', args: [secondary.url, 10_000] })
  })

  it('gives the snapshot exactly as the browser made it', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const driver = new FakeDriver({ pages: [{ capture: async () => bytes }] })
    const capture = await openCaptureSession(driver, settings).capture(primary)

    expect(capture).toEqual({ snapshot: bytes, console: [] })
    expect('snapshot' in capture && capture.snapshot).toBe(bytes)
  })

  it('gives how long the story\'s "completing" render step took beside its snapshot', async () => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => finishedAnswer({ completingMs: 104 }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toStrictEqual({
      snapshot: defaultSnapshot,
      console: [],
      completingMs: 104,
    })
  })

  it('gives no "completing" time when the page saw no completing and completed render steps', async () => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => finishedAnswer({ completingMs: null }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toStrictEqual({
      snapshot: defaultSnapshot,
      console: [],
      completingMs: undefined,
    })
  })
})

describe("the story's wait hook", () => {
  it('runs after images and fonts, and captures straight away when the story has none', async () => {
    const driver = new FakeDriver()

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      snapshot: defaultSnapshot,
      console: [],
    })
    expect(driver.calls.slice(3)).toEqual([
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'growViewportToContent', args: [] },
      { page: 1, method: 'evaluate', args: [waitHookExpression('button--primary', 10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [endStateExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [plainPrepExpression(10_000), 11_000] },
      { page: 1, method: 'capture', args: ['full-page'] },
    ])
  })

  it('checks images and fonts again once it ran, measures the page again, then captures', async () => {
    const driver = new FakeDriver({ pages: [{ waitHook: async () => ran }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      snapshot: defaultSnapshot,
      console: [],
    })
    expect(driver.calls.slice(3)).toEqual([
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'growViewportToContent', args: [] },
      { page: 1, method: 'evaluate', args: [waitHookExpression('button--primary', 10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'setViewport', args: [primary.viewport] },
      { page: 1, method: 'growViewportToContent', args: [] },
      { page: 1, method: 'evaluate', args: [framesAfterGrowthExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [endStateExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [plainPrepExpression(10_000), 11_000] },
      { page: 1, method: 'capture', args: ['full-page'] },
    ])
  })

  it('gets only the time readyTimeout has left, and leaves the second check of images and fonts only what is left after it', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async () => pass(3000),
          waitHook: async () => {
            pass(4000)

            return ran
          },
        },
      ],
    })

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls[5]?.args).toEqual([waitHookExpression('button--primary', 7000), 8000])
    expect(driver.calls[6]?.args).toEqual([assetsReadyExpression(3000), 4000])
  })

  it.each([
    [
      'wait-threw',
      'that threw, saying what it threw',
      { outcome: 'threw', text: 'Error: The data never came.' },
      "The story's wait hook threw Error: The data never came.",
      {},
    ],
    [
      'timeout',
      "that hadn't finished within readyTimeout",
      { outcome: 'timed-out' },
      "The story wasn't ready within readyTimeout (10000 ms): its wait hook hadn't finished.",
      { readyTimeoutMs: 10000 },
    ],
    [
      'error',
      "whose context visual-check couldn't build",
      { outcome: 'context-failed', text: 'Error: No context.' },
      "visual-check couldn't read the story's wait hook or build its context: Error: No context.",
      {},
    ],
    [
      'error',
      "that couldn't run because Storybook's preview had no render of the story",
      { outcome: 'no-render' },
      "Storybook's preview had no render of the story to run its wait hook with.",
      {},
    ],
    [
      'error',
      "that couldn't run because the page script didn't run",
      { outcome: 'script-missing' },
      "visual-check's page script didn't run in the story's page, so it couldn't run its wait hook.",
      {},
    ],
  ])('makes a broken story, %s, of a wait hook %s', async (reason, _what, answer, message, details) => {
    const driver = new FakeDriver({ pages: [{ waitHook: async () => answer }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: { reason, message, ...details },
      console: [],
    })
    expect(driver.methods()).toEqual([
      '1:setViewport',
      '1:goto',
      '1:evaluate',
      '1:evaluate',
      '1:growViewportToContent',
      '1:evaluate',
      '1:close',
    ])
  })

  /**
   * A page whose story's wait hook runs, and whose check of images and fonts after it answers as `second` says.
   */
  const checkedAfterTheHook = (second: (timeoutMs: number) => Promise<unknown>): FakePageBehaviour => {
    let checks = 0

    return {
      assetsWait: async (timeoutMs) => {
        checks += 1

        return checks === 1 ? readyAnswer() : await second(timeoutMs)
      },
      waitHook: async () => ran,
    }
  }

  it.each([
    [
      'images still loading',
      imagesTimedOutAnswer(1),
      {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): 1 of its images was still loading after its wait hook.",
        readyTimeoutMs: 10000,
      },
    ],
    [
      'document.fonts.ready unresolved',
      fontsTimedOutAnswer([]),
      {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): document.fonts.ready hadn't resolved after its wait hook.",
        readyTimeoutMs: 10000,
      },
    ],
    [
      'fonts still loading',
      fontsTimedOutAnswer(['Inter 400 normal']),
      {
        reason: 'fonts-not-loaded',
        message:
          "The story's fonts hadn't loaded within readyTimeout (10000 ms) after its wait hook. Still loading: Inter 400 normal.",
        faces: ['Inter 400 normal'],
        readyTimeoutMs: 10000,
      },
    ],
    [
      'a page that lost the page script',
      { outcome: 'script-missing' },
      {
        reason: 'error',
        message:
          "visual-check's page script didn't run in the story's page, so it couldn't wait for its images and fonts after its wait hook.",
      },
    ],
  ])('makes a broken story of %s once it ran, saying it was after the hook', async (_what, answer, broken) => {
    const driver = new FakeDriver({ pages: [checkedAfterTheHook(async () => answer)] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({ broken, console: [] })
    expect(driver.methods()).not.toContain('1:capture')
    expect(driver.methods().filter((method) => method === '1:setViewport')).toHaveLength(1)
  })

  it("makes a broken story, timeout, of a page that doesn't answer while it runs, naming that step", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          waitHook: async (timeoutMs) => {
            pass(timeoutMs)

            throw new PageTimeoutError("The expression evaluated in the page didn't finish within 11 s.", timeoutMs)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): its page stopped answering while its wait hook ran.",
        readyTimeoutMs: 10000,
      },
      console: [],
    })
  })

  it('names the step it was in when the page crashes while it runs', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          waitHook: async () => {
            throw new PageCrashedError()
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'crashed',
        message:
          "The page crashed while running the story's wait hook, usually because it ran out of memory. Fewer workers leave each page more memory.",
      },
      console: [],
    })
  })

  it("names the check of images and fonts after it when the page doesn't answer that check in time", async () => {
    const driver = new FakeDriver({
      pages: [
        checkedAfterTheHook(async (timeoutMs) => {
          pass(timeoutMs)

          throw new PageTimeoutError("The expression evaluated in the page didn't finish within 11 s.", timeoutMs)
        }),
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): its page stopped answering while visual-check waited for its images and fonts after its wait hook.",
        readyTimeoutMs: 10000,
      },
      console: [],
    })
  })

  it('names the check of images and fonts after it when the page crashes in that check', async () => {
    const driver = new FakeDriver({
      pages: [
        checkedAfterTheHook(async () => {
          throw new PageCrashedError()
        }),
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'crashed',
        message:
          'The page crashed while waiting for images and fonts after its wait hook, usually because it ran out of memory. Fewer workers leave each page more memory.',
      },
      console: [],
    })
  })

  it("names the check of images and fonts after it when that check gives an answer visual-check doesn't know", async () => {
    const driver = new FakeDriver({ pages: [checkedAfterTheHook(async () => 42)] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "Waiting for images and fonts after its wait hook failed: The wait for images and fonts in the page gave an answer visual-check doesn't know: 42.",
      },
      console: [],
    })
  })

  it("makes a broken story of a run that gives an answer visual-check doesn't know", async () => {
    const driver = new FakeDriver({ pages: [{ waitHook: async () => 42 }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "Running the story's wait hook failed: The wait hook in the page gave an answer visual-check doesn't know: 42.",
      },
      console: [],
    })
  })

  it('leaves the next story a fresh page after it threw', async () => {
    const driver = new FakeDriver({ pages: [{ waitHook: async () => ({ outcome: 'threw', text: 'Error: boom' }) }] })
    const session = openCaptureSession(driver, settings)

    expect(await session.capture(primary)).toHaveProperty('broken.reason', 'wait-threw')
    expect(await session.capture(secondary)).toEqual({ snapshot: defaultSnapshot, console: [] })
    expect(driver.setups).toHaveLength(2)
    expect(driver.methods()).toContain('1:close')
    expect(driver.methods()).not.toContain('2:clearStorage')
  })
})

describe('growing the viewport to the page', () => {
  it('grows it after the first check of images and fonts, before the wait hook, for a full-page capture', async () => {
    const driver = new FakeDriver()

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls.slice(3, 6)).toEqual([
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'growViewportToContent', args: [] },
      { page: 1, method: 'evaluate', args: [waitHookExpression('button--primary', 10_000), 11_000] },
    ])
  })

  it.each([
    ['captures an element', { ...primary, element: '#card' }],
    ['turns it off', { ...primary, growViewport: false }],
  ])('leaves it as it is for a story that %s', async (_what, story) => {
    const driver = new FakeDriver()

    await openCaptureSession(driver, settings).capture(story)
    expect(driver.methods()).not.toContain('1:growViewportToContent')
    expect(driver.methods()).toContain('1:capture')
  })

  it('lets two frames pass once it grew, so the page reacts, then checks images and fonts again and runs the wait hook', async () => {
    const driver = new FakeDriver({ pages: [{ growViewportToContent: async () => true }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      snapshot: defaultSnapshot,
      console: [],
    })
    expect(driver.calls.slice(3, 8)).toEqual([
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'growViewportToContent', args: [] },
      { page: 1, method: 'evaluate', args: [framesAfterGrowthExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [waitHookExpression('button--primary', 10_000), 11_000] },
    ])
  })

  it('lets no frame pass when the page fits its viewport', async () => {
    const driver = new FakeDriver()

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls).not.toContainEqual({
      page: 1,
      method: 'evaluate',
      args: [framesAfterGrowthExpression(10_000), 11_000],
    })
  })

  it('makes a broken story of frames that never passed once it grew, saying visual-check let the page react', async () => {
    const driver = new FakeDriver({
      pages: [{ growViewportToContent: async () => true, framesWait: async () => ({ outcome: 'timed-out' }) }],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): visual-check was still letting the page react to the grown viewport.",
        readyTimeoutMs: 10000,
      },
      console: [],
    })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it('makes a broken story, error, of a page without the page script once it grew', async () => {
    const driver = new FakeDriver({
      pages: [{ growViewportToContent: async () => true, framesWait: async () => ({ outcome: 'script-missing' }) }],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "visual-check's page script didn't run in the story's page, so it couldn't let the page react to the grown viewport.",
      },
      console: [],
    })
  })

  it('makes a broken story of a page that stopped answering while it reacted to the grown viewport', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          growViewportToContent: async () => true,
          framesWait: async (timeoutMs) => {
            throw new PageTimeoutError("The expression evaluated in the page didn't finish within 11 s.", timeoutMs)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): its page stopped answering while visual-check let it react to the grown viewport.",
        readyTimeoutMs: 10000,
      },
      console: [],
    })
  })

  it('makes a broken story of images still loading once it grew, saying it was after growing the viewport', async () => {
    let checks = 0
    const driver = new FakeDriver({
      pages: [
        {
          growViewportToContent: async () => true,
          assetsWait: async () => {
            checks += 1

            return checks === 1 ? readyAnswer() : imagesTimedOutAnswer(1)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): 1 of its images was still loading after growing the viewport.",
        readyTimeoutMs: 10000,
      },
      console: [],
    })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it('makes a broken story, error, of a page that failed to grow it, naming that step', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          growViewportToContent: async () => {
            throw new Error('The browser said no.')
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: { reason: 'error', message: 'Growing the viewport to the page failed: The browser said no.' },
      console: [],
    })
    expect(driver.methods().at(-1)).toBe('1:close')
  })
})

describe('measuring the page again after the wait hook', () => {
  /**
   * A `growViewportToContent` answer that gives `grown[n]` on its n-th call, and false after them.
   */
  const growing = (...grown: boolean[]): (() => Promise<boolean>) => {
    let calls = 0

    return async () => {
      calls += 1

      return grown[calls - 1] ?? false
    }
  }

  /**
   * A page call that succeeds the first time and does as `second` says after that.
   */
  const failingSecond = <T>(first: T, second: () => Promise<T>): (() => Promise<T>) => {
    let calls = 0

    return async () => {
      calls += 1

      return calls === 1 ? first : await second()
    }
  }

  /**
   * A page whose story's wait hook runs, and whose third check of images and fonts, the one once the viewport was set
   * again after the hook, answers as `third` says. The two before it find everything ready.
   */
  const checkedAfterRegrowth = (third: (timeoutMs: number) => Promise<unknown>): FakePageBehaviour => {
    let checks = 0

    return {
      assetsWait: async (timeoutMs) => {
        checks += 1

        return checks <= 2 ? readyAnswer() : await third(timeoutMs)
      },
      waitHook: async () => ran,
    }
  }

  it("sets the story's viewport again once the hook ran, grows it to the page, lets two frames pass and checks images and fonts again, before the end state", async () => {
    const driver = new FakeDriver({
      pages: [{ waitHook: async () => ran, growViewportToContent: growing(false, true) }],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      snapshot: defaultSnapshot,
      console: [],
    })
    expect(driver.calls.slice(3)).toEqual([
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'growViewportToContent', args: [] },
      { page: 1, method: 'evaluate', args: [waitHookExpression('button--primary', 10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'setViewport', args: [{ width: 1280, height: 720, deviceScaleFactor: 2, touch: false }] },
      { page: 1, method: 'growViewportToContent', args: [] },
      { page: 1, method: 'evaluate', args: [framesAfterGrowthExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [endStateExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [plainPrepExpression(10_000), 11_000] },
      { page: 1, method: 'capture', args: ['full-page'] },
    ])
  })

  it('measures again after a first growth too', async () => {
    const driver = new FakeDriver({
      pages: [{ waitHook: async () => ran, growViewportToContent: growing(true, true) }],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      snapshot: defaultSnapshot,
      console: [],
    })
    expect(driver.calls.slice(3)).toEqual([
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'growViewportToContent', args: [] },
      { page: 1, method: 'evaluate', args: [framesAfterGrowthExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [waitHookExpression('button--primary', 10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'setViewport', args: [primary.viewport] },
      { page: 1, method: 'growViewportToContent', args: [] },
      { page: 1, method: 'evaluate', args: [framesAfterGrowthExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [endStateExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [plainPrepExpression(10_000), 11_000] },
      { page: 1, method: 'capture', args: ['full-page'] },
    ])
  })

  it("lets two frames pass and checks images and fonts again even when the page fits the story's viewport", async () => {
    const driver = new FakeDriver({ pages: [{ waitHook: async () => ran }] })

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls.slice(7, 11)).toEqual([
      { page: 1, method: 'setViewport', args: [primary.viewport] },
      { page: 1, method: 'growViewportToContent', args: [] },
      { page: 1, method: 'evaluate', args: [framesAfterGrowthExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
    ])
  })

  it("sets the snapshot's own viewport again, a touch mode's included", async () => {
    const driver = new FakeDriver({ pages: [{ waitHook: async () => ran }] })

    await openCaptureSession(driver, settings).capture(secondary)
    expect(driver.calls.filter((call) => call.method === 'setViewport').map((call) => call.args)).toEqual([
      [secondary.viewport],
      [secondary.viewport],
    ])
  })

  it.each([
    ['has no wait hook', primary, {}, 1],
    ['captures an element', { ...primary, element: '#card' }, { waitHook: async () => ran }, 0],
    ['turns the growth off', { ...primary, growViewport: false }, { waitHook: async () => ran }, 0],
  ])('neither sets the viewport again nor grows it for a story that %s', async (_what, story, page, grows) => {
    const driver = new FakeDriver({ pages: [page] })

    await openCaptureSession(driver, settings).capture(story)

    const methods = driver.methods()

    expect(methods.filter((method) => method === '1:setViewport')).toHaveLength(1)
    expect(methods.filter((method) => method === '1:growViewportToContent')).toHaveLength(grows)
    expect(driver.calls.some((call) => String(call.args[0]).includes('.letFramesPass('))).toBe(false)
    expect(methods).toContain('1:capture')
  })

  it("keeps the story's viewport for a page too tall to capture after the hook, so its capture is too-tall", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          waitHook: async () => ran,
          growViewportToContent: growing(true, false),
          capture: async () => {
            throw new CaptureTooLargeError(2560, 40_000)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'too-tall',
        message:
          'The capture is 2560 × 40000 device pixels, over 32,767 on a side. Set element to capture part of the story, or use a smaller viewport.',
        size: { width: 2560, height: 40_000 },
      },
      console: [],
    })
    expect(driver.calls.filter((call) => call.method === 'setViewport').map((call) => call.args)).toEqual([
      [primary.viewport],
      [primary.viewport],
    ])
  })

  it('gives the frames and the check after it only the time readyTimeout has left', async () => {
    let viewports = 0
    const driver = new FakeDriver({
      pages: [
        {
          goto: async () => pass(3000),
          waitHook: async () => {
            pass(4000)

            return ran
          },
          setViewport: async () => {
            viewports += 1

            if (viewports === 2) {
              pass(1000)
            }
          },
        },
      ],
    })

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls[9]?.args).toEqual([framesAfterGrowthExpression(2000), 3000])
    expect(driver.calls[10]?.args).toEqual([assetsReadyExpression(2000), 3000])
    expect(driver.calls[11]?.args).toEqual([endStateExpression(2000), 3000])
  })

  it.each([
    [
      'setting the viewport again',
      (fail: () => Promise<never>): FakePageBehaviour => ({ setViewport: failingSecond(undefined, fail) }),
    ],
    [
      'growing it again',
      (fail: () => Promise<never>): FakePageBehaviour => ({ growViewportToContent: failingSecond(false, fail) }),
    ],
  ])('makes a broken story, error, of a page that failed %s, naming that step', async (_what, failing) => {
    const driver = new FakeDriver({
      pages: [
        {
          waitHook: async () => ran,
          ...failing(async () => {
            throw new Error('The browser said no.')
          }),
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message: 'Growing the viewport to the page again after its wait hook failed: The browser said no.',
      },
      console: [],
    })
    expect(driver.methods().at(-1)).toBe('1:close')
  })

  it("makes a broken story, error, of the driver's own limit running out while it set the viewport again", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          waitHook: async () => ran,
          setViewport: failingSecond(undefined, async () => {
            throw new PageTimeoutError("The page didn't set its viewport within 30 s.", 30_000)
          }),
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "Growing the viewport to the page again after its wait hook failed: The page didn't set its viewport within 30 s.",
      },
      console: [],
    })
  })

  it('makes a broken story, crashed, of a page that crashed while it set the viewport again', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          waitHook: async () => ran,
          setViewport: failingSecond(undefined, async () => {
            throw new PageCrashedError()
          }),
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'crashed',
        message:
          'The page crashed while growing the viewport to the page again after its wait hook, usually because it ran out of memory. Fewer workers leave each page more memory.',
      },
      console: [],
    })
  })

  it.each([
    [
      'frames that never passed',
      async () => ({ outcome: 'timed-out' }),
      {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): visual-check was still letting the page react to the viewport set again after its wait hook.",
        readyTimeoutMs: 10000,
      },
    ],
    [
      'a page without the page script',
      async () => ({ outcome: 'script-missing' }),
      {
        reason: 'error',
        message:
          "visual-check's page script didn't run in the story's page, so it couldn't let the page react to the viewport set again after its wait hook.",
      },
    ],
    [
      'a page that stopped answering',
      async (timeoutMs: number) => {
        throw new PageTimeoutError("The expression evaluated in the page didn't finish within 11 s.", timeoutMs)
      },
      {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): its page stopped answering while visual-check let it react to the viewport set again after its wait hook.",
        readyTimeoutMs: 10000,
      },
    ],
    [
      "an answer visual-check doesn't know",
      async () => 42,
      {
        reason: 'error',
        message:
          "Letting the page react to the viewport set again after its wait hook failed: Letting frames pass in the page gave an answer visual-check doesn't know: 42.",
      },
    ],
  ])(
    'makes a broken story of %s while the page reacted to the viewport set again after the hook',
    async (_what, framesWait, broken) => {
      const driver = new FakeDriver({ pages: [{ waitHook: async () => ran, framesWait }] })

      expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({ broken, console: [] })
      expect(driver.methods()).not.toContain('1:capture')
    },
  )

  it.each([
    [
      'images still loading',
      async () => imagesTimedOutAnswer(1),
      {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): 1 of its images was still loading once the viewport was set again after its wait hook.",
        readyTimeoutMs: 10000,
      },
    ],
    [
      'document.fonts.ready unresolved',
      async () => fontsTimedOutAnswer([]),
      {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): document.fonts.ready hadn't resolved once the viewport was set again after its wait hook.",
        readyTimeoutMs: 10000,
      },
    ],
    [
      'fonts still loading',
      async () => fontsTimedOutAnswer(['Inter 400 normal']),
      {
        reason: 'fonts-not-loaded',
        message:
          "The story's fonts hadn't loaded within readyTimeout (10000 ms) once the viewport was set again after its wait hook. Still loading: Inter 400 normal.",
        faces: ['Inter 400 normal'],
        readyTimeoutMs: 10000,
      },
    ],
    [
      'no page script',
      async () => ({ outcome: 'script-missing' }),
      {
        reason: 'error',
        message:
          "visual-check's page script didn't run in the story's page, so it couldn't wait for its images and fonts once the viewport was set again after its wait hook.",
      },
    ],
    [
      'a page that stopped answering',
      async (timeoutMs: number) => {
        throw new PageTimeoutError("The expression evaluated in the page didn't finish within 11 s.", timeoutMs)
      },
      {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): its page stopped answering while visual-check waited for its images and fonts once the viewport was set again after its wait hook.",
        readyTimeoutMs: 10000,
      },
    ],
    [
      'a page that crashed',
      async () => {
        throw new PageCrashedError()
      },
      {
        reason: 'crashed',
        message:
          'The page crashed while waiting for images and fonts once the viewport was set again after its wait hook, usually because it ran out of memory. Fewer workers leave each page more memory.',
      },
    ],
    [
      "an answer visual-check doesn't know",
      async () => 42,
      {
        reason: 'error',
        message:
          "Waiting for images and fonts once the viewport was set again after its wait hook failed: The wait for images and fonts in the page gave an answer visual-check doesn't know: 42.",
      },
    ],
  ])(
    'makes a broken story of %s at the check of images and fonts once the viewport was set again after the hook',
    async (_what, third, broken) => {
      const driver = new FakeDriver({ pages: [checkedAfterRegrowth(third)] })

      expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({ broken, console: [] })
      expect(driver.methods()).not.toContain('1:capture')
    },
  )
})

describe('the masks', () => {
  /**
   * A story with an element and masks.
   */
  const card = {
    ...primary,
    element: '#card',
    masks: [
      { name: 'clock', selector: '.clock' },
      { name: 'images', host: 'images.example.com' },
    ],
  }

  it("are painted after the end state, with the story's element and masks and the settings' maskColor", async () => {
    const driver = new FakeDriver()

    await openCaptureSession(driver, settings).capture(card)
    expect(driver.calls.slice(5)).toEqual([
      { page: 1, method: 'evaluate', args: [endStateExpression(10_000), 11_000] },
      {
        page: 1,
        method: 'evaluate',
        args: [
          prepareCaptureExpression(
            { element: '#card', masks: card.masks, maskColor: '#00FF00', findRemote: false },
            10_000,
          ),
          11_000,
        ],
      },
      { page: 1, method: 'capture', args: ['full-page'] },
    ])
  })

  it('are painted after the check of images and fonts that follows an end state that changed anything', async () => {
    const driver = new FakeDriver({ pages: [{ endStateWait: async () => settledAnswer(true) }] })

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls.slice(6)).toEqual([
      { page: 1, method: 'evaluate', args: [endStateExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [plainPrepExpression(10_000), 11_000] },
      { page: 1, method: 'capture', args: ['full-page'] },
    ])
  })

  it('get only the time readyTimeout has left', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async () => pass(3000),
          endStateWait: async () => {
            pass(2500)

            return settledAnswer()
          },
        },
      ],
    })

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls[7]?.args).toEqual([plainPrepExpression(4500), 5500])
  })

  it("capture the element's box when the page gives one", async () => {
    const box = { x: 8, y: 16, width: 320, height: 200 }
    const driver = new FakeDriver({ pages: [{ capturePrep: async () => ({ outcome: 'ready', box }) }] })

    expect(await openCaptureSession(driver, settings).capture(card)).toEqual({ snapshot: defaultSnapshot, console: [] })
    expect(driver.calls.at(-1)).toEqual({ page: 1, method: 'capture', args: [box] })
  })

  it.each([
    [
      'the element selector matched nothing',
      { outcome: 'element-missing', found: 'nothing' },
      { reason: 'element-missing', message: 'The element selector "#card" matched nothing.' },
    ],
    [
      'the element selector matched an element of zero size',
      { outcome: 'element-missing', found: 'zero-size' },
      {
        reason: 'element-missing',
        message: 'The element selector "#card" matched an element with a box of zero size.',
      },
    ],
    [
      'the element selector is not valid CSS',
      { outcome: 'invalid-selector', of: 'element', message: "'#card' is not a valid selector" },
      { reason: 'error', message: `The element selector "#card" isn't valid CSS: '#card' is not a valid selector.` },
    ],
    [
      "a mask's selector is not valid CSS",
      { outcome: 'invalid-selector', of: 'mask', name: 'clock', message: "'.clock' is not a valid selector." },
      { reason: 'error', message: `The selector of mask "clock" isn't valid CSS: '.clock' is not a valid selector.` },
    ],
    [
      'the remote content search timed out',
      { outcome: 'timed-out' },
      {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): visual-check was still looking for remote content to mask.",
        readyTimeoutMs: 10000,
      },
    ],
    [
      "the masks couldn't be painted",
      { outcome: 'paint-failed', message: 'NotSupportedError: no elements' },
      {
        reason: 'error',
        message: "visual-check couldn't paint the story's masks: NotSupportedError: no elements.",
      },
    ],
    [
      "the page script didn't run",
      { outcome: 'script-missing' },
      {
        reason: 'error',
        message: "visual-check's page script didn't run in the story's page, so it couldn't paint its masks.",
      },
    ],
    [
      "the page gives an answer visual-check doesn't know",
      42,
      {
        reason: 'error',
        message:
          "Painting its masks and hiding the caret failed: Preparing the capture in the page gave an answer visual-check doesn't know: 42.",
      },
    ],
  ])('make a broken story when %s, capturing nothing and closing the page', async (_what, answer, broken) => {
    const driver = new FakeDriver({ pages: [{ capturePrep: async () => answer }] })

    expect(await openCaptureSession(driver, settings).capture(card)).toEqual({ broken, console: [] })
    expect(driver.methods()).not.toContain('1:capture')
    expect(driver.methods().at(-1)).toBe('1:close')
  })

  it('quote the selector as JSON in the message, so its own quotes show', async () => {
    const driver = new FakeDriver({
      pages: [{ capturePrep: async () => ({ outcome: 'element-missing', found: 'nothing' }) }],
    })

    expect(await openCaptureSession(driver, settings).capture({ ...primary, element: '[data-id="a"]' })).toEqual({
      broken: { reason: 'element-missing', message: 'The element selector "[data-id=\\"a\\"]" matched nothing.' },
      console: [],
    })
  })

  it("make a broken story, timeout, of a page that doesn't answer while they're painted, naming that step", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          capturePrep: async (timeoutMs) => {
            pass(timeoutMs)

            throw new PageTimeoutError("The expression evaluated in the page didn't finish within 11 s.", timeoutMs)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(card)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): its page stopped answering while visual-check painted its masks and hid the caret.",
        readyTimeoutMs: 10000,
      },
      console: [],
    })
    expect(driver.methods().at(-1)).toBe('1:close')
  })

  it('name the step when the page crashes while they are painted', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          capturePrep: async () => {
            throw new PageCrashedError()
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(card)).toEqual({
      broken: {
        reason: 'crashed',
        message:
          'The page crashed while painting its masks and hiding the caret, usually because it ran out of memory. Fewer workers leave each page more memory.',
      },
      console: [],
    })
  })
})

describe('the remote content', () => {
  /**
   * The primary story, asking for the remote content its snapshot shows.
   */
  const retried = { ...primary, findRemoteContent: true }

  it('is asked of the page when the story asks for it', async () => {
    const driver = new FakeDriver()

    await openCaptureSession(driver, settings).capture(retried)
    expect(driver.calls[7]?.args).toEqual([
      prepareCaptureExpression({ element: null, masks: [], maskColor: '#00FF00', findRemote: true }, 10_000),
      11_000,
    ])
  })

  it('is not asked of the page, nor given, when the story does not ask for it', async () => {
    const remote = [{ host: 'images.example.com', x: 1, y: 2, width: 3, height: 4 }]
    const driver = new FakeDriver({ pages: [{ capturePrep: async () => ({ outcome: 'ready', box: null, remote }) }] })
    const capture = await openCaptureSession(driver, settings).capture(primary)

    expect(driver.calls[7]?.args).toEqual([plainPrepExpression(10_000), 11_000])
    expect(capture).toEqual({ snapshot: defaultSnapshot, console: [] })
    expect(capture).not.toHaveProperty('remoteContent')
  })

  it('is not given when the story asks for it but the page gives none, as when its search timed out', async () => {
    const capture = await openCaptureSession(new FakeDriver(), settings).capture(retried)

    expect(capture).toEqual({ snapshot: defaultSnapshot, console: [] })
    expect(capture).not.toHaveProperty('remoteContent')
  })

  it('is given in pixels of the image for the full page', async () => {
    const remote = [{ host: 'images.example.com:8443', x: 10.5, y: 20.25, width: 30, height: 40 }]
    const driver = new FakeDriver({ pages: [{ capturePrep: async () => ({ outcome: 'ready', box: null, remote }) }] })
    const story = { ...retried, viewport: { ...primary.viewport, deviceScaleFactor: 1 } }

    expect(await openCaptureSession(driver, settings).capture(story)).toEqual({
      snapshot: defaultSnapshot,
      console: [],
      completingMs: undefined,
      remoteContent: [{ host: 'images.example.com:8443', x: 10, y: 20, width: 31, height: 41 }],
    })
  })

  it("is given in pixels of the image for the element's box, at the viewport's scale", async () => {
    const box = { x: 8, y: 16, width: 320, height: 200 }
    const remote = [{ host: 'images.example.com', x: 10.3, y: 20.75, width: 5.2, height: 3.1 }]
    const driver = new FakeDriver({ pages: [{ capturePrep: async () => ({ outcome: 'ready', box, remote }) }] })

    expect(await openCaptureSession(driver, settings).capture({ ...retried, element: '#card' })).toEqual({
      snapshot: defaultSnapshot,
      console: [],
      completingMs: undefined,
      remoteContent: [{ host: 'images.example.com', x: 4, y: 9, width: 11, height: 7 }],
    })
    expect(driver.calls.at(-1)).toEqual({ page: 1, method: 'capture', args: [box] })
  })
})

describe('remoteContentBoxesOf', () => {
  it('moves each box to the full page origin and rounds it out to whole pixels at scale 1', () => {
    expect(
      remoteContentBoxesOf([{ host: 'a.example.com', x: 10.5, y: 20.25, width: 30, height: 40.5 }], 'full-page', 1),
    ).toEqual([{ host: 'a.example.com', x: 10, y: 20, width: 31, height: 41 }])
  })

  it("moves each box to the element's box and scales it, rounding the left and top down and the right and bottom up", () => {
    const area = { x: 8, y: 16, width: 320, height: 200 }

    expect(
      remoteContentBoxesOf(
        [
          { host: 'a.example.com', x: 10.3, y: 20.75, width: 5.2, height: 3.1 },
          { host: 'b.example.com:8443', x: 0, y: 10, width: 20, height: 10 },
        ],
        area,
        2,
      ),
    ).toEqual([
      { host: 'a.example.com', x: 4, y: 9, width: 11, height: 7 },
      { host: 'b.example.com:8443', x: -16, y: -12, width: 40, height: 20 },
    ])
  })

  it('scales whole pixels exactly at a fractional scale', () => {
    expect(
      remoteContentBoxesOf([{ host: 'a.example.com', x: 4, y: 2, width: 2, height: 2 }], 'full-page', 1.5),
    ).toEqual([{ host: 'a.example.com', x: 6, y: 3, width: 3, height: 3 }])
  })

  it('gives none for no remote content', () => {
    expect(remoteContentBoxesOf([], 'full-page', 2)).toEqual([])
  })
})

describe("clearing the previous story's storage", () => {
  it('clears the page before each later capture on it', async () => {
    const driver = new FakeDriver()
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await session.capture(secondary)
    await session.capture(primary)
    expect(driver.methods()).toEqual([
      '1:setViewport',
      '1:goto',
      '1:evaluate',
      '1:evaluate',
      '1:growViewportToContent',
      '1:evaluate',
      '1:evaluate',
      '1:evaluate',
      '1:capture',
      '1:clearStorage',
      '1:setViewport',
      '1:goto',
      '1:evaluate',
      '1:evaluate',
      '1:growViewportToContent',
      '1:evaluate',
      '1:evaluate',
      '1:evaluate',
      '1:capture',
      '1:clearStorage',
      '1:setViewport',
      '1:goto',
      '1:evaluate',
      '1:evaluate',
      '1:growViewportToContent',
      '1:evaluate',
      '1:evaluate',
      '1:evaluate',
      '1:capture',
    ])
  })

  it("clears nothing on the fresh page that replaced a broken story's page", async () => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => finishedAnswer({ status: 'error' }) }] })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await session.capture(secondary)
    expect(driver.methods()).toEqual([
      '1:setViewport',
      '1:goto',
      '1:evaluate',
      '1:close',
      '2:setViewport',
      '2:goto',
      '2:evaluate',
      '2:evaluate',
      '2:growViewportToContent',
      '2:evaluate',
      '2:evaluate',
      '2:evaluate',
      '2:capture',
    ])
  })

  it('leaves readyTimeout whole for the capture after it', async () => {
    const driver = new FakeDriver({ pages: [{ clearStorage: async () => pass(3000) }] })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await session.capture(secondary)
    expect(driver.calls[11]).toEqual({ page: 1, method: 'goto', args: [secondary.url, 10_000] })
  })

  it.each([
    ['an error', new Error('The browser said no.')],
    ['a crash', new PageCrashedError()],
    ['a timeout', new PageTimeoutError("The page didn't clear its storage within 30 s.", 30_000)],
  ])('closes the page and captures the story on a fresh page when it fails with %s', async (_how, error) => {
    const driver = new FakeDriver({
      pages: [
        {
          clearStorage: async () => {
            throw error
          },
        },
      ],
    })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    expect(await session.capture(secondary)).toEqual({ snapshot: defaultSnapshot, console: [] })
    expect(driver.methods().slice(9)).toEqual([
      '1:clearStorage',
      '1:close',
      '2:setViewport',
      '2:goto',
      '2:evaluate',
      '2:evaluate',
      '2:growViewportToContent',
      '2:evaluate',
      '2:evaluate',
      '2:evaluate',
      '2:capture',
    ])
  })
})

describe('a broken story', () => {
  it('is one Storybook reports finished with a status other than success, naming the status', async () => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => finishedAnswer({ status: 'error' }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          'Storybook reported the story finished with status "error", as it does when a loader, beforeEach or the render throws, or when a check such as accessibility fails.',
      },
      console: [],
    })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it.each([
    [
      'whose play function threw, even though Storybook reports it finished well',
      { errors: [{ event: 'playFunctionThrewException', text: 'Error: boom', stack: ['at play (a.js:1)'] }] },
      "The story's play function threw Error: boom.",
      'Error: boom',
      ['at play (a.js:1)'],
    ],
    [
      'whose play function left unhandled errors',
      { status: 'error', errors: [{ event: 'unhandledErrorsWhilePlaying', text: 'Error: late', stack: [] }] },
      "The story's play function left unhandled errors: Error: late.",
      'Error: late',
      [],
    ],
  ])('is play-threw for a story %s, keeping its error and stack', async (_what, answer, message, errorText, stack) => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => finishedAnswer(answer) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: { reason: 'play-threw', message, errorText, stack },
      console: [],
    })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it.each([
    [
      'error',
      'that threw as it rendered',
      { errors: [{ event: 'storyThrewException', text: 'TypeError: x is undefined' }] },
      'The story threw TypeError: x is undefined.',
    ],
    [
      'error',
      'where Storybook showed its error display',
      { errorDisplay: true },
      'Storybook showed its error display.',
    ],
  ])('is %s for a story %s, saying so', async (reason, _what, answer, message) => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => finishedAnswer(answer) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: { reason, message },
      console: [],
    })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it.each([
    [
      "Storybook's preview never started",
      timedOutAnswer('preview-start'),
      "Storybook's preview never started in its page",
    ],
    [
      "Storybook's preview never became ready",
      timedOutAnswer('preview-ready'),
      "Storybook's preview started but never became ready",
    ],
    [
      'Storybook never reported the story finished',
      timedOutAnswer('story'),
      'Storybook never sent storyFinished for it',
    ],
    [
      'Storybook never reported the story finished, with its last render step',
      timedOutAnswer('story', 'playing'),
      'Storybook never sent storyFinished for it, and its last render step was "playing"',
    ],
  ])('is a timeout when %s, saying so', async (_what, answer, doing) => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => answer }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message: `The story wasn't ready within readyTimeout (10000 ms): ${doing}.`,
        readyTimeoutMs: 10000,
      },
      console: [],
    })
  })

  it("is one whose page didn't run the page script", async () => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => ({ outcome: 'script-missing' }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "visual-check's page script didn't run in the story's page, so it couldn't wait for the story to finish.",
      },
      console: [],
    })
  })

  it.each([
    ['1 image still loading', 1, '1 of its images was still loading'],
    ['3 images still loading', 3, '3 of its images were still loading'],
    ['loaded images still decoding', 0, 'its images were still decoding'],
  ])('is a timeout with %s at the time limit, saying so', async (_what, pending, doing) => {
    const driver = new FakeDriver({ pages: [{ assetsWait: async () => imagesTimedOutAnswer(pending) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message: `The story wasn't ready within readyTimeout (10000 ms): ${doing}.`,
        readyTimeoutMs: 10000,
      },
      console: [],
    })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it('is fonts-not-loaded when fonts were still loading at the time limit, naming the faces', async () => {
    const faces = ['Never Loads 400 normal', 'Slow 700 italic']
    const driver = new FakeDriver({ pages: [{ assetsWait: async () => fontsTimedOutAnswer(faces) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'fonts-not-loaded',
        message:
          "The story's fonts hadn't loaded within readyTimeout (10000 ms). Still loading: Never Loads 400 normal, Slow 700 italic.",
        faces,
        readyTimeoutMs: 10000,
      },
      console: [],
    })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it("is a timeout when document.fonts.ready hadn't resolved at the time limit with no face still loading", async () => {
    const driver = new FakeDriver({ pages: [{ assetsWait: async () => fontsTimedOutAnswer([]) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message: "The story wasn't ready within readyTimeout (10000 ms): document.fonts.ready hadn't resolved.",
        readyTimeoutMs: 10000,
      },
      console: [],
    })
  })

  it("is one whose page didn't run the page script when waiting for its images and fonts", async () => {
    const driver = new FakeDriver({ pages: [{ assetsWait: async () => ({ outcome: 'script-missing' }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "visual-check's page script didn't run in the story's page, so it couldn't wait for its images and fonts.",
      },
      console: [],
    })
  })

  it("is one whose page doesn't answer the wait for images and fonts in time, naming that step", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          assetsWait: async (timeoutMs) => {
            pass(timeoutMs)

            throw new PageTimeoutError("The expression evaluated in the page didn't finish within 11 s.", timeoutMs)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): its page stopped answering while visual-check waited for its images and fonts.",
        readyTimeoutMs: 10000,
      },
      console: [],
    })
  })

  it("is one whose wait for images and fonts gives an answer visual-check doesn't know", async () => {
    const driver = new FakeDriver({ pages: [{ assetsWait: async () => 42 }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "Waiting for images and fonts failed: The wait for images and fonts in the page gave an answer visual-check doesn't know: 42.",
      },
      console: [],
    })
  })

  it('is a timeout when visual-check was still finishing its animations at the time limit, saying so', async () => {
    const driver = new FakeDriver({ pages: [{ endStateWait: async () => animationsTimedOutAnswer() }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): visual-check was still finishing its animations.",
        readyTimeoutMs: 10000,
      },
      console: [],
    })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it('is a timeout when visual-check was still putting its media on their first frame at the time limit, saying so', async () => {
    const driver = new FakeDriver({ pages: [{ endStateWait: async () => mediaTimedOutAnswer() }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): visual-check was still putting its media on their first frame.",
        readyTimeoutMs: 10000,
      },
      console: [],
    })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it("is one whose page didn't run the page script when bringing it to its end state", async () => {
    const driver = new FakeDriver({ pages: [{ endStateWait: async () => ({ outcome: 'script-missing' }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message: "visual-check's page script didn't run in the story's page, so it couldn't bring it to its end state.",
      },
      console: [],
    })
  })

  it("is one whose page doesn't answer the end state in time, naming that step", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          endStateWait: async (timeoutMs) => {
            pass(timeoutMs)

            throw new PageTimeoutError("The expression evaluated in the page didn't finish within 11 s.", timeoutMs)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): its page stopped answering while visual-check brought it to its end state.",
        readyTimeoutMs: 10000,
      },
      console: [],
    })
  })

  it("is one whose end state gives an answer visual-check doesn't know", async () => {
    const driver = new FakeDriver({ pages: [{ endStateWait: async () => 42 }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "Bringing the story to its end state failed: The end state in the page gave an answer visual-check doesn't know: 42.",
      },
      console: [],
    })
  })

  it('is one whose images were still loading after the end state changed anything, saying so', async () => {
    let assetsWaits = 0
    const driver = new FakeDriver({
      pages: [
        {
          assetsWait: async () => {
            assetsWaits += 1

            return assetsWaits === 1 ? readyAnswer() : imagesTimedOutAnswer(1)
          },
          endStateWait: async () => settledAnswer(true),
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): 1 of its images was still loading after its end state.",
        readyTimeoutMs: 10000,
      },
      console: [],
    })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it("is one whose page doesn't load in time, naming that step", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async (url, timeoutMs) => {
            pass(timeoutMs)

            throw new PageTimeoutError(`The page didn't load ${url} within 10 s.`, timeoutMs)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message: "The story wasn't ready within readyTimeout (10000 ms): its page was still loading.",
        readyTimeoutMs: 10000,
      },
      console: [],
    })
  })

  it("is one whose page doesn't answer the story wait in time, naming that step", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          storyWait: async (timeoutMs) => {
            pass(timeoutMs)

            throw new PageTimeoutError("The expression evaluated in the page didn't finish within 11 s.", timeoutMs)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): its page stopped answering while visual-check waited for the story to finish.",
        readyTimeoutMs: 10000,
      },
      console: [],
    })
  })

  it('is one whose page fails to load as the time runs out, by the error it gives and not by the clock', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async (url, timeoutMs) => {
            pass(timeoutMs)

            throw new PageLoadError(url, 'net::ERR_CONNECTION_RESET')
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message: `Loading the story failed: The page couldn't load ${primary.url}: net::ERR_CONNECTION_RESET.`,
      },
      console: [],
    })
  })

  it("is one whose viewport isn't set within the driver's own limit, saying so", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          setViewport: async () => {
            throw new PageTimeoutError("The page didn't set its viewport within 30 s.", 30_000)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message: "Setting the viewport failed: The page didn't set its viewport within 30 s.",
      },
      console: [],
    })
  })

  it('is one whose page fails to load, naming that step and why', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async (url) => {
            throw new PageLoadError(url, 'net::ERR_CONNECTION_REFUSED')
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message: `Loading the story failed: The page couldn't load ${primary.url}: net::ERR_CONNECTION_REFUSED.`,
      },
      console: [],
    })
  })

  it.each([
    ['setViewport', 'Setting the viewport'],
    ['storyWait', 'Waiting for the story to finish'],
    ['assetsWait', 'Waiting for images and fonts'],
    ['waitHook', "Running the story's wait hook"],
    ['endStateWait', 'Bringing the story to its end state'],
    ['capture', 'Capturing the snapshot'],
  ] as const)('is one whose %s fails, naming that step and why', async (method, step) => {
    const driver = new FakeDriver({
      pages: [
        {
          [method]: async () => {
            throw new Error('The browser said no.')
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: { reason: 'error', message: `${step} failed: The browser said no.` },
      console: [],
    })
  })

  it("is one whose story wait gives an answer visual-check doesn't know", async () => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => 42 }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "Waiting for the story to finish failed: The Storybook wait in the page gave an answer visual-check doesn't know: 42.",
      },
      console: [],
    })
  })

  it('is one whose page crashed, pointing at memory', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async () => {
            throw new PageCrashedError()
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'crashed',
        message:
          'The page crashed while loading the story, usually because it ran out of memory. Fewer workers leave each page more memory.',
      },
      console: [],
    })
  })

  it.each([
    [
      "the story's own origin, as a path",
      'http://localhost:6006/categories/burgers?tab=a#top',
      '/categories/burgers?tab=a#top',
    ],
    ['another origin, in full', 'https://example.com/x', 'https://example.com/x'],
    ['a URL that cannot be parsed, as it is', 'not a url', 'not a url'],
    ["a blob URL of the story's origin, in full", 'blob:http://localhost:6006/abc', 'blob:http://localhost:6006/abc'],
  ])('is one that navigated away to %s, naming where it went', async (_where, url, shown) => {
    const page: FakePageBehaviour = {
      goto: async (storyUrl) => {
        throw new PageNavigatedAwayError(url, `The page navigated to ${url} before ${storyUrl} loaded.`)
      },
    }
    // The story navigates away on every attempt, the retries included.
    const driver = new FakeDriver({ pages: [page, page, page] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'navigated-away',
        message: `The story navigated away to ${shown}. Await the new page before clicking.`,
        url,
      },
      console: [],
    })
  })

  it('is one that navigated away while waiting for the story to finish', async () => {
    const page: FakePageBehaviour = {
      storyWait: async () => {
        throw new PageNavigatedAwayError('http://localhost:6006/next', 'The page navigated to /next.')
      },
    }
    // The story navigates away on every attempt, the retries included.
    const driver = new FakeDriver({ pages: [page, page, page] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'navigated-away',
        message: 'The story navigated away to /next. Await the new page before clicking.',
        url: 'http://localhost:6006/next',
      },
      console: [],
    })
  })

  it('is one whose page crashed while waiting for the story to finish, naming that step', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          storyWait: async () => {
            throw new PageCrashedError()
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'crashed',
        message:
          'The page crashed while waiting for the story to finish, usually because it ran out of memory. Fewer workers leave each page more memory.',
      },
      console: [],
    })
  })

  it("is one whose capture hits the driver's own time limit, as an error and not a timeout", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          capture: async () => {
            throw new PageTimeoutError("The page didn't capture within 30 s.", 30_000)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: { reason: 'error', message: "Capturing the snapshot failed: The page didn't capture within 30 s." },
      console: [],
    })
  })

  it('is too tall when the capture is over 32,767 device pixels on a side, and its page is closed', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          capture: async () => {
            throw new CaptureTooLargeError(2560, 40_000)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'too-tall',
        message:
          'The capture is 2560 × 40000 device pixels, over 32,767 on a side. Set element to capture part of the story, or use a smaller viewport.',
        size: { width: 2560, height: 40_000 },
      },
      console: [],
    })
    expect(driver.methods()).toContain('1:close')
  })

  it("is too tall with a hint to capture a smaller element when the story's element is over 32,767 device pixels", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          capturePrep: async () => ({ outcome: 'ready', box: { x: 0, y: 0, width: 640, height: 20_000 } }),
          capture: async () => {
            throw new CaptureTooLargeError(1280, 40_000)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture({ ...primary, element: '#list' })).toEqual({
      broken: {
        reason: 'too-tall',
        message:
          'The capture is 1280 × 40000 device pixels, over 32,767 on a side. Capture a smaller element, or use a smaller viewport.',
        size: { width: 1280, height: 40_000 },
      },
      console: [],
    })
  })

  it('is one whose page fails to open, saying why', async () => {
    const driver = new FakeDriver({
      newPage: async () => {
        throw new Error("The browser didn't open a page within 30 s.")
      },
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message: "visual-check couldn't open a page for the story: The browser didn't open a page within 30 s.",
      },
    })
  })

  it('closes its page and opens a fresh one for the next story', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async () => {
            throw new PageCrashedError()
          },
        },
      ],
    })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    expect(await session.capture(secondary)).toEqual({ snapshot: defaultSnapshot, console: [] })
    expect(driver.methods()).toEqual([
      '1:setViewport',
      '1:goto',
      '1:close',
      '2:setViewport',
      '2:goto',
      '2:evaluate',
      '2:evaluate',
      '2:growViewportToContent',
      '2:evaluate',
      '2:evaluate',
      '2:evaluate',
      '2:capture',
    ])
  })

  it('closes its page when Storybook reports the story failed too', async () => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => finishedAnswer({ status: 'error' }) }] })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await session.capture(secondary)
    expect(driver.setups).toHaveLength(2)
    expect(driver.methods()).toContain('1:close')
  })

  it("carries on when its page doesn't close", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async () => {
            throw new PageCrashedError()
          },
          close: async () => {
            throw new Error('The page crashed.')
          },
        },
      ],
    })
    const session = openCaptureSession(driver, settings)

    expect(await session.capture(primary)).toHaveProperty('broken.reason', 'crashed')
    expect(await session.capture(secondary)).toEqual({ snapshot: defaultSnapshot, console: [] })
  })

  it('tries to open a page again after one failed to open', async () => {
    let openings = 0
    const driver = new FakeDriver({
      newPage: async () => {
        openings += 1

        if (openings === 1) {
          throw new Error("The browser didn't open a page within 30 s.")
        }
      },
    })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    expect(await session.capture(secondary)).toEqual({ snapshot: defaultSnapshot, console: [] })
  })
})

describe('a grid', () => {
  /**
   * The message of a grid too wide for the 1280 px viewport, at 1281 px.
   */
  const tooWideMessage =
    'The grid is 1281 px wide, wider than the 1280 px viewport. Give the story its own viewport width, list modes without the narrow ones, or set a smaller cellWidth.'

  /**
   * A page whose capture preparation answers that it shows a grid of this size, with this box.
   */
  const showingGrid = (grid: { width: number; height: number }, box: object | null = null): FakePageBehaviour => ({
    capturePrep: async () => ({ outcome: 'ready', box, grid }),
  })

  it('is no problem when the page shows none', () => {
    expect(gridProblemOf(undefined, primary.viewport)).toBeUndefined()
  })

  it('is no problem when it is as wide as the viewport', () => {
    expect(gridProblemOf({ width: 1280, height: 500 }, primary.viewport)).toBeUndefined()
  })

  it('is too wide when it is wider than the viewport, rounded up', () => {
    expect(gridProblemOf({ width: 1280.25, height: 500 }, primary.viewport)).toEqual({
      reason: 'grid-too-wide',
      message: tooWideMessage,
      grid: { width: 1281, viewportWidth: 1280 },
    })
  })

  it("is too tall when it's over 32,767 device pixels on a side at the viewport's scale", () => {
    expect(gridProblemOf({ width: 600, height: 20_000 }, primary.viewport)).toEqual({
      reason: 'too-tall',
      message: 'The grid is 1200 × 40000 device pixels, over 32,767 on a side. Split the grid into several stories.',
      size: { width: 1200, height: 40_000 },
    })
  })

  it('is no problem when it fits at a smaller scale', () => {
    expect(gridProblemOf({ width: 600, height: 20_000 }, { ...primary.viewport, deviceScaleFactor: 1 })).toBeUndefined()
  })

  it('is too wide rather than too tall when it is both', () => {
    expect(gridProblemOf({ width: 1400, height: 40_000 }, { ...primary.viewport, deviceScaleFactor: 1 })).toMatchObject(
      { reason: 'grid-too-wide' },
    )
  })

  it('breaks a story whose grid is wider than the viewport, capturing nothing, and its page is closed', async () => {
    const driver = new FakeDriver({ pages: [showingGrid({ width: 1400, height: 500 })] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'grid-too-wide',
        message:
          'The grid is 1400 px wide, wider than the 1280 px viewport. Give the story its own viewport width, list modes without the narrow ones, or set a smaller cellWidth.',
        grid: { width: 1400, viewportWidth: 1280 },
      },
      console: [],
    })
    expect(driver.methods().filter((method) => method.endsWith(':capture'))).toEqual([])
    expect(driver.methods()).toContain('1:close')
  })

  it("breaks a story whose grid is wider than the viewport when it captures an element's box", async () => {
    const box = { x: 0, y: 0, width: 300, height: 200 }
    const driver = new FakeDriver({ pages: [showingGrid({ width: 1400, height: 500 }, box)] })

    expect(await openCaptureSession(driver, settings).capture({ ...primary, element: '#grid' })).toMatchObject({
      broken: { reason: 'grid-too-wide', grid: { width: 1400, viewportWidth: 1280 } },
    })
    expect(driver.methods().filter((method) => method.endsWith(':capture'))).toEqual([])
  })

  it("names the snapshot's own viewport width", async () => {
    const driver = new FakeDriver({ pages: [showingGrid({ width: 600, height: 500 })] })

    expect(await openCaptureSession(driver, settings).capture(secondary)).toMatchObject({
      broken: {
        reason: 'grid-too-wide',
        message:
          'The grid is 600 px wide, wider than the 375 px viewport. Give the story its own viewport width, list modes without the narrow ones, or set a smaller cellWidth.',
        grid: { width: 600, viewportWidth: 375 },
      },
    })
  })

  it('breaks a story whose element is missing as element-missing, even when its page shows a grid too wide', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          capturePrep: async () => ({
            outcome: 'element-missing',
            found: 'nothing',
            grid: { width: 1400, height: 500 },
          }),
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture({ ...primary, element: '#grid' })).toMatchObject({
      broken: { reason: 'element-missing' },
    })
    expect(driver.methods().filter((method) => method.endsWith(':capture'))).toEqual([])
  })

  it("breaks a story whose grid is too tall at the viewport's scale, capturing nothing", async () => {
    const driver = new FakeDriver({ pages: [showingGrid({ width: 600, height: 20_000 })] })
    const capture = await openCaptureSession(driver, settings).capture({ ...primary, imageWhenBroken: true })

    expect(capture).toEqual({
      broken: {
        reason: 'too-tall',
        message: 'The grid is 1200 × 40000 device pixels, over 32,767 on a side. Split the grid into several stories.',
        size: { width: 1200, height: 40_000 },
      },
      console: [],
    })
    expect(driver.methods().filter((method) => method.endsWith(':capture'))).toEqual([])
    expect(driver.methods()).toContain('1:close')
  })
})

describe('an overflow', () => {
  /**
   * The end of the message of an element's overflow.
   */
  const elementFix =
    ', so the capture would cut it. Fix the layout, capture an element that holds the content, or set allowOverflow when the cut is intended.'

  /**
   * The message of a full-page overflow of 197 px past the 1280 px viewport.
   */
  const fullPageMessage =
    'Content reaches 197 px past the right edge of the 1280 px viewport, so the capture would cut it. Fix the layout, give the story a wider viewport or list modes without the narrow ones, or set allowOverflow when the cut is intended.'

  /**
   * The box of the element most tests capture.
   */
  const box = { x: 0, y: 0, width: 300, height: 200 }

  /**
   * A page whose capture preparation answers that its capture would cut content by this much, with this box.
   */
  const overflowing = (
    overflow: { top: number; right: number; bottom: number; left: number },
    prepBox: object | null = null,
  ): FakePageBehaviour => ({
    capturePrep: async () => ({ outcome: 'ready', box: prepBox, overflow }),
  })

  it('is no problem when the capture would cut nothing', () => {
    expect(overflowProblemOf(undefined, 'full-page', primary)).toBeUndefined()
  })

  it('is no problem when the story allows it', () => {
    const overflow = { top: 0, right: 197, bottom: 0, left: 0 }

    expect(overflowProblemOf(overflow, 'full-page', { ...primary, allowOverflow: true })).toBeUndefined()
  })

  it("breaks a full-page capture, naming the content past the viewport's right edge", () => {
    expect(overflowProblemOf({ top: 0, right: 197, bottom: 0, left: 0 }, 'full-page', primary)).toEqual({
      reason: 'overflows',
      message: fullPageMessage,
      overflow: { area: 'full-page', top: 0, right: 197, bottom: 0, left: 0, viewportWidth: 1280 },
    })
  })

  it('breaks a story whose allowOverflow is false', () => {
    const overflow = { top: 0, right: 197, bottom: 0, left: 0 }

    expect(overflowProblemOf(overflow, 'full-page', { ...primary, allowOverflow: false })).toMatchObject({
      reason: 'overflows',
    })
  })

  it("names the snapshot's own viewport width", () => {
    expect(overflowProblemOf({ top: 0, right: 25, bottom: 0, left: 0 }, 'full-page', secondary)).toEqual({
      reason: 'overflows',
      message:
        'Content reaches 25 px past the right edge of the 375 px viewport, so the capture would cut it. Fix the layout, give the story a wider viewport or list modes without the narrow ones, or set allowOverflow when the cut is intended.',
      overflow: { area: 'full-page', top: 0, right: 25, bottom: 0, left: 0, viewportWidth: 375 },
    })
  })

  it.each([
    [{ top: 12, right: 0, bottom: 0, left: 0 }, "The element reaches 12 px past the page's top edge"],
    [{ top: 0, right: 197, bottom: 0, left: 0 }, "The element's content reaches 197 px past the element's right edge"],
    [{ top: 0, right: 0, bottom: 30, left: 0 }, "The element's content reaches 30 px past the element's bottom edge"],
    [{ top: 0, right: 0, bottom: 0, left: 4 }, "The element reaches 4 px past the page's left edge"],
    [
      { top: 12, right: 197, bottom: 0, left: 0 },
      "The element reaches 12 px past the page's top edge and its content reaches 197 px past the element's right edge",
    ],
    [
      { top: 12, right: 0, bottom: 30, left: 0 },
      "The element reaches 12 px past the page's top edge and its content reaches 30 px past the element's bottom edge",
    ],
    [
      { top: 12, right: 0, bottom: 0, left: 4 },
      "The element reaches 12 px past the page's top edge and the element reaches 4 px past the page's left edge",
    ],
    [
      { top: 0, right: 197, bottom: 30, left: 0 },
      "The element's content reaches 197 px past the element's right edge and 30 px past its bottom edge",
    ],
    [
      { top: 0, right: 197, bottom: 0, left: 4 },
      "The element's content reaches 197 px past the element's right edge and the element reaches 4 px past the page's left edge",
    ],
    [
      { top: 0, right: 0, bottom: 30, left: 4 },
      "The element's content reaches 30 px past the element's bottom edge and the element reaches 4 px past the page's left edge",
    ],
    [
      { top: 12, right: 197, bottom: 30, left: 0 },
      "The element reaches 12 px past the page's top edge and its content reaches 197 px past the element's right edge and 30 px past its bottom edge",
    ],
    [
      { top: 12, right: 197, bottom: 0, left: 4 },
      "The element reaches 12 px past the page's top edge, its content reaches 197 px past the element's right edge and the element reaches 4 px past the page's left edge",
    ],
    [
      { top: 12, right: 0, bottom: 30, left: 4 },
      "The element reaches 12 px past the page's top edge, its content reaches 30 px past the element's bottom edge and the element reaches 4 px past the page's left edge",
    ],
    [
      { top: 0, right: 197, bottom: 30, left: 4 },
      "The element's content reaches 197 px past the element's right edge and 30 px past its bottom edge and the element reaches 4 px past the page's left edge",
    ],
    [
      { top: 12, right: 197, bottom: 30, left: 4 },
      "The element reaches 12 px past the page's top edge, its content reaches 197 px past the element's right edge and 30 px past its bottom edge and the element reaches 4 px past the page's left edge",
    ],
  ])("breaks an element's capture cut by %j, naming each side that counts", (overflow, sentence) => {
    expect(overflowProblemOf(overflow, box, { ...primary, element: '#card' })).toEqual({
      reason: 'overflows',
      message: `${sentence}${elementFix}`,
      overflow: { area: 'element', ...overflow, viewportWidth: 1280 },
    })
  })

  it('breaks a story whose full-page capture would cut content, capturing nothing, and its page is closed', async () => {
    const driver = new FakeDriver({ pages: [overflowing({ top: 0, right: 197, bottom: 0, left: 0 })] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'overflows',
        message: fullPageMessage,
        overflow: { area: 'full-page', top: 0, right: 197, bottom: 0, left: 0, viewportWidth: 1280 },
      },
      console: [],
    })
    expect(driver.methods().filter((method) => method.endsWith(':capture'))).toEqual([])
    expect(driver.methods()).toContain('1:close')
  })

  it("breaks a story whose element's capture would cut content, capturing nothing", async () => {
    const driver = new FakeDriver({ pages: [overflowing({ top: 0, right: 197, bottom: 30, left: 0 }, box)] })

    expect(await openCaptureSession(driver, settings).capture({ ...primary, element: '#card' })).toEqual({
      broken: {
        reason: 'overflows',
        message: `The element's content reaches 197 px past the element's right edge and 30 px past its bottom edge${elementFix}`,
        overflow: { area: 'element', top: 0, right: 197, bottom: 30, left: 0, viewportWidth: 1280 },
      },
      console: [],
    })
    expect(driver.methods().filter((method) => method.endsWith(':capture'))).toEqual([])
  })

  it('captures a story that allows its capture to cut content, as it would capture any', async () => {
    const driver = new FakeDriver({ pages: [overflowing({ top: 0, right: 197, bottom: 30, left: 0 }, box)] })
    const story = { ...primary, element: '#card', allowOverflow: true }

    expect(await openCaptureSession(driver, settings).capture(story)).toEqual({
      snapshot: defaultSnapshot,
      console: [],
    })
    expect(driver.calls.filter((call) => call.method === 'capture').map((call) => call.args)).toEqual([[box]])
  })

  it('captures a story whose capture would cut nothing', async () => {
    const driver = new FakeDriver({ pages: [{ capturePrep: async () => ({ outcome: 'ready', box: null }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      snapshot: defaultSnapshot,
      console: [],
    })
  })

  it('breaks a story whose page shows a grid too wide as grid-too-wide, even when its capture would cut content', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          capturePrep: async () => ({
            outcome: 'ready',
            box: null,
            grid: { width: 1400, height: 500 },
            overflow: { top: 0, right: 120, bottom: 0, left: 0 },
          }),
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toMatchObject({
      broken: { reason: 'grid-too-wide' },
    })
  })

  it('breaks a story whose page shows a grid too tall as too-tall, even when its capture would cut content', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          capturePrep: async () => ({
            outcome: 'ready',
            box: null,
            grid: { width: 600, height: 20_000 },
            overflow: { top: 0, right: 120, bottom: 0, left: 0 },
          }),
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toMatchObject({
      broken: { reason: 'too-tall' },
    })
  })

  it('breaks a story whose element is missing as element-missing', async () => {
    const driver = new FakeDriver({
      pages: [{ capturePrep: async () => ({ outcome: 'element-missing', found: 'nothing' }) }],
    })

    expect(await openCaptureSession(driver, settings).capture({ ...primary, element: '#card' })).toMatchObject({
      broken: { reason: 'element-missing' },
    })
  })
})

describe('a story that navigates away', () => {
  /**
   * A page whose story navigates away to `url` as it loads.
   */
  const navigatesAway = (url: string): FakePageBehaviour => ({
    goto: async () => {
      throw new PageNavigatedAwayError(url, `The page navigated to ${url}.`)
    },
  })

  /**
   * The methods a page that navigated away at its load received: it was set up, failed to load and was closed.
   */
  const navigatedAwayAt = (page: number): string[] => [`${page}:setViewport`, `${page}:goto`, `${page}:close`]

  /**
   * The methods a page that captured well received.
   */
  const capturedOn = (page: number): string[] => [
    `${page}:setViewport`,
    `${page}:goto`,
    `${page}:evaluate`,
    `${page}:evaluate`,
    `${page}:growViewportToContent`,
    `${page}:evaluate`,
    `${page}:evaluate`,
    `${page}:evaluate`,
    `${page}:capture`,
  ]

  it('is broken with the last attempt after 2 retries, each on a fresh page', async () => {
    const driver = new FakeDriver({
      pages: [
        navigatesAway('http://localhost:6006/one'),
        navigatesAway('http://localhost:6006/two'),
        navigatesAway('http://localhost:6006/three'),
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'navigated-away',
        message: 'The story navigated away to /three. Await the new page before clicking.',
        url: 'http://localhost:6006/three',
      },
      console: [],
    })
    expect(driver.setups).toHaveLength(3)
    expect(driver.methods()).toEqual([...navigatedAwayAt(1), ...navigatedAwayAt(2), ...navigatedAwayAt(3)])
  })

  it('gives the snapshot of a retry that captured, keeping that page', async () => {
    const driver = new FakeDriver({ pages: [navigatesAway('http://localhost:6006/one')] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      snapshot: defaultSnapshot,
      console: [],
    })
    expect(driver.methods()).toEqual([...navigatedAwayAt(1), ...capturedOn(2)])
  })

  it('clears the kept page of a retry before the next story, as after any story that captured', async () => {
    const driver = new FakeDriver({ pages: [navigatesAway('http://localhost:6006/one')] })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    expect(await session.capture(secondary)).toEqual({ snapshot: defaultSnapshot, console: [] })
    expect(driver.setups).toHaveLength(2)
    expect(driver.methods()).toEqual([...navigatedAwayAt(1), ...capturedOn(2), '2:clearStorage', ...capturedOn(2)])
  })

  /**
   * Each outcome other than navigating away, as the reason it gives and a page that has it as it loads.
   */
  const otherOutcomes: [string, FakePageBehaviour][] = [
    [
      'crashed',
      {
        goto: async () => {
          throw new PageCrashedError()
        },
      },
    ],
    [
      'error',
      {
        goto: async () => {
          throw new Error('The page broke.')
        },
      },
    ],
    ['timeout', { storyWait: async () => timedOutAnswer('story') }],
    ['fonts-not-loaded', { assetsWait: async () => fontsTimedOutAnswer(['Inter 400 normal']) }],
    ['wait-threw', { waitHook: async () => ({ outcome: 'threw', text: 'Error: boom' }) }],
    [
      'play-threw',
      {
        storyWait: async () =>
          finishedAnswer({ errors: [{ event: 'playFunctionThrewException', text: 'Error: boom' }] }),
      },
    ],
  ]

  it.each(otherOutcomes)('is not retried when the first attempt is %s', async (reason, behaviour) => {
    const driver = new FakeDriver({ pages: [behaviour] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toHaveProperty('broken.reason', reason)
    expect(driver.setups).toHaveLength(1)
  })

  it.each(otherOutcomes)('gives the outcome of a retry that is %s, retrying no more', async (reason, behaviour) => {
    const driver = new FakeDriver({ pages: [navigatesAway('http://localhost:6006/one'), behaviour] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toHaveProperty('broken.reason', reason)
    expect(driver.setups).toHaveLength(2)
  })

  it('gives each retry the whole readyTimeout', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async () => {
            pass(4_000)

            throw new PageNavigatedAwayError('http://localhost:6006/one', 'The page navigated to /one.')
          },
        },
      ],
    })

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls.filter((call) => call.method === 'goto').map((call) => call.args[1])).toEqual([
      settings.readyTimeoutMs,
      settings.readyTimeoutMs,
    ])
  })

  it('gives the error of a page that cannot be opened for a retry', async () => {
    let openings = 0
    const driver = new FakeDriver({
      pages: [navigatesAway('http://localhost:6006/one')],
      newPage: async () => {
        openings += 1

        if (openings === 2) {
          throw new Error("The browser didn't open a page within 30 s.")
        }
      },
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message: "visual-check couldn't open a page for the story: The browser didn't open a page within 30 s.",
      },
    })
    expect(driver.methods()).toEqual(navigatedAwayAt(1))
  })

  it('rejects when the browser exits during a retry', async () => {
    const exited = new BrowserExitedError({ code: 1, signal: null, error: undefined }, [])
    const driver = new FakeDriver({
      pages: [
        navigatesAway('http://localhost:6006/one'),
        {
          goto: async () => {
            throw exited
          },
        },
      ],
    })

    await expect(openCaptureSession(driver, settings).capture(primary)).rejects.toBe(exited)
    expect(driver.methods()).toEqual([...navigatedAwayAt(1), '2:setViewport', '2:goto'])
  })
})

describe('capturing the same page again', () => {
  /**
   * The snapshot a page gives at its first capture.
   */
  const first = new Uint8Array([1, 1, 1])

  /**
   * The snapshot a page gives at each capture after its first.
   */
  const again = new Uint8Array([2, 2, 2])

  /**
   * A page whose first capture gives `first` and whose later captures answer as `later` says, giving `again` by
   * default. It answers the rest as `behaviour` says.
   */
  const capturingTwice = (
    behaviour: FakePageBehaviour = {},
    later: () => Promise<Uint8Array> = async () => again,
  ): FakePageBehaviour => {
    let captures = 0

    return {
      ...behaviour,
      capture: async () => {
        captures += 1

        return captures === 1 ? first : await later()
      },
    }
  }

  /**
   * The methods a page received up to the first capture of a story that captured well.
   */
  const capturedOn = (page: number): string[] => [
    `${page}:setViewport`,
    `${page}:goto`,
    `${page}:evaluate`,
    `${page}:evaluate`,
    `${page}:growViewportToContent`,
    `${page}:evaluate`,
    `${page}:evaluate`,
    `${page}:evaluate`,
    `${page}:capture`,
  ]

  it('captures once, giving nothing captured again, for a story without captureAgainIf', async () => {
    const driver = new FakeDriver({ pages: [capturingTwice()] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toStrictEqual({
      snapshot: first,
      console: [],
      completingMs: undefined,
    })
    expect(driver.methods()).toEqual(capturedOn(1))
  })

  it('calls captureAgainIf with the snapshot as soon as it is captured', async () => {
    let methodsWhenCalled: string[] = []
    const driver = new FakeDriver({ pages: [capturingTwice()] })
    const captureAgainIf = vi.fn(async () => {
      methodsWhenCalled = driver.methods()

      return false
    })

    await openCaptureSession(driver, settings).capture({ ...primary, captureAgainIf })
    expect(captureAgainIf).toHaveBeenCalledExactlyOnceWith(first)
    expect(methodsWhenCalled).toEqual(capturedOn(1))
  })

  it('captures nothing more when captureAgainIf resolves false, keeping the page for the next story', async () => {
    const driver = new FakeDriver({ pages: [capturingTwice()] })
    const session = openCaptureSession(driver, settings)

    expect(await session.capture({ ...primary, captureAgainIf: async () => false })).toStrictEqual({
      snapshot: first,
      console: [],
      completingMs: undefined,
    })
    expect(await session.capture(secondary)).toEqual({ snapshot: again, console: [] })
    expect(driver.methods()).toEqual([...capturedOn(1), '1:clearStorage', ...capturedOn(1)])
  })

  /**
   * An element's box, as the capture preparation gives it.
   */
  const box = { x: 8, y: 16, width: 320, height: 200 }

  it.each([
    ['the full page', primary, null, 'full-page'],
    ["the element's box", { ...primary, element: '#card' }, box, box],
  ])(
    'captures %s again at once when captureAgainIf resolves true, beside the first snapshot',
    async (_area, story, prepBox, area) => {
      const driver = new FakeDriver({
        pages: [capturingTwice({ capturePrep: async () => ({ outcome: 'ready', box: prepBox }) })],
      })
      const capture = await openCaptureSession(driver, settings).capture({ ...story, captureAgainIf: async () => true })

      expect(capture).toStrictEqual({ snapshot: first, completingMs: undefined, console: [], capturedAgain: again })
      expect('snapshot' in capture && capture.capturedAgain).toBe(again)
      expect(driver.methods().filter((method) => method !== '1:growViewportToContent')).toEqual([
        '1:setViewport',
        '1:goto',
        '1:evaluate',
        '1:evaluate',
        '1:evaluate',
        '1:evaluate',
        '1:evaluate',
        '1:capture',
        '1:capture',
      ])
      expect(driver.calls.slice(-2)).toEqual([
        { page: 1, method: 'capture', args: [area] },
        { page: 1, method: 'capture', args: [area] },
      ])
    },
  )

  it('keeps the page for the next story after it captured again, clearing it as after any story that captured', async () => {
    const driver = new FakeDriver({ pages: [capturingTwice()] })
    const session = openCaptureSession(driver, settings)

    await session.capture({ ...primary, captureAgainIf: async () => true })
    expect(await session.capture(secondary)).toEqual({ snapshot: again, console: [] })
    expect(driver.setups).toHaveLength(1)
    expect(driver.methods()).toEqual([...capturedOn(1), '1:capture', '1:clearStorage', ...capturedOn(1)])
  })

  it('gives the completing time, the remote content and the hosts of the first capture, read before captureAgainIf is called', async () => {
    let called = false
    const remote = [{ host: 'images.example.com', x: 1, y: 2, width: 3, height: 4 }]
    const driver = new FakeDriver({
      pages: [
        capturingTwice({
          storyWait: async () => finishedAnswer({ completingMs: 104 }),
          capturePrep: async () => ({ outcome: 'ready', box: null, remote }),
          requestHosts: () => (called ? ['late.example.com'] : ['api.example.com']),
        }),
      ],
    })
    const story = {
      ...primary,
      viewport: { ...primary.viewport, deviceScaleFactor: 1 },
      findRemoteContent: true,
      captureAgainIf: async () => {
        called = true

        return true
      },
    }

    expect(await openCaptureSession(driver, { ...settings, listHosts: true }).capture(story)).toStrictEqual({
      snapshot: first,
      console: [],
      completingMs: 104,
      remoteContent: [{ host: 'images.example.com', x: 1, y: 2, width: 3, height: 4 }],
      hosts: { requests: ['api.example.com'], remoteContent: ['images.example.com'] },
      capturedAgain: again,
    })
  })

  it.each([
    [
      'crashed',
      'a crash',
      new PageCrashedError(),
      'The page crashed while capturing the snapshot again, usually because it ran out of memory. Fewer workers leave each page more memory.',
    ],
    [
      'error',
      'an error',
      new Error('The browser said no.'),
      'Capturing the snapshot again failed: The browser said no.',
    ],
    [
      'error',
      "the driver's own time limit, not readyTimeout",
      new PageTimeoutError("The page didn't capture within 30 s.", 30_000),
      "Capturing the snapshot again failed: The page didn't capture within 30 s.",
    ],
  ])(
    'makes a broken story, %s, of a second capture that fails with %s, closing the page',
    async (reason, _how, error, message) => {
      const driver = new FakeDriver({
        pages: [
          capturingTwice({}, async () => {
            throw error
          }),
        ],
      })

      expect(
        await openCaptureSession(driver, settings).capture({ ...primary, captureAgainIf: async () => true }),
      ).toEqual({ broken: { reason, message }, console: [] })
      expect(driver.methods()).toEqual([...capturedOn(1), '1:capture', '1:close'])
    },
  )

  it('rejects when the browser exits during the second capture, closing nothing', async () => {
    const exited = new BrowserExitedError({ code: 1, signal: null, error: undefined }, [])
    const driver = new FakeDriver({
      pages: [
        capturingTwice({}, async () => {
          throw exited
        }),
      ],
    })

    await expect(
      openCaptureSession(driver, settings).capture({ ...primary, captureAgainIf: async () => true }),
    ).rejects.toBe(exited)
    expect(driver.methods()).toEqual([...capturedOn(1), '1:capture'])
  })

  it('rejects with what captureAgainIf rejects with, closing the page and capturing nothing more', async () => {
    const failure = new Error('The snapshots could not be compared.')
    const driver = new FakeDriver({ pages: [capturingTwice()] })
    const session = openCaptureSession(driver, settings)
    const captureAgainIf = async (): Promise<boolean> => {
      throw failure
    }

    await expect(session.capture({ ...primary, captureAgainIf })).rejects.toBe(failure)
    expect(driver.methods()).toEqual([...capturedOn(1), '1:close'])
    expect(await session.capture(secondary)).toEqual({ snapshot: defaultSnapshot, console: [] })
    expect(driver.setups).toHaveLength(2)
  })

  it("rejects with what captureAgainIf rejects with when the page doesn't close", async () => {
    const failure = new Error('The snapshots could not be compared.')
    const driver = new FakeDriver({
      pages: [
        capturingTwice({
          close: async () => {
            throw new Error('The page crashed.')
          },
        }),
      ],
    })
    const captureAgainIf = async (): Promise<boolean> => {
      throw failure
    }

    await expect(openCaptureSession(driver, settings).capture({ ...primary, captureAgainIf })).rejects.toBe(failure)
  })

  /**
   * Pages whose story is broken, as when it is.
   */
  const brokenPages: [string, FakePageBehaviour][] = [
    ['Storybook reports it failed', { storyWait: async () => finishedAnswer({ status: 'error' }) }],
    [
      'its capture fails',
      {
        capture: async () => {
          throw new Error('The browser said no.')
        },
      },
    ],
  ]

  it.each(brokenPages)('does not call captureAgainIf for a broken story, as when %s', async (_when, behaviour) => {
    const captureAgainIf = vi.fn(async () => true)
    const driver = new FakeDriver({ pages: [behaviour] })

    expect(await openCaptureSession(driver, settings).capture({ ...primary, captureAgainIf })).toHaveProperty('broken')
    expect(captureAgainIf).not.toHaveBeenCalled()
  })

  it('calls captureAgainIf once, for the snapshot of the retry, when the first attempt navigates away', async () => {
    const captureAgainIf = vi.fn(async () => true)
    const driver = new FakeDriver({
      pages: [
        {
          goto: async () => {
            throw new PageNavigatedAwayError('http://localhost:6006/one', 'The page navigated to /one.')
          },
        },
        capturingTwice(),
      ],
    })

    expect(await openCaptureSession(driver, settings).capture({ ...primary, captureAgainIf })).toStrictEqual({
      snapshot: first,
      console: [],
      completingMs: undefined,
      capturedAgain: again,
    })
    expect(captureAgainIf).toHaveBeenCalledExactlyOnceWith(first)
    expect(driver.methods()).toEqual(['1:setViewport', '1:goto', '1:close', ...capturedOn(2), '2:capture'])
  })

  it('retries a story whose second capture navigates away on a fresh page, calling captureAgainIf again for its snapshot', async () => {
    const retried = new Uint8Array([3, 3, 3])
    const captureAgainIf = vi.fn(async () => true)
    const driver = new FakeDriver({
      pages: [
        capturingTwice({}, async () => {
          throw new PageNavigatedAwayError('http://localhost:6006/one', 'The page navigated to /one.')
        }),
        { capture: async () => retried },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture({ ...primary, captureAgainIf })).toStrictEqual({
      snapshot: retried,
      console: [],
      completingMs: undefined,
      capturedAgain: retried,
    })
    expect(captureAgainIf.mock.calls).toEqual([[first], [retried]])
    expect(driver.methods()).toEqual([...capturedOn(1), '1:capture', '1:close', ...capturedOn(2), '2:capture'])
  })
})

describe('the console messages of a capture', () => {
  /**
   * A console message a page sent, named by `text`.
   */
  const logged = (text: string): ConsoleMessage => ({ kind: 'console.log', text })

  /**
   * A page that gives `sent` as its messages until it's closed, and none after, answering the rest as `behaviour`
   * says.
   */
  const sendingUntilClosed = (sent: ConsoleMessage[], behaviour: FakePageBehaviour = {}): FakePageBehaviour => {
    let closed = false

    return {
      ...behaviour,
      close: async () => {
        closed = true
      },
      consoleMessages: () => (closed ? [] : sent),
    }
  }

  it("come with the snapshot, as the page gives them once it's captured", async () => {
    let captured = false
    const driver = new FakeDriver({
      pages: [
        {
          capture: async () => {
            captured = true

            return defaultSnapshot
          },
          consoleMessages: () => (captured ? [logged('captured')] : []),
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toStrictEqual({
      snapshot: defaultSnapshot,
      completingMs: undefined,
      console: [logged('captured')],
    })
  })

  it('come with the first snapshot when the page is captured again', async () => {
    const driver = new FakeDriver({ pages: [{ consoleMessages: () => [logged('a line')] }] })
    const capture = await openCaptureSession(driver, settings).capture({
      ...primary,
      captureAgainIf: async () => true,
    })

    expect(capture).toMatchObject({ console: [logged('a line')], capturedAgain: defaultSnapshot })
  })

  it('come with a broken story that Storybook reports failed, read before its page closes', async () => {
    const driver = new FakeDriver({
      pages: [
        sendingUntilClosed([logged('render failed')], { storyWait: async () => finishedAnswer({ status: 'error' }) }),
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toMatchObject({
      broken: { reason: 'error' },
      console: [logged('render failed')],
    })
    expect(driver.methods()).toContain('1:close')
  })

  it('come with a broken story whose step failed, read before its page closes', async () => {
    const driver = new FakeDriver({
      pages: [
        sendingUntilClosed([logged('crashing')], {
          goto: async () => {
            throw new PageCrashedError()
          },
        }),
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toMatchObject({
      broken: { reason: 'crashed' },
      console: [logged('crashing')],
    })
  })

  it('come with a broken story whose second capture failed, read before its page closes', async () => {
    let captures = 0
    const driver = new FakeDriver({
      pages: [
        sendingUntilClosed([logged('captured twice')], {
          capture: async () => {
            captures += 1

            if (captures === 2) {
              throw new PageCrashedError()
            }

            return defaultSnapshot
          },
        }),
      ],
    })

    expect(
      await openCaptureSession(driver, settings).capture({ ...primary, captureAgainIf: async () => true }),
    ).toMatchObject({ broken: { reason: 'crashed' }, console: [logged('captured twice')] })
  })

  it('are those of the last attempt of a story that navigates away', async () => {
    const navigatesAway = (text: string): FakePageBehaviour =>
      sendingUntilClosed([logged(text)], {
        goto: async () => {
          throw new PageNavigatedAwayError('http://localhost:6006/away', 'The page navigated away.')
        },
      })
    const driver = new FakeDriver({ pages: [navigatesAway('one'), navigatesAway('two'), navigatesAway('three')] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toMatchObject({
      broken: { reason: 'navigated-away' },
      console: [logged('three')],
    })
  })

  it('are those of the retry that captured, for a story that navigated away first', async () => {
    const driver = new FakeDriver({
      pages: [
        sendingUntilClosed([logged('one')], {
          goto: async () => {
            throw new PageNavigatedAwayError('http://localhost:6006/away', 'The page navigated away.')
          },
        }),
        { consoleMessages: () => [logged('two')] },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toMatchObject({
      snapshot: defaultSnapshot,
      console: [logged('two')],
    })
  })

  it("are left out of a broken story whose page didn't open", async () => {
    const driver = new FakeDriver({
      newPage: async () => {
        throw new Error("The browser didn't open a page within 30 s.")
      },
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).not.toHaveProperty('console')
  })
})

describe('the failed loads of a broken story', () => {
  const chunk = { url: 'http://localhost:6006/assets/card.stories-B0zV1TVO.js', error: 'net::ERR_EMPTY_RESPONSE' }
  const stylesheet = { url: 'http://localhost:6006/assets/preview.css?v=1', error: 'net::ERR_CONNECTION_RESET' }
  const font = { url: 'http://localhost:6006/fonts/inter.woff2', error: 'net::ERR_EMPTY_RESPONSE' }

  it("add a sentence naming the one file to a timed-out story's message, and come with it", async () => {
    const driver = new FakeDriver({
      pages: [{ storyWait: async () => timedOutAnswer('story'), failedLoads: () => [chunk] }],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): Storybook never sent storyFinished for it. Its page couldn't load /assets/card.stories-B0zV1TVO.js from Storybook: net::ERR_EMPTY_RESPONSE.",
        readyTimeoutMs: 10_000,
        failedLoads: [chunk],
      },
      console: [],
    })
  })

  it("add a sentence counting several files and naming the first to an errored story's message", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          storyWait: async () =>
            finishedAnswer({ errors: [{ event: 'storyThrewException', text: 'TypeError: Failed to fetch' }] }),
          failedLoads: () => [stylesheet, chunk, font],
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "The story threw TypeError: Failed to fetch. Its page couldn't load 3 files from Storybook, the first /assets/preview.css?v=1: net::ERR_CONNECTION_RESET.",
        failedLoads: [stylesheet, chunk, font],
      },
      console: [],
    })
  })

  it("keep a play-threw story's message without their sentence as its error text when Storybook described no error", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          storyWait: async () =>
            finishedAnswer({ errors: [{ event: 'playFunctionThrewException', text: '', stack: [] }] }),
          failedLoads: () => [chunk],
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toMatchObject({
      broken: {
        reason: 'play-threw',
        message:
          "The story's play function threw an error. Its page couldn't load /assets/card.stories-B0zV1TVO.js from Storybook: net::ERR_EMPTY_RESPONSE.",
        errorText: "The story's play function threw an error.",
      },
    })
  })

  it('come with a broken story whose step failed, and one whose second capture failed', async () => {
    const goneWrong = new FakeDriver({
      pages: [
        {
          goto: async () => {
            throw new PageCrashedError()
          },
          failedLoads: () => [chunk],
        },
      ],
    })
    let captures = 0
    const capturedAgain = new FakeDriver({
      pages: [
        {
          capture: async () => {
            captures += 1

            if (captures === 2) {
              throw new PageCrashedError()
            }

            return defaultSnapshot
          },
          failedLoads: () => [chunk],
        },
      ],
    })

    expect(await openCaptureSession(goneWrong, settings).capture(primary)).toMatchObject({
      broken: { reason: 'crashed', failedLoads: [chunk] },
    })
    expect(
      await openCaptureSession(capturedAgain, settings).capture({ ...primary, captureAgainIf: async () => true }),
    ).toMatchObject({ broken: { reason: 'crashed', failedLoads: [chunk] } })
  })

  it('leave a broken story without any as it was', async () => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => timedOutAnswer('story') }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toStrictEqual({
      broken: {
        reason: 'timeout',
        message: "The story wasn't ready within readyTimeout (10000 ms): Storybook never sent storyFinished for it.",
        readyTimeoutMs: 10_000,
      },
      console: [],
    })
  })

  it('are ignored for a snapshot that captures', async () => {
    const driver = new FakeDriver({ pages: [{ failedLoads: () => [font] }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toStrictEqual({
      snapshot: defaultSnapshot,
      completingMs: undefined,
      console: [],
    })
  })
})

describe('the image of a broken story', () => {
  /**
   * A story that asks for an image of its page when it breaks.
   */
  const imaged = { ...primary, imageWhenBroken: true }

  /**
   * The image a page gives of a broken story.
   */
  const image = new Uint8Array([7, 7, 7])

  /**
   * A page that breaks the story as `breaking` says, and captures `image` once the story broke.
   */
  const breakingWith = (breaking: FakePageBehaviour): FakePageBehaviour => ({
    capture: async () => image,
    ...breaking,
  })

  it.each([
    ['error', { storyWait: async () => finishedAnswer({ status: 'error' }) }],
    [
      'play-threw',
      { storyWait: async () => finishedAnswer({ errors: [{ event: 'playFunctionThrewException', text: 'Error' }] }) },
    ],
    ['timeout', { assetsWait: async () => imagesTimedOutAnswer(1) }],
    ['fonts-not-loaded', { assetsWait: async () => fontsTimedOutAnswer(['Inter 400 normal']) }],
    ['wait-threw', { waitHook: async () => ({ outcome: 'threw', text: 'Error: no data' }) }],
    ['element-missing', { capturePrep: async () => ({ outcome: 'element-missing', found: 'nothing' }) }],
    [
      'grid-too-wide',
      { capturePrep: async () => ({ outcome: 'ready', box: null, grid: { width: 1400, height: 500 } }) },
    ],
    [
      'overflows',
      {
        capturePrep: async () => ({
          outcome: 'ready',
          box: { x: 0, y: 0, width: 300, height: 200 },
          overflow: { top: 0, right: 197, bottom: 0, left: 0 },
        }),
      },
    ],
  ])(
    'is the full page captured once a story is broken with %s, before its page is closed',
    async (reason, breaking) => {
      const driver = new FakeDriver({ pages: [breakingWith(breaking)] })
      const capture = await openCaptureSession(driver, settings).capture({ ...imaged, element: '#card' })

      expect(capture).toMatchObject({ broken: { reason }, console: [], image })
      expect(driver.calls.filter((call) => call.method === 'capture').map((call) => call.args)).toEqual([['full-page']])
      expect(driver.methods().slice(-2)).toEqual(['1:capture', '1:close'])
    },
  )

  it.each([
    [
      'crashed',
      {
        waitHook: async () => {
          throw new PageCrashedError()
        },
      },
    ],
    [
      'too-tall',
      {
        capture: async () => {
          throw new CaptureTooLargeError(2560, 40_000)
        },
      },
    ],
    [
      'navigated-away',
      {
        waitHook: async () => {
          throw new PageNavigatedAwayError('http://localhost:6006/next', 'The page navigated to /next.')
        },
      },
    ],
  ])("isn't captured for a story broken with %s", async (reason, breaking) => {
    const driver = new FakeDriver({ pages: [breaking, breaking, breaking] })
    const capture = await openCaptureSession(driver, settings).capture(imaged)

    expect(capture).toMatchObject({ broken: { reason } })
    expect(capture).not.toHaveProperty('image')
    expect(driver.methods().filter((method) => method.endsWith(':capture'))).toHaveLength(reason === 'too-tall' ? 1 : 0)
  })

  it("isn't captured for a story that doesn't ask for it", async () => {
    const driver = new FakeDriver({ pages: [breakingWith({ assetsWait: async () => imagesTimedOutAnswer(1) })] })
    const capture = await openCaptureSession(driver, settings).capture(primary)

    expect(capture).toMatchObject({ broken: { reason: 'timeout' } })
    expect(capture).not.toHaveProperty('image')
    expect(driver.methods()).not.toContain('1:capture')
  })

  it('is left out when its capture fails, and the page is still closed', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          assetsWait: async () => imagesTimedOutAnswer(1),
          capture: async () => {
            throw new Error('Page.captureScreenshot failed.')
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(imaged)).toStrictEqual({
      broken: {
        reason: 'timeout',
        message: "The story wasn't ready within readyTimeout (10000 ms): 1 of its images was still loading.",
        readyTimeoutMs: 10000,
      },
      console: [],
    })
    expect(driver.methods().slice(-1)).toEqual(['1:close'])
  })

  it("is left out when its capture doesn't finish within the settings' time limit", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          assetsWait: async () => imagesTimedOutAnswer(1),
          capture: async () => await new Promise<Uint8Array>(() => undefined),
        },
      ],
    })
    const capture = await openCaptureSession(driver, { ...settings, brokenImageTimeLimitMs: 10 }).capture(imaged)

    expect(capture).toMatchObject({ broken: { reason: 'timeout' } })
    expect(capture).not.toHaveProperty('image')
    expect(driver.methods().slice(-1)).toEqual(['1:close'])
  })

  it('rejects the capture when the browser exits while it is captured', async () => {
    const exited = new BrowserExitedError({ code: 1, signal: null, error: undefined }, [])
    const driver = new FakeDriver({
      pages: [
        {
          assetsWait: async () => imagesTimedOutAnswer(1),
          capture: async () => {
            throw exited
          },
        },
      ],
    })

    await expect(openCaptureSession(driver, settings).capture(imaged)).rejects.toBe(exited)
    expect(driver.methods()).not.toContain('1:close')
  })
})

describe('a browser exit', () => {
  const exited = new BrowserExitedError({ code: 1, signal: null, error: undefined }, [])

  it('rejects the capture with the error, closing nothing', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async () => {
            throw exited
          },
        },
      ],
    })

    await expect(openCaptureSession(driver, settings).capture(primary)).rejects.toBe(exited)
    expect(driver.methods()).not.toContain('1:close')
  })

  it("rejects the capture when the previous story's storage is being cleared", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          clearStorage: async () => {
            throw exited
          },
        },
      ],
    })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await expect(session.capture(secondary)).rejects.toBe(exited)
    expect(driver.methods()).not.toContain('1:close')
    expect(driver.setups).toHaveLength(1)
  })

  it('rejects the capture when the page is being opened', async () => {
    const driver = new FakeDriver({
      newPage: async () => {
        throw exited
      },
    })

    await expect(openCaptureSession(driver, settings).capture(primary)).rejects.toBe(exited)
  })
})

describe('close', () => {
  it('closes the open page', async () => {
    const driver = new FakeDriver()
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await session.close()
    expect(driver.methods().at(-1)).toBe('1:close')
  })

  it('does nothing without an open page', async () => {
    const driver = new FakeDriver()

    await openCaptureSession(driver, settings).close()
    expect(driver.calls).toEqual([])
  })
})
