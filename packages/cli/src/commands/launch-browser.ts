import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkBrowserVersion, runImageOf } from '../browser/browser-version.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import { startBrowserProcess } from '../browser-process/start-browser-process.js'
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
 * Where a run's browser runs: directly inside visual-check's image, or in visual-check's container.
 */
export type BrowserPlace = { in: 'image' } | { in: 'container'; platform: ContainerPlatform }

/**
 * What launching the browser for a run needs.
 */
export type BrowserLaunch =
  | {
      /**
       * The browser runs directly inside visual-check's image.
       */
      in: 'image'
      /**
       * The path of the headless shell's executable inside the image.
       */
      executable: string
    }
  | {
      /**
       * The browser runs in visual-check's container.
       */
      in: 'container'
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
 * Starts the headless shell as a child process of the CLI, which runs inside visual-check's image, and connects to it
 * over CDP. Chromium's sandbox is off and never tried, because the container the CLI runs in is the boundary. Nothing
 * is pulled and no `docker` runs.
 */
async function launchBrowserInImage(executable: string): Promise<Driver> {
  const profileDir = await mkdtemp(join(tmpdir(), 'visual-check-profile-'))

  return await launchCdpDriver({
    start: startBrowserProcess({ executable, profileDir }),
    sandbox: false,
    profileDir,
  })
}

/**
 * Pulls the image when Docker doesn't have it for the platform, then starts the browser in visual-check's container,
 * with its sandbox off because the container is the boundary, and connects to it over CDP. The container joins the
 * network of the container the CLI runs in when Docker knows it, else it uses the host's.
 */
async function launchBrowserInContainer(launch: Extract<BrowserLaunch, { in: 'container' }>): Promise<Driver> {
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
 * Launches the browser where the launch says: directly inside visual-check's image, or in visual-check's container.
 */
export const launchBrowser: LaunchBrowser = async (launch) => {
  return launch.in === 'image' ? await launchBrowserInImage(launch.executable) : await launchBrowserInContainer(launch)
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
   * Where the browser runs.
   */
  place: BrowserPlace
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
 * Prepares a run's browser, which `launcher` launches. Nothing is launched until the first `session()`.
 */
export function runBrowserOf(launcher: LaunchBrowser, options: RunBrowserOptions): RunBrowser {
  let driver: Driver | undefined
  let session: CaptureSession | undefined

  const open = async (): Promise<CaptureSession> => {
    const executable = options.browserPackage.headlessShell

    driver = await launcher(
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
    checkBrowserVersion(
      driver.version,
      options.browserPackage,
      options.place.in === 'image' ? { in: 'image' } : { in: 'container', configImage: options.configImage },
    )

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
