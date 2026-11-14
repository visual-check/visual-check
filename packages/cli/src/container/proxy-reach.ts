import {
  BrowserExitedError,
  BrowserLaunchError,
  type Driver,
  type Page,
  PageLoadError,
  type PageSetup,
  PageTimeoutError,
} from '../capture/driver/driver.js'
import { ContainerError } from './container-error.js'
import type { SocksProxy } from './socks-proxy.js'

/**
 * How long the check URL may take to load by default, in milliseconds, as long as the driver's other limits.
 */
const checkTimeoutMs = 30_000

/**
 * The setup of the page the check loads in, which takes nothing from a run's config.
 */
const neutralSetup: PageSetup = {
  userAgentSuffix: '',
  timezone: 'UTC',
  locale: 'en-US',
  colorScheme: 'light',
  initScript: '',
}

/**
 * What the check says after naming the proxy and the browser's reason: why a browser can't reach it, the runtimes
 * visual-check is tested with, and the fix.
 */
const runtimeAdvice =
  "This Docker runtime doesn't give its containers host.docker.internal, its name for this machine. visual-check is " +
  'tested with OrbStack and Docker Desktop on Apple Silicon Macs, Colima on Intel Macs, Docker Desktop on Windows, ' +
  'and Docker Engine on Linux. Use one of them, then run visual-check again.'

/**
 * Gives the error's message as a sentence, with a full stop added unless it already ends one.
 */
function sentenceOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)

  return /[.?!]$/.test(text) ? text : `${text}.`
}

/**
 * Builds the error for a browser that can't reach the proxy, naming the proxy and why loading the check URL failed:
 * the browser's network error, or the time limit that passed with no answer.
 */
function unreachableProxyOf(proxy: SocksProxy, error: PageLoadError | PageTimeoutError): ContainerError {
  const reason = error instanceof PageLoadError ? error.reason : `no answer within ${error.timeoutMs / 1000} s`

  return new ContainerError(
    `The browser can't reach visual-check's proxy at host.docker.internal:${proxy.port}: ${reason}.\n${runtimeAdvice}`,
    'tested-runtimes',
  )
}

/**
 * Gives the error for a browser that failed during the check other than by not reaching the proxy: a browser that
 * exited keeps its `BrowserExitedError`, and anything else becomes a `BrowserLaunchError`.
 */
function failedCheckOf(error: unknown): BrowserExitedError | BrowserLaunchError {
  if (error instanceof BrowserExitedError) {
    return error
  }

  return new BrowserLaunchError(
    `The browser failed while visual-check checked that it can reach the proxy: ${sentenceOf(error)}`,
    [],
  )
}

/**
 * Checks that the browser reaches the proxy, by loading the proxy's check URL within `timeoutMs`, 30 s by default, in
 * a page with a neutral setup. The page is closed whatever happens.
 *
 * @public
 * @throws {ContainerError} When the check URL can't load or doesn't load in time, as when the runtime gives its
 * containers no `host.docker.internal`. Its fix is `tested-runtimes`.
 * @throws {BrowserExitedError} When the browser exits during the check, unchanged, so the run can tell why it exited.
 * @throws {BrowserLaunchError} When the browser fails during the check any other way, such as a page that doesn't
 * open or crashes.
 */
export async function checkProxyReach(
  driver: Driver,
  proxy: SocksProxy,
  timeoutMs: number = checkTimeoutMs,
): Promise<void> {
  let page: Page

  try {
    page = await driver.newPage(neutralSetup)
  } catch (error) {
    throw failedCheckOf(error)
  }

  try {
    await page.goto(proxy.checkUrl, timeoutMs)
  } catch (error) {
    throw error instanceof PageLoadError || error instanceof PageTimeoutError
      ? unreachableProxyOf(proxy, error)
      : failedCheckOf(error)
  } finally {
    await page.close().catch(() => undefined)
  }
}
