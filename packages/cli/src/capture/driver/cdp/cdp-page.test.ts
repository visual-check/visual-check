import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CaptureTooLargeError,
  type ConsoleMessage,
  consoleMessageFunction,
  type Driver,
  type Page,
  PageLoadError,
  PageTimeoutError,
} from '../driver.js'
import { launchCdpDriver } from './cdp-driver.js'
import {
  type CommandHandler,
  childFrame,
  defaultCaptureData,
  defaultVersionReply,
  executionContext,
  FakeBrowser,
  type FakeBrowserOptions,
  mainFrame,
  pageSetup,
  type ReceivedCommand,
} from './fake-browser.fixture.js'

setFlagsFromString('--expose-gc')

/**
 * Runs a full garbage collection.
 */
const collectGarbage = runInNewContext('gc') as () => void

/**
 * The URL the tests load.
 */
const storyUrl = 'http://storybook:6006/iframe.html?id=button--primary&viewMode=story'

/**
 * The origin of the URL the tests load.
 */
const storyOrigin = 'http://storybook:6006'

/**
 * The URL a story's script navigates the page to on its own, after the story loaded.
 */
const burgersUrl = 'http://storybook:6006/categories/burgers'

/**
 * The browser's message when it fails a call in flight because the main frame is committing a new document.
 */
const navigatedOrClosed = 'Inspected target navigated or closed'

/**
 * The command that clears every cookie of the first page's browser context, at the browser level.
 */
const clearCookies = { method: 'Storage.clearCookies', params: { browserContextId: 'context-1' }, sessionId: undefined }

/**
 * The session the fake browser attaches the first page in.
 */
const sessionId = 'session-1'

/**
 * The first page's target id, which is also its main frame's id.
 */
const targetId = 'target-1'

/**
 * The session the fake browser attaches the first page's service worker in, after the page's own.
 */
const workerSessionId = 'session-2'

/**
 * The parameters a watched page turns the Network domain on with, in its session and its service workers' sessions:
 * no body kept.
 */
const networkEnableParams = { maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0 }

/**
 * A URL of another origin than the story's that a story's script requests.
 */
const apiUrl = 'https://api.example.com/users'

/**
 * A command as the tests compare it: without its id.
 */
type SentCommand = Omit<ReceivedCommand, 'id'>

/**
 * Launches a driver on a fake browser with these options.
 */
async function launch(options: FakeBrowserOptions = {}): Promise<{ browser: FakeBrowser; driver: Driver }> {
  const browser = new FakeBrowser(options)
  const driver = await launchCdpDriver({
    sandbox: false,
    profileDir: '/tmp/visual-check-profile',
    start: browser.start,
  })

  return { browser, driver }
}

/**
 * Launches a driver on a fake browser with these options and opens a page with the tests' setup.
 */
async function openPage(options: FakeBrowserOptions = {}): Promise<{ browser: FakeBrowser; page: Page }> {
  const { browser, driver } = await launch(options)

  return { browser, page: await driver.newPage(pageSetup) }
}

/**
 * The commands the browser received, without their ids.
 */
function sent(browser: FakeBrowser): SentCommand[] {
  return browser.received.map(({ method, params, sessionId: commandSessionId }) => ({
    method,
    params,
    sessionId: commandSessionId,
  }))
}

/**
 * The commands of one method the browser received, without their ids.
 */
function sentOf(browser: FakeBrowser, method: string): SentCommand[] {
  return sent(browser).filter((command) => command.method === method)
}

/**
 * The storage commands the browser received, without their ids.
 */
function storageCommands(browser: FakeBrowser): SentCommand[] {
  return sent(browser).filter((command) => /^(DOM)?Storage\./.test(command.method))
}

/**
 * The commands that clear `localStorage`, IndexedDB and `sessionStorage` of the origin, in the first page's session.
 */
function clearOriginCommands(origin: string): SentCommand[] {
  return [
    { method: 'Storage.clearDataForOrigin', params: { origin, storageTypes: 'local_storage,indexeddb' }, sessionId },
    { method: 'DOMStorage.clear', params: { storageId: { securityOrigin: origin, isLocalStorage: false } }, sessionId },
  ]
}

/**
 * Answers `Page.navigate` as Chromium does when the first page loads, committing its main frame as `frame`, which
 * carries loader `loaderId`, `loader-1` by default: where a server redirect landed, or a document whose security origin
 * the test chooses.
 */
function navigateCommitting(frame: Record<string, unknown>, loaderId = 'loader-1'): CommandHandler {
  return (command: ReceivedCommand, fake: FakeBrowser) => {
    fake.emit('Page.frameNavigated', { frame }, sessionId)
    fake.reply(command, { frameId: targetId, loaderId })
    fake.emit('Page.loadEventFired', { timestamp: 1 }, sessionId)
  }
}

/**
 * Commits the first page's main frame at the URL asked for with loader `loader-1`, replies, and fires the load event.
 */
function navigateAndLoadOnce(command: ReceivedCommand, fake: FakeBrowser): void {
  fake.emit('Page.frameNavigated', { frame: mainFrame(targetId, String(command.params.url), 'loader-1') }, sessionId)
  fake.reply(command, { frameId: targetId, loaderId: 'loader-1' })
  fake.emit('Page.loadEventFired', { timestamp: 1 }, sessionId)
}

/**
 * Has the fake browser say that the first page asks to navigate this frame to `url`, in the current tab, as a story's
 * script does when it follows a link.
 */
function requestNavigation(fake: FakeBrowser, frameId: string, url: string): void {
  fake.emit(
    'Page.frameRequestedNavigation',
    { frameId, reason: 'anchorClick', url, disposition: 'currentTab' },
    sessionId,
  )
}

/**
 * A `PageNavigatedAwayError` as the tests match it: the page navigated to `url` after `gotoUrl` loaded.
 */
function navigatedAway(url: string, gotoUrl = storyUrl): Record<string, unknown> {
  return { name: 'PageNavigatedAwayError', url, message: `The page navigated to ${url} after ${gotoUrl} loaded.` }
}

/**
 * A `Target.targetCreated` event's parameters for a target of this type, in this browser context.
 */
function createdTarget(type: string, browserContextId: string, newTargetId: string): Record<string, unknown> {
  return { targetInfo: { targetId: newTargetId, type, browserContextId } }
}

/**
 * Launches a driver on a fake browser with these options, opens a page that watches its requests, and loads the story
 * in it.
 */
async function openWatchedPage(options: FakeBrowserOptions = {}): Promise<{ browser: FakeBrowser; page: Page }> {
  const { browser, driver } = await launch(options)
  const page = await driver.newPage({ ...pageSetup, watchRequests: true })

  await page.goto(storyUrl, 1000)

  return { browser, page }
}

/**
 * Has the fake browser say that a request of this resource type, `Fetch` by default, is sent to `url`, in the first
 * page's session or the one given.
 */
function sendRequest(fake: FakeBrowser, requestId: string, url: string, type = 'Fetch', session = sessionId): void {
  fake.emit('Network.requestWillBeSent', { requestId, type, request: { url, method: 'GET' } }, session)
}

/**
 * Has the fake browser say that a request of the first page's session got this response.
 */
function receiveResponse(fake: FakeBrowser, requestId: string, response: Record<string, unknown>): void {
  fake.emit('Network.responseReceived', { requestId, type: 'Fetch', response: { url: '', ...response } }, sessionId)
}

/**
 * Has the fake browser say that the first page opened a WebSocket to `url`.
 */
function openSocket(fake: FakeBrowser, requestId: string, url: string): void {
  fake.emit('Network.webSocketCreated', { requestId, url }, sessionId)
}

/**
 * Has the first page's session report a service worker of its browser context, and waits until the page has attached
 * to it and taken in the browser's answer to the Network domain in its session.
 */
async function attachWorker(fake: FakeBrowser): Promise<void> {
  reportWorker(fake)
  await flushUntil(() => sentOf(fake, 'Network.enable').length === 2)
  await flush()
}

/**
 * Has the first page's session report a service worker of its browser context.
 */
function reportWorker(fake: FakeBrowser): void {
  fake.emit('Target.targetCreated', createdTarget('service_worker', 'context-1', 'target-worker'), sessionId)
}

/**
 * Waits until every pending stream event and promise callback has run.
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

/**
 * Waits for stream events and promise callbacks until `condition` holds.
 */
async function flushUntil(condition: () => boolean): Promise<void> {
  while (!condition()) {
    await flush()
  }
}

/**
 * Resolves with whether the promise has settled yet.
 */
async function hasSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false

  promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  await flush()

  return settled
}

/**
 * Has the fake browser say that the execution context `contextId` of the first page, or of the session given, called
 * the message function, or the function named `name`, with `payload`, as the page script does for each console
 * message or error it records. The fake browser's first navigation creates context 1, its second context 2, and so on.
 */
function sendMessage(
  fake: FakeBrowser,
  payload: string,
  contextId: number,
  { session = sessionId, name = consoleMessageFunction }: { session?: string; name?: string } = {},
): void {
  fake.emit('Runtime.bindingCalled', { name, payload, executionContextId: contextId }, session)
}

/**
 * The payload the page script sends for a `console.log` of `text`.
 */
function logged(text: string): string {
  return JSON.stringify({ kind: 'console.log', text })
}

/**
 * A `console.log` message of `text`, as `Page.consoleMessages` gives it.
 */
function logMessage(text: string): ConsoleMessage {
  return { kind: 'console.log', text }
}

/**
 * A phone-sized viewport with touch.
 */
const touchViewport = { width: 375, height: 667, deviceScaleFactor: 2, touch: true }

afterEach(() => {
  vi.useRealTimers()
})

describe('Driver.newPage', () => {
  it('opens a target in a fresh browser context and attaches to it in a flat session', async () => {
    const { browser } = await openPage()

    expect(sent(browser).slice(2, 5)).toEqual([
      { method: 'Target.createBrowserContext', params: { disposeOnDetach: true }, sessionId: undefined },
      {
        method: 'Target.createTarget',
        params: { url: 'about:blank', browserContextId: 'context-1' },
        sessionId: undefined,
      },
      { method: 'Target.attachToTarget', params: { targetId: 'target-1', flatten: true }, sessionId: undefined },
    ])
  })

  it('sets the page up once, in its session', async () => {
    const { browser } = await openPage()

    expect(sent(browser).slice(5)).toEqual([
      { method: 'Page.enable', params: {}, sessionId },
      { method: 'Inspector.enable', params: {}, sessionId },
      {
        method: 'Emulation.setUserAgentOverride',
        params: { userAgent: `${defaultVersionReply.userAgent} StorybookTestRunner`, acceptLanguage: 'pl-PL' },
        sessionId,
      },
      { method: 'Emulation.setTimezoneOverride', params: { timezoneId: 'Europe/Warsaw' }, sessionId },
      { method: 'Emulation.setLocaleOverride', params: { locale: 'pl-PL' }, sessionId },
      {
        method: 'Emulation.setEmulatedMedia',
        params: {
          features: [
            { name: 'prefers-color-scheme', value: 'dark' },
            { name: 'prefers-reduced-motion', value: 'no-preference' },
          ],
        },
        sessionId,
      },
      { method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true }, sessionId },
      { method: 'Runtime.enable', params: {}, sessionId },
      { method: 'Runtime.addBinding', params: { name: '__visualCheckMessage' }, sessionId },
      {
        method: 'Page.addScriptToEvaluateOnNewDocument',
        params: { source: 'window.__visualCheck = true' },
        sessionId,
      },
      { method: 'Log.enable', params: {}, sessionId },
      {
        method: 'Browser.setDownloadBehavior',
        params: { behavior: 'deny', browserContextId: 'context-1' },
        sessionId: undefined,
      },
      {
        method: 'Browser.grantPermissions',
        params: { permissions: [], browserContextId: 'context-1' },
        sessionId: undefined,
      },
    ])
  })

  // A beyond-viewport capture resets the page's web preferences, which drops a font table set through
  // `Page.setFontFamilies`, and Chromium takes the table once per page. With one, a page would be measured with the
  // table's fonts and painted with the system's, so its boxes and its pixels would disagree.
  it('sets no font table, so a page is measured with the fonts it is captured with', async () => {
    const { browser, page } = await openPage()

    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1, touch: false })
    await page.goto(storyUrl, 1000)
    await page.capture('full-page')

    expect(sentOf(browser, 'Page.setFontFamilies')).toEqual([])
  })

  it.each([['Emulation.setTimezoneOverride'], ['Target.attachToTarget']])(
    'disposes the context when %s fails',
    async (failingMethod) => {
      const { browser, driver } = await launch({
        handlers: {
          [failingMethod]: (command: ReceivedCommand, fake: FakeBrowser) => fake.fail(command, -32000, 'Failed'),
        },
      })

      await expect(driver.newPage(pageSetup)).rejects.toThrow(`CDP ${failingMethod} failed: Failed`)
      expect(sentOf(browser, 'Target.disposeBrowserContext')).toEqual([
        { method: 'Target.disposeBrowserContext', params: { browserContextId: 'context-1' }, sessionId: undefined },
      ])
    },
  )

  it("fails and disposes the context when the browser's answer has no session", async () => {
    const { browser, driver } = await launch({
      handlers: { 'Target.attachToTarget': (command: ReceivedCommand, fake: FakeBrowser) => fake.reply(command, {}) },
    })

    await expect(driver.newPage(pageSetup)).rejects.toThrow(
      "The browser's answer to Target.attachToTarget has no sessionId.",
    )
    expect(sentOf(browser, 'Target.disposeBrowserContext')).toHaveLength(1)
  })

  it.each([['Target.createTarget'], ['Page.enable']])(
    "fails after 30 s and disposes the context when %s isn't answered",
    async (silentMethod) => {
      const { browser, driver } = await launch({ handlers: { [silentMethod]: () => undefined } })

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      const opening = driver.newPage(pageSetup)
      const failure = expect(opening).rejects.toThrow("The browser didn't open a page within 30 s.")

      await flushUntil(() => browser.timesReceived(silentMethod) === 1)
      await vi.advanceTimersByTimeAsync(29_999)
      expect(sentOf(browser, 'Target.disposeBrowserContext')).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      await failure
      expect(sentOf(browser, 'Target.disposeBrowserContext')).toEqual([
        { method: 'Target.disposeBrowserContext', params: { browserContextId: 'context-1' }, sessionId: undefined },
      ])
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('fails with a PageCrashedError and disposes the context when the page crashes during its setup', async () => {
    const { browser, driver } = await launch({
      handlers: {
        'Page.enable': (_command: ReceivedCommand, fake: FakeBrowser) =>
          fake.emit('Inspector.targetCrashed', {}, sessionId),
      },
    })

    await expect(driver.newPage(pageSetup)).rejects.toMatchObject({ name: 'PageCrashedError' })
    expect(sentOf(browser, 'Target.disposeBrowserContext')).toHaveLength(1)
  })

  it('fails with a BrowserExitedError when the browser exits during the setup', async () => {
    const { driver } = await launch({
      handlers: { 'Page.enable': (_command: ReceivedCommand, fake: FakeBrowser) => fake.exit({ code: 1 }) },
    })

    await expect(driver.newPage(pageSetup)).rejects.toMatchObject({ name: 'BrowserExitedError' })
  })

  it('fails after 30 s while the context is being created, and disposes the context the browser creates late', async () => {
    const pending: ReceivedCommand[] = []
    const { browser, driver } = await launch({
      handlers: { 'Target.createBrowserContext': (command: ReceivedCommand) => pending.push(command) },
    })

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const opening = driver.newPage(pageSetup)
    const failure = expect(opening).rejects.toThrow("The browser didn't open a page within 30 s.")

    await flushUntil(() => pending.length === 1)
    await vi.advanceTimersByTimeAsync(30_000)
    await failure
    expect(sentOf(browser, 'Target.disposeBrowserContext')).toEqual([])
    browser.reply(pending[0] as ReceivedCommand, { browserContextId: 'context-late' })
    await flushUntil(() => browser.timesReceived('Target.disposeBrowserContext') === 1)
    expect(sentOf(browser, 'Target.disposeBrowserContext')).toEqual([
      { method: 'Target.disposeBrowserContext', params: { browserContextId: 'context-late' }, sessionId: undefined },
    ])
    expect(sentOf(browser, 'Target.createTarget')).toEqual([])
  })
})

