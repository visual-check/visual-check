import { checkBrowserVersion, runImageOf } from '../browser/browser-version.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import {
  type CaptureSession,
  type CaptureSettings,
  openCaptureSession,
  type StoryCapture,
  type StoryToCapture,
} from '../capture/capture-session.js'
import { BrowserExitedError, type Driver } from '../capture/driver/driver.js'
import type { BrowserPlace, LaunchBrowser } from './launch-browser.js'

/**
 * What a run's browser is launched and set up with.
 */
interface RunBrowserOptions {
  /**
   * The browser package, which names the image, the headless shell and the build the browser must be.
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
   * Writes the progress of a pull as it happens.
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
   * Whether a capture came after the exit, so that visual-check relaunched the browser for it, whether or not the
   * relaunch then worked.
   */
  relaunched: boolean
}

/**
 * The browser a run captures in, launched at the first story that needs it, with one capture session for each worker.
 * When it exits, it's relaunched once, at the next story that needs it.
 */
export interface RunBrowser {
  /**
   * Captures a story in the worker's capture session, which keeps its own page. The first call launches the browser and
   * checks that it is the browser package's build, and every call shares that one browser. A worker's first call on a
   * browser opens its session there.
   *
   * When the first browser exits, each capture in flight on it gives a broken story, `browser-exited`, even when it
   * fails after the relaunch. The browser counts as exited from the first capture that fails with the exit, or from
   * its `exited`, so an exit seen between captures breaks no story. The next call relaunches the browser and checks it
   * the same way, and every call after shares the relaunched one. A worker's session in the first browser is closed when
   * the worker opens one in the relaunched browser. The first browser itself stays open until `close()`.
   *
   * `started`, when given, is called once the browser is up and the worker's session is open, just before the
   * capture, so the caller can time the capture without the launch.
   *
   * @throws {ContainerError} When Docker can't be run or the image can't be pulled, at the launch or the relaunch.
   * @throws {BrowserLaunchError} When the browser doesn't connect, at the launch or the relaunch.
   * @throws {BrowserMismatchError} When the browser, launched or relaunched, isn't the browser package's build.
   * @throws {BrowserExitedError} When the relaunched browser exits during the capture, or has exited before it.
   */
  capture: (worker: number, story: StoryToCapture, started?: () => void) => Promise<StoryCapture>
  /**
   * How the first browser exited, once it has exited other than through `close()`, or `undefined`.
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
 * Prepares a run's browser, which `launcher` launches. Nothing is launched until the first `capture()`.
 */
export function runBrowserOf(launcher: LaunchBrowser, options: RunBrowserOptions): RunBrowser {
  let first: LaunchedBrowser | undefined
  let relaunched: LaunchedBrowser | undefined

  /**
   * Launches the browser and checks that it is the browser package's build, closing it when it isn't.
   */
  const launchChecked = async (): Promise<Driver> => {
    const executable = options.browserPackage.headlessShell
    const driver = await launcher(
      options.place.in === 'image'
        ? { in: 'image', executable }
        : {
            in: 'container',
            image: runImageOf(options.browserPackage, options.configImage),
            platform: options.place.platform,
            executable,
            progress: options.progress,
          },
    )

    try {
      checkBrowserVersion(
        driver.version,
        options.browserPackage,
        options.place.in === 'image' ? { in: 'image' } : { in: 'container', configImage: options.configImage },
      )
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
   * Gives the browser the next capture runs in: the first one, launching it at the first call, or once it has exited,
   * the relaunched one, relaunching it at the first call after the exit.
   *
   * @throws {BrowserExitedError} When the relaunched browser has exited too.
   */
  const browserForCapture = (): LaunchedBrowser => {
    first ??= startLaunch()

    if (first.exit === undefined) {
      return first
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

  return {
    capture: async (worker, story, started) => {
      const browser = browserForCapture()
      const session = await sessionOf(browser, worker)

      started?.()

      try {
        return await session.capture(story)
      } catch (error) {
        if (!(error instanceof BrowserExitedError)) {
          throw error
        }

        browser.exit ??= error

        if (browser !== first) {
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
    firstExit: () => {
      if (first?.exit === undefined) {
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
