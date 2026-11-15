import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type CheckedBrowser, checkBrowserVersion, runImageOf } from '../browser/browser-version.js'
import type { ChromeForTestingPlatform } from '../browser/chrome-for-testing-platform.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import {
  headlessShellPathsOf,
  type InstallHeadlessShellOptions,
  installHeadlessShell,
} from '../browser-download/install-headless-shell.js'
import { startBrowserProcess } from '../browser-process/start-browser-process.js'
import { type CaptureSession, type CaptureSettings, openCaptureSession } from '../capture/capture-session.js'
import { type CdpDriverOptions, launchCdpDriver } from '../capture/driver/cdp/cdp-driver.js'
import { BrowserLaunchError, type BrowserSystem, type Driver } from '../capture/driver/driver.js'
import {
  type ContainerNetwork,
  type ContainerPlatform,
  startBrowserInContainer,
} from '../container/browser-container.js'
import { pullMissingImage } from '../container/image-pull.js'
import { launchThroughProxy } from '../container/launch-through-proxy.js'
import type { BrowserPlace, ContainerRoute } from './browser-route.js'

/**
 * The folder Chromium keeps its profile in, inside the container. The container is removed when the browser exits, and
 * the profile with it.
 */
const containerProfileDir = '/tmp/visual-check-profile'

/**
 * The OS each Chrome for Testing platform's headless shell runs on, which picks the font table its pages use.
 */
const systemOfPlatform: Record<ChromeForTestingPlatform, BrowserSystem> = {
  linux64: 'linux',
  'linux-arm64': 'linux',
  'mac-x64': 'macos',
  'mac-arm64': 'macos',
  win64: 'windows',
}

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
       * How the browser reaches a Storybook.
       */
      route: ContainerRoute
      /**
       * The path of the headless shell's executable inside the image.
       */
      executable: string
      /**
       * Writes the progress of a pull as it happens.
       */
      progress: (text: string) => void
    }
  | {
      /**
       * The browser runs on the host, from the headless shell visual-check downloads into its cache.
       */
      in: 'host'
      /**
       * The Chrome for Testing platform whose headless shell runs on the machine.
       */
      platform: ChromeForTestingPlatform
      /**
       * The Chromium version to download, such as `157.0.8103.78`.
       */
      version: string
      /**
       * The SHA-256 the platform's download must have, from the browser package.
       */
      sha256: string
      /**
       * The browser package's version, which a checksum mismatch names.
       */
      packageVersion: string
      /**
       * The environment, for the cache folder, the mirror and the proxy.
       */
      environment: Record<string, string | undefined>
      /**
       * Writes the progress of the download as it happens.
       */
      progress: (text: string) => void
    }

/**
 * Launches the browser a run captures in, and resolves with its driver once it has connected. In visual-check's
 * container, the launch's route says how the browser reaches a Storybook: with host networking, on the network of the
 * container the CLI runs in, or through a SOCKS proxy in the CLI that lives as long as the driver, which the browser is
 * checked to reach before the driver resolves.
 *
 * @throws {ContainerError} When Docker can't be run, the image can't be pulled, or the browser can't reach the proxy.
 * @throws {BrowserDownloadError} When the headless shell can't be downloaded to the host.
 * @throws {BrowserLaunchError} When the browser doesn't connect, or fails any other way while it is checked to reach
 * the proxy.
 * @throws {BrowserExitedError} When the browser exits while it is checked to reach the proxy.
 */
export type LaunchBrowser = (launch: BrowserLaunch) => Promise<Driver>

/**
 * What a launcher downloads the headless shell with and starts the browser with. A test gives fakes.
 */
interface LauncherSeams {
  /**
   * Gives the executable of the headless shell for the host, downloading it when the cache doesn't hold it.
   * `installHeadlessShell` by default.
   */
  install?: (options: InstallHeadlessShellOptions) => Promise<string>
  /**
   * Starts the browser and connects to it over CDP. `launchCdpDriver` by default.
   */
  launchDriver?: (options: CdpDriverOptions) => Promise<Driver>
}

/**
 * How the headless shell starts as a child process of the CLI.
 */
interface ChildBrowser {
  /**
   * The path of the headless shell's executable.
   */
  executable: string
  /**
   * Whether Chromium's sandbox is on.
   */
  sandbox: boolean
  /**
   * The OS the browser runs on, which picks the font table.
   */
  system: BrowserSystem
}

/**
 * Starts the headless shell as a child process of the CLI, with a fresh profile folder in the OS's temporary folder,
 * and connects to it over CDP. The profile folder goes once the browser has exited.
 */
async function launchChildBrowser(
  launchDriver: (options: CdpDriverOptions) => Promise<Driver>,
  child: ChildBrowser,
): Promise<Driver> {
  const profileDir = await mkdtemp(join(tmpdir(), 'visual-check-profile-'))

  return await launchDriver({
    start: startBrowserProcess({ executable: child.executable, profileDir }),
    sandbox: child.sandbox,
    profileDir,
    system: child.system,
  })
}

/**
 * Starts the browser in visual-check's container on this network, with its sandbox off because the container is the
 * boundary, and connects to it over CDP. Every request goes through the proxy when one is given.
 */
async function launchCdpInContainer(
  launchDriver: (options: CdpDriverOptions) => Promise<Driver>,
  launch: Extract<BrowserLaunch, { in: 'container' }>,
  network: ContainerNetwork,
  proxyServer?: string,
): Promise<Driver> {
  return await launchDriver({
    start: startBrowserInContainer({
      image: launch.image,
      platform: launch.platform,
      executable: launch.executable,
      network,
    }),
    sandbox: false,
    profileDir: containerProfileDir,
    system: 'linux',
    ...(proxyServer === undefined ? {} : { proxyServer }),
  })
}