describe('Page', () => {
  it('turns on no Network, lifecycle events or request interception through a whole capture', async () => {
    const { browser, page } = await openPage()

    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1, touch: false })
    await page.goto(storyUrl, 1000)
    await page.evaluate('document.title', 1000)
    await page.capture('full-page')
    await page.clearStorage()
    await page.close()
    expect(new Set(browser.received.map((command) => command.method))).toEqual(
      new Set([
        'Browser.getVersion',
        'Target.setDiscoverTargets',
        'Browser.setDownloadBehavior',
        'Browser.grantPermissions',
        'Target.createBrowserContext',
        'Target.createTarget',
        'Target.attachToTarget',
        'Page.enable',
        'Inspector.enable',
        'Emulation.setUserAgentOverride',
        'Emulation.setTimezoneOverride',
        'Emulation.setLocaleOverride',
        'Emulation.setEmulatedMedia',
        'Emulation.setFocusEmulationEnabled',
        'Runtime.enable',
        'Runtime.addBinding',
        'Page.addScriptToEvaluateOnNewDocument',
        'Log.enable',
        'Emulation.setDeviceMetricsOverride',
        'Emulation.setTouchEmulationEnabled',
        'Page.navigate',
        'Runtime.evaluate',
        'Page.getLayoutMetrics',
        'Page.captureScreenshot',
        'Storage.clearCookies',
        'Storage.clearDataForOrigin',
        'DOMStorage.clear',
        'Target.disposeBrowserContext',
      ]),
    )
  })

  it('leaves no timer running once each call has settled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const { page } = await openPage({
      handlers: {
        'Runtime.evaluate': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.reply(command, { result: { type: 'object' }, exceptionDetails: { text: 'Uncaught' } }),
      },
    })

    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1, touch: false })
    await page.goto(storyUrl, 1000)
    await expect(page.evaluate('fail()', 1000)).rejects.toThrow()
    await page.capture('full-page')
    await page.clearStorage()
    await page.close()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Page.setViewport', () => {
  it('overrides the device metrics with the viewport as the screen, not mobile, and turns touch off', async () => {
    const { browser, page } = await openPage()

    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2, touch: false })
    expect(sentOf(browser, 'Emulation.setDeviceMetricsOverride')).toEqual([
      {
        method: 'Emulation.setDeviceMetricsOverride',
        params: { width: 1280, height: 720, deviceScaleFactor: 2, mobile: false, screenWidth: 1280, screenHeight: 720 },
        sessionId,
      },
    ])
    expect(sentOf(browser, 'Emulation.setTouchEmulationEnabled')).toEqual([
      { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: false }, sessionId },
    ])
  })

  it('emulates a mobile device with touch for a touch viewport', async () => {
    const { browser, page } = await openPage()

    await page.setViewport(touchViewport)
    expect(sentOf(browser, 'Emulation.setDeviceMetricsOverride')).toEqual([
      {
        method: 'Emulation.setDeviceMetricsOverride',
        params: { width: 375, height: 667, deviceScaleFactor: 2, mobile: true, screenWidth: 375, screenHeight: 667 },
        sessionId,
      },
    ])
    expect(sentOf(browser, 'Emulation.setTouchEmulationEnabled')).toEqual([
      { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: true, maxTouchPoints: 5 }, sessionId },
    ])
  })

  it('sends the device metrics and the touch emulation in parallel', async () => {
    const { browser, page } = await openPage({
      handlers: { 'Emulation.setDeviceMetricsOverride': () => undefined },
    })
    const setting = page.setViewport(touchViewport)

    await flushUntil(() => browser.timesReceived('Emulation.setTouchEmulationEnabled') === 1)
    expect(await hasSettled(setting)).toBe(false)
  })
})

describe('the 30 s limit on a page call', () => {
  it.each([
    [
      'setViewport',
      'Emulation.setDeviceMetricsOverride',
      (page: Page) => page.setViewport({ width: 1, height: 1, deviceScaleFactor: 1, touch: false }),
      "The page didn't set its viewport within 30 s.",
    ],
    [
      'setViewport',
      'Emulation.setTouchEmulationEnabled',
      (page: Page) => page.setViewport(touchViewport),
      "The page didn't set its viewport within 30 s.",
    ],
    [
      'growViewportToContent',
      'Page.getLayoutMetrics',
      async (page: Page) => {
        await page.setViewport(touchViewport)

        return page.growViewportToContent()
      },
      "The page didn't grow its viewport within 30 s.",
    ],
    [
      'capture',
      'Page.captureScreenshot',
      (page: Page) => page.capture('full-page'),
      "The page wasn't captured within 30 s.",
    ],
    [
      'clearStorage',
      'Storage.clearCookies',
      (page: Page) => page.clearStorage(),
      "The page didn't clear its storage within 30 s.",
    ],
  ])(
    'fails %s with a PageTimeoutError when the browser stays silent on %s for 30 s',
    async (_call, silentMethod, call, message) => {
      const { browser, page } = await openPage({ handlers: { [silentMethod]: () => undefined } })

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      const calling = call(page)
      const failure = expect(calling).rejects.toEqual(new PageTimeoutError(message, 30_000))

      await flushUntil(() => browser.timesReceived(silentMethod) === 1)
      await vi.advanceTimersByTimeAsync(29_999)
      expect(await hasSettled(calling)).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await failure
    },
  )
})

describe('Page.goto', () => {
  it('navigates the main frame and resolves on the load event once its document has committed', async () => {
    const { browser, page } = await openPage({ handlers: { 'Page.navigate': () => undefined } })
    const loading = page.goto(storyUrl, 1000)

    await flush()
    expect(sentOf(browser, 'Page.navigate')).toEqual([
      { method: 'Page.navigate', params: { url: storyUrl }, sessionId },
    ])

    const [navigate] = browser.received.filter((command) => command.method === 'Page.navigate')

    browser.emit('Page.frameNavigated', { frame: mainFrame(targetId, storyUrl, 'loader-1') }, sessionId)
    expect(await hasSettled(loading)).toBe(false)
    browser.reply(navigate as ReceivedCommand, { frameId: targetId, loaderId: 'loader-1' })
    expect(await hasSettled(loading)).toBe(false)
    browser.emit('Page.loadEventFired', { timestamp: 1 }, sessionId)
    await expect(loading).resolves.toBeUndefined()
  })

  it("fails with the browser's error when the navigation fails, though an error page commits", async () => {
    const { page } = await openPage({
      handlers: {
        'Page.navigate': (command: ReceivedCommand, fake: FakeBrowser) => {
          fake.emit(
            'Page.frameNavigated',
            {
              frame: { ...mainFrame(targetId, 'chrome-error://chromewebdata/', 'loader-1'), unreachableUrl: storyUrl },
            },
            sessionId,
          )
          fake.reply(command, { frameId: targetId, loaderId: 'loader-1', errorText: 'net::ERR_CONNECTION_REFUSED' })
          fake.emit('Page.loadEventFired', { timestamp: 1 }, sessionId)
        },
      },
    })

    const loading = page.goto(storyUrl, 1000)

    await expect(loading).rejects.toBeInstanceOf(PageLoadError)
    await expect(loading).rejects.toMatchObject({
      message: `The page couldn't load ${storyUrl}: net::ERR_CONNECTION_REFUSED`,
      reason: 'net::ERR_CONNECTION_REFUSED',
    })
  })

  it('fails at once, naming the URL, when the page starts a navigation of its main frame and Page.navigate never replies', async () => {
    const { page } = await openPage({
      handlers: {
        'Page.navigate': (_command: ReceivedCommand, fake: FakeBrowser) =>
          fake.emit(
            'Page.frameRequestedNavigation',
            {
              frameId: targetId,
              reason: 'anchorClick',
              url: 'http://storybook:6006/categories/burgers',
              disposition: 'currentTab',
            },
            sessionId,
          ),
      },
    })

    await expect(page.goto(storyUrl, 60_000)).rejects.toMatchObject({
      name: 'PageNavigatedAwayError',
      url: 'http://storybook:6006/categories/burgers',
      message: `The page navigated to http://storybook:6006/categories/burgers before ${storyUrl} loaded.`,
    })
  })

  it.each([
    ['before', ['late commit', 'reply']],
    ['after', ['reply', 'late commit']],
  ])("ignores an earlier navigation's error page that commits late, %s the next goto's reply", async (_when, order) => {
    const failedUrl = 'http://127.0.0.1:1/x'
    const { page } = await openPage({
      handlers: {
        'Page.navigate': (command: ReceivedCommand, fake: FakeBrowser) => {
          if (fake.timesReceived(command.method) === 1) {
            fake.reply(command, { frameId: targetId, loaderId: 'loader-1', errorText: 'net::ERR_UNSAFE_PORT' })

            return
          }

          for (const step of order) {
            if (step === 'reply') {
              fake.reply(command, { frameId: targetId, loaderId: 'loader-2' })
            } else {
              fake.emit(
                'Page.frameNavigated',
                {
                  frame: {
                    ...mainFrame(targetId, 'chrome-error://chromewebdata/', 'loader-1'),
                    unreachableUrl: failedUrl,
                  },
                },
                sessionId,
              )
            }
          }

          fake.emit('Page.frameNavigated', { frame: mainFrame(targetId, storyUrl, 'loader-2') }, sessionId)
          fake.emit('Page.loadEventFired', { timestamp: 1 }, sessionId)
        },
      },
    })

    await expect(page.goto(failedUrl, 1000)).rejects.toThrow(
      `The page couldn't load ${failedUrl}: net::ERR_UNSAFE_PORT`,
    )
    await expect(page.goto(storyUrl, 1000)).resolves.toBeUndefined()
  })

  it("forgets the earlier navigations' loaders once a goto's document commits", async () => {
    const failedUrl = 'http://127.0.0.1:1/x'
    const lateErrorPage = {
      frame: { ...mainFrame(targetId, 'chrome-error://chromewebdata/', 'loader-1'), unreachableUrl: failedUrl },
    }
    const { page } = await openPage({
      handlers: {
        'Page.navigate': (command: ReceivedCommand, fake: FakeBrowser) => {
          const loaderId = `loader-${fake.timesReceived(command.method)}`

          if (loaderId === 'loader-1') {
            fake.reply(command, { frameId: targetId, loaderId, errorText: 'net::ERR_UNSAFE_PORT' })

            return
          }

          if (loaderId === 'loader-3') {
            fake.emit('Page.frameNavigated', lateErrorPage, sessionId)
          }

          fake.reply(command, { frameId: targetId, loaderId })
          fake.emit(
            'Page.frameNavigated',
            { frame: mainFrame(targetId, String(command.params.url), loaderId) },
            sessionId,
          )
          fake.emit('Page.loadEventFired', { timestamp: 1 }, sessionId)
        },
      },
    })

    await expect(page.goto(failedUrl, 1000)).rejects.toThrow('net::ERR_UNSAFE_PORT')
    await expect(page.goto(storyUrl, 1000)).resolves.toBeUndefined()
    await expect(page.goto(storyUrl, 1000)).rejects.toMatchObject({ name: 'PageNavigatedAwayError', url: failedUrl })
  })

  it("ignores another session's navigations and load", async () => {
    const { browser, page } = await openPage({
      handlers: {
        'Page.navigate': (command: ReceivedCommand, fake: FakeBrowser) => {
          fake.emit(
            'Page.frameRequestedNavigation',
            { frameId: targetId, reason: 'scriptInitiated', url: 'http://elsewhere/', disposition: 'currentTab' },
            'session-other',
          )
          fake.emit('Page.frameNavigated', { frame: mainFrame(targetId, storyUrl, 'loader-1') }, sessionId)
          fake.reply(command, { frameId: targetId, loaderId: 'loader-1' })
          fake.emit(
            'Page.frameNavigated',
            { frame: mainFrame(targetId, 'http://elsewhere/', 'other') },
            'session-other',
          )
          fake.emit('Page.loadEventFired', { timestamp: 1 }, 'session-other')
        },
      },
    })
    const loading = page.goto(storyUrl, 1000)

    expect(await hasSettled(loading)).toBe(false)
    browser.emit('Page.loadEventFired', { timestamp: 2 }, sessionId)
    await expect(loading).resolves.toBeUndefined()
  })

  it("fails with a PageTimeoutError, naming the URL and the time, when the page doesn't load in time", async () => {
    const { page } = await openPage({ handlers: { 'Page.navigate': () => undefined } })
    const failure = await page.goto(storyUrl, 50).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(PageTimeoutError)
    expect(failure).toMatchObject({ message: `The page didn't load ${storyUrl} within 0.05 s.`, timeoutMs: 50 })
  })
})

