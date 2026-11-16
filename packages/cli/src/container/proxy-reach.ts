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
 * How long a browser that failed during the check gets to show it has exited, in milliseconds, before its failure is
 * taken for what it says. Its exit carries its output, which can tell why it failed.
 */
const exitWaitMs = 2000

/**
 * The setup of the page the check loads in, which takes nothing from a run's config.
 */
const neutralSetup: PageSetup = {
  userAgentSuffix: '',
  timezone: 'UTC',
  locale: 'en-US',
  colorScheme: 'light',
  initScript: '',
  watchRequests: false,
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
 * Waits up to `waitMs` for the browser to exit, and gives its `BrowserExitedError` if it does, else `undefined`.
 */
async function exitWithin(driver: Driver, waitMs: number): Promise<BrowserExitedError | undefined> {
  let timer: NodeJS.Timeout | undefined

  try {
    return await Promise.race([
      driver.exited,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), waitMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Checks that the browser reaches the proxy, by loading the proxy's check URL within `timeoutMs`, 30 s by default, in
 * a page with a neutral setup. The page is closed whatever happens.
 *
 * When opening the page or loading the URL fails other than by the browser exiting, the check first waits up to
 * `waitMs`, 2 s by default, for the browser to exit, as a browser dying under an emulator can fail or time out on the
 * check page before it exits. Only a browser that stays up has its failure taken for what it says.
 *
 * @throws {BrowserExitedError} When the browser exits during the check, or within `waitMs` of another failure, so the
 * run can tell why it exited.
 * @throws {ContainerError} When the check URL can't load or doesn't load in time, as when the runtime gives its
 * containers no `host.docker.internal`. Its fix is `tested-runtimes`.
 * @throws {BrowserLaunchError} When the browser fails during the check any other way, such as a page that doesn't
 * open or crashes.
 */
export async function checkProxyReach(
  driver: Driver,
  proxy: SocksProxy,
  timeoutMs: number = checkTimeoutMs,
  waitMs: number = exitWaitMs,
): Promise<void> {
  let page: Page | undefined

  try {
    page = await driver.newPage(neutralSetup)
    await page.goto(proxy.checkUrl, timeoutMs)
  } catch (error) {
    if (error instanceof BrowserExitedError) {
      throw error
    }

    const exited = await exitWithin(driver, waitMs)

    if (exited !== undefined) {
      throw exited
    }

    // Only loading the check URL, not opening the page, tells whether the browser reaches the proxy.
    if (page !== undefined && (error instanceof PageLoadError || error instanceof PageTimeoutError)) {
      throw unreachableProxyOf(proxy, error)
    }

    throw new BrowserLaunchError(
      `The browser failed while visual-check checked that it can reach the proxy: ${sentenceOf(error)}`,
      [],
      { exited: false },
    )
  } finally {
    await page?.close().catch(() => undefined)
  }
}
