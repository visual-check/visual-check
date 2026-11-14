import { connect } from 'node:net'
import { describe, expect, it } from 'vitest'
import type { BrowserExitedError, Driver, Page, PageSetup } from '../capture/driver/driver.js'
import { launchThroughProxy } from './launch-browser.js'

/**
 * The setup the tests open a page with.
 */
const pageSetup: PageSetup = {
  userAgentSuffix: ' StorybookTestRunner',
  timezone: 'Europe/Warsaw',
  locale: 'pl-PL',
  colorScheme: 'dark',
  initScript: 'window.__visualCheck = true',
}

/**
 * A page that does nothing, which the fake driver opens.
 */
const fakePage: Page = {
  setViewport: async () => undefined,
  goto: async () => undefined,
  evaluate: async () => undefined,
  captureFullPage: async () => new Uint8Array(),
  clearStorage: async () => undefined,
  close: async () => undefined,
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
   * What connecting to the proxy gave at each close of the driver, in order.
   */
  proxyAtCloses: string[]
}

/**
 * Builds a fake driver that, when it is closed, connects to the proxy on this port and records what that gave, then
 * rejects with `closeError` when one is given.
 */
function fakeDriverOf(proxyPort: () => number, closeError?: Error): FakeDriver {
  const setups: PageSetup[] = []
  const proxyAtCloses: string[] = []
  const driver: Driver = {
    version: '157.0.8103.78',
    exited: new Promise<BrowserExitedError>(() => undefined),
    newPage: async (setup) => {
      setups.push(setup)

      return fakePage
    },
    close: async () => {
      proxyAtCloses.push(await connectionTo(proxyPort()))

      if (closeError !== undefined) {
        throw closeError
      }
    },
  }

  return { driver, setups, proxyAtCloses }
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
    expect(await driver.newPage(pageSetup)).toBe(fakePage)
    expect(fake.setups).toEqual([pageSetup])

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
    const fake = fakeDriverOf(() => portOf(proxyServer), error)
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
})