describe('Page.evaluate', () => {
  it('evaluates in the main frame with a user gesture, awaiting a promise and returning the value as JSON', async () => {
    const { browser, page } = await openPage()

    await page.evaluate('window.ready', 1000)
    expect(sentOf(browser, 'Runtime.evaluate')).toEqual([
      {
        method: 'Runtime.evaluate',
        params: { expression: 'window.ready', returnByValue: true, awaitPromise: true, userGesture: true },
        sessionId,
      },
    ])
  })

  it('resolves with the value', async () => {
    const { page } = await openPage({
      handlers: {
        'Runtime.evaluate': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.reply(command, { result: { type: 'object', value: { ready: true, stories: 3 } } }),
      },
    })

    await expect(page.evaluate('state()', 1000)).resolves.toEqual({ ready: true, stories: 3 })
  })

  it('resolves with undefined when the expression gives undefined', async () => {
    const { page } = await openPage()

    await expect(page.evaluate('undefined', 1000)).resolves.toBeUndefined()
  })

  it("fails with the exception's description when the expression throws", async () => {
    const { page } = await openPage({
      handlers: {
        'Runtime.evaluate': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.reply(command, {
            result: { type: 'object', subtype: 'error' },
            exceptionDetails: {
              text: 'Uncaught',
              exception: { type: 'object', subtype: 'error', description: 'Error: boom\n    at <anonymous>:1:7' },
            },
          }),
      },
    })

    await expect(page.evaluate('boom()', 1000)).rejects.toThrow(
      'The expression evaluated in the page threw: Error: boom\n    at <anonymous>:1:7',
    )
  })

  it.each([
    [{ type: 'string', value: 'nope' }, '"nope"'],
    [{ type: 'number', value: 42, description: '42' }, '42'],
    [{ type: 'object', subtype: 'null', value: null }, 'null'],
  ])('fails with the value when the expression throws a primitive (%o)', async (exception, shown) => {
    const { page } = await openPage({
      handlers: {
        'Runtime.evaluate': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.reply(command, { result: exception, exceptionDetails: { text: 'Uncaught', exception } }),
      },
    })

    await expect(page.evaluate('fail()', 1000)).rejects.toThrow(`The expression evaluated in the page threw: ${shown}`)
  })

  it("fails with the exception's text when the exception has neither a value nor a description", async () => {
    const { page } = await openPage({
      handlers: {
        'Runtime.evaluate': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.reply(command, {
            result: { type: 'undefined' },
            exceptionDetails: { text: 'Uncaught (in promise)', exception: { type: 'undefined' } },
          }),
      },
    })

    await expect(page.evaluate('Promise.reject()', 1000)).rejects.toThrow(
      'The expression evaluated in the page threw: Uncaught (in promise)',
    )
  })

  it.each([
    ['NaN', 'number'],
    ['-0', 'number'],
    ['12345678901234567890n', 'bigint'],
  ])("fails when the value is %s, which JSON can't carry", async (unserializableValue, type) => {
    const { page } = await openPage({
      handlers: {
        'Runtime.evaluate': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.reply(command, { result: { type, unserializableValue, description: unserializableValue } }),
      },
    })

    await expect(page.evaluate('value()', 1000)).rejects.toThrow(
      `The expression evaluated in the page gave ${unserializableValue}, which JSON can't carry.`,
    )
  })

  it("fails with a PageTimeoutError, naming the time, when the expression doesn't finish in time", async () => {
    const { page } = await openPage({ handlers: { 'Runtime.evaluate': () => undefined } })
    const failure = await page.evaluate('new Promise(() => {})', 50).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(PageTimeoutError)
    expect(failure).toMatchObject({
      message: "The expression evaluated in the page didn't finish within 0.05 s.",
      timeoutMs: 50,
    })
  })
})

/**
 * Answers `Page.getLayoutMetrics` with a layout viewport this wide and 720 px tall, the same visual viewport scrolled
 * down by `scrollY`, and content this tall, in CSS pixels. The content is 500 px wider than the viewport unless told
 * otherwise, which a full-page capture leaves out.
 */
function layoutOf(
  clientWidth: number,
  contentHeight: number,
  contentWidth = clientWidth + 500,
  scrollY = 0,
): CommandHandler {
  return (command: ReceivedCommand, fake: FakeBrowser) =>
    fake.reply(command, {
      cssLayoutViewport: { pageX: 0, pageY: scrollY, clientWidth, clientHeight: 720 },
      cssVisualViewport: {
        offsetX: 0,
        offsetY: 0,
        pageX: 0,
        pageY: scrollY,
        clientWidth,
        clientHeight: 720,
        scale: 1,
        zoom: 1,
      },
      cssContentSize: { x: 0, y: 0, width: contentWidth, height: contentHeight },
    })
}

/**
 * The capture command the first page sends for this clip, at scale 1, beyond the viewport unless told otherwise.
 */
function captureCommand(
  clip: { x: number; y: number; width: number; height: number },
  captureBeyondViewport = true,
): SentCommand {
  return {
    method: 'Page.captureScreenshot',
    params: { format: 'png', captureBeyondViewport, clip: { ...clip, scale: 1 } },
    sessionId,
  }
}

