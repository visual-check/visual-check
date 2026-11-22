import type { Driver, Page, PageSetup } from '../capture/driver/driver.js'
import { abortable } from './abortable.js'
import type { BrowserLaunch, LaunchBrowser } from './launch-browser.js'

/**
 * A browser kept between clicks, so that only the first click, and a click after something changed, launches one.
 * One click uses it at a time: the next one starts once the last one has ended, whether or not a launch it abandoned is
 * still in flight.
 *
 * @public
 */
export interface WarmBrowser {
  /**
   * Gives the launcher of one click. It hands out the warm browser, launching one when there's none, when the kept one
   * was launched differently, or when the kept one is the one this click already got, which has then exited. Closing
   * the driver it resolves with closes the pages the click opened and leaves the browser running, unless it opened none:
   * then the click couldn't use the browser, such as one of another build than the browser package's, so the browser is
   * closed and the next launcher launches another.
   *
   * When the signal aborts, every page the click opened closes, a pull stops, and a launch in flight is abandoned: the
   * launcher rejects at once with the signal's reason, and the browser stays warm once it connects. The next launcher
   * waits for it. An abort leaves the browser running, even when the click opened no page. The launch's progress stops
   * at the abort too.
   */
  launcherFor: (signal: AbortSignal) => LaunchBrowser
  /**
   * Closes the browser, waiting for a launch in flight. Every launch asked for afterwards fails. Calling it again
   * returns the same promise.
   */
  close: () => Promise<void>
}

/**
 * The browser that is kept, with what it was launched with.
 */
interface KeptBrowser {
  /**
   * The key of the launch that started it, as `launchKeyOf` gives it.
   */
  key: string
  /**
   * The browser's driver.
   */
  driver: Driver
}

/**
 * The fields of a launch that don't change which browser it starts.
 */
const fieldsOutsideKey: ReadonlySet<string> = new Set(['progress', 'signal', 'environment'])

/**
 * Gives a text that two launches share when they start the same browser the same way: every field but where the progress
 * goes, the signal and the environment.
 */
export function launchKeyOf(launch: BrowserLaunch): string {
  return JSON.stringify(Object.entries(launch).filter(([field]) => !fieldsOutsideKey.has(field)))
}

/**
 * Gives a click's launch as the launcher gets it: its progress is dropped once the click's signal has aborted, and in
 * the container that signal stops the pull.
 */
function launchOfClick(launch: BrowserLaunch, signal: AbortSignal): BrowserLaunch {
  if (launch.in === 'image') {
    return launch
  }

  const progress = (text: string): void => {
    if (!signal.aborted) {
      launch.progress(text)
    }
  }

  return launch.in === 'container' ? { ...launch, progress, signal } : { ...launch, progress }
}

/**
 * Closes a page or a browser, ignoring a failure to.
 */
async function closeQuietly(closable: Page | Driver): Promise<void> {
  await closable.close().catch(() => undefined)
}

/**
 * Opens a page in the browser. A browser that has exited is closed too, and then rejects a page as closing, so a failure
 * once it has exited is thrown as the exit.
 *
 * @throws {BrowserExitedError} When the browser has exited.
 * @throws {Error} The browser's own error otherwise.
 */
async function openPage(driver: Driver, setup: PageSetup): Promise<Page> {
  try {
    return await driver.newPage(setup)
  } catch (error) {
    const exit = await Promise.race([driver.exited, undefined])

    throw exit ?? error
  }
}

/**
 * Lends a browser to one click: a driver whose `close()` closes the pages it opened, ignoring a failure to, and leaves
 * the browser running. When it opened none, `close()` calls `dropUnused` and waits for it. The signal's abort closes the
 * lease too, and from then on `close()` never calls `dropUnused`.
 *
 * @throws {unknown} The signal's reason, when it has already aborted.
 */
