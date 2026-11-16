import { connect } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserExitedError, type Driver, type Page, PageLoadError, type PageSetup } from '../capture/driver/driver.js'
import { ContainerError } from './container-error.js'
import { launchThroughProxy } from './launch-through-proxy.js'

/**
 * The setup the tests open a page with.
 */
const pageSetup: PageSetup = {
  userAgentSuffix: ' StorybookTestRunner',
  timezone: 'Europe/Warsaw',
  locale: 'pl-PL',
  colorScheme: 'dark',
  initScript: 'window.__visualCheck = true',
  watchRequests: false,
}

/**
 * How the fake driver behaves.
 */
interface FakeBehaviour {
  /**
   * The error closing the driver rejects with, or `undefined` to close it.
   */
  closeError?: Error
  /**
   * The error loading a URL in a page rejects with, or `undefined` to load it.
   */
  gotoError?: Error
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
   * The page every `newPage` opens, which does nothing but load.
   */
  page: Page
  /**
   * The setup of every page opened.
   */
  setups: PageSetup[]
  /**
   * The URL of every load, in order.
   */
  urls: string[]
  /**
   * What connecting to the proxy gave at each close of the driver, in order.
   */
  proxyAtCloses: string[]
}

/**
 * Builds a fake driver that, when it is closed, connects to the proxy on this port and records what that gave, then
 * rejects with the behaviour's `closeError` when it has one. Its page loads every URL, or rejects with `gotoError`.
 */
function fakeDriverOf(proxyPort: () => number, behaviour: FakeBehaviour = {}): FakeDriver {
  const setups: PageSetup[] = []
  const urls: string[] = []
  const proxyAtCloses: string[] = []
  const page: Page = {
    setViewport: async () => undefined,
    goto: async (url) => {
      urls.push(url)

      if (behaviour.gotoError !== undefined) {
        throw behaviour.gotoError
      }
    },
    evaluate: async () => undefined,
    capture: async () => new Uint8Array(),
    clearStorage: async () => undefined,
    close: async () => undefined,
    requestHosts: () => [],
  }
  const driver: Driver = {
    version: '157.0.8103.78',
    exited: new Promise<BrowserExitedError>(() => undefined),
    newPage: async (setup) => {
      setups.push(setup)

      return page
    },
    close: async () => {
      proxyAtCloses.push(await connectionTo(proxyPort()))

      if (behaviour.closeError !== undefined) {
        throw behaviour.closeError
      }
    },
  }

  return { driver, page, setups, urls, proxyAtCloses }
}

/**
 * Reads the port from a proxy address such as `socks5://host.docker.internal:40123`.
 */
function portOf(proxyServer: string): number {
  return Number(proxyServer.slice(proxyServer.lastIndexOf(':') + 1))
}

/**
 * Connects to this port on 127.0.0.1, and gives `accepted` when it does, else the error code it fails with.
 */
function connectionTo(port: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })

    socket.once('connect', () => {
      socket.destroy()
      resolve('accepted')
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code ?? error.message)
    })
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('launchThroughProxy', () => {
  it("gives the launch the proxy's address on host.docker.internal, and passes the driver's version, exit and pages through", async () => {
    let proxyServer = ''
    const fake = fakeDriverOf(() => portOf(proxyServer))
    const driver = await launchThroughProxy(async (server) => {
      proxyServer = server

      return fake.driver
    })

    expect(proxyServer).toMatch(/^socks5:\/\/host\.docker\.internal:\d+$/)
    expect(await connectionTo(portOf(proxyServer))).toBe('accepted')
    expect(driver.version).toBe('157.0.8103.78')
    expect(driver.exited).toBe(fake.driver.exited)
    expect(await driver.newPage(pageSetup)).toBe(fake.page)
    expect(fake.setups.at(-1)).toEqual(pageSetup)

    await driver.close()
  })

  it('closes the driver, then the proxy, once however often it is closed', async () => {
    let proxyServer = ''
    const fake = fakeDriverOf(() => portOf(proxyServer))
    const driver = await launchThroughProxy(async (server) => {
      proxyServer = server

      return fake.driver
    })
    const closing = driver.close()

    expect(driver.close()).toBe(closing)

    await closing

    expect(fake.proxyAtCloses).toEqual(['accepted'])
    expect(await connectionTo(portOf(proxyServer))).toBe('ECONNREFUSED')
  })

  it("closes the proxy and rejects with the driver's error when the driver fails to close", async () => {
    const error = new Error('The browser could not be closed.')
    let proxyServer = ''
    const fake = fakeDriverOf(() => portOf(proxyServer), { closeError: error })
    const driver = await launchThroughProxy(async (server) => {
      proxyServer = server

      return fake.driver
    })

    await expect(driver.close()).rejects.toBe(error)
    expect(fake.proxyAtCloses).toEqual(['accepted'])
    expect(await connectionTo(portOf(proxyServer))).toBe('ECONNREFUSED')
  })

  it('closes the proxy and rethrows when the launch fails', async () => {
    const error = new Error('The browser exited with code 1 before it answered.')
    let proxyServer = ''

    await expect(
      launchThroughProxy(async (server) => {
        proxyServer = server

        throw error
      }),
    ).rejects.toBe(error)
    expect(await connectionTo(portOf(proxyServer))).toBe('ECONNREFUSED')
  })

  it("checks that the browser reaches the proxy by loading the proxy's check URL once it has launched", async () => {
    let proxyServer = ''
    const fake = fakeDriverOf(() => portOf(proxyServer))
    const driver = await launchThroughProxy(async (server) => {
      proxyServer = server

      return fake.driver
    })

    expect(fake.urls).toEqual([expect.stringMatching(/^http:\/\/[0-9a-f]{16}\.visual-check\.invalid\/$/)])
    expect(fake.proxyAtCloses).toEqual([])

    await driver.close()
  })

  it("closes the browser, then the proxy, and rejects with a ContainerError when the browser can't reach the proxy", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    let proxyServer = ''
    const fake = fakeDriverOf(() => portOf(proxyServer), {
      gotoError: new PageLoadError('http://check.visual-check.invalid/', 'net::ERR_PROXY_CONNECTION_FAILED'),
      closeError: new Error('The browser could not be closed.'),
    })
    const launching = launchThroughProxy(async (server) => {
      proxyServer = server

      return fake.driver
    })
    const rejected = expect(launching).rejects.toBeInstanceOf(ContainerError)

    // The check waits 2 s for the browser to exit before it blames the runtime.
    await vi.waitFor(() => {
      expect(vi.getTimerCount()).toBe(1)
    })
    await vi.advanceTimersByTimeAsync(2000)
    await rejected
    await expect(launching).rejects.toHaveProperty('fix', 'tested-runtimes')
    expect(fake.proxyAtCloses).toEqual(['accepted'])
    expect(await connectionTo(portOf(proxyServer))).toBe('ECONNREFUSED')
  })

  it('rethrows a browser that exits during the check, after closing the browser and the proxy', async () => {
    const exited = new BrowserExitedError({ code: 133, signal: null, error: undefined }, [])
    let proxyServer = ''
    const fake = fakeDriverOf(() => portOf(proxyServer), { gotoError: exited })

    await expect(
      launchThroughProxy(async (server) => {
        proxyServer = server

        return fake.driver
      }),
    ).rejects.toBe(exited)
    expect(fake.proxyAtCloses).toEqual(['accepted'])
    expect(await connectionTo(portOf(proxyServer))).toBe('ECONNREFUSED')
  })
})