describe('Page.capture', () => {
  it('keeps no hold on the bytes it returned while the page stays open', async () => {
    const data = Buffer.alloc(1024 * 1024, 7).toString('base64')
    const { page } = await openPage({
      handlers: {
        'Page.captureScreenshot': (command: ReceivedCommand, fake: FakeBrowser) => fake.reply(command, { data }),
      },
    })
    const bytes = new WeakRef(await page.capture('full-page'))

    await flush()
    collectGarbage()
    expect(bytes.deref()).toBeUndefined()
  })

  it("captures the full page as PNG at the layout viewport's width and the content's height, rounded up", async () => {
    const { browser, page } = await openPage({ handlers: { 'Page.getLayoutMetrics': layoutOf(1280.2, 2400.5) } })

    await page.capture('full-page')
    expect(sentOf(browser, 'Page.captureScreenshot')).toEqual([
      captureCommand({ x: 0, y: 0, width: 1281, height: 2401 }),
    ])
  })

  it('captures a box below the viewport as given, beyond the viewport', async () => {
    const { browser, page } = await openPage()

    await page.capture({ x: 16, y: 2000, width: 320, height: 48 })
    expect(sentOf(browser, 'Page.captureScreenshot')).toEqual([
      captureCommand({ x: 16, y: 2000, width: 320, height: 48 }),
    ])
  })

  it.each([
    ['inside the viewport', { x: 16, y: 100, width: 320, height: 48 }],
    ['the size of the viewport', { x: 0, y: 0, width: 375, height: 720 }],
  ])('captures a box %s without going beyond it, so the page is not resized', async (_case, box) => {
    const { browser, page } = await openPage({ handlers: { 'Page.getLayoutMetrics': layoutOf(375, 3000) } })

    await page.capture(box)
    expect(sentOf(browser, 'Page.captureScreenshot')).toEqual([captureCommand(box, false)])
  })

  it.each([
    ['inside the scrolled viewport', { x: 0, y: 1000, width: 320, height: 48 }, false],
    ['above the scrolled viewport', { x: 0, y: 100, width: 320, height: 48 }, true],
    ['across its bottom edge', { x: 0, y: 1600, width: 320, height: 48 }, true],
    ['across its right edge', { x: 100, y: 1000, width: 320, height: 48 }, true],
  ])('captures a box %s beyond the viewport only when it reaches past it', async (_case, box, beyondViewport) => {
    const { browser, page } = await openPage({
      handlers: { 'Page.getLayoutMetrics': layoutOf(375, 3000, 375, 900) },
    })

    await page.capture(box)
    expect(sentOf(browser, 'Page.captureScreenshot')).toEqual([captureCommand(box, beyondViewport)])
  })

  it('captures a full page that fits the viewport, as a grown one does, without going beyond it', async () => {
    const { browser, page } = await openPage({ handlers: { 'Page.getLayoutMetrics': layoutOf(375, 720) } })

    await page.capture('full-page')
    expect(sentOf(browser, 'Page.captureScreenshot')).toEqual([
      captureCommand({ x: 0, y: 0, width: 375, height: 720 }, false),
    ])
  })

  it("fails, sending no capture, when the browser's layout answer has no visual viewport", async () => {
    const { browser, page } = await openPage({
      handlers: {
        'Page.getLayoutMetrics': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.reply(command, {
            cssLayoutViewport: { pageX: 0, pageY: 0, clientWidth: 1280, clientHeight: 720 },
            cssContentSize: { x: 0, y: 0, width: 1280, height: 720 },
          }),
      },
    })

    await expect(page.capture({ x: 0, y: 0, width: 10, height: 10 })).rejects.toThrow(
      "The browser's answer to Page.getLayoutMetrics has no cssVisualViewport.",
    )
    expect(sentOf(browser, 'Page.captureScreenshot')).toEqual([])
  })

  it('resolves with the exact bytes the browser sent', async () => {
    const { page } = await openPage()
    const bytes = await page.capture('full-page')

    expect([...bytes]).toEqual([...Buffer.from(defaultCaptureData, 'base64')])
  })

  it('turns touch emulation back on behind the screenshot and after it when the content is taller than a touch viewport', async () => {
    const { browser, page } = await openPage({ handlers: { 'Page.getLayoutMetrics': layoutOf(375, 3000) } })

    await page.setViewport(touchViewport)

    const sentBefore = browser.received.length

    await page.capture('full-page')
    expect(sent(browser).slice(sentBefore)).toEqual([
      { method: 'Page.getLayoutMetrics', params: {}, sessionId },
      expect.objectContaining({ method: 'Page.captureScreenshot' }),
      { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: true, maxTouchPoints: 5 }, sessionId },
      { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: true, maxTouchPoints: 5 }, sessionId },
    ])
  })

  it.each([
    ['wider than', { width: 375.5, height: 667 }],
    ['the size of', { width: 375, height: 720 }],
  ])(
    'sends nothing after the screenshot when the content is %s a touch viewport, since the capture stays in it',
    async (_shape, content) => {
      const { browser, page } = await openPage({
        handlers: { 'Page.getLayoutMetrics': layoutOf(375, content.height, content.width) },
      })

      await page.setViewport(touchViewport)

      const sentBefore = browser.received.length

      await page.capture('full-page')
      expect(sent(browser).slice(sentBefore)).toEqual([
        { method: 'Page.getLayoutMetrics', params: {}, sessionId },
        captureCommand({ x: 0, y: 0, width: 375, height: content.height }, false),
      ])
    },
  )

  it('turns touch emulation back on right behind the screenshot command, and again once it is answered', async () => {
    const screenshots: ReceivedCommand[] = []
    const { browser, page } = await openPage({
      handlers: {
        'Page.getLayoutMetrics': layoutOf(375, 3000),
        'Page.captureScreenshot': (command: ReceivedCommand) => {
          screenshots.push(command)
        },
      },
    })

    await page.setViewport(touchViewport)

    const sentBefore = browser.received.length
    const capturing = page.capture('full-page')

    await flushUntil(() => browser.timesReceived('Emulation.setTouchEmulationEnabled') === 2)
    await flush()
    expect(await hasSettled(capturing)).toBe(false)
    expect(
      sent(browser)
        .slice(sentBefore)
        .map((command) => command.method),
    ).toEqual(['Page.getLayoutMetrics', 'Page.captureScreenshot', 'Emulation.setTouchEmulationEnabled'])

    browser.reply(screenshots[0] as ReceivedCommand, { data: defaultCaptureData })
    await capturing
    expect(browser.timesReceived('Emulation.setTouchEmulationEnabled')).toBe(3)
  })

  it('turns touch emulation on again only once the one sent behind the screenshot is answered too', async () => {
    const held: ReceivedCommand[] = []
    const { browser, page } = await openPage({
      handlers: {
        'Page.getLayoutMetrics': layoutOf(375, 3000),
        'Emulation.setTouchEmulationEnabled': (command: ReceivedCommand, fake: FakeBrowser) => {
          if (fake.timesReceived('Emulation.setTouchEmulationEnabled') === 2) {
            held.push(command)
          } else {
            fake.reply(command, {})
          }
        },
      },
    })

    await page.setViewport(touchViewport)

    const capturing = page.capture('full-page')

    await flushUntil(() => held.length === 1 && browser.timesReceived('Page.captureScreenshot') === 1)
    await flush()
    expect(browser.timesReceived('Emulation.setTouchEmulationEnabled')).toBe(2)
    expect(await hasSettled(capturing)).toBe(false)

    browser.reply(held[0] as ReceivedCommand, {})
    await capturing
    expect(browser.timesReceived('Emulation.setTouchEmulationEnabled')).toBe(3)
  })

  it("turns touch emulation back on around a box's capture too", async () => {
    const { browser, page } = await openPage()

    await page.setViewport(touchViewport)

    const sentBefore = browser.received.length

    await page.capture({ x: 0, y: 2000, width: 320, height: 48 })
    expect(sent(browser).slice(sentBefore)).toEqual([
      { method: 'Page.getLayoutMetrics', params: {}, sessionId },
      captureCommand({ x: 0, y: 2000, width: 320, height: 48 }),
      { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: true, maxTouchPoints: 5 }, sessionId },
      { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: true, maxTouchPoints: 5 }, sessionId },
    ])
  })

  it("checks the size at a touch viewport's scale before sending anything for the capture", async () => {
    const { browser, page } = await openPage({ handlers: { 'Page.getLayoutMetrics': layoutOf(375, 16_384) } })

    await page.setViewport(touchViewport)

    const sentBefore = browser.received.length

    await expect(page.capture('full-page')).rejects.toMatchObject({
      name: 'CaptureTooLargeError',
      deviceWidth: 750,
      deviceHeight: 32_768,
    })
    expect(sent(browser).slice(sentBefore)).toEqual([{ method: 'Page.getLayoutMetrics', params: {}, sessionId }])
  })

  it('sends nothing after the screenshot for a viewport without touch', async () => {
    const { browser, page } = await openPage({
      handlers: { 'Page.getLayoutMetrics': layoutOf(375, 3000) },
    })

    await page.setViewport({ width: 375, height: 667, deviceScaleFactor: 2, touch: false })

    const sentBefore = browser.received.length

    await page.capture('full-page')

    const methods = sent(browser)
      .slice(sentBefore)
      .map((command) => command.method)

    expect(methods).toEqual(['Page.getLayoutMetrics', 'Page.captureScreenshot'])
  })

  it('sends nothing after the screenshot once a viewport without touch replaced a touch one', async () => {
    const { browser, page } = await openPage({
      handlers: { 'Page.getLayoutMetrics': layoutOf(375, 3000) },
    })

    await page.setViewport(touchViewport)
    await page.setViewport({ ...touchViewport, touch: false })

    const sentBefore = browser.received.length

    await page.capture('full-page')

    const methods = sent(browser)
      .slice(sentBefore)
      .map((command) => command.method)

    expect(methods).toEqual(['Page.getLayoutMetrics', 'Page.captureScreenshot'])
  })

  it('sends nothing after the screenshot before any viewport is set', async () => {
    const { browser, page } = await openPage()

    await page.capture('full-page')
    expect(sentOf(browser, 'Emulation.setTouchEmulationEnabled')).toEqual([])
  })

  it.each([
    ['behind the screenshot', 2],
    ['after the screenshot', 3],
  ])('fails when the browser fails to turn touch emulation back on %s', async (_when, failingTime) => {
    const { page } = await openPage({
      handlers: {
        'Page.getLayoutMetrics': layoutOf(375, 3000),
        'Emulation.setTouchEmulationEnabled': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.timesReceived('Emulation.setTouchEmulationEnabled') === failingTime
            ? fake.fail(command, -32602, 'Touch points must be between 1 and 16')
            : fake.reply(command, {}),
      },
    })

    await page.setViewport(touchViewport)
    await expect(page.capture('full-page')).rejects.toThrow('Touch points must be between 1 and 16')
  })

  it.each([
    ['behind the screenshot', 2],
    ['after the screenshot', 3],
  ])(
    'fails with a PageTimeoutError when the browser stays silent on turning touch emulation back on %s',
    async (_when, silentTime) => {
      const { browser, page } = await openPage({
        handlers: {
          'Page.getLayoutMetrics': layoutOf(375, 3000),
          'Emulation.setTouchEmulationEnabled': (command: ReceivedCommand, fake: FakeBrowser) => {
            if (fake.timesReceived('Emulation.setTouchEmulationEnabled') !== silentTime) {
              fake.reply(command, {})
            }
          },
        },
      })

      await page.setViewport(touchViewport)
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      const capturing = page.capture('full-page')
      const failure = expect(capturing).rejects.toEqual(
        new PageTimeoutError("The page wasn't captured within 30 s.", 30_000),
      )

      await flushUntil(() => browser.timesReceived('Emulation.setTouchEmulationEnabled') === silentTime)
      await vi.advanceTimersByTimeAsync(30_000)
      await failure
    },
  )

  it("fails when the browser's layout answer has no content size", async () => {
    const { page } = await openPage({
      handlers: {
        'Page.getLayoutMetrics': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.reply(command, { cssLayoutViewport: { pageX: 0, pageY: 0, clientWidth: 1280, clientHeight: 720 } }),
      },
    })

    await expect(page.capture('full-page')).rejects.toThrow(
      "The browser's answer to Page.getLayoutMetrics has no cssContentSize.",
    )
  })

  it("fails when the browser's layout answer has no layout viewport", async () => {
    const { page } = await openPage({
      handlers: {
        'Page.getLayoutMetrics': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.reply(command, { cssContentSize: { x: 0, y: 0, width: 1280, height: 720 } }),
      },
    })

    await expect(page.capture('full-page')).rejects.toThrow(
      "The browser's answer to Page.getLayoutMetrics has no cssLayoutViewport.",
    )
  })

  it.each([
    [
      'clientWidth',
      '{"pageX":0,"pageY":0,"clientWidth":1e999,"clientHeight":720}',
      '{"width":1280,"height":720}',
      'cssLayoutViewport',
    ],
    [
      'height',
      '{"pageX":0,"pageY":0,"clientWidth":1280,"clientHeight":720}',
      '{"width":1280,"height":-1e999}',
      'cssContentSize',
    ],
  ])(
    'fails, sending no capture, when the layout answer gives an infinite %s',
    async (_field, viewport, content, named) => {
      const { browser, page } = await openPage({
        handlers: {
          'Page.getLayoutMetrics': (command: ReceivedCommand, fake: FakeBrowser) =>
            fake.replyWithJson(command, `{"cssLayoutViewport":${viewport},"cssContentSize":${content}}`),
        },
      })

      await expect(page.capture('full-page')).rejects.toThrow(
        `The browser's answer to Page.getLayoutMetrics has no ${named}.`,
      )
      expect(sentOf(browser, 'Page.captureScreenshot')).toEqual([])
    },
  )

  it('fails with a CaptureTooLargeError, sending no capture, when the full page is over 32,767 device pixels tall', async () => {
    const { browser, page } = await openPage({ handlers: { 'Page.getLayoutMetrics': layoutOf(1280, 16_384) } })

    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2, touch: false })

    const failure = await page.capture('full-page').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CaptureTooLargeError)
    expect(failure).toMatchObject({
      message: 'The capture would be 2560 × 32768 device pixels, over the 32,767 the browser can capture on a side.',
      deviceWidth: 2560,
      deviceHeight: 32_768,
    })
    expect(sentOf(browser, 'Page.captureScreenshot')).toEqual([])
  })

  it("captures a full page up to 32,767 device pixels tall at the viewport's scale", async () => {
    const { browser, page } = await openPage({ handlers: { 'Page.getLayoutMetrics': layoutOf(1280, 16_383) } })

    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2, touch: false })
    await page.capture('full-page')
    expect(sentOf(browser, 'Page.captureScreenshot')).toEqual([
      captureCommand({ x: 0, y: 0, width: 1280, height: 16_383 }),
    ])
  })

  it('counts device pixels at a scale of 1 before any viewport is set', async () => {
    const { browser, page } = await openPage()

    await expect(page.capture({ x: 0, y: 0, width: 32_768, height: 100 })).rejects.toMatchObject({
      name: 'CaptureTooLargeError',
      deviceWidth: 32_768,
      deviceHeight: 100,
    })
    await page.capture({ x: 0, y: 0, width: 32_767, height: 100 })
    expect(sentOf(browser, 'Page.captureScreenshot')).toEqual([
      captureCommand({ x: 0, y: 0, width: 32_767, height: 100 }),
    ])
  })

  it('rounds the device pixels up at a fractional scale', async () => {
    const { page } = await openPage()

    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5, touch: false })
    await expect(page.capture({ x: 0, y: 0, width: 21_845, height: 1 })).rejects.toMatchObject({
      deviceWidth: 32_768,
      deviceHeight: 2,
    })
  })
})

describe('Page.growViewportToContent', () => {
  it("grows a touch viewport's height to the content's, rounded up, keeping its screen, scale and touch", async () => {
    const { browser, page } = await openPage({ handlers: { 'Page.getLayoutMetrics': layoutOf(375, 3000.4) } })

    await page.setViewport(touchViewport)

    const sentBefore = browser.received.length

    expect(await page.growViewportToContent()).toBe(true)
    expect(sent(browser).slice(sentBefore)).toEqual([
      { method: 'Page.getLayoutMetrics', params: {}, sessionId },
      {
        method: 'Emulation.setDeviceMetricsOverride',
        params: { width: 375, height: 3001, deviceScaleFactor: 2, mobile: true, screenWidth: 375, screenHeight: 667 },
        sessionId,
      },
    ])
  })

  it('leaves touch emulation alone when it grows a viewport without touch, so the page keeps its hover', async () => {
    const { browser, page } = await openPage({ handlers: { 'Page.getLayoutMetrics': layoutOf(1280, 3000) } })

    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1, touch: false })

    const sentBefore = browser.received.length

    expect(await page.growViewportToContent()).toBe(true)
    expect(
      sent(browser)
        .slice(sentBefore)
        .map((command) => command.method),
    ).toEqual(['Page.getLayoutMetrics', 'Emulation.setDeviceMetricsOverride'])
  })

  it('keeps the viewport setViewport set for later captures, so their size is counted at its scale', async () => {
    const { page } = await openPage({ handlers: { 'Page.getLayoutMetrics': layoutOf(375, 3000) } })

    await page.setViewport(touchViewport)
    await page.growViewportToContent()
    await expect(page.capture({ x: 0, y: 0, width: 16_384, height: 1 })).rejects.toMatchObject({
      deviceWidth: 32_768,
    })
  })

  it.each([
    ['as tall as the viewport', 667],
    ['shorter than the viewport', 400],
  ])('does nothing and resolves false when the content is %s', async (_case, contentHeight) => {
    const { browser, page } = await openPage({ handlers: { 'Page.getLayoutMetrics': layoutOf(375, contentHeight) } })

    await page.setViewport(touchViewport)
    expect(await page.growViewportToContent()).toBe(false)
    expect(sentOf(browser, 'Emulation.setDeviceMetricsOverride')).toHaveLength(1)
  })

  it('does nothing and resolves false when the content is over 32,767 device pixels tall', async () => {
    const { browser, page } = await openPage({ handlers: { 'Page.getLayoutMetrics': layoutOf(375, 16_384) } })

    await page.setViewport(touchViewport)
    expect(await page.growViewportToContent()).toBe(false)
    expect(sentOf(browser, 'Emulation.setDeviceMetricsOverride')).toHaveLength(1)
  })

  it('grows to a content up to 32,767 device pixels tall', async () => {
    const { browser, page } = await openPage({ handlers: { 'Page.getLayoutMetrics': layoutOf(375, 16_383) } })

    await page.setViewport(touchViewport)
    expect(await page.growViewportToContent()).toBe(true)
    expect(sentOf(browser, 'Emulation.setDeviceMetricsOverride').at(-1)?.params).toMatchObject({ height: 16_383 })
  })

  it('sends nothing and resolves false before any viewport is set', async () => {
    const { browser, page } = await openPage()
    const sentBefore = sent(browser).length

    expect(await page.growViewportToContent()).toBe(false)
    expect(sent(browser).slice(sentBefore)).toEqual([])
  })
})

