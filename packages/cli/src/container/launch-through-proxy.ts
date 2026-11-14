import type { Driver } from '../capture/driver/driver.js'
import { checkProxyReach } from './proxy-reach.js'
import { type SocksProxy, startSocksProxy } from './socks-proxy.js'

/**
 * Wraps the driver of a browser that goes through the proxy, so closing it closes the browser, then the proxy. Calling
 * `close()` again returns the same promise.
 */
function closingProxyWith(driver: Driver, proxy: SocksProxy): Driver {
  let closing: Promise<void> | undefined

  return {
    version: driver.version,
    exited: driver.exited,
    newPage: (setup) => driver.newPage(setup),
    close: () => {
      closing ??= driver.close().finally(() => proxy.close())

      return closing
    },
  }
}

/**
 * Starts the SOCKS proxy, then launches the browser with `launchWith`, which gets the proxy's address as a browser on
 * Docker's default bridge network reaches it: `socks5://host.docker.internal:<port>`, the runtime's own name for the
 * machine. Then checks that the browser reaches the proxy. Closing the driver it resolves with closes the browser,
 * then the proxy. When the launch fails, the proxy closes at once and the error is rethrown. When the check fails, the
 * browser and the proxy close, and the check's error is rethrown.
 *
 * @public
 * @throws {ContainerError} When the browser can't reach the proxy.
 * @throws {BrowserExitedError} When the browser exits during the check.
 * @throws {BrowserLaunchError} When the browser fails the check any other way.
 * @throws {Error} Any error `launchWith` rejects with.
 */
export async function launchThroughProxy(launchWith: (proxyServer: string) => Promise<Driver>): Promise<Driver> {
  const proxy = await startSocksProxy()
  let driver: Driver

  try {
    driver = closingProxyWith(await launchWith(`socks5://host.docker.internal:${proxy.port}`), proxy)
  } catch (error) {
    await proxy.close()

    throw error
  }

  try {
    await checkProxyReach(driver, proxy)
  } catch (error) {
    await driver.close().catch(() => undefined)

    throw error
  }

  return driver
}
