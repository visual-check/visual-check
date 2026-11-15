import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserExitedError,
  type Driver,
  type Page,
  PageCrashedError,
  PageLoadError,
  type PageSetup,
  PageTimeoutError,
} from '../capture/driver/driver.js'
import { checkProxyReach } from './proxy-reach.js'
import type { SocksProxy } from './socks-proxy.js'

/**
 * A proxy that only names its port and check URL, which is all the check reads.
 */
const proxy: SocksProxy = {
  port: 40123,
  checkUrl: 'http://0123456789abcdef.visual-check.invalid/',
  close: async () => undefined,
}

/**
 * What the check says after the first line, which names the proxy and why the page didn't load: the tested runtimes and
 * the fix.
 */
const runtimeAdvice =
  "This Docker runtime doesn't give its containers host.docker.internal, its name for this machine. visual-check is " +
  'tested with OrbStack and Docker Desktop on Apple Silicon Macs, Colima on Intel Macs, Docker Desktop on Windows, ' +
  'and Docker Engine on Linux. Use one of them, then run visual-check again.'

/**
 * How the fake driver and its page behave.
 */
interface FakeBehaviour {
  /**
   * The error opening a page rejects with, or `undefined` to open one.
   */
  newPageError?: Error
  /**
   * The error loading a URL rejects with, or `undefined` to load it.
   */
  gotoError?: Error
  /**
   * The error closing the page rejects with, or `undefined` to close it.
   */
  closeError?: Error
  /**
   * The error the driver's `exited` settles with after `exitsAfterMs`, or `undefined` for a browser that stays up.
   */
  exits?: BrowserExitedError
  /**
   * How long after the fake is made `exits` settles, in milliseconds. 5 when not given.
   */
  exitsAfterMs?: number
}

/**
 * A fake driver, and what it saw.
 */
interface FakeDriver {
  /**
   * The driver.
   */
  driver: Driver
  /**
   * The setup of every page opened.
   */
  setups: PageSetup[]
  /**
   * The URL and time limit of every load, in order.
   */
  gotos: [string, number][]
  /**
   * How many times a page was closed.
   */
  pageCloses: number
  /**
   * Cancels the settling of `exited`, so no timer outlives the test.
   */
  cancelExit: () => void
}

/**
 * Builds a fake driver whose pages behave as `behaviour` says, and records what it was asked.
 */
function fakeDriverOf(behaviour: FakeBehaviour = {}): FakeDriver {
  let exitTimer: NodeJS.Timeout | undefined
  const fake: FakeDriver = {
    driver: {
      version: '157.0.8103.78',
      exited: new Promise<BrowserExitedError>((resolve) => {
        if (behaviour.exits !== undefined) {
          exitTimer = setTimeout(() => resolve(behaviour.exits as BrowserExitedError), behaviour.exitsAfterMs ?? 5)
        }
      }),
      newPage: async (setup) => {
        fake.setups.push(setup)

        if (behaviour.newPageError !== undefined) {
          throw behaviour.newPageError
        }

        return pageOf(fake, behaviour)
      },
      close: async () => undefined,
    },
    setups: [],
    gotos: [],
    pageCloses: 0,
    cancelExit: () => clearTimeout(exitTimer),
  }

  return fake
}

/**
 * Builds a page of the fake driver, which records its loads and closes there.
 */
function pageOf(fake: FakeDriver, behaviour: FakeBehaviour): Page {
  return {
    setViewport: async () => undefined,
    goto: async (url, timeoutMs) => {
      fake.gotos.push([url, timeoutMs])

      if (behaviour.gotoError !== undefined) {
        throw behaviour.gotoError
      }
    },
    evaluate: async () => undefined,
    capture: async () => new Uint8Array(),
    clearStorage: async () => undefined,
    close: async () => {
      fake.pageCloses += 1

      if (behaviour.closeError !== undefined) {
        throw behaviour.closeError
      }
    },
  }
}

/**
 * A browser that exited during the check.
 */
function browserExited(): BrowserExitedError {
  return new BrowserExitedError({ code: 133, signal: null, error: undefined }, ['qemu: uncaught target signal'])
}

afterEach(() => {
  vi.useRealTimers()
})