describe('Page.clearStorage', () => {
  it("clears the context's cookies at the browser level, and the main frame's origin in the session", async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    await page.clearStorage()
    expect(storageCommands(browser)).toEqual([clearCookies, ...clearOriginCommands(storyOrigin)])
  })

  it('clears only the cookies before any goto', async () => {
    const { browser, page } = await openPage()

    await page.clearStorage()
    expect(storageCommands(browser)).toEqual([clearCookies])
  })

  it("doesn't count a commit from before the goto", async () => {
    const { browser, page } = await openPage()

    browser.emit('Page.frameNavigated', { frame: mainFrame(targetId, 'about:blank', 'loader-0') }, sessionId)
    await flush()
    await page.goto(storyUrl, 1000)
    await page.clearStorage()
    expect(storageCommands(browser)).toEqual([clearCookies, ...clearOriginCommands(storyOrigin)])
  })

  it.each([
    ['about:blank', '://'],
    ['data:text/html,story', '://'],
    ['chrome-error://chromewebdata/', '://'],
    ['chrome-error://chromewebdata/', 'chrome-error://chromewebdata'],
  ])(
    'clears only the cookies when the goto loaded %s, whose security origin %s is opaque',
    async (url, securityOrigin) => {
      const frame = { ...mainFrame(targetId, url, 'loader-1'), securityOrigin }
      const { browser, page } = await openPage({ handlers: { 'Page.navigate': navigateCommitting(frame) } })

      await page.goto(url, 1000)
      await page.clearStorage()
      expect(storageCommands(browser)).toEqual([clearCookies])
    },
  )

  it("clears the story's origin though an earlier navigation's error page commits late, before the goto's own document", async () => {
    const failedUrl = 'http://127.0.0.1:1/x'
    const { browser, page } = await openPage({
      handlers: {
        'Page.navigate': (command: ReceivedCommand, fake: FakeBrowser) => {
          if (fake.timesReceived(command.method) === 1) {
            fake.reply(command, { frameId: targetId, loaderId: 'loader-1', errorText: 'net::ERR_UNSAFE_PORT' })

            return
          }

          fake.emit(
            'Page.frameNavigated',
            {
              frame: { ...mainFrame(targetId, 'chrome-error://chromewebdata/', 'loader-1'), unreachableUrl: failedUrl },
            },
            sessionId,
          )
          navigateCommitting(mainFrame(targetId, storyUrl, 'loader-2'), 'loader-2')(command, fake)
        },
      },
    })

    await expect(page.goto(failedUrl, 1000)).rejects.toThrow('net::ERR_UNSAFE_PORT')
    await page.goto(storyUrl, 1000)
    await page.clearStorage()
    expect(storageCommands(browser)).toEqual([clearCookies, ...clearOriginCommands(storyOrigin)])
  })

  it('clears the origin a server redirect took the main frame to', async () => {
    const landed = mainFrame(targetId, 'https://www.storybook.test/iframe.html?id=button--primary', 'loader-1')
    const { browser, page } = await openPage({ handlers: { 'Page.navigate': navigateCommitting(landed) } })

    await page.goto(storyUrl, 1000)
    await page.clearStorage()
    expect(storageCommands(browser)).toEqual([clearCookies, ...clearOriginCommands('https://www.storybook.test')])
  })

  it.each([['http://elsewhere:7000/'], ['about:blank'], ['data:text/html,away']])(
    'fails at once with a PageNavigatedAwayError, sending nothing, when the page left the document its goto loaded for %s',
    async (url) => {
      const { browser, page } = await openPage()

      await page.goto(storyUrl, 1000)
      browser.emit('Page.frameNavigated', { frame: mainFrame(targetId, url, 'loader-9') }, sessionId)
      await flush()
      await expect(page.clearStorage()).rejects.toMatchObject({ name: 'PageNavigatedAwayError', url })
      expect(storageCommands(browser)).toEqual([])
    },
  )

  it("ignores a subframe's commits and another session's", async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    browser.emit('Page.frameNavigated', { frame: childFrame(targetId, 'http://ads:9000/frame') }, sessionId)
    browser.emit(
      'Page.frameNavigated',
      { frame: mainFrame(targetId, 'http://other:8000/', 'loader-9') },
      'session-other',
    )
    await flush()
    await page.clearStorage()
    expect(storageCommands(browser)).toEqual([clearCookies, ...clearOriginCommands(storyOrigin)])
  })

  it('sends its commands in parallel and resolves once the browser has answered every one', async () => {
    const { browser, page } = await openPage({ handlers: { 'Storage.clearCookies': () => undefined } })

    await page.goto(storyUrl, 1000)

    const clearing = page.clearStorage()

    await flushUntil(() => browser.timesReceived('DOMStorage.clear') === 1)
    expect(browser.timesReceived('Storage.clearDataForOrigin')).toBe(1)
    expect(await hasSettled(clearing)).toBe(false)

    const [cookies] = browser.received.filter((command) => command.method === 'Storage.clearCookies')

    browser.reply(cookies as ReceivedCommand, {})
    await expect(clearing).resolves.toBeUndefined()
  })

  it("fails with the browser's error when a command fails", async () => {
    const { page } = await openPage({
      handlers: {
        'DOMStorage.clear': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.fail(command, -32000, 'Frame not found for the given storage id'),
      },
    })

    await page.goto(storyUrl, 1000)
    await expect(page.clearStorage()).rejects.toThrow('Frame not found for the given storage id')
  })
})

/**
 * The viewport the tests set.
 */
const viewport = { width: 1280, height: 720, deviceScaleFactor: 1, touch: false }

/**
 * Each page call, with the method it is in flight on, as the tests run them after a goto.
 */
const callsInFlight: [string, string, (page: Page) => Promise<unknown>][] = [
  ['evaluate', 'Runtime.evaluate', (page: Page) => page.evaluate('play()', 60_000)],
  ['capture', 'Page.captureScreenshot', (page: Page) => page.capture('full-page')],
  ['setViewport', 'Emulation.setDeviceMetricsOverride', (page: Page) => page.setViewport(viewport)],
  ['clearStorage', 'DOMStorage.clear', (page: Page) => page.clearStorage()],
]

describe('when the page navigates away after a goto loaded', () => {
  it.each(callsInFlight)(
    'fails %s in flight and every later call with a PageNavigatedAwayError once the main frame commits a new document',
    async (_call, method, call) => {
      const { browser, page } = await openPage({
        handlers: {
          [method]: (_command: ReceivedCommand, fake: FakeBrowser) =>
            fake.emit(
              'Page.frameNavigated',
              { frame: mainFrame(targetId, `${burgersUrl}#top`, 'loader-9') },
              sessionId,
            ),
        },
      })
      const failure = navigatedAway(`${burgersUrl}#top`)

      await page.goto(storyUrl, 1000)
      await expect(call(page)).rejects.toMatchObject(failure)

      const sentBefore = browser.received.length

      await expect(page.evaluate('1', 60_000)).rejects.toMatchObject(failure)
      await expect(page.setViewport(viewport)).rejects.toMatchObject(failure)
      await expect(page.capture('full-page')).rejects.toMatchObject(failure)
      await expect(page.clearStorage()).rejects.toMatchObject(failure)
      await expect(page.goto(storyUrl, 60_000)).rejects.toMatchObject(failure)
      expect(browser.received.length).toBe(sentBefore)
    },
  )

  it('names the URL an error page stands for', async () => {
    const { browser, page } = await openPage()
    const errorPage = {
      ...mainFrame(targetId, 'chrome-error://chromewebdata/', 'loader-9'),
      unreachableUrl: burgersUrl,
    }

    await page.goto(storyUrl, 1000)
    browser.emit('Page.frameNavigated', { frame: errorPage }, sessionId)
    await flush()
    await expect(page.evaluate('1', 1000)).rejects.toMatchObject(navigatedAway(burgersUrl))
  })

  it('fails every call from the first commit after the load event, though they come together', async () => {
    const { page } = await openPage({
      handlers: {
        'Page.navigate': (command: ReceivedCommand, fake: FakeBrowser) => {
          navigateAndLoadOnce(command, fake)
          fake.emit('Page.frameNavigated', { frame: mainFrame(targetId, burgersUrl, 'loader-9') }, sessionId)
        },
      },
    })

    await expect(page.goto(storyUrl, 1000)).resolves.toBeUndefined()
    await expect(page.evaluate('1', 1000)).rejects.toMatchObject(navigatedAway(burgersUrl))
  })

  it('fails every call from a commit that came after the load event but before the answer to Page.navigate', async () => {
    const { page } = await openPage({
      handlers: {
        'Page.navigate': (command: ReceivedCommand, fake: FakeBrowser) => {
          fake.emit('Page.frameNavigated', { frame: mainFrame(targetId, storyUrl, 'loader-1') }, sessionId)
          fake.emit('Page.loadEventFired', { timestamp: 1 }, sessionId)
          fake.emit('Page.frameNavigated', { frame: mainFrame(targetId, burgersUrl, 'loader-9') }, sessionId)
          fake.reply(command, { frameId: targetId, loaderId: 'loader-1' })
        },
      },
    })

    await expect(page.goto(storyUrl, 1000)).resolves.toBeUndefined()
    await expect(page.evaluate('1', 1000)).rejects.toMatchObject(navigatedAway(burgersUrl))
  })

  it('fails an evaluation the browser fails once the main frame has started a history traversal to another document', async () => {
    const previousStoryUrl = 'http://storybook:6006/iframe.html?id=button--secondary&viewMode=story'
    const { page } = await openPage({
      handlers: {
        'Runtime.evaluate': (command: ReceivedCommand, fake: FakeBrowser) => {
          fake.emit(
            'Page.frameStartedNavigating',
            {
              frameId: targetId,
              url: previousStoryUrl,
              loaderId: 'loader-9',
              navigationType: 'historyDifferentDocument',
            },
            sessionId,
          )
          fake.fail(command, -32000, navigatedOrClosed)
        },
      },
    })

    await page.goto(storyUrl, 1000)
    await expect(page.evaluate('history.back()', 1000)).rejects.toMatchObject(navigatedAway(previousStoryUrl))
  })

  it.each(callsInFlight)(
    'fails %s with a PageNavigatedAwayError naming the requested URL when the browser fails it while the page navigates',
    async (_call, method, call) => {
      const { page } = await openPage({
        handlers: {
          [method]: (command: ReceivedCommand, fake: FakeBrowser) => {
            requestNavigation(fake, targetId, burgersUrl)
            fake.fail(command, -32000, navigatedOrClosed)
          },
        },
      })

      await page.goto(storyUrl, 1000)
      await expect(call(page)).rejects.toMatchObject(navigatedAway(burgersUrl))
    },
  )

  it("fails with the browser's error when no navigation the page requested is pending", async () => {
    const { page } = await openPage({
      handlers: {
        'Runtime.evaluate': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.fail(command, -32000, navigatedOrClosed),
      },
    })

    await page.goto(storyUrl, 1000)
    await expect(page.evaluate('1', 1000)).rejects.toMatchObject({
      name: 'CdpError',
      message: `CDP Runtime.evaluate failed: ${navigatedOrClosed}`,
    })
  })

  it("names the URL when the commit and the main frame's stop come right behind the browser's error", async () => {
    const { page } = await openPage({
      handlers: {
        'Runtime.evaluate': (command: ReceivedCommand, fake: FakeBrowser) => {
          requestNavigation(fake, targetId, burgersUrl)
          fake.fail(command, -32000, navigatedOrClosed)
          fake.emit('Page.frameNavigated', { frame: mainFrame(targetId, burgersUrl, 'loader-9') }, sessionId)
          fake.emit('Page.frameStoppedLoading', { frameId: targetId }, sessionId)
        },
      },
    })

    await page.goto(storyUrl, 1000)
    await expect(page.evaluate('play()', 1000)).rejects.toMatchObject(navigatedAway(burgersUrl))
  })

  it("keeps a pending navigation through a same-document one, such as Storybook's history.replaceState", async () => {
    const { page } = await openPage({
      handlers: {
        'Runtime.evaluate': (command: ReceivedCommand, fake: FakeBrowser) => {
          requestNavigation(fake, targetId, burgersUrl)
          fake.emit(
            'Page.navigatedWithinDocument',
            { frameId: targetId, url: `${storyUrl}&args=`, navigationType: 'historyApi' },
            sessionId,
          )
          fake.fail(command, -32000, navigatedOrClosed)
        },
      },
    })

    await page.goto(storyUrl, 1000)
    await expect(page.evaluate('play()', 1000)).rejects.toMatchObject(navigatedAway(burgersUrl))
  })

  it('forgets a navigation the page requested once the main frame stops loading without a new document', async () => {
    const { page } = await openPage({
      handlers: {
        'Runtime.evaluate': (command: ReceivedCommand, fake: FakeBrowser) => {
          requestNavigation(fake, targetId, 'http://storybook:6006/no-content')
          fake.emit('Page.frameStoppedLoading', { frameId: targetId }, sessionId)
          fake.fail(command, -32000, 'Something else went wrong')
        },
      },
    })

    await page.goto(storyUrl, 1000)
    await expect(page.evaluate('play()', 1000)).rejects.toMatchObject({ name: 'CdpError' })
  })

  it("ignores a child frame's commits and requests, and another session's", async () => {
    const { browser, page } = await openPage({
      handlers: {
        'Runtime.evaluate': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.fail(command, -32000, navigatedOrClosed),
      },
    })

    await page.goto(storyUrl, 1000)
    requestNavigation(browser, 'child-frame', 'http://ads:9000/next')
    browser.emit('Page.frameNavigated', { frame: childFrame(targetId, 'http://ads:9000/next') }, sessionId)
    browser.emit(
      'Page.frameRequestedNavigation',
      { frameId: targetId, reason: 'anchorClick', url: burgersUrl, disposition: 'currentTab' },
      'session-other',
    )
    browser.emit('Page.frameNavigated', { frame: mainFrame(targetId, burgersUrl, 'loader-9') }, 'session-other')
    await flush()
    await expect(page.evaluate('1', 1000)).rejects.toMatchObject({ name: 'CdpError' })
    await expect(page.capture('full-page')).resolves.toBeDefined()
  })

  it('counts no commit or request from before a goto loaded', async () => {
    const { browser, page } = await openPage({
      handlers: {
        'Runtime.evaluate': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.fail(command, -32000, navigatedOrClosed),
      },
    })

    requestNavigation(browser, targetId, 'about:blank')
    browser.emit('Page.frameNavigated', { frame: mainFrame(targetId, 'about:blank', 'loader-0') }, sessionId)
    await flush()
    await expect(page.evaluate('1', 1000)).rejects.toMatchObject({ name: 'CdpError' })
    await expect(page.capture('full-page')).resolves.toBeDefined()
  })

  it('counts no commit after a goto that failed', async () => {
    const { browser, page } = await openPage({
      handlers: {
        'Page.navigate': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.reply(command, { frameId: targetId, loaderId: 'loader-1', errorText: 'net::ERR_CONNECTION_REFUSED' }),
      },
    })

    await expect(page.goto(storyUrl, 1000)).rejects.toThrow('net::ERR_CONNECTION_REFUSED')
    browser.emit(
      'Page.frameNavigated',
      { frame: { ...mainFrame(targetId, 'chrome-error://chromewebdata/', 'loader-1'), unreachableUrl: storyUrl } },
      sessionId,
    )
    await flush()
    await expect(page.capture('full-page')).resolves.toBeDefined()
  })

  it('counts no commit after a goto that timed out, though a late answer reveals that its document loaded', async () => {
    const pending: ReceivedCommand[] = []
    const { browser, page } = await openPage({
      handlers: {
        'Page.navigate': (command: ReceivedCommand, fake: FakeBrowser) => {
          fake.emit('Page.frameNavigated', { frame: mainFrame(targetId, storyUrl, 'loader-1') }, sessionId)
          fake.emit('Page.loadEventFired', { timestamp: 1 }, sessionId)
          pending.push(command)
        },
      },
    })

    await expect(page.goto(storyUrl, 50)).rejects.toBeInstanceOf(PageTimeoutError)
    browser.reply(pending[0] as ReceivedCommand, { frameId: targetId, loaderId: 'loader-1' })
    await flush()
    browser.emit('Page.frameNavigated', { frame: mainFrame(targetId, burgersUrl, 'loader-9') }, sessionId)
    await flush()
    await expect(page.capture('full-page')).resolves.toBeDefined()
  })

  it('forgets a pending navigation when a goto starts, and follows the document that goto loads', async () => {
    const nextStoryUrl = 'http://storybook:6006/iframe.html?id=button--secondary&viewMode=story'
    const { browser, page } = await openPage({
      handlers: {
        'Runtime.evaluate': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.fail(command, -32000, navigatedOrClosed),
      },
    })

    await page.goto(storyUrl, 1000)
    requestNavigation(browser, targetId, burgersUrl)
    await flush()
    await page.goto(nextStoryUrl, 1000)
    await expect(page.evaluate('1', 1000)).rejects.toMatchObject({ name: 'CdpError' })
    browser.emit('Page.frameNavigated', { frame: mainFrame(targetId, burgersUrl, 'loader-9') }, sessionId)
    await flush()
    await expect(page.capture('full-page')).rejects.toMatchObject(navigatedAway(burgersUrl, nextStoryUrl))
  })

  it('never turns a PageTimeoutError into a PageNavigatedAwayError', async () => {
    const { page } = await openPage({
      handlers: {
        'Runtime.evaluate': (_command: ReceivedCommand, fake: FakeBrowser) =>
          requestNavigation(fake, targetId, burgersUrl),
      },
    })

    await page.goto(storyUrl, 1000)

    const failure = await page.evaluate('new Promise(() => {})', 50).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(PageTimeoutError)
  })
})

