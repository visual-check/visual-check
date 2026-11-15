import { type CheckedBrowser, checkBrowserVersion, runImageOf } from '../browser/browser-version.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import { headlessShellPathsOf } from '../browser-download/install-headless-shell.js'
import {
  type CaptureSession,
  type CaptureSettings,
  openCaptureSession,
  type StoryCapture,
  type StoryToCapture,
} from '../capture/capture-session.js'
import { BrowserExitedError, type Driver } from '../capture/driver/driver.js'
import { type OptionsRequest, readStoryOptions, type StorybookOptionsRead } from '../capture/read-options.js'
import type { BrowserPlace } from './browser-route.js'
import type { BrowserLaunch, LaunchBrowser } from './launch-browser.js'

/**
 * What a run's browser is launched and set up with.
 */
interface RunBrowserOptions {
  /**
   * The browser package, which names the image, the headless shell, its downloads and the build the browser must be.
   */
  browserPackage: BrowserPackage
  /**
   * The config's `image`, which replaces the browser package's, or `undefined`.
   */
  configImage: string | undefined
  /**
   * Where the browser runs.
   */
  place: BrowserPlace
  /**
   * How each session captures every story.
   */
  settings: CaptureSettings
  /**
   * The environment, for where the headless shell is downloaded to on the host, and through which mirror and proxy.
   */
  environment: Record<string, string | undefined>
  /**
   * Writes the progress of a pull or a download as it happens.
   */
  progress: (text: string) => void
}

/**
 * How the run's first browser exited while the run went on.
 */
export interface FirstBrowserExit {
  /**
   * What the browser exited with, which names the exit code or signal and keeps the browser's last output.
   */
  error: BrowserExitedError
  /**
   * Whether a read or a capture came after the exit, so that visual-check relaunched the browser for it, whether or
   * not the relaunch then worked.
   */
  relaunched: boolean
}

/**
 * The browser a run reads options and captures in, launched at the first read or story that needs it, with one capture
 * session for each worker. When it exits, it's relaunched once, at the next read or story that needs it.
 */
export interface RunBrowser {
  /**
   * Captures a story in the worker's capture session, which keeps its own page. The first call of either method
   * launches the browser and checks that it is the browser package's build, and every call shares that one browser. A
   * worker's first call on a browser opens its session there.
   *
   * When the first browser exits, each capture in flight on it gives a broken story, `browser-exited`, even when it
   * fails after the relaunch. The browser counts as exited from the first capture that fails with the exit, or from
   * its `exited`, so an exit seen between captures breaks no story. The next call relaunches the browser and checks it
   * the same way, and every call after shares the relaunched one. A worker's session in the first browser is closed
   * when the worker opens one in the relaunched browser. The first browser itself stays open until `close()`.
   *
   * An exit of the first browser whose output says its graphics process couldn't start, before any capture gave a
   * snapshot, means this machine can't run the platform: a relaunch would fail the same way, so every capture that
   * meets it throws it instead.
   *
   * `started`, when given, is called once the browser is up and the worker's session is open, just before the
   * capture, so the caller can time the capture without the launch.
   *
   * @throws {ContainerError} When Docker can't be run, the image can't be pulled, or the browser can't reach the proxy,
   * at the launch or the relaunch.
   * @throws {BrowserDownloadError} When the headless shell can't be downloaded to the host.
   * @throws {BrowserLaunchError} When the browser doesn't connect, or fails any other way while it is checked to reach
   * the proxy, at the launch or the relaunch.
   * @throws {BrowserMismatchError} When the browser, launched or relaunched, isn't the browser package's build.
   * @throws {BrowserExitedError} When the browser exits while it is checked to reach the proxy, when the relaunched
   * browser exits during the capture or has exited before it, and when the first browser's exit says this machine
   * can't run the platform.
   */
  capture: (worker: number, story: StoryToCapture, started?: () => void) => Promise<StoryCapture>
  /**
   * Reads the per-story options of a Storybook's stories on a page of its own, in the browser the next capture would
   * use. The first call of either method launches the browser and checks it the way `capture` does, and a failed launch
   * throws the same errors. The page is closed afterwards. Whatever goes wrong with the read other than the browser
   * exiting comes back as a problem.
   *
   * When the first browser exits during the read, the read is made once more in the relaunched browser, as the next
   * capture would be, and the first browser counts as exited. A read in the relaunched browser that exits, or in a
   * first browser whose exit says this machine can't run the platform, throws the exit.
   *
   * @throws {ContainerError} When Docker can't be run, the image can't be pulled, or the browser can't reach the proxy,
   * at the launch or the relaunch.
   * @throws {BrowserDownloadError} When the headless shell can't be downloaded to the host.
   * @throws {BrowserLaunchError} When the browser doesn't connect, or fails any other way while it is checked to reach
   * the proxy, at the launch or the relaunch.
   * @throws {BrowserMismatchError} When the browser, launched or relaunched, isn't the browser package's build.
   * @throws {BrowserExitedError} When the relaunched browser exits during the read or has exited before it, when the
   * browser exits while it is checked to reach the proxy, and when the first browser's exit says this machine can't
   * run the platform.
   */
  readOptions: (request: OptionsRequest) => Promise<StorybookOptionsRead>
  /**
   * How the first browser exited, once it has exited other than through `close()` and the run went on, or `undefined`.
   * An exit saying this machine can't run the platform gives `undefined`, since it stops the run.
   */
  firstExit: () => FirstBrowserExit | undefined
  /**
   * Closes every session's page, in the first browser and the relaunched one, and then both browsers, if they were
   * opened. Waits for a launch still in flight, so no browser is left running, and doesn't throw when a launch failed.
   * Call it once every capture has settled.
   */
  close: () => Promise<void>
}