describe('checkProxyReach', () => {
  it("loads the proxy's check URL in one page with a neutral setup within 30 s, then closes the page", async () => {
    const fake = fakeDriverOf()

    await checkProxyReach(fake.driver, proxy)

    expect(fake.setups).toEqual([
      { userAgentSuffix: '', timezone: 'UTC', locale: 'en-US', colorScheme: 'light', initScript: '' },
    ])
    expect(fake.gotos).toEqual([[proxy.checkUrl, 30_000]])
    expect(fake.pageCloses).toBe(1)
  })

  it('loads the check URL within the time limit given', async () => {
    const fake = fakeDriverOf()

    await checkProxyReach(fake.driver, proxy, 500)

    expect(fake.gotos).toEqual([[proxy.checkUrl, 500]])
  })

  it("names the proxy, the network error and the tested runtimes when the page can't load, and closes it", async () => {
    const fake = fakeDriverOf({ gotoError: new PageLoadError(proxy.checkUrl, 'net::ERR_PROXY_CONNECTION_FAILED') })

    await expect(checkProxyReach(fake.driver, proxy, 500, 20)).rejects.toMatchObject({
      name: 'ContainerError',
      fix: 'tested-runtimes',
      message:
        "The browser can't reach visual-check's proxy at host.docker.internal:40123: " +
        `net::ERR_PROXY_CONNECTION_FAILED.\n${runtimeAdvice}`,
    })
    expect(fake.pageCloses).toBe(1)
  })

  it('names the time limit that passed when the page times out, and closes the page', async () => {
    const fake = fakeDriverOf({
      gotoError: new PageTimeoutError(`The page didn't load ${proxy.checkUrl} within 1.5 s.`, 1500),
    })

    await expect(checkProxyReach(fake.driver, proxy, 1500, 20)).rejects.toMatchObject({
      name: 'ContainerError',
      fix: 'tested-runtimes',
      message:
        "The browser can't reach visual-check's proxy at host.docker.internal:40123: no answer within 1.5 s.\n" +
        runtimeAdvice,
    })
    expect(fake.pageCloses).toBe(1)
  })

  it('rethrows a browser that exits while the page loads, and closes the page', async () => {
    const exited = browserExited()
    const fake = fakeDriverOf({ gotoError: exited })

    await expect(checkProxyReach(fake.driver, proxy)).rejects.toBe(exited)
    expect(fake.pageCloses).toBe(1)
  })

  it('rethrows a browser that exits before the page opens', async () => {
    const exited = browserExited()
    const fake = fakeDriverOf({ newPageError: exited })

    await expect(checkProxyReach(fake.driver, proxy)).rejects.toBe(exited)
    expect(fake.gotos).toEqual([])
    expect(fake.pageCloses).toBe(0)
  })

  it('fails the launch when the page crashes while it loads, and closes the page', async () => {
    const fake = fakeDriverOf({ gotoError: new PageCrashedError() })

    await expect(checkProxyReach(fake.driver, proxy, 500, 20)).rejects.toMatchObject({
      name: 'BrowserLaunchError',
      message: 'The browser failed while visual-check checked that it can reach the proxy: The page crashed.',
      output: [],
    })
    expect(fake.pageCloses).toBe(1)
  })

  it("fails the launch when the page doesn't open", async () => {
    const fake = fakeDriverOf({ newPageError: new Error("The browser didn't open a page within 30 s") })

    await expect(checkProxyReach(fake.driver, proxy, 500, 20)).rejects.toMatchObject({
      name: 'BrowserLaunchError',
      message:
        "The browser failed while visual-check checked that it can reach the proxy: The browser didn't open a page " +
        'within 30 s.',
      output: [],
    })
    expect(fake.pageCloses).toBe(0)
  })

  it.each([
    ['fails to load', new PageLoadError(proxy.checkUrl, 'net::ERR_PROXY_CONNECTION_FAILED')],
    ['times out', new PageTimeoutError(`The page didn't load ${proxy.checkUrl} within 0.5 s.`, 500)],
  ])(
    'gives the exit of a browser that exits shortly after the page %s, rather than blaming the runtime',
    async (_name, gotoError) => {
      const exited = browserExited()
      const fake = fakeDriverOf({ gotoError, exits: exited })

      await expect(checkProxyReach(fake.driver, proxy, 500, 1000)).rejects.toBe(exited)
      expect(fake.pageCloses).toBe(1)
    },
  )

  it('waits 2 s by default for the browser to exit before it blames the runtime', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const fake = fakeDriverOf({ gotoError: new PageLoadError(proxy.checkUrl, 'net::ERR_PROXY_CONNECTION_FAILED') })
    let failed = false
    const checking = checkProxyReach(fake.driver, proxy).catch((error: unknown) => {
      failed = true

      return error
    })

    await vi.advanceTimersByTimeAsync(1999)
    expect(failed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await checking).toMatchObject({ name: 'ContainerError' })
  })

  it('gives the exit of a browser that exits shortly after the page crashes, which carries its output', async () => {
    const exited = browserExited()
    const fake = fakeDriverOf({ gotoError: new PageCrashedError(), exits: exited })

    await expect(checkProxyReach(fake.driver, proxy, 500, 1000)).rejects.toBe(exited)
    expect(fake.pageCloses).toBe(1)
  })

  it("fails the launch when the browser exits only after the wait, which it doesn't outlast", async () => {
    const fake = fakeDriverOf({ gotoError: new PageCrashedError(), exits: browserExited(), exitsAfterMs: 500 })

    await expect(checkProxyReach(fake.driver, proxy, 500, 20)).rejects.toMatchObject({ name: 'BrowserLaunchError' })
    fake.cancelExit()
  })

  it("ignores the page's close failing, whether the page loaded or not", async () => {
    const closeError = new Error('The browser was closed.')
    const loaded = fakeDriverOf({ closeError })

    await checkProxyReach(loaded.driver, proxy)
    expect(loaded.pageCloses).toBe(1)

    const failed = fakeDriverOf({ gotoError: new PageLoadError(proxy.checkUrl, 'net::ERR_FAILED'), closeError })

    await expect(checkProxyReach(failed.driver, proxy, 500, 20)).rejects.toMatchObject({ name: 'ContainerError' })
    expect(failed.pageCloses).toBe(1)
  })
})
