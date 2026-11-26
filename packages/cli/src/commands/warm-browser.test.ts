import { describe, expect, it } from 'vitest'
import { BrowserMismatchError } from '../browser/browser-version.js'
import { BrowserExitedError, type Driver, type Page, type PageSetup } from '../capture/driver/driver.js'
import { answerEvaluate } from '../capture/fake-driver.fixture.js'
import type { BrowserLaunch, LaunchBrowser } from './launch-browser.js'
import { type RunBrowser, runBrowserOf } from './run-browser.js'
import { createWarmBrowser, launchKeyOf, type WarmBrowser } from './warm-browser.js'

/**
 * A launch in visual-check's container.
 */
type ContainerLaunch = Extract<BrowserLaunch, { in: 'container' }>

/**
 * The launch most tests make.
 */
const launch: ContainerLaunch = {
  in: 'container',
  image: 'ghcr.io/visual-check/chromium@sha256:abc',
  platform: 'linux/amd64',
  route: 'host',
  executable: '/opt/chromium/chrome-headless-shell',
  progress: () => undefined,
}

/**
 * A launch on the host.
 */
const hostLaunch: Extract<BrowserLaunch, { in: 'host' }> = {
  in: 'host',
  platform: 'linux64',
  version: '157.0.8103.78',
  sha256: '1'.repeat(64),
  packageVersion: '157.0.0',
  environment: { VISUAL_CHECK_CACHE_DIR: '/cache/visual-check' },
  progress: () => undefined,
}

/**
 * How every test sets its pages up.
 */
const setup: PageSetup = {
  userAgentSuffix: '',
  timezone: 'UTC',
  locale: 'en-US',
  colorScheme: 'light',
  initScript: '',
  watchRequests: false,
}

/**
 * What a click's signal aborts with.
 */
const reason = new Error('The check was cancelled.')

/**
 * Makes a promise and the functions that settle it.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

/**
 * A fake browser the test makes exit, or makes open its pages late.
 */
interface FakeBrowser {
  /**
   * The browser's driver.
   */
  driver: Driver
  /**
   * How many of its pages are open.
   */
  openPages: number
  /**
   * How many times its driver was closed.
   */
  closes: number
  /**
   * Makes the browser exit: every later call on it fails with the exit, and `exited` settles with it unless `seen` is
   * false.
   */
  exit: (seen?: boolean) => void
  /**
   * Holds every page it opens until the function it gives is called.
   */
  holdPages: () => () => void
}

/**
 * Builds a fake browser of the given version, which captures every story well until it exits.
 */
function fakeBrowserOf(version = '157.0.8103.78'): FakeBrowser {
  const exited = deferred<BrowserExitedError>()
  let gone: BrowserExitedError | undefined
  let opening: Promise<void> = Promise.resolve()
  const failIfGone = async (): Promise<void> => {
    if (gone !== undefined) {
      throw gone
    }
  }
  const pageOf = (): Page => {
    let closing: Promise<void> | undefined

    return {
      setViewport: failIfGone,
      growViewportToContent: async () => {
        await failIfGone()

        return false
      },
      goto: failIfGone,
      evaluate: async (expression, timeoutMs) => {
        await failIfGone()

        return await answerEvaluate({}, expression, timeoutMs)
      },
      capture: async () => {
        await failIfGone()

        return new Uint8Array([0x89, 0x50, 0x4e, 0x47])
      },
      clearStorage: failIfGone,
      close: () => {
        closing ??= Promise.resolve().then(() => {
          browser.openPages -= 1
        })

        return closing
      },
      requestHosts: () => [],
      consoleMessages: () => [],
    }
  }
  const browser: FakeBrowser = {
    driver: {
      version,
      exited: exited.promise,
      newPage: async () => {
        if (browser.closes > 0) {
          throw new Error("The browser is closing, so it can't open a page.")
        }

        await opening
        await failIfGone()
        browser.openPages += 1

        return pageOf()
      },
      close: async () => {
        browser.closes += 1
      },
    },
    openPages: 0,
    closes: 0,
    exit: (seen = true) => {
      gone = new BrowserExitedError({ code: 137, signal: null, error: undefined }, ['Out of memory'])

      if (seen) {
        exited.resolve(gone)
      }
    },
    holdPages: () => {
      const held = deferred<void>()

      opening = held.promise

      return held.resolve
    },
  }

  return browser
}