/**
 * One launch of a run's browser, with the capture sessions of the workers that captured in it.
 */
interface LaunchedBrowser {
  /**
   * The browser's driver, once the browser has connected and its version is checked.
   */
  driver: Promise<Driver>
  /**
   * The capture session of each worker that captured in this browser, by worker number.
   */
  sessions: Map<number, CaptureSession>
  /**
   * What the browser exited with, from the first capture that failed with it or from its driver's `exited`, whichever
   * came first, or `undefined` while it runs.
   */
  exit: BrowserExitedError | undefined
}

/**
 * Gives what launching the browser needs where it runs: the headless shell's path inside the image; the image, the
 * platform, the route and the path for the container; or the browser package's version and checksum of the download
 * for the host.
 */
function browserLaunchOf(options: RunBrowserOptions): BrowserLaunch {
  const { browserPackage, place } = options

  switch (place.in) {
    case 'image':
      return { in: 'image', executable: browserPackage.headlessShell }
    case 'container':
      return {
        in: 'container',
        image: runImageOf(browserPackage, options.configImage),
        platform: place.platform,
        route: place.route,
        executable: browserPackage.headlessShell,
        progress: options.progress,
      }
    case 'host':
      return {
        in: 'host',
        platform: place.platform,
        version: browserPackage.chromium,
        sha256: browserPackage.sha256[place.platform],
        packageVersion: browserPackage.packageVersion,
        environment: options.environment,
        progress: options.progress,
      }
  }
}

/**
 * Gives where the browser that answered runs, as the version check names it.
 */
function checkedBrowserOf(options: RunBrowserOptions): CheckedBrowser {
  switch (options.place.in) {
    case 'image':
      return { in: 'image' }
    case 'container':
      return { in: 'container', configImage: options.configImage }
    case 'host': {
      const { environment, browserPackage, place } = options
      const { folder } = headlessShellPathsOf(environment, browserPackage.chromium, place.platform)

      return { in: 'host', folder }
    }
  }
}

/**
 * Prepares a run's browser, which `launcher` launches. Nothing is launched until the first `capture()` or
 * `readOptions()`.
 */
