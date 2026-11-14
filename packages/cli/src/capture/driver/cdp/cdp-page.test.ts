import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Driver, type Page, PageLoadError, PageTimeoutError } from '../driver.js'
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
 * carries loader `loader-1`: where a server redirect landed, or a document whose security origin the test chooses.
 */
function navigateCommitting(frame: Record<string, unknown>): CommandHandler {
  return (command: ReceivedCommand, fake: FakeBrowser) => {
    fake.emit('Page.frameNavigated', { frame }, sessionId)
    fake.reply(command, { frameId: targetId, loaderId: 'loader-1' })
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

afterEach(() => {
  vi.useRealTimers()
})

describe('Driver.newPage', () => {
  it('opens a target in a fresh browser context and attaches to it in a flat session', async () => {
    const { browser } = await openPage()

    expect(sent(browser).slice(1, 4)).toEqual([
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

    expect(sent(browser).slice(4)).toEqual([
      { method: 'Page.enable', params: {}, sessionId },
      { method: 'Inspector.enable', params: {}, sessionId },
      {
        method: 'Page.setFontFamilies',
        params: {
          fontFamilies: {
            standard: 'Times New Roman',
            fixed: 'Monospace',
            serif: 'Times New Roman',
            sansSerif: 'Arial',
            cursive: 'Comic Sans MS',
            fantasy: 'Impact',
          },
        },
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

    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
    await page.goto(storyUrl, 1000)
    await page.evaluate('document.title', 1000)
    await page.captureFullPage()
    await page.clearStorage()
    await page.close()
    expect(new Set(browser.received.map((command) => command.method))).toEqual(
      new Set([
        'Browser.getVersion',
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

    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
    await page.goto(storyUrl, 1000)
    await expect(page.evaluate('fail()', 1000)).rejects.toThrow()
    await page.captureFullPage()
    await page.clearStorage()
    await page.close()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Page.setViewport', () => {
  it('overrides the device metrics with the viewport as the screen, not mobile', async () => {
    const { browser, page } = await openPage()

    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 })
    expect(sentOf(browser, 'Emulation.setDeviceMetricsOverride')).toEqual([
      {
        method: 'Emulation.setDeviceMetricsOverride',
        params: { width: 1280, height: 720, deviceScaleFactor: 2, mobile: false, screenWidth: 1280, screenHeight: 720 },
        sessionId,
      },
    ])
  })
})

describe('the 30 s limit on a page call', () => {
  it.each([
    [
      'setViewport',
      'Emulation.setDeviceMetricsOverride',
      (page: Page) => page.setViewport({ width: 1, height: 1, deviceScaleFactor: 1 }),
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
    'fails %s with a PageTimeoutError when the browser stays silent for 30 s',
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

  it('clears the origin a server redirect took the main frame to', async () => {
    const landed = mainFrame(targetId, 'https://www.storybook.test/iframe.html?id=button--primary', 'loader-1')
    const { browser, page } = await openPage({ handlers: { 'Page.navigate': navigateCommitting(landed) } })

    await page.goto(storyUrl, 1000)
    await page.clearStorage()
    expect(storageCommands(browser)).toEqual([clearCookies, ...clearOriginCommands('https://www.storybook.test')])
  })

  it.each([['http://elsewhere:7000/'], ['about:blank'], ['data:text/html,away']])(
    'fails at once, sending nothing, when the page left the document its goto loaded for %s',
    async (url) => {
      const { browser, page } = await openPage()

      await page.goto(storyUrl, 1000)
      browser.emit('Page.frameNavigated', { frame: mainFrame(targetId, url, 'loader-9') }, sessionId)
      await flush()
      await expect(page.clearStorage()).rejects.toThrow('The page left the document its last goto loaded.')
      expect(storageCommands(browser)).toEqual([])
    },
  )

  it('clears the origin again once a goto has loaded another document after the page left one', async () => {
    const { browser, page } = await openPage()

    await page.goto(storyUrl, 1000)
    browser.emit('Page.frameNavigated', { frame: mainFrame(targetId, 'http://elsewhere:7000/', 'loader-9') }, sessionId)
    await flush()
    await page.goto(storyUrl, 1000)
    await page.clearStorage()
    expect(storageCommands(browser)).toEqual([clearCookies, ...clearOriginCommands(storyOrigin)])
  })

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

  it('fails a goto in flight and every later call at once with a PageCrashedError', async () => {
    const { browser, page } = await openPage({
      handlers: {
        'Page.navigate': (_command: ReceivedCommand, fake: FakeBrowser) =>
          fake.emit('Inspector.targetCrashed', {}, sessionId),
      },
    })

    await expect(page.goto(storyUrl, 60_000)).rejects.toMatchObject({ name: 'PageCrashedError' })
    await expect(page.evaluate('1', 60_000)).rejects.toMatchObject({ name: 'PageCrashedError' })
    await expect(page.setViewport({ width: 1, height: 1, deviceScaleFactor: 1 })).rejects.toMatchObject({
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