/**
 * A warm browser over a fake launcher, and what that launcher saw.
 */
interface FakeWarmBrowser {
  /**
   * The warm browser.
   */
  warm: WarmBrowser
  /**
   * Every launch that reached the launcher, in order.
   */
  launches: BrowserLaunch[]
}

/**
 * Makes a warm browser whose launches give `browsers` in order: a fake browser, a promise of one, which launches once it
 * settles, or an error, which fails the launch.
 */
function warmBrowserWith(...browsers: (FakeBrowser | Promise<FakeBrowser> | Error)[]): FakeWarmBrowser {
  const launches: BrowserLaunch[] = []
  const warm = createWarmBrowser(async (launched) => {
    const next = browsers[launches.length]

    launches.push(launched)

    if (next === undefined) {
      throw new Error('The test launched more browsers than it gave.')
    }

    if (next instanceof Error) {
      throw next
    }

    return (await next).driver
  })

  return { warm, launches }
}

/**
 * Gives the launcher of a click that's never cancelled.
 */
function clickOf(warm: WarmBrowser): LaunchBrowser {
  return warm.launcherFor(new AbortController().signal)
}

/**
 * Writes progress as the launch does.
 */
function printProgressOf(launched: BrowserLaunch | undefined, text: string): void {
  if (launched !== undefined && 'progress' in launched) {
    launched.progress(text)
  }
}