describe('Page.requestHosts', () => {
  it('turns on no Network domain and attaches to no service worker when the setup has watchRequests off', async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    browser.emit('Target.targetCreated', createdTarget('service_worker', 'context-1', 'target-worker'), sessionId)
    sendRequest(browser, 'request-1', apiUrl)
    openSocket(browser, 'request-2', 'wss://socket.example.com/live')
    await flush()
    expect(sent(browser).filter((command) => command.method.startsWith('Network.'))).toEqual([])
    expect(sentOf(browser, 'Target.attachToTarget')).toHaveLength(1)
    expect(sentOf(browser, 'Target.setDiscoverTargets')).toEqual([
      {
        method: 'Target.setDiscoverTargets',
        params: { discover: true, filter: [{ type: 'page' }] },
        sessionId: undefined,
      },
    ])
    expect(page.requestHosts()).toEqual([])
  })

  it("turns the Network domain on and has the page's session report service workers, in its setup", async () => {
    const { browser } = await openWatchedPage()

    expect(sentOf(browser, 'Network.enable')).toEqual([
      { method: 'Network.enable', params: networkEnableParams, sessionId },
    ])
    expect(sentOf(browser, 'Target.setDiscoverTargets').slice(1)).toEqual([
      {
        method: 'Target.setDiscoverTargets',
        params: { discover: true, filter: [{ type: 'service_worker' }] },
        sessionId,
      },
    ])
  })

  it.each(['Fetch', 'XHR', 'EventSource'])('counts a %s request to another origin', async (type) => {
    const { browser, page } = await openWatchedPage()

    sendRequest(browser, 'request-1', apiUrl, type)
    receiveResponse(browser, 'request-1', { fromServiceWorker: false })
    await flush()
    expect(page.requestHosts()).toEqual(['api.example.com'])
  })

  it('counts a WebSocket to another origin', async () => {
    const { browser, page } = await openWatchedPage()

    openSocket(browser, 'request-1', 'wss://socket.example.com/live')
    await flush()
    expect(page.requestHosts()).toEqual(['socket.example.com'])
  })

  it("counts no request or WebSocket to the story's own origin", async () => {
    const { browser, page } = await openWatchedPage()

    sendRequest(browser, 'request-1', `${storyOrigin}/api/users`)
    receiveResponse(browser, 'request-1', { fromServiceWorker: false })
    openSocket(browser, 'request-2', 'ws://storybook:6006/storybook-server-channel')
    await flush()
    expect(page.requestHosts()).toEqual([])
  })

  it.each(['Image', 'Stylesheet', 'Font', 'Script', 'Document', 'Other'])('counts no %s request', async (type) => {
    const { browser, page } = await openWatchedPage()

    sendRequest(browser, 'request-1', apiUrl, type)
    receiveResponse(browser, 'request-1', { fromServiceWorker: false })
    await flush()
    expect(page.requestHosts()).toEqual([])
  })

  it("counts no URL that doesn't go over the network", async () => {
    const { browser, page } = await openWatchedPage()

    sendRequest(browser, 'request-1', 'data:application/json,{}')
    sendRequest(browser, 'request-2', 'blob:http://storybook:6006/1234')
    await flush()
    expect(page.requestHosts()).toEqual([])
  })

  it('counts a request to another port of the same host name, naming the port', async () => {
    const { browser, page } = await openWatchedPage()

    sendRequest(browser, 'request-1', 'http://storybook:6007/api')
    receiveResponse(browser, 'request-1', { fromServiceWorker: false })
    await flush()
    expect(page.requestHosts()).toEqual(['storybook:6007'])
  })

  it('names each host once, in lower case, without its default port, in the order first sent', async () => {
    const { browser, page } = await openWatchedPage()

    sendRequest(browser, 'request-1', 'https://B.example.com:443/one')
    sendRequest(browser, 'request-2', 'https://a.example.com/two')
    sendRequest(browser, 'request-3', 'https://b.example.com/three')
    await flush()
    expect(page.requestHosts()).toEqual(['b.example.com', 'a.example.com'])
  })

  it('counts a response from the HTTP cache', async () => {
    const { browser, page } = await openWatchedPage()

    sendRequest(browser, 'request-1', apiUrl)
    receiveResponse(browser, 'request-1', { fromServiceWorker: false, fromDiskCache: true })
    await flush()
    expect(page.requestHosts()).toEqual(['api.example.com'])
  })

  it('counts no response a service worker built itself', async () => {
    const { browser, page } = await openWatchedPage()

    sendRequest(browser, 'request-1', apiUrl)
    receiveResponse(browser, 'request-1', { fromServiceWorker: true, serviceWorkerResponseSource: 'fallback-code' })
    await flush()
    expect(page.requestHosts()).toEqual([])
  })

  it("attaches to a service worker of the page's context at the browser level, and watches its requests", async () => {
    const { browser } = await openWatchedPage()

    await attachWorker(browser)
    expect(sentOf(browser, 'Target.attachToTarget').slice(1)).toEqual([
      { method: 'Target.attachToTarget', params: { targetId: 'target-worker', flatten: true }, sessionId: undefined },
    ])
    expect(sentOf(browser, 'Network.enable').slice(1)).toEqual([
      { method: 'Network.enable', params: networkEnableParams, sessionId: workerSessionId },
    ])
  })

  it('attaches to no service worker of another browser context', async () => {
    const { browser } = await openWatchedPage()

    browser.emit('Target.targetCreated', createdTarget('service_worker', 'context-2', 'target-other'), sessionId)
    browser.emit('Target.targetCreated', createdTarget('shared_worker', 'context-1', 'target-shared'), sessionId)
    await flush()
    expect(sentOf(browser, 'Target.attachToTarget')).toHaveLength(1)
  })

  it('counts a response through a service worker that passed the request on', async () => {
    const { browser, page } = await openWatchedPage()

    await attachWorker(browser)
    sendRequest(browser, 'request-1', apiUrl)
    sendRequest(browser, 'worker-request-1', apiUrl, 'Fetch', workerSessionId)
    receiveResponse(browser, 'request-1', { fromServiceWorker: true, serviceWorkerResponseSource: 'network' })
    await flush()
    expect(page.requestHosts()).toEqual(['api.example.com'])
  })

  it('counts a pending request a service worker passed on', async () => {
    const { browser, page } = await openWatchedPage()

    await attachWorker(browser)
    sendRequest(browser, 'request-1', apiUrl)
    sendRequest(browser, 'worker-request-1', apiUrl, 'Fetch', workerSessionId)
    await flush()
    expect(page.requestHosts()).toEqual(['api.example.com'])
  })

  it('counts a pending or failed request while no service worker is attached', async () => {
    const { browser, page } = await openWatchedPage()

    sendRequest(browser, 'request-1', 'https://pending.example.com/')
    sendRequest(browser, 'request-2', 'https://failed.example.com/')
    browser.emit('Network.loadingFailed', { requestId: 'request-2', errorText: 'net::ERR_FAILED' }, sessionId)
    await flush()
    expect(page.requestHosts()).toEqual(['pending.example.com', 'failed.example.com'])
  })

  it('counts no pending or failed request no attached service worker passed on', async () => {
    const { browser, page } = await openWatchedPage()

    await attachWorker(browser)
    sendRequest(browser, 'request-1', 'https://pending.example.com/')
    sendRequest(browser, 'request-2', 'https://failed.example.com/')
    browser.emit('Network.loadingFailed', { requestId: 'request-2', errorText: 'net::ERR_FAILED' }, sessionId)
    await flush()
    expect(page.requestHosts()).toEqual([])
  })

  it("counts a pending request again once the service worker's session detached", async () => {
    const { browser, page } = await openWatchedPage()

    await attachWorker(browser)
    sendRequest(browser, 'request-1', apiUrl)
    browser.emit('Target.detachedFromTarget', { sessionId: workerSessionId, targetId: 'target-worker' })
    await flush()
    expect(page.requestHosts()).toEqual(['api.example.com'])
  })

  it("counts no request a document sent before the goto's own document committed", async () => {
    const { browser, driver } = await launch({
      handlers: {
        'Page.navigate': (command: ReceivedCommand, fake: FakeBrowser) => {
          sendRequest(fake, 'request-2', 'https://leaving.example.com/')
          sendRequest(fake, 'worker-request-1', 'https://passed.example.com/', 'Fetch', workerSessionId)
          navigateAndLoadOnce(command, fake)
          sendRequest(fake, 'request-3', 'https://passed.example.com/')
          receiveResponse(fake, 'request-3', { fromServiceWorker: true })
          sendRequest(fake, 'request-4', apiUrl)
          receiveResponse(fake, 'request-4', { fromServiceWorker: false })
        },
      },
    })
    const page = await driver.newPage({ ...pageSetup, watchRequests: true })

    await attachWorker(browser)
    sendRequest(browser, 'request-1', 'https://before.example.com/')
    receiveResponse(browser, 'request-1', { fromServiceWorker: false })
    await flush()
    await page.goto(storyUrl, 1000)
    expect(page.requestHosts()).toEqual(['api.example.com'])
  })

  it('counts a pending request while the Network domain of the only service worker is unanswered', async () => {
    const { browser, page } = await openWatchedPage({
      handlers: {
        'Network.enable': (command: ReceivedCommand, fake: FakeBrowser) => {
          if (command.sessionId === sessionId) {
            fake.reply(command, {})
          }
        },
      },
    })

    reportWorker(browser)
    await flushUntil(() => sentOf(browser, 'Network.enable').length === 2)
    sendRequest(browser, 'request-1', apiUrl)
    await flush()
    expect(page.requestHosts()).toEqual(['api.example.com'])
  })

  it('keeps a redirected request in the place it was first sent, with the URL it went to last', async () => {
    const { browser, page } = await openWatchedPage()

    sendRequest(browser, 'request-1', `${storyOrigin}/api/login`)
    sendRequest(browser, 'request-2', 'https://first.example.com/')
    sendRequest(browser, 'request-1', 'https://auth.example.com/callback')
    await flush()
    expect(page.requestHosts()).toEqual(['auth.example.com', 'first.example.com'])
  })

  it("ignores requests, WebSockets and responses of another page's session", async () => {
    const { browser, page } = await openWatchedPage()
    const otherSessionId = 'session-other'

    await attachWorker(browser)
    sendRequest(browser, 'request-1', apiUrl)
    sendRequest(browser, 'request-2', 'https://other.example.com/', 'Fetch', otherSessionId)
    browser.emit(
      'Network.webSocketCreated',
      { requestId: 'request-3', url: 'wss://socket.example.com/' },
      otherSessionId,
    )
    browser.emit(
      'Network.responseReceived',
      { requestId: 'request-1', type: 'Fetch', response: { url: apiUrl, fromServiceWorker: false } },
      otherSessionId,
    )
    await flush()
    expect(page.requestHosts()).toEqual([])
  })

  it('ignores a pass-on from a session it never attached', async () => {
    const { browser, page } = await openWatchedPage()

    await attachWorker(browser)
    sendRequest(browser, 'request-1', apiUrl)
    sendRequest(browser, 'worker-request-1', apiUrl, 'Fetch', 'session-unattached')
    await flush()
    expect(page.requestHosts()).toEqual([])
  })

  it.each([
    [
      'the discovery of service workers',
      'Target.setDiscoverTargets',
      (command: ReceivedCommand, fake: FakeBrowser) =>
        command.sessionId === undefined ? fake.reply(command, {}) : fake.fail(command, -32000, 'Not allowed'),
    ],
    [
      'the attach to a service worker',
      'Target.attachToTarget',
      (command: ReceivedCommand, fake: FakeBrowser) => {
        if (command.params.targetId === 'target-worker') {
          fake.fail(command, -32000, 'No target with given id')
        } else {
          fake.sessionTargets.set(sessionId, String(command.params.targetId))
          fake.reply(command, { sessionId })
        }
      },
    ],
    [
      "the Network domain in a service worker's session",
      'Network.enable',
      (command: ReceivedCommand, fake: FakeBrowser) =>
        command.sessionId === sessionId ? fake.reply(command, {}) : fake.fail(command, -32000, 'Not allowed'),
    ],
  ])('survives a failure of %s, and watches no service worker', async (_what, method, handler: CommandHandler) => {
    const { browser, page } = await openWatchedPage({ handlers: { [method]: handler } })

    if (method !== 'Target.setDiscoverTargets') {
      reportWorker(browser)
      await flushUntil(() => browser.timesReceived(method) === 2)
    }

    await flush()
    await expect(page.evaluate('1', 1000)).resolves.toBeUndefined()
    openSocket(browser, 'request-1', 'wss://socket.example.com/live')
    sendRequest(browser, 'request-2', apiUrl)
    await flush()
    expect(page.requestHosts()).toEqual(['socket.example.com', 'api.example.com'])
  })
})

