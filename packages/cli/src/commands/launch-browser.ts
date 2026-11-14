import { checkBrowserVersion, packageImageOf } from '../browser/browser-version.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import { type CaptureSession, type CaptureSettings, openCaptureSession } from '../capture/capture-session.js'
import { launchCdpDriver } from '../capture/driver/cdp/cdp-driver.js'
import type { Driver } from '../capture/driver/driver.js'
import { type ContainerPlatform, startBrowserInContainer } from '../container/browser-container.js'
import { pullMissingImage } from '../container/image-pull.js'
import { containerNetwork } from '../container/own-container.js'

/**
 * The folder Chromium keeps its profile in, inside the container. The container is removed when the browser exits, and
 * the profile with it.
 */
const containerProfileDir = '/tmp/visual-check-profile'

/**
 * What launching the browser for a run needs.
 */
export interface BrowserLaunch {
  /**
   * The image the browser runs in: the config's `image`, or the browser package's `<tag>@<digest>`.
   */
  image: string
  /**
   * The platform the container runs on.
   */
  platform: ContainerPlatform
  /**
   * The path of the headless shell's executable inside the image.
   */
  executable: string
  /**
   * Writes the progress of a pull as it happens.
   */
  progress: (text: string) => void
}

/**
 * Launches the browser a run captures in, and resolves with its driver once it has connected.
 *
 * @throws {ContainerError} When Docker can't be run or the image can't be pulled.
 * @throws {BrowserLaunchError} When the browser doesn't connect.
 */
export type LaunchBrowser = (launch: BrowserLaunch) => Promise<Driver>

/**
 * Pulls the image when Docker doesn't have it for the platform, then starts the browser in visual-check's container,
 * with its sandbox off because the container is the boundary, and connects to it over CDP. The container joins the
 * network of the container the CLI runs in when Docker knows it, else it uses the host's.
 */
export const launchBrowserInContainer: LaunchBrowser = async (launch) => {
  await pullMissingImage(launch.image, launch.platform, launch.progress)

  const network = await containerNetwork()

  return await launchCdpDriver({
    start: startBrowserInContainer({
      image: launch.image,
      platform: launch.platform,
      executable: launch.executable,
      network,
    }),
    sandbox: false,
    profileDir: containerProfileDir,
  })
}

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
   * The platform the container runs on.
   */
  platform: ContainerPlatform
  /**
   * How the session captures every story.
   */
  settings: CaptureSettings
  /**
   * Writes the progress of a pull as it happens.
   */
  progress: (text: string) => void
}

/**
 * The browser a run captures in, launched at the first story that needs it, with one capture session for the run.
 */
export interface RunBrowser {
  /**
   * The run's capture session. The first call launches the browser, checks that it is the browser package's build and
   * opens the session.
   *
   * @throws {ContainerError} When Docker can't be run or the image can't be pulled.
   * @throws {BrowserLaunchError} When the browser doesn't connect.
   * @throws {BrowserMismatchError} When the browser isn't the browser package's build.
   */
  session: () => Promise<CaptureSession>
  /**
   * Closes the session's page and the browser, if they were opened.
   */
  close: () => Promise<void>
}

/**
 * Prepares a run's browser, which `launchBrowser` launches. Nothing is launched until the first `session()`.
 */
export function runBrowserOf(launchBrowser: LaunchBrowser, options: RunBrowserOptions): RunBrowser {
  let driver: Driver | undefined
  let session: CaptureSession | undefined

  const open = async (): Promise<CaptureSession> => {
    driver = await launchBrowser({
      image: options.configImage ?? packageImageOf(options.browserPackage),
      platform: options.platform,
      executable: options.browserPackage.headlessShell,
      progress: options.progress,
    })
    checkBrowserVersion(driver.version, options.browserPackage, options.configImage)

    return openCaptureSession(driver, options.settings)
  }

  return {
    session: async () => {
      session ??= await open()

      return session
    },
    close: async () => {
      await session?.close()
      await driver?.close()
    },
  }
}