/**
 * Waits until every callback already queued has run, such as the warm browser seeing a driver's `exited` settle.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('launchKeyOf', () => {
  it('is the same whatever the progress, the signal and the environment are', () => {
    expect(launchKeyOf({ ...launch, progress: () => 1, signal: AbortSignal.abort() })).toBe(launchKeyOf(launch))
    expect(launchKeyOf({ ...hostLaunch, environment: {} })).toBe(launchKeyOf(hostLaunch))
  })

  it.each<[string, BrowserLaunch]>([
    ['the place', hostLaunch],
    ['the image', { ...launch, image: 'ghcr.io/acme/chromium:1' }],
    ['the platform', { ...launch, platform: 'linux/arm64' }],
    ['the route', { ...launch, route: 'proxy' }],
    ['the executable', { ...launch, executable: '/opt/other' }],
  ])('differs with %s', (_field, other) => {
    expect(launchKeyOf(other)).not.toBe(launchKeyOf(launch))
  })

  it('differs with the version and the checksum of the download', () => {
    expect(launchKeyOf({ ...hostLaunch, version: '158.0.0.1' })).not.toBe(launchKeyOf(hostLaunch))
    expect(launchKeyOf({ ...hostLaunch, sha256: '2'.repeat(64) })).not.toBe(launchKeyOf(hostLaunch))
  })
})

describe('createWarmBrowser', () => {
  it('launches one browser for two clicks, with the progress of the click that started it', async () => {
    const { warm, launches } = warmBrowserWith(fakeBrowserOf())
    const printed: string[] = []
    const controller = new AbortController()

    expect(launches).toEqual([])

    const first = await warm.launcherFor(controller.signal)({ ...launch, progress: (text) => printed.push(text) })
    const second = await clickOf(warm)(launch)

    expect(launches).toEqual([{ ...launch, progress: expect.any(Function), signal: controller.signal }])
    printProgressOf(launches[0], 'Pulling')
    expect(printed).toEqual(['Pulling'])
    expect(first.version).toBe('157.0.8103.78')
    expect(second.version).toBe('157.0.8103.78')
  })

  it('gives the signal to a launch in the container only', async () => {
    const { warm, launches } = warmBrowserWith(fakeBrowserOf(), fakeBrowserOf())

    await clickOf(warm)(hostLaunch)
    await clickOf(warm)({ in: 'image', executable: launch.executable })

    expect(launches).toEqual([
      { ...hostLaunch, progress: expect.any(Function) },
      { in: 'image', executable: launch.executable },
    ])
  })

  it.each<[string, Exclude<BrowserLaunch, { in: 'image' }>]>([
    ['in the container', launch],
    ['on the host', hostLaunch],
  ])('drops the progress of a launch %s once its click has aborted', async (_place, launched) => {
    const { warm, launches } = warmBrowserWith(deferred<FakeBrowser>().promise)
    const printed: string[] = []
    const controller = new AbortController()
    const abandoned = warm.launcherFor(controller.signal)({ ...launched, progress: (text) => printed.push(text) })

    await settle()
    printProgressOf(launches[0], 'in time')
    controller.abort(reason)
    printProgressOf(launches[0], 'late')

    await expect(abandoned).rejects.toBe(reason)
    expect(printed).toEqual(['in time'])
  })

  it("closes the click's pages when its driver is closed, and leaves the browser running", async () => {
    const browser = fakeBrowserOf()
    const { warm } = warmBrowserWith(browser)
    const first = await clickOf(warm)(launch)
    const second = await clickOf(warm)(launch)

    await first.newPage(setup)
    await first.newPage(setup)
    await second.newPage(setup)
    await first.close()

    expect(browser.openPages).toBe(1)
    expect(browser.closes).toBe(0)
    await expect(first.newPage(setup)).rejects.toThrow("The browser is closing, so it can't open a page.")
    expect(browser.openPages).toBe(1)
    await second.newPage(setup)
    expect(browser.openPages).toBe(2)
  })

  it('launches again for the next click when the browser exited between clicks, and closes the exited one', async () => {
    const first = fakeBrowserOf()
    const second = fakeBrowserOf()
    const { warm, launches } = warmBrowserWith(first, second)

    const firstClick = await clickOf(warm)(launch)

    await firstClick.newPage(setup)
    await firstClick.close()
    first.exit()
    await settle()
    expect(first.closes).toBe(1)

    const driver = await clickOf(warm)(launch)

    await driver.newPage(setup)
    expect(second.openPages).toBe(1)
    expect(launches).toHaveLength(2)
  })

  it("rejects a page with the browser's exit once it has exited, though the browser is closed by then", async () => {
    const browser = fakeBrowserOf()
    const { warm } = warmBrowserWith(browser)
    const driver = await clickOf(warm)(launch)

    await driver.newPage(setup)
    browser.exit()
    await settle()

    expect(browser.closes).toBe(1)
    await expect(driver.newPage(setup)).rejects.toBe(await driver.exited)
  })

  it('never gives a click the browser it already got, even when its exit has not been seen', async () => {
    const first = fakeBrowserOf()
    const second = fakeBrowserOf()
    const { warm, launches } = warmBrowserWith(first, second)
    const click = clickOf(warm)
    const exited = await click(launch)

    first.exit(false)
    await expect(exited.newPage(setup)).rejects.toBeInstanceOf(BrowserExitedError)

    const driver = await click(launch)

    await driver.newPage(setup)
    expect(second.openPages).toBe(1)
    expect(first.closes).toBe(1)
    expect(launches).toHaveLength(2)

    const next = await clickOf(warm)(launch)

    await next.newPage(setup)
    expect(second.openPages).toBe(2)
  })

  it('closes the kept browser before it launches one that differs', async () => {
    const first = fakeBrowserOf()
    const closesAtLaunch: number[] = []
    const launcher = createWarmBrowser(async () => {
      closesAtLaunch.push(first.closes)

      return closesAtLaunch.length === 1 ? first.driver : fakeBrowserOf().driver
    })

    await clickOf(launcher)(launch)
    await clickOf(launcher)({ ...launch, platform: 'linux/arm64' })

    expect(closesAtLaunch).toEqual([0, 1])
  })

  it('keeps nothing after a failed launch, so the next click launches again', async () => {
    const error = new Error('docker pull failed.')
    const browser = fakeBrowserOf()
    const { warm, launches } = warmBrowserWith(error, browser)

    await expect(clickOf(warm)(launch)).rejects.toBe(error)
    await (await clickOf(warm)(launch)).newPage(setup)

    expect(launches).toHaveLength(2)
    expect(browser.openPages).toBe(1)
  })

  it('rejects at once when aborted during a launch, and keeps the browser once it connects', async () => {
    const launching = deferred<FakeBrowser>()
    const browser = fakeBrowserOf()
    const { warm, launches } = warmBrowserWith(launching.promise)
    const controller = new AbortController()
    const abandoned = warm.launcherFor(controller.signal)(launch)

    await settle()
    controller.abort(reason)
    await expect(abandoned).rejects.toBe(reason)

    const next = clickOf(warm)(launch)

    launching.resolve(browser)
    await (await next).newPage(setup)
    expect(launches).toHaveLength(1)
    expect(browser.openPages).toBe(1)
    expect(browser.closes).toBe(0)
  })

  it("launches for the next click when the abandoned launch failed, without that click seeing the launch's error", async () => {
    const launching = deferred<FakeBrowser>()
    const browser = fakeBrowserOf()
    const { warm, launches } = warmBrowserWith(launching.promise, browser)
    const controller = new AbortController()
    const abandoned = warm.launcherFor(controller.signal)(launch)

    await settle()
    controller.abort(reason)

    const next = clickOf(warm)(launch)

    launching.reject(reason)
    await expect(abandoned).rejects.toBe(reason)
    await (await next).newPage(setup)
    expect(launches).toHaveLength(2)
    expect(browser.openPages).toBe(1)
  })

  it('closes the browser when a click closes its driver before it opened a page, and waits for it', async () => {
    const first = fakeBrowserOf()
    const second = fakeBrowserOf()
    const { warm, launches } = warmBrowserWith(first, second)
    const closing = deferred<void>()
    let closed = false

    first.driver.close = () => closing.promise

    const driver = await clickOf(warm)(launch)
    const leaseClosing = driver.close().then(() => {
      closed = true
    })
    const next = clickOf(warm)(launch)

    await settle()
    expect(closed).toBe(false)
    expect(launches).toHaveLength(1)
    closing.resolve()
    await leaseClosing
    await (await next).newPage(setup)
    expect(second.openPages).toBe(1)
    expect(launches).toHaveLength(2)
  })

  it("leaves the browser that replaced it when a click's unused driver closes late", async () => {
    const first = fakeBrowserOf()
    const second = fakeBrowserOf()
    const { warm, launches } = warmBrowserWith(first, second)
    const unused = await clickOf(warm)(launch)

    first.exit()
    await settle()
    await clickOf(warm)(launch)
    await unused.close()

    expect(second.closes).toBe(0)
    await (await clickOf(warm)(launch)).newPage(setup)
    expect(launches).toHaveLength(2)
  })

  it('keeps the browser when the click aborts before it opened a page', async () => {
    const browser = fakeBrowserOf()
    const { warm, launches } = warmBrowserWith(browser)
    const controller = new AbortController()
    const driver = await warm.launcherFor(controller.signal)(launch)

    controller.abort(reason)
    await driver.close()
    await clickOf(warm)(launch)

    expect(browser.closes).toBe(0)
    expect(launches).toHaveLength(1)
  })

  it('launches nothing and keeps the browser when the click has already aborted', async () => {
    const browser = fakeBrowserOf()
    const { warm, launches } = warmBrowserWith(browser)

    await clickOf(warm)(launch)

    const aborted = warm.launcherFor(AbortSignal.abort(reason))

    await expect(aborted({ ...launch, platform: 'linux/arm64' })).rejects.toBe(reason)
    expect(launches).toHaveLength(1)
    expect(browser.closes).toBe(0)
  })

  it("closes the click's pages when aborted during captures, one that opens afterwards too", async () => {
    const browser = fakeBrowserOf()
    const { warm } = warmBrowserWith(browser)
    const controller = new AbortController()
    const driver = await warm.launcherFor(controller.signal)(launch)

    await driver.newPage(setup)

    const releasePages = browser.holdPages()
    const pending = driver.newPage(setup)

    controller.abort(reason)
    await settle()
    expect(browser.openPages).toBe(0)

    releasePages()
    await expect(pending).rejects.toThrow("The browser is closing, so it can't open a page.")
    expect(browser.openPages).toBe(0)
    expect(browser.closes).toBe(0)
  })

  it('launches nothing when the click aborts while the browser that differs closes', async () => {
    const first = fakeBrowserOf()
    const { warm, launches } = warmBrowserWith(first, fakeBrowserOf())
    const closing = deferred<void>()
    const controller = new AbortController()

    first.driver.close = () => closing.promise
    await clickOf(warm)(hostLaunch)

    const aborted = warm.launcherFor(controller.signal)({ ...hostLaunch, version: '158.0.0.1' })

    await settle()
    controller.abort(reason)
    await expect(aborted).rejects.toBe(reason)
    closing.resolve()
    await warm.close()
    expect(launches).toHaveLength(1)
  })

  it('launches nothing when it is closed while the browser that differs closes', async () => {
    const first = fakeBrowserOf()
    const { warm, launches } = warmBrowserWith(first, fakeBrowserOf())
    const closing = deferred<void>()

    first.driver.close = () => closing.promise
    await clickOf(warm)(hostLaunch)

    const next = clickOf(warm)({ ...hostLaunch, version: '158.0.0.1' })
    const refused = expect(next).rejects.toThrow("The browser is closing, so it can't be launched.")

    await settle()

    const warmClosing = warm.close()

    closing.resolve()
    await warmClosing
    await refused
    expect(launches).toHaveLength(1)
  })

  it('closes the browser once, and launches nothing afterwards', async () => {
    const browser = fakeBrowserOf()
    const { warm, launches } = warmBrowserWith(browser)

    await clickOf(warm)(launch)

    const closing = warm.close()

    expect(warm.close()).toBe(closing)
    await expect(clickOf(warm)(launch)).rejects.toThrow("The browser is closing, so it can't be launched.")
    await closing
    expect(browser.closes).toBe(1)
    expect(launches).toHaveLength(1)
  })

  it('waits for a launch in flight when it closes, and closes the browser that connects', async () => {
    const launching = deferred<FakeBrowser>()
    const browser = fakeBrowserOf()
    const { warm } = warmBrowserWith(launching.promise)
    const controller = new AbortController()
    const abandoned = warm.launcherFor(controller.signal)(launch)
    let closed = false

    await settle()
    controller.abort(reason)
    await expect(abandoned).rejects.toBe(reason)

    const closing = warm.close().then(() => {
      closed = true
    })

    await settle()
    expect(closed).toBe(false)
    launching.resolve(browser)
    await closing
    expect(browser.closes).toBe(1)
  })
})

describe('runBrowserOf over a warm browser', () => {
  /**
   * Prepares a click's run browser over the warm browser.
   */
  const runBrowserOn = (warm: WarmBrowser, chromium = '157.0.8103.78'): RunBrowser =>
    runBrowserOf(clickOf(warm), {
      browserPackage: {
        packageVersion: '157.0.0',
        chromium,
        image: { tag: 'ghcr.io/visual-check/chromium:157.0.0', digest: 'sha256:0' },
        headlessShell: '/opt/chromium/chrome-headless-shell',
        sha256: { linux64: '', 'linux-arm64': '', 'mac-x64': '', 'mac-arm64': '', win64: '' },
      },
      configImage: undefined,
      place: { in: 'image' },
      environment: {},
      settings: {
        readyTimeoutMs: 15_000,
        timezone: 'UTC',
        locale: 'en-US',
        colorScheme: 'light',
        maskColor: '#FF00FF',
        listHosts: false,
        brokenImageTimeLimitMs: 5_000,
      },
      progress: () => undefined,
    })

  /**
   * Captures a story in the click's run browser.
   */
  const captureIn = (browser: RunBrowser): ReturnType<RunBrowser['capture']> =>
    browser.capture(0, {
      id: 'a',
      url: 'http://127.0.0.1:6006/iframe.html?id=a&viewMode=story',
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1, touch: false },
    })

  it('closes a browser of another build, so the next click launches anew', async () => {
    const wrong = fakeBrowserOf('156.0.0.1')
    const right = fakeBrowserOf()
    const { warm, launches } = warmBrowserWith(wrong, right)

    await expect(captureIn(runBrowserOn(warm))).rejects.toBeInstanceOf(BrowserMismatchError)
    expect(wrong.closes).toBe(1)
    expect(await captureIn(runBrowserOn(warm))).toHaveProperty('snapshot')
    expect(launches).toHaveLength(2)
  })

  it('closes a browser that served earlier clicks once it is of another build', async () => {
    const old = fakeBrowserOf()
    const updated = fakeBrowserOf('158.0.0.1')
    const { warm, launches } = warmBrowserWith(old, updated)
    const firstClick = runBrowserOn(warm)

    expect(await captureIn(firstClick)).toHaveProperty('snapshot')
    await firstClick.close()
    expect(old.closes).toBe(0)
    await expect(captureIn(runBrowserOn(warm, '158.0.0.1'))).rejects.toBeInstanceOf(BrowserMismatchError)
    expect(old.closes).toBe(1)
    expect(await captureIn(runBrowserOn(warm, '158.0.0.1'))).toHaveProperty('snapshot')
    expect(launches).toHaveLength(2)
  })

  it('launches anew, not as a relaunch, when the browser exited between clicks', async () => {
    const [first, second, third] = [fakeBrowserOf(), fakeBrowserOf(), fakeBrowserOf()]
    const { warm, launches } = warmBrowserWith(first, second, third)
    const firstClick = runBrowserOn(warm)

    expect(await captureIn(firstClick)).toHaveProperty('snapshot')
    await firstClick.close()
    first.exit()
    await settle()

    const secondClick = runBrowserOn(warm)

    expect(await captureIn(secondClick)).toHaveProperty('snapshot')
    expect(secondClick.firstExit()).toBeUndefined()
    expect(launches).toHaveLength(2)
    second.exit()
    await settle()
    expect(await captureIn(secondClick)).toHaveProperty('snapshot')
    expect(secondClick.firstExit()).toMatchObject({ relaunched: true })
    expect(launches).toHaveLength(3)
  })

  it('relaunches once in each click, counting exits per click', async () => {
    const [first, second, third] = [fakeBrowserOf(), fakeBrowserOf(), fakeBrowserOf()]
    const { warm, launches } = warmBrowserWith(first, second, third)
    const firstClick = runBrowserOn(warm)

    expect(await captureIn(firstClick)).toHaveProperty('snapshot')
    first.exit()
    await settle()
    expect(await captureIn(firstClick)).toHaveProperty('snapshot')
    expect(firstClick.firstExit()).toMatchObject({ relaunched: true })
    expect(launches).toHaveLength(2)
    await firstClick.close()

    const secondClick = runBrowserOn(warm)

    expect(await captureIn(secondClick)).toHaveProperty('snapshot')
    expect(launches).toHaveLength(2)
    expect(secondClick.firstExit()).toBeUndefined()
    second.exit()
    await settle()
    expect(await captureIn(secondClick)).toHaveProperty('snapshot')
    expect(secondClick.firstExit()).toMatchObject({ relaunched: true })
    expect(launches).toHaveLength(3)
    await secondClick.close()
    expect(third.openPages).toBe(0)
    expect(third.closes).toBe(0)
  })
})