describe('dialogs', () => {
  it.each([
    ['alert', true],
    ['beforeunload', true],
    ['confirm', false],
    ['prompt', false],
  ])('answers a %s dialog in the page session with accept: %s', async (type, accept) => {
    const { browser, page } = await openPage()

    browser.emit('Page.javascriptDialogOpening', { type, message: 'Hi', url: storyUrl }, sessionId)
    await flushUntil(() => browser.timesReceived('Page.handleJavaScriptDialog') === 1)
    expect(sentOf(browser, 'Page.handleJavaScriptDialog')).toEqual([
      { method: 'Page.handleJavaScriptDialog', params: { accept }, sessionId },
    ])
    await page.close()
  })

  it('ignores a dialog in another session', async () => {
    const { browser } = await openPage()

    browser.emit('Page.javascriptDialogOpening', { type: 'alert' }, 'session-other')
    await flush()
    expect(sentOf(browser, 'Page.handleJavaScriptDialog')).toEqual([])
  })

  it('survives a failing dialog answer', async () => {
    const { browser, page } = await openPage({
      handlers: {
        'Page.handleJavaScriptDialog': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.fail(command, -32000, 'No dialog is showing'),
      },
    })

    browser.emit('Page.javascriptDialogOpening', { type: 'alert' }, sessionId)
    await flushUntil(() => browser.timesReceived('Page.handleJavaScriptDialog') === 1)
    await expect(page.evaluate('1', 1000)).resolves.toBeUndefined()
  })

  it('answers no dialog once the page is closed', async () => {
    const { browser, page } = await openPage()

    await page.close()
    browser.emit('Page.javascriptDialogOpening', { type: 'alert' }, sessionId)
    await flush()
    expect(sentOf(browser, 'Page.handleJavaScriptDialog')).toEqual([])
  })
})

describe('popups', () => {
  it('closes a page target created in the same browser context, at the browser level', async () => {
    const { browser } = await openPage()

    browser.emit('Target.targetCreated', createdTarget('page', 'context-1', 'target-popup'))
    await flushUntil(() => browser.timesReceived('Target.closeTarget') === 1)
    expect(sentOf(browser, 'Target.closeTarget')).toEqual([
      { method: 'Target.closeTarget', params: { targetId: 'target-popup' }, sessionId: undefined },
    ])
  })

  it.each([
    ['a page target of another context', createdTarget('page', 'context-2', 'target-other')],
    ['a service worker of the same context', createdTarget('service_worker', 'context-1', 'target-worker')],
    ['the page itself', createdTarget('page', 'context-1', targetId)],
  ])('leaves %s alone', async (_what, params) => {
    const { browser } = await openPage()

    browser.emit('Target.targetCreated', params)
    await flush()
    expect(sentOf(browser, 'Target.closeTarget')).toEqual([])
  })

  it('survives a failing close', async () => {
    const { browser, page } = await openPage({
      handlers: {
        'Target.closeTarget': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.fail(command, -32000, 'No target with given id'),
      },
    })

    browser.emit('Target.targetCreated', createdTarget('page', 'context-1', 'target-popup'))
    await flushUntil(() => browser.timesReceived('Target.closeTarget') === 1)
    await expect(page.evaluate('1', 1000)).resolves.toBeUndefined()
  })

  it('closes no popup once the page is closed', async () => {
    const { browser, page } = await openPage()

    await page.close()
    browser.emit('Target.targetCreated', createdTarget('page', 'context-1', 'target-popup'))
    await flush()
    expect(sentOf(browser, 'Target.closeTarget')).toEqual([])
  })
})

describe('when the page crashes', () => {
  it('fails a capture and sends no capture command when the page crashes after the layout answer', async () => {
    const { browser, page } = await openPage({
      handlers: {
        'Page.getLayoutMetrics': (command: ReceivedCommand, fake: FakeBrowser) => {
          fake.emit('Inspector.targetCrashed', {}, sessionId)
          fake.reply(command, { cssContentSize: { x: 0, y: 0, width: 10, height: 10 } })
        },
      },
    })

    await expect(page.capture('full-page')).rejects.toMatchObject({ name: 'PageCrashedError' })
    await flush()
    expect(sentOf(browser, 'Page.captureScreenshot')).toEqual([])
  })

  it('fails a capture and sends no touch emulation after the screenshot when the page crashes on its answer', async () => {
    const { browser, page } = await openPage({
      handlers: {
        'Page.captureScreenshot': (command: ReceivedCommand, fake: FakeBrowser) => {
          fake.emit('Inspector.targetCrashed', {}, sessionId)
          fake.reply(command, { data: defaultCaptureData })
        },
      },
    })

    await page.setViewport(touchViewport)
    await expect(page.capture('full-page')).rejects.toMatchObject({ name: 'PageCrashedError' })
    await flush()
    expect(sentOf(browser, 'Emulation.setTouchEmulationEnabled')).toHaveLength(2)
  })

  it('fails a goto in flight and every later call at once with a PageCrashedError', async () => {
    const { browser, page } = await openPage({
      handlers: {
        'Page.navigate': (_command: ReceivedCommand, fake: FakeBrowser) =>
          fake.emit('Inspector.targetCrashed', {}, sessionId),
      },
    })

    await expect(page.goto(storyUrl, 60_000)).rejects.toMatchObject({ name: 'PageCrashedError' })
    await expect(page.evaluate('1', 60_000)).rejects.toMatchObject({ name: 'PageCrashedError' })
    await expect(page.setViewport({ width: 1, height: 1, deviceScaleFactor: 1, touch: false })).rejects.toMatchObject({
      name: 'PageCrashedError',
    })
    await expect(page.capture('full-page')).rejects.toMatchObject({ name: 'PageCrashedError' })
    await expect(page.clearStorage()).rejects.toMatchObject({ name: 'PageCrashedError' })
    expect(sentOf(browser, 'Runtime.evaluate')).toEqual([])
    expect(sentOf(browser, 'Storage.clearCookies')).toEqual([])
  })

  it('fails a clear in flight with a PageCrashedError', async () => {
    const { page } = await openPage({
      handlers: {
        'Storage.clearCookies': (_command: ReceivedCommand, fake: FakeBrowser) =>
          fake.emit('Inspector.targetCrashed', {}, sessionId),
      },
    })

    await expect(page.clearStorage()).rejects.toMatchObject({ name: 'PageCrashedError' })
  })

  it('fails an evaluation in flight with a PageCrashedError', async () => {
    const { page } = await openPage({
      handlers: {
        'Runtime.evaluate': (_command: ReceivedCommand, fake: FakeBrowser) =>
          fake.emit('Inspector.targetCrashed', {}, sessionId),
      },
    })

    await expect(page.evaluate('1', 60_000)).rejects.toMatchObject({ name: 'PageCrashedError' })
  })

  it("leaves the page alone when another session's page crashes", async () => {
    const { page } = await openPage({
      handlers: {
        'Page.navigate': (command: ReceivedCommand, fake: FakeBrowser) => {
          fake.emit('Inspector.targetCrashed', {}, 'session-other')
          navigateAndLoadOnce(command, fake)
        },
      },
    })

    await expect(page.goto(storyUrl, 1000)).resolves.toBeUndefined()
    await expect(page.evaluate('1', 1000)).resolves.toBeUndefined()
  })
})

describe('when the browser closes the page without a crash', () => {
  it.each([
    ['its session reports a detach', 'Inspector.detached', { reason: 'target closed' }, sessionId],
    ['the browser reports the session detached', 'Target.detachedFromTarget', { sessionId, targetId }, undefined],
  ])('fails a call in flight and every later call when %s', async (_how, method, params, eventSessionId) => {
    const { page } = await openPage({
      handlers: {
        'Runtime.evaluate': (_command: ReceivedCommand, fake: FakeBrowser) => fake.emit(method, params, eventSessionId),
      },
    })

    await expect(page.evaluate('1', 60_000)).rejects.toThrow('The browser closed the page.')
    await expect(page.goto(storyUrl, 60_000)).rejects.toThrow('The browser closed the page.')
  })

  it("leaves the page alone when another session's target detaches", async () => {
    const { page } = await openPage({
      handlers: {
        'Runtime.evaluate': (command: ReceivedCommand, fake: FakeBrowser) => {
          fake.emit('Inspector.detached', { reason: 'target closed' }, 'session-other')
          fake.emit('Target.detachedFromTarget', { sessionId: 'session-other', targetId: 'target-other' })
          fake.reply(command, { result: { type: 'number', value: 1 } })
        },
      },
    })

    await expect(page.evaluate('1', 1000)).resolves.toBe(1)
  })
})