/**
 * Pulls the image when Docker doesn't have it for the platform, then starts the browser in visual-check's container
 * and connects to it over CDP. The route decides how it reaches a Storybook: `host` uses the machine's network,
 * `container:<id>` joins the network of the container the CLI runs in, and `proxy` goes through a SOCKS proxy in the
 * CLI.
 */
async function launchBrowserInContainer(
  launchDriver: (options: CdpDriverOptions) => Promise<Driver>,
  launch: Extract<BrowserLaunch, { in: 'container' }>,
): Promise<Driver> {
  await pullMissingImage(launch.image, launch.platform, launch.progress)

  if (launch.route === 'proxy') {
    // On the bridge network every request, loopback included, goes through the proxy, so the Storybook is reached from
    // the CLI's machine.
    return await launchThroughProxy((proxyServer) => launchCdpInContainer(launchDriver, launch, 'bridge', proxyServer))
  }

  return await launchCdpInContainer(launchDriver, launch, launch.route)
}

/**
 * Makes the launcher of one run, which launches the browser where each launch says.
 *
 * - Inside visual-check's image, the headless shell starts as a child process of the CLI. Chromium's sandbox is off and
 *   never tried, because the container the CLI runs in is the boundary. Nothing is pulled and no `docker` runs.
 * - In visual-check's container, as `launchBrowserInContainer` says.
 * - On the host, the first launch downloads the headless shell, unless the cache holds it, and later launches reuse it.
 *   The first launch starts it as a child process of the CLI with Chromium's sandbox. When it exits at launch, as it
 *   does where the OS doesn't allow the sandbox, it starts again without it, printing nothing. Whichever launch first
 *   connects settles the sandbox for the run, and every later launch keeps it, with no fallback. It never uses Docker
 *   or the proxy.
 */
export function createLaunchBrowser(seams: LauncherSeams = {}): LaunchBrowser {
  const install = seams.install ?? installHeadlessShell
  const launchDriver = seams.launchDriver ?? launchCdpDriver
  // Undefined until a launch on the host settles it.
  let sandbox: boolean | undefined
  let installed: string | undefined

  const launchOnHost = async (launch: Extract<BrowserLaunch, { in: 'host' }>): Promise<Driver> => {
    const { version, platform, sha256, packageVersion, environment, progress } = launch

    installed ??= await install({ version, platform, sha256, packageVersion, environment, progress })

    const child = { executable: installed, system: systemOfPlatform[platform] }

    try {
      const driver = await launchChildBrowser(launchDriver, { ...child, sandbox: sandbox ?? true })

      sandbox ??= true

      return driver
    } catch (error) {
      if (!(sandbox === undefined && error instanceof BrowserLaunchError && error.exited)) {
        throw error
      }

      const driver = await launchChildBrowser(launchDriver, { ...child, sandbox: false })

      sandbox = false

      return driver
    }
  }

  return async (launch) => {
    switch (launch.in) {
      case 'image':
        return await launchChildBrowser(launchDriver, {
          executable: launch.executable,
          sandbox: false,
          system: 'linux',
        })
      case 'container':
        return await launchBrowserInContainer(launchDriver, launch)
      case 'host':
        return await launchOnHost(launch)
    }
  }
}

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
 * The browser a run captures in, launched at the first story that needs it, with one capture session for each worker.
 */
export interface RunBrowser {
  /**
   * The capture session of a worker. The first call launches the browser and checks that it is the browser package's
   * build, and every call shares that one browser. A worker's first call opens its session, which keeps its own page.
   *
   * @throws {ContainerError} When Docker can't be run, the image can't be pulled, or the browser can't reach the proxy.
   * @throws {BrowserDownloadError} When the headless shell can't be downloaded to the host.
   * @throws {BrowserLaunchError} When the browser doesn't connect, or fails any other way while it is checked to reach
   * the proxy.
   * @throws {BrowserExitedError} When the browser exits while it is checked to reach the proxy.
   * @throws {BrowserMismatchError} When the browser isn't the browser package's build.
   */
  session: (worker: number) => Promise<CaptureSession>
  /**
   * Closes every session's page and the browser, if they were opened. Waits for a launch still in flight, so no
   * browser is left running, and doesn't throw when the launch failed.
   */
  close: () => Promise<void>
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
 * Prepares a run's browser, which `launcher` launches. Nothing is launched until the first `session()`.
 */
export function runBrowserOf(launcher: LaunchBrowser, options: RunBrowserOptions): RunBrowser {
  let launched: Promise<Driver> | undefined
  const sessions = new Map<number, CaptureSession>()

  const launch = async (): Promise<Driver> => {
    const driver = await launcher(browserLaunchOf(options))

    try {
      checkBrowserVersion(driver.version, options.browserPackage, checkedBrowserOf(options))
    } catch (error) {
      await driver.close()

      throw error
    }

    return driver
  }

  return {
    session: async (worker) => {
      launched ??= launch()

      const driver = await launched
      let session = sessions.get(worker)

      if (session === undefined) {
        session = openCaptureSession(driver, options.settings)
        sessions.set(worker, session)
      }

      return session
    },
    close: async () => {
      await Promise.all([...sessions.values()].map((session) => session.close()))

      const driver = await launched?.catch(() => undefined)

      await driver?.close()
    },
  }
}
