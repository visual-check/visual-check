import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type BrowserSystem, type Driver, type Page, PageLoadError, PageTimeoutError } from '../driver.js'
import { launchCdpDriver } from './cdp-driver.js'
import {
  type CommandHandler,
  childFrame,
  defaultCaptureData,
  defaultVersionReply,
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
 * The fonts a page on Linux uses.
 */
const linuxFonts = {
  standard: 'Times New Roman',
  fixed: 'Monospace',
  serif: 'Times New Roman',
  sansSerif: 'Arial',
  cursive: 'Comic Sans MS',
  fantasy: 'Impact',
}

/**
 * A command as the tests compare it: without its id.
 */
type SentCommand = Omit<ReceivedCommand, 'id'>

/**
 * Launches a driver on a fake browser with these options.
 */
async function launch(
  options: FakeBrowserOptions = {},
  system: BrowserSystem = 'linux',
): Promise<{ browser: FakeBrowser; driver: Driver }> {
  const browser = new FakeBrowser(options)
  const driver = await launchCdpDriver({
    sandbox: false,
    profileDir: '/tmp/visual-check-profile',
    system,
    start: browser.start,
  })

  return { browser, driver }
}

/**
 * Launches a driver on a fake browser with these options and opens a page with the tests' setup.
 */
async function openPage(
  options: FakeBrowserOptions = {},
  system: BrowserSystem = 'linux',
): Promise<{ browser: FakeBrowser; page: Page }> {
  const { browser, driver } = await launch(options, system)

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
 * A phone-sized viewport with touch.
 */
const touchViewport = { width: 375, height: 667, deviceScaleFactor: 2, touch: true }

/**
 * Answers `Page.getLayoutMetrics` with this content size.
 */
function layoutOf(cssContentSize: Record<string, number>): CommandHandler {
  return (command: ReceivedCommand, fake: FakeBrowser) => fake.reply(command, { cssContentSize })
}

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

  it('sets the page up once, in its session, with the Linux fonts and no per-script ones', async () => {
    const { browser } = await openPage()

    expect(sent(browser).slice(5)).toEqual([
      { method: 'Page.enable', params: {}, sessionId },
      { method: 'Inspector.enable', params: {}, sessionId },
      {
        method: 'Page.setFontFamilies',
        params: { fontFamilies: linuxFonts },
        sessionId,
      },
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
      {
        method: 'Page.addScriptToEvaluateOnNewDocument',
        params: { source: 'window.__visualCheck = true' },
        sessionId,
      },
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

  it("sets macOS's fonts, with its per-script fonts", async () => {
    const { browser } = await openPage({}, 'macos')

    expect(sentOf(browser, 'Page.setFontFamilies')).toEqual([
      {
        method: 'Page.setFontFamilies',
        params: {
          fontFamilies: {
            standard: 'Times',
            fixed: 'Courier',
            serif: 'Times',
            sansSerif: 'Helvetica',
            cursive: 'Apple Chancery',
            fantasy: 'Papyrus',
          },
          forScripts: [
            {
              script: 'jpan',
              fontFamilies: {
                standard: 'Hiragino Kaku Gothic ProN',
                fixed: 'Osaka-Mono',
                serif: 'Hiragino Mincho ProN',
                sansSerif: 'Hiragino Kaku Gothic ProN',
              },
            },
            {
              script: 'hang',
              fontFamilies: {
                standard: 'Apple SD Gothic Neo',
                serif: 'AppleMyungjo',
                sansSerif: 'Apple SD Gothic Neo',
              },
            },
            {
              script: 'hans',
              fontFamilies: {
                standard: ',PingFang SC,STHeiti',
                serif: 'Songti SC',
                sansSerif: ',PingFang SC,STHeiti',
                cursive: 'Kaiti SC',
              },
            },
            {
              script: 'hant',
              fontFamilies: {
                standard: ',PingFang TC,Heiti TC',
                serif: 'Songti TC',
                sansSerif: ',PingFang TC,Heiti TC',
                cursive: 'Kaiti TC',
              },
            },
          ],
        },
        sessionId,
      },
    ])
  })

  it("sets Windows's fonts, with its per-script fonts", async () => {
    const { browser } = await openPage({}, 'windows')

    expect(sentOf(browser, 'Page.setFontFamilies')).toEqual([
      {
        method: 'Page.setFontFamilies',
        params: {
          fontFamilies: {
            standard: 'Times New Roman',
            fixed: 'Consolas',
            serif: 'Times New Roman',
            sansSerif: 'Arial',
            cursive: 'Comic Sans MS',
            fantasy: 'Impact',
          },
          forScripts: [
            {
              script: 'cyrl',
              fontFamilies: {
                standard: 'Times New Roman',
                fixed: 'Courier New',
                serif: 'Times New Roman',
                sansSerif: 'Arial',
              },
            },
            { script: 'arab', fontFamilies: { fixed: 'Courier New', sansSerif: 'Segoe UI' } },
            {
              script: 'grek',
              fontFamilies: {
                standard: 'Times New Roman',
                fixed: 'Courier New',
                serif: 'Times New Roman',
                sansSerif: 'Arial',
              },
            },
            {
              script: 'jpan',
              fontFamilies: {
                standard: ',Meiryo,Yu Gothic',
                fixed: 'MS Gothic',
                serif: ',Yu Mincho,MS PMincho',
                sansSerif: ',Meiryo,Yu Gothic',
              },
            },
            {
              script: 'hang',
              fontFamilies: {
                standard: 'Malgun Gothic',
                fixed: 'Gulimche',
                serif: 'Batang',
                sansSerif: 'Malgun Gothic',
                cursive: 'Gungsuh',
              },
            },
            {
              script: 'hans',
              fontFamilies: {
                standard: 'Microsoft YaHei',
                fixed: 'NSimsun',
                serif: 'Simsun',
                sansSerif: 'Microsoft YaHei',
                cursive: 'KaiTi',
              },
            },
            {
              script: 'hant',
              fontFamilies: {
                standard: 'Microsoft JhengHei',
                fixed: 'MingLiU',
                serif: 'PMingLiU',
                sansSerif: 'Microsoft JhengHei',
                cursive: 'DFKai-SB',
              },
            },
          ],
        },
        sessionId,
      },
    ])
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
  it('turns on no Network, Runtime, Log, lifecycle events or request interception through a whole capture', async () => {
    const { browser, page } = await openPage()

    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1, touch: false })
    await page.goto(storyUrl, 1000)
    await page.evaluate('document.title', 1000)
    await page.captureFullPage()
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
        'Page.setFontFamilies',
        'Emulation.setUserAgentOverride',
        'Emulation.setTimezoneOverride',
        'Emulation.setLocaleOverride',
        'Emulation.setEmulatedMedia',
        'Emulation.setFocusEmulationEnabled',
        'Page.addScriptToEvaluateOnNewDocument',
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
    await page.captureFullPage()
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
      'captureFullPage',
      'Page.captureScreenshot',
      (page: Page) => page.captureFullPage(),
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

describe('Page.captureFullPage', () => {
  it('keeps no hold on the bytes it returned while the page stays open', async () => {
    const data = Buffer.alloc(1024 * 1024, 7).toString('base64')
    const { page } = await openPage({
      handlers: {
        'Page.captureScreenshot': (command: ReceivedCommand, fake: FakeBrowser) => fake.reply(command, { data }),
      },
    })
    const bytes = new WeakRef(await page.captureFullPage())

    await flush()
    collectGarbage()
    expect(bytes.deref()).toBeUndefined()
  })

  it('captures the whole content as PNG beyond the viewport, its size rounded up', async () => {
    const { browser, page } = await openPage({
      handlers: {
        'Page.getLayoutMetrics': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.reply(command, { cssContentSize: { x: 0, y: 0, width: 1280.2, height: 2400.5 } }),
      },
    })

    await page.captureFullPage()
    expect(sentOf(browser, 'Page.captureScreenshot')).toEqual([
      {
        method: 'Page.captureScreenshot',
        params: {
          format: 'png',
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: 1281, height: 2401, scale: 1 },
        },
        sessionId,
      },
    ])
  })

  it('resolves with the exact bytes the browser sent', async () => {
    const { page } = await openPage()
    const bytes = await page.captureFullPage()

    expect([...bytes]).toEqual([...Buffer.from(defaultCaptureData, 'base64')])
  })

  it.each([
    ['taller than', { x: 0, y: 0, width: 375, height: 3000 }],
    ['wider than', { x: 0, y: 0, width: 375.5, height: 667 }],
    ['the size of', { x: 0, y: 0, width: 375, height: 667 }],
  ])(
    'turns touch emulation back on behind the screenshot and after it when the content is %s a touch viewport',
    async (_shape, cssContentSize) => {
      const { browser, page } = await openPage({ handlers: { 'Page.getLayoutMetrics': layoutOf(cssContentSize) } })

      await page.setViewport(touchViewport)

      const sentBefore = browser.received.length

      await page.captureFullPage()
      expect(sent(browser).slice(sentBefore)).toEqual([
        { method: 'Page.getLayoutMetrics', params: {}, sessionId },
        expect.objectContaining({ method: 'Page.captureScreenshot' }),
        { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: true, maxTouchPoints: 5 }, sessionId },
        { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: true, maxTouchPoints: 5 }, sessionId },
      ])
    },
  )

  it('turns touch emulation back on right behind the screenshot command, and again once it is answered', async () => {
    const screenshots: ReceivedCommand[] = []
    const { browser, page } = await openPage({
      handlers: {
        'Page.getLayoutMetrics': layoutOf({ x: 0, y: 0, width: 375, height: 3000 }),
        'Page.captureScreenshot': (command: ReceivedCommand) => {
          screenshots.push(command)
        },
      },
    })

    await page.setViewport(touchViewport)

    const sentBefore = browser.received.length
    const capturing = page.captureFullPage()

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
        'Page.getLayoutMetrics': layoutOf({ x: 0, y: 0, width: 375, height: 3000 }),
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

    const capturing = page.captureFullPage()

    await flushUntil(() => held.length === 1 && browser.timesReceived('Page.captureScreenshot') === 1)
    await flush()
    expect(browser.timesReceived('Emulation.setTouchEmulationEnabled')).toBe(2)
    expect(await hasSettled(capturing)).toBe(false)

    browser.reply(held[0] as ReceivedCommand, {})
    await capturing
    expect(browser.timesReceived('Emulation.setTouchEmulationEnabled')).toBe(3)
  })

  it('sends nothing after the screenshot for a viewport without touch', async () => {
    const { browser, page } = await openPage({
      handlers: { 'Page.getLayoutMetrics': layoutOf({ x: 0, y: 0, width: 375, height: 3000 }) },
    })

    await page.setViewport({ width: 375, height: 667, deviceScaleFactor: 2, touch: false })

    const sentBefore = browser.received.length

    await page.captureFullPage()

    const methods = sent(browser)
      .slice(sentBefore)
      .map((command) => command.method)

    expect(methods).toEqual(['Page.getLayoutMetrics', 'Page.captureScreenshot'])
  })

  it('sends nothing after the screenshot once a viewport without touch replaced a touch one', async () => {
    const { browser, page } = await openPage({
      handlers: { 'Page.getLayoutMetrics': layoutOf({ x: 0, y: 0, width: 375, height: 3000 }) },
    })

    await page.setViewport(touchViewport)
    await page.setViewport({ ...touchViewport, touch: false })

    const sentBefore = browser.received.length

    await page.captureFullPage()

    const methods = sent(browser)
      .slice(sentBefore)
      .map((command) => command.method)

    expect(methods).toEqual(['Page.getLayoutMetrics', 'Page.captureScreenshot'])
  })

  it('sends nothing after the screenshot before any viewport is set', async () => {
    const { browser, page } = await openPage()

    await page.captureFullPage()
    expect(sentOf(browser, 'Emulation.setTouchEmulationEnabled')).toEqual([])
  })

  it.each([
    ['behind the screenshot', 2],
    ['after the screenshot', 3],
  ])('fails when the browser fails to turn touch emulation back on %s', async (_when, failingTime) => {
    const { page } = await openPage({
      handlers: {
        'Page.getLayoutMetrics': layoutOf({ x: 0, y: 0, width: 375, height: 3000 }),
        'Emulation.setTouchEmulationEnabled': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.timesReceived('Emulation.setTouchEmulationEnabled') === failingTime
            ? fake.fail(command, -32602, 'Touch points must be between 1 and 16')
            : fake.reply(command, {}),
      },
    })

    await page.setViewport(touchViewport)
    await expect(page.captureFullPage()).rejects.toThrow('Touch points must be between 1 and 16')
  })

  it.each([
    ['behind the screenshot', 2],
    ['after the screenshot', 3],
  ])(
    'fails with a PageTimeoutError when the browser stays silent on turning touch emulation back on %s',
    async (_when, silentTime) => {
      const { browser, page } = await openPage({
        handlers: {
          'Page.getLayoutMetrics': layoutOf({ x: 0, y: 0, width: 375, height: 3000 }),
          'Emulation.setTouchEmulationEnabled': (command: ReceivedCommand, fake: FakeBrowser) => {
            if (fake.timesReceived('Emulation.setTouchEmulationEnabled') !== silentTime) {
              fake.reply(command, {})
            }
          },
        },
      })

      await page.setViewport(touchViewport)
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      const capturing = page.captureFullPage()
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
        'Page.getLayoutMetrics': (command: ReceivedCommand, fake: FakeBrowser) => fake.reply(command, {}),
      },
    })

    await expect(page.captureFullPage()).rejects.toThrow(
      "The browser's answer to Page.getLayoutMetrics has no cssContentSize.",
    )
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
  ['captureFullPage', 'Page.captureScreenshot', (page: Page) => page.captureFullPage()],
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
      await expect(page.captureFullPage()).rejects.toMatchObject(failure)
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
    await expect(page.captureFullPage()).resolves.toBeDefined()
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
    await expect(page.captureFullPage()).resolves.toBeDefined()
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
    await expect(page.captureFullPage()).resolves.toBeDefined()
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
    await expect(page.captureFullPage()).resolves.toBeDefined()
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
    await expect(page.captureFullPage()).rejects.toMatchObject(navigatedAway(burgersUrl, nextStoryUrl))
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

    await expect(page.captureFullPage()).rejects.toMatchObject({ name: 'PageCrashedError' })
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
    await expect(page.captureFullPage()).rejects.toMatchObject({ name: 'PageCrashedError' })
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
    await expect(page.captureFullPage()).rejects.toMatchObject({ name: 'PageCrashedError' })
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