describe('when the browser exits', () => {
  it('fails an evaluation in flight with a BrowserExitedError', async () => {
    const { page } = await openPage({
      handlers: { 'Runtime.evaluate': (_command: ReceivedCommand, fake: FakeBrowser) => fake.exit({ code: 1 }) },
    })

    await expect(page.evaluate('1', 60_000)).rejects.toMatchObject({ name: 'BrowserExitedError' })
  })

  it('fails a goto waiting for its load event with a BrowserExitedError', async () => {
    const { page } = await openPage({
      handlers: {
        'Page.navigate': (command: ReceivedCommand, fake: FakeBrowser) => {
          fake.emit('Page.frameNavigated', { frame: mainFrame(targetId, storyUrl, 'loader-1') }, sessionId)
          fake.reply(command, { frameId: targetId, loaderId: 'loader-1' })
          fake.exit({ signal: 'SIGKILL' })
        },
      },
    })

    await expect(page.goto(storyUrl, 60_000)).rejects.toMatchObject({ name: 'BrowserExitedError' })
  })
})

describe('when the driver closes the browser', () => {
  it('fails every later call on the page with a closed-browser error', async () => {
    const { browser, driver } = await launch()
    const page = await driver.newPage(pageSetup)

    await driver.close()
    await expect(page.evaluate('1', 1000)).rejects.toThrow('The browser was closed.')
    expect(sentOf(browser, 'Runtime.evaluate')).toEqual([])
  })
})

describe('Page.close', () => {
  it('disposes the browser context, at the browser level', async () => {
    const { browser, page } = await openPage()

    await page.close()
    expect(sentOf(browser, 'Target.disposeBrowserContext')).toEqual([
      { method: 'Target.disposeBrowserContext', params: { browserContextId: 'context-1' }, sessionId: undefined },
    ])
  })

  it('returns the same promise when called again, and disposes the context once', async () => {
    const { browser, page } = await openPage()
    const first = page.close()

    expect(page.close()).toBe(first)
    await first
    await page.close()
    expect(sentOf(browser, 'Target.disposeBrowserContext')).toHaveLength(1)
  })

  it('resolves when disposing the context fails', async () => {
    const { page } = await openPage({
      handlers: {
        'Target.disposeBrowserContext': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.fail(command, -32000, 'Failed to find context'),
      },
    })

    await expect(page.close()).resolves.toBeUndefined()
  })

  it("resolves 5 s after asking when the browser doesn't answer", async () => {
    const { page } = await openPage({ handlers: { 'Target.disposeBrowserContext': () => undefined } })

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const closing = page.close()

    await vi.advanceTimersByTimeAsync(4999)
    expect(await hasSettled(closing)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(closing).resolves.toBeUndefined()
  })

  it('fails a call in flight and every later call with a closed-page error', async () => {
    const { browser, page } = await openPage({ handlers: { 'Page.navigate': () => undefined } })
    const loading = page.goto(storyUrl, 60_000)

    await flush()
    await page.close()
    await expect(loading).rejects.toThrow('The page was closed.')
    await expect(page.evaluate('1', 1000)).rejects.toThrow('The page was closed.')
    await expect(page.clearStorage()).rejects.toThrow('The page was closed.')
    expect(sentOf(browser, 'Runtime.evaluate')).toEqual([])
    expect(sentOf(browser, 'Storage.clearCookies')).toEqual([])
  })
})

describe('Page.consoleMessages', () => {
  it('gives none before the page sent any', async () => {
    const { page } = await openPage()

    expect(page.consoleMessages()).toEqual([])
  })

  it("gives the messages the main world of the goto's document sent, in order", async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    sendMessage(browser, logged('first'), 1)
    sendMessage(browser, JSON.stringify({ kind: 'unhandledrejection', text: 'nope' }), 1)
    await flush()
    expect(page.consoleMessages()).toEqual([logMessage('first'), { kind: 'unhandledrejection', text: 'nope' }])
  })

  it('keeps only the last 50', async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    for (let index = 1; index <= 60; index += 1) {
      sendMessage(browser, logged(`line ${index}`), 1)
    }

    await flush()

    const kept = page.consoleMessages()

    expect(kept).toHaveLength(50)
    expect(kept[0]).toEqual(logMessage('line 11'))
    expect(kept[49]).toEqual(logMessage('line 60'))
  })

  it('forgets the messages from before a goto once it starts', async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    sendMessage(browser, logged('the earlier story'), 1)
    await flush()
    await page.goto(burgersUrl, 1000)
    sendMessage(browser, logged('this story'), 2)
    await flush()
    expect(page.consoleMessages()).toEqual([logMessage('this story')])
  })

  it("ignores what the document before a goto sends once it started, though it comes after the goto's document", async () => {
    const { browser, page } = await openPage({
      handlers: {
        'Page.navigate': (command: ReceivedCommand, fake: FakeBrowser) => {
          if (fake.timesReceived('Page.navigate') === 2) {
            sendMessage(fake, logged('the earlier story, late'), 1)
          }

          fake.emit(
            'Page.frameNavigated',
            { frame: mainFrame(targetId, String(command.params.url), 'loader-9') },
            sessionId,
          )
          fake.emit('Runtime.executionContextCreated', executionContext(7, targetId), sessionId)
          sendMessage(fake, logged('the earlier story, later still'), 1)
          sendMessage(fake, logged('this story'), 7)
          fake.reply(command, { frameId: targetId, loaderId: 'loader-9' })
          fake.emit('Page.loadEventFired', { timestamp: 1 }, sessionId)
        },
      },
    })

    await page.goto(storyUrl, 1000)
    await page.goto(burgersUrl, 1000)
    sendMessage(browser, logged('the earlier story, last'), 1)
    await flush()
    expect(page.consoleMessages()).toEqual([logMessage('this story')])
  })

  it('keeps the messages of a story that navigated away, and those of the document it went to', async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    sendMessage(browser, logged('before leaving'), 1)
    browser.emit('Page.frameNavigated', { frame: mainFrame(targetId, burgersUrl, 'loader-9') }, sessionId)
    browser.emit('Runtime.executionContextCreated', executionContext(9, targetId), sessionId)
    sendMessage(browser, logged('after leaving'), 9)
    await flush()
    await expect(page.evaluate('1', 1000)).rejects.toMatchObject(navigatedAway(burgersUrl))
    expect(page.consoleMessages()).toEqual([logMessage('before leaving'), logMessage('after leaving')])
  })

  it("ignores a subframe's context, an isolated world and a context it wasn't told of", async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    browser.emit('Runtime.executionContextCreated', executionContext(5, 'child-frame'), sessionId)
    browser.emit('Runtime.executionContextCreated', executionContext(6, targetId, false), sessionId)
    browser.emit('Runtime.executionContextCreated', executionContext(8, targetId), 'session-9')
    sendMessage(browser, logged('a subframe'), 5)
    sendMessage(browser, logged('an isolated world'), 6)
    sendMessage(browser, logged("another session's context"), 8)
    sendMessage(browser, logged('an unknown context'), 42)
    sendMessage(browser, logged('kept'), 1)
    await flush()
    expect(page.consoleMessages()).toEqual([logMessage('kept')])
  })

  it("ignores a payload it can't read, another function's calls and another session's", async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    sendMessage(browser, 'not JSON', 1)
    sendMessage(browser, JSON.stringify({ kind: 'console.table', text: 'a table' }), 1)
    sendMessage(browser, logged('another function'), 1, { name: 'otherBinding' })
    sendMessage(browser, logged('another session'), 1, { session: 'session-9' })
    sendMessage(browser, logged('kept'), 1)
    await flush()
    expect(page.consoleMessages()).toEqual([logMessage('kept')])
  })

  it('gives a copy, which the page never changes', async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    sendMessage(browser, logged('first'), 1)
    await flush()

    const given = page.consoleMessages()

    sendMessage(browser, logged('second'), 1)
    await flush()
    expect(given).toEqual([logMessage('first')])
  })
})

/**
 * Has the browser log, in the page's session or another, that the load of `url` failed with this text.
 */
function logLoad(
  browser: FakeBrowser,
  url: string,
  text = 'Failed to load resource: net::ERR_EMPTY_RESPONSE',
  session = sessionId,
): void {
  browser.emit('Log.entryAdded', { entry: { source: 'network', level: 'error', text, url } }, session)
}

describe('Page.failedLoads', () => {
  const chunkUrl = `${storyOrigin}/assets/card.stories-B0zV1TVO.js`

  it('turns the Log domain on and no Network domain in its setup when the setup has watchRequests off', async () => {
    const { browser } = await openPage()

    expect(sentOf(browser, 'Log.enable')).toEqual([{ method: 'Log.enable', params: {}, sessionId }])
    expect(sentOf(browser, 'Network.enable')).toEqual([])
  })

  it('gives none before any goto', async () => {
    const { browser, page } = await openPage()

    logLoad(browser, chunkUrl)
    await flush()
    expect(page.failedLoads()).toEqual([])
  })

  it("keeps a network error of the goto document's origin", async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    logLoad(browser, chunkUrl)
    await flush()
    expect(page.failedLoads()).toEqual([{ url: chunkUrl, error: 'net::ERR_EMPTY_RESPONSE' }])
  })

  it("drops another origin, an HTTP status, a cancellation, another source or level, and another session's", async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    logLoad(browser, 'https://fonts.example.com/inter.woff2')
    logLoad(
      browser,
      `${storyOrigin}/missing.js`,
      'Failed to load resource: the server responded with a status of 404 (Not Found)',
    )
    logLoad(browser, `${storyOrigin}/aborted.js`, 'Failed to load resource: net::ERR_ABORTED')
    browser.emit(
      'Log.entryAdded',
      {
        entry: {
          source: 'javascript',
          level: 'error',
          text: 'Failed to load resource: net::ERR_FAILED',
          url: chunkUrl,
        },
      },
      sessionId,
    )
    browser.emit(
      'Log.entryAdded',
      {
        entry: { source: 'network', level: 'warning', text: 'Failed to load resource: net::ERR_FAILED', url: chunkUrl },
      },
      sessionId,
    )
    logLoad(browser, chunkUrl, undefined, 'session-9')
    await flush()
    expect(page.failedLoads()).toEqual([])
  })

  it('keeps each URL once, in order', async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    logLoad(browser, chunkUrl)
    logLoad(browser, `${storyOrigin}/assets/preview.css`, 'Failed to load resource: net::ERR_CONNECTION_RESET')
    logLoad(browser, chunkUrl, 'Failed to load resource: net::ERR_CONNECTION_REFUSED')
    await flush()
    expect(page.failedLoads()).toEqual([
      { url: chunkUrl, error: 'net::ERR_EMPTY_RESPONSE' },
      { url: `${storyOrigin}/assets/preview.css`, error: 'net::ERR_CONNECTION_RESET' },
    ])
  })

  it('keeps only the first 10', async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    for (let index = 1; index <= 12; index += 1) {
      logLoad(browser, `${storyOrigin}/assets/chunk-${index}.js`)
    }

    await flush()

    const kept = page.failedLoads()

    expect(kept).toHaveLength(10)
    expect(kept[0]?.url).toBe(`${storyOrigin}/assets/chunk-1.js`)
    expect(kept[9]?.url).toBe(`${storyOrigin}/assets/chunk-10.js`)
  })

  it('forgets them once a goto starts', async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    logLoad(browser, chunkUrl)
    await flush()
    await page.goto(burgersUrl, 1000)
    expect(page.failedLoads()).toEqual([])
  })

  it("keeps a failure of the goto document's origin after 10 of other origins", async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    for (let index = 1; index <= 10; index += 1) {
      logLoad(browser, `https://cdn-${index}.example.com/image.png`)
    }

    logLoad(browser, chunkUrl)
    await flush()
    expect(page.failedLoads()).toEqual([{ url: chunkUrl, error: 'net::ERR_EMPTY_RESPONSE' }])
  })

  it('keeps the failures from before the main frame commits a document of another origin', async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    logLoad(browser, chunkUrl)
    browser.emit(
      'Page.frameNavigated',
      { frame: mainFrame(targetId, 'https://elsewhere.example.com/', 'loader-9') },
      sessionId,
    )
    await flush()
    expect(page.failedLoads()).toEqual([{ url: chunkUrl, error: 'net::ERR_EMPTY_RESPONSE' }])
  })

  it('keeps them once the page can no longer be used', async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    logLoad(browser, chunkUrl)
    browser.emit('Inspector.targetCrashed', {}, sessionId)
    await flush()
    await expect(page.evaluate('1', 1000)).rejects.toMatchObject({ name: 'PageCrashedError' })
    expect(page.failedLoads()).toEqual([{ url: chunkUrl, error: 'net::ERR_EMPTY_RESPONSE' }])
  })
})