export function runBrowserOf(launcher: LaunchBrowser, options: RunBrowserOptions): RunBrowser {
  let first: LaunchedBrowser | undefined
  let relaunched: LaunchedBrowser | undefined
  let snapshotTaken = false

  /**
   * Whether the first browser's exit says this machine can't run the platform: its graphics process couldn't start,
   * and no capture has given a snapshot yet.
   */
  const cannotRunPlatform = (exit: BrowserExitedError): boolean => exit.graphicsFailed && !snapshotTaken

  /**
   * Launches the browser and checks that it is the browser package's build, closing it when it isn't.
   */
  const launchChecked = async (): Promise<Driver> => {
    const driver = await launcher(browserLaunchOf(options))

    try {
      checkBrowserVersion(driver.version, options.browserPackage, checkedBrowserOf(options))
    } catch (error) {
      await driver.close()

      throw error
    }

    return driver
  }

  /**
   * Starts a checked launch and gives its record, which watches the driver's `exited` to mark the browser exited.
   */
  const startLaunch = (): LaunchedBrowser => {
    const launched: LaunchedBrowser = { driver: launchChecked(), sessions: new Map(), exit: undefined }

    launched.driver.then(
      (driver) =>
        driver.exited.then((error) => {
          launched.exit ??= error
        }),
      () => undefined,
    )

    return launched
  }

  /**
   * Gives the browser the next read or capture runs in: the first one, launching it at the first call, or once it has
   * exited, the relaunched one, relaunching it at the first call after the exit.
   *
   * @throws {BrowserExitedError} When the relaunched browser has exited too, or the first one's exit says this machine
   * can't run the platform.
   */
  const browserForNextUse = (): LaunchedBrowser => {
    first ??= startLaunch()

    if (first.exit === undefined) {
      return first
    }

    if (cannotRunPlatform(first.exit)) {
      throw first.exit
    }

    relaunched ??= startLaunch()

    if (relaunched.exit !== undefined) {
      throw relaunched.exit
    }

    return relaunched
  }

  /**
   * Gives the worker's session in `browser` once the browser is up, opening it when the worker has none there yet.
   * Opening one in the relaunched browser closes the worker's session in the first, ignoring a failure to.
   *
   * @throws {Error} The launch's error, when the browser failed to launch.
   */
  const sessionOf = async (browser: LaunchedBrowser, worker: number): Promise<CaptureSession> => {
    const driver = await browser.driver
    const open = browser.sessions.get(worker)

    if (open !== undefined) {
      return open
    }

    const session = openCaptureSession(driver, options.settings)

    browser.sessions.set(worker, session)

    const left = browser === relaunched ? first?.sessions.get(worker) : undefined

    if (left !== undefined) {
      first?.sessions.delete(worker)
      await left.close().catch(() => undefined)
    }

    return session
  }

  /**
   * Reads the options in `browser` once it is up. When the browser exits during the read, marks it exited and gives the
   * exit instead.
   *
   * @throws {Error} The launch's error, when the browser failed to launch.
   */
  const readIn = async (
    browser: LaunchedBrowser,
    request: OptionsRequest,
  ): Promise<StorybookOptionsRead | BrowserExitedError> => {
    const driver = await browser.driver

    try {
      return await readStoryOptions(driver, options.settings, request)
    } catch (error) {
      if (!(error instanceof BrowserExitedError)) {
        throw error
      }

      browser.exit ??= error

      return error
    }
  }

  return {
    capture: async (worker, story, started) => {
      const browser = browserForNextUse()
      const session = await sessionOf(browser, worker)

      started?.()

      try {
        const capture = await session.capture(story)

        if ('snapshot' in capture) {
          snapshotTaken = true
        }

        return capture
      } catch (error) {
        if (!(error instanceof BrowserExitedError)) {
          throw error
        }

        browser.exit ??= error

        if (browser !== first || cannotRunPlatform(error)) {
          throw error
        }

        return {
          broken: {
            reason: 'browser-exited',
            message: `The browser exited while visual-check captured this story: ${error.message}`,
          },
        }
      }
    },
    readOptions: async (request) => {
      const browser = browserForNextUse()
      const read = await readIn(browser, request)

      if (!(read instanceof BrowserExitedError)) {
        return read
      }

      if (browser !== first || cannotRunPlatform(read)) {
        throw read
      }

      const reread = await readIn(browserForNextUse(), request)

      if (reread instanceof BrowserExitedError) {
        throw reread
      }

      return reread
    },
    firstExit: () => {
      if (first?.exit === undefined || cannotRunPlatform(first.exit)) {
        return undefined
      }

      return { error: first.exit, relaunched: relaunched !== undefined }
    },
    close: async () => {
      const launches = [first, relaunched].filter((browser) => browser !== undefined)

      await Promise.all(launches.flatMap((browser) => [...browser.sessions.values()].map((session) => session.close())))
      await Promise.all(
        launches.map(async (browser) => {
          const driver = await browser.driver.catch(() => undefined)

          await driver?.close()
        }),
      )
    },
  }
}