function leaseOf(driver: Driver, signal: AbortSignal, dropUnused: () => Promise<void>): Driver {
  const pages = new Set<Page>()
  let closing: Promise<void> | undefined

  const closePages = async (): Promise<void> => {
    const unused = pages.size === 0 && !signal.aborted

    signal.removeEventListener('abort', close)

    if (unused) {
      await dropUnused()
    }

    await Promise.all([...pages].map(closeQuietly))
    pages.clear()
  }
  const close = (): Promise<void> => {
    closing ??= closePages()

    return closing
  }
  const throwIfClosed = (): void => {
    if (closing !== undefined) {
      throw new Error("The browser is closing, so it can't open a page.")
    }
  }

  signal.throwIfAborted()
  signal.addEventListener('abort', close, { once: true })

  return {
    version: driver.version,
    exited: driver.exited,
    newPage: async (setup) => {
      throwIfClosed()

      const page = await openPage(driver, setup)

      try {
        throwIfClosed()
      } catch (error) {
        await closeQuietly(page)

        throw error
      }

      pages.add(page)

      return page
    },
    close,
  }
}

/**
 * Makes a warm browser that `launcher` launches. Nothing is launched until a click's launcher is first called.
 *
 * `launcher` is called for every launch over the warm browser's long life, so it must not remember an installed
 * executable, as one `createLaunchBrowser()`, which is for one run, does: make a fresh one for each launch.
 *
 * @public
 */
export function createWarmBrowser(launcher: LaunchBrowser): WarmBrowser {
  let kept: KeptBrowser | undefined
  let closing: Promise<void> | undefined
  // Settles once the last launch asked for, or drop of an unused browser, has ended, so that they run one after another.
  // It never rejects.
  let lastLaunch: Promise<unknown> = Promise.resolve()

  /**
   * Closes the kept browser, ignoring a failure to, and keeps none. An exited one is closed too, since that stops the
   * proxy it went through.
   */
  const dropKept = async (): Promise<void> => {
    const dropped = kept?.driver

    kept = undefined

    if (dropped !== undefined) {
      await closeQuietly(dropped)
    }
  }

  /**
   * Closes the browser when it's still the kept one, once the launches asked for before have ended. The launches asked
   * for afterwards, and `close()`, wait for it.
   */
  const dropUnused = async (driver: Driver): Promise<void> => {
    const dropping = lastLaunch.then(() => (kept?.driver === driver ? dropKept() : undefined))

    lastLaunch = dropping
    await dropping
  }

  /**
   * Keeps the browser until it exits.
   */
  const keep = (key: string, driver: Driver): void => {
    kept = { key, driver }

    driver.exited.then(async () => {
      if (kept?.driver === driver) {
        await dropKept()
      }
    })
  }

  /**
   * Throws when nothing may be launched for the click any more.
   *
   * @throws {Error} When the warm browser is closing.
   * @throws {unknown} The signal's reason, when it has aborted.
   */
  const throwIfEnded = (signal: AbortSignal): void => {
    signal.throwIfAborted()

    if (closing !== undefined) {
      throw new Error("The browser is closing, so it can't be launched.")
    }
  }

  /**
   * Gives the kept browser when it was launched the same way and isn't `spent`, the one the click already got.
   * Otherwise closes it, launches another and keeps that.
   *
   * @throws {Error} When the warm browser is closing.
   * @throws {unknown} The launch's error, or the signal's reason when it aborts before the launch or during its pull.
   */
  const driverFor = async (launch: BrowserLaunch, spent: Driver | undefined, signal: AbortSignal): Promise<Driver> => {
    throwIfEnded(signal)

    const key = launchKeyOf(launch)

    if (kept?.key === key && kept.driver !== spent) {
      return kept.driver
    }

    await dropKept()
    throwIfEnded(signal)

    const driver = await launcher(launchOfClick(launch, signal))

    keep(key, driver)

    return driver
  }

  return {
    launcherFor: (signal) => {
      let given: Driver | undefined

      return async (launch) => {
        const launching = lastLaunch.then(() => driverFor(launch, given, signal))

        lastLaunch = launching.catch(() => undefined)

        const driver = await abortable(launching, signal)

        given = driver

        return leaseOf(driver, signal, () => dropUnused(driver))
      }
    },
    close: () => {
      closing ??= lastLaunch.then(dropKept)

      return closing
    },
  }
}
