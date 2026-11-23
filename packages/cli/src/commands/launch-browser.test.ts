import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChromeForTestingPlatform } from '../browser/chrome-for-testing-platform.js'
import { BrowserDownloadError } from '../browser-download/browser-download-error.js'
import type { InstallHeadlessShellOptions } from '../browser-download/install-headless-shell.js'
import type { CdpDriverOptions } from '../capture/driver/cdp/cdp-driver.js'
import { BrowserLaunchError, type Driver } from '../capture/driver/driver.js'
import { type FakeDocker, installFakeDocker } from '../container/fake-docker.fixture.js'
import { type BrowserLaunch, createLaunchBrowser } from './launch-browser.js'

/**
 * The launch of the headless shell on the host.
 */
type HostLaunch = Extract<BrowserLaunch, { in: 'host' }>

/**
 * The launch of the headless shell in visual-check's container.
 */
const containerLaunch: Extract<BrowserLaunch, { in: 'container' }> = {
  in: 'container',
  image: 'ghcr.io/visual-check/chromium@sha256:abc',
  platform: 'linux/amd64',
  route: 'host',
  executable: '/opt/chromium/chrome-headless-shell',
  progress: () => undefined,
}

/**
 * The executable the fake install gives.
 */
const executable = '/cache/visual-check/chromium/157.0.8103.78/chrome-headless-shell-linux64/chrome-headless-shell'

/**
 * The profile folders the launches made, removed after each test, since the fake driver never starts a browser that
 * would remove them.
 */
const profileDirs: string[] = []

afterEach(() => {
  for (const profileDir of profileDirs.splice(0)) {
    rmSync(profileDir, { recursive: true, force: true })
  }
})

/**
 * A browser that answered.
 */
const driver: Driver = {
  version: '157.0.8103.78',
  exited: new Promise(() => undefined),
  newPage: () => Promise.reject(new Error('The test opened a page.')),
  close: async () => undefined,
}

/**
 * The launch error of a browser that exited before it answered, as Chromium does when its sandbox can't start.
 */
function exitedAtLaunch(): BrowserLaunchError {
  return new BrowserLaunchError(
    'The browser exited with code 1 before it answered.',
    ['FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox!'],
    { exited: true },
  )
}

/**
 * What a fake launcher saw.
 */
interface FakeLauncher {
  /**
   * Launches the browser with the fake install and the fake driver launch.
   */
  launchBrowser: ReturnType<typeof createLaunchBrowser>
  /**
   * Every install, in order.
   */
  installs: InstallHeadlessShellOptions[]
  /**
   * Every driver launch, in order.
   */
  launches: CdpDriverOptions[]
}

/**
 * Builds a launcher whose install gives `executable`, or fails with `installError`, and whose driver launches each
 * answer with the next outcome: the driver, or an error to throw.
 */
function fakeLauncher(outcomes: (Driver | Error)[], installError?: Error): FakeLauncher {
  const installs: InstallHeadlessShellOptions[] = []
  const launches: CdpDriverOptions[] = []
  const launchBrowser = createLaunchBrowser({
    install: async (options) => {
      installs.push(options)

      if (installError !== undefined) {
        throw installError
      }

      return executable
    },
    launchDriver: async (options) => {
      launches.push(options)
      profileDirs.push(options.profileDir)

      const outcome = outcomes.shift()

      if (outcome === undefined) {
        throw new Error('The test launched more browsers than it expected.')
      }

      if (outcome instanceof Error) {
        throw outcome
      }

      return outcome
    },
  })

  return { launchBrowser, installs, launches }
}

/**
 * Builds the launch of the headless shell for the Chrome for Testing platform on the host, writing its progress into
 * `printed`.
 */
function hostLaunch(printed: string[], platform: ChromeForTestingPlatform = 'linux64'): HostLaunch {
  return {
    in: 'host',
    platform,
    version: '157.0.8103.78',
    sha256: '1'.repeat(64),
    packageVersion: '157.0.0',
    environment: { VISUAL_CHECK_CACHE_DIR: '/cache/visual-check' },
    progress: (text) => printed.push(text),
  }
}

describe('createLaunchBrowser on the host', () => {
  it("installs the browser package's headless shell for the platform, then launches it with the sandbox", async () => {
    const printed: string[] = []
    const { launchBrowser, installs, launches } = fakeLauncher([driver])
    const launch = hostLaunch(printed)

    expect(await launchBrowser(launch)).toBe(driver)
    expect(installs).toEqual([
      {
        version: '157.0.8103.78',
        platform: 'linux64',
        sha256: '1'.repeat(64),
        packageVersion: '157.0.0',
        environment: { VISUAL_CHECK_CACHE_DIR: '/cache/visual-check' },
        progress: launch.progress,
      },
    ])
    expect(launches).toEqual([
      { sandbox: true, system: 'linux', profileDir: expect.stringContaining(tmpdir()), start: expect.any(Function) },
    ])
  })

  it('relaunches without the sandbox, silently and with a fresh profile, when it exits at launch', async () => {
    const printed: string[] = []
    const { launchBrowser, launches } = fakeLauncher([exitedAtLaunch(), driver])

    expect(await launchBrowser(hostLaunch(printed))).toBe(driver)
    expect(launches.map(({ sandbox }) => sandbox)).toEqual([true, false])
    expect(launches[0]?.profileDir).not.toBe(launches[1]?.profileDir)
    expect(printed).toEqual([])
  })

  it('keeps the choice for later launches of the run, downloading only once', async () => {
    const { launchBrowser, installs, launches } = fakeLauncher([exitedAtLaunch(), driver, driver])

    await launchBrowser(hostLaunch([]))
    await launchBrowser(hostLaunch([]))

    expect(launches.map(({ sandbox }) => sandbox)).toEqual([true, false, false])
    expect(installs).toHaveLength(1)
  })

  it('keeps the sandbox for later launches when the first one worked with it', async () => {
    const { launchBrowser, launches } = fakeLauncher([driver, driver])

    await launchBrowser(hostLaunch([]))
    await launchBrowser(hostLaunch([]))

    expect(launches.map(({ sandbox }) => sandbox)).toEqual([true, true])
  })

  it("doesn't drop the sandbox when a later launch exits at launch after the first worked with it", async () => {
    const exited = exitedAtLaunch()
    const { launchBrowser, launches } = fakeLauncher([driver, exited, driver])

    await launchBrowser(hostLaunch([]))
    await expect(launchBrowser(hostLaunch([]))).rejects.toBe(exited)
    expect(launches.map(({ sandbox }) => sandbox)).toEqual([true, true])
  })

  it("doesn't relaunch when the browser didn't answer in time", async () => {
    const timeout = new BrowserLaunchError("The browser didn't answer within 30 s.", [], { exited: false })
    const { launchBrowser, launches } = fakeLauncher([timeout, driver])

    await expect(launchBrowser(hostLaunch([]))).rejects.toBe(timeout)
    expect(launches).toHaveLength(1)
  })

  it("doesn't relaunch after an error that isn't a failed launch", async () => {
    const error = new Error('A bug.')
    const { launchBrowser, launches } = fakeLauncher([error, driver])

    await expect(launchBrowser(hostLaunch([]))).rejects.toBe(error)
    expect(launches).toHaveLength(1)
  })

  it("throws the relaunch's error when the browser exits without the sandbox too", async () => {
    const second = new BrowserLaunchError('The browser exited with code 127 before it answered.', ['libnss3.so'], {
      exited: true,
    })
    const { launchBrowser, launches } = fakeLauncher([exitedAtLaunch(), second, driver])

    await expect(launchBrowser(hostLaunch([]))).rejects.toBe(second)
    expect(launches.map(({ sandbox }) => sandbox)).toEqual([true, false])
  })

  it('leaves the sandbox unsettled when neither launch connects, so the next launch tries it first', async () => {
    const { launchBrowser, launches } = fakeLauncher([exitedAtLaunch(), exitedAtLaunch(), driver])

    await expect(launchBrowser(hostLaunch([]))).rejects.toBeInstanceOf(BrowserLaunchError)
    await launchBrowser(hostLaunch([]))

    expect(launches.map(({ sandbox }) => sandbox)).toEqual([true, false, true])
  })

  it.each([
    ['linux64', 'linux'],
    ['linux-arm64', 'linux'],
    ['mac-x64', 'macos'],
    ['mac-arm64', 'macos'],
    ['win64', 'windows'],
  ] as const)('gives the %s headless shell the %s font table', async (platform, system) => {
    const { launchBrowser, launches } = fakeLauncher([driver])

    await launchBrowser(hostLaunch([], platform))

    expect(launches[0]?.system).toBe(system)
  })

  it("throws the download's error without launching", async () => {
    const error = new BrowserDownloadError('The download of Chromium 157.0.8103.78 (linux64) failed.')
    const { launchBrowser, launches } = fakeLauncher([driver], error)

    await expect(launchBrowser(hostLaunch([]))).rejects.toBe(error)
    expect(launches).toEqual([])
  })
})

describe("createLaunchBrowser inside visual-check's image", () => {
  it('launches the headless shell without the sandbox and never tries it', async () => {
    const { launchBrowser, installs, launches } = fakeLauncher([driver])

    expect(await launchBrowser({ in: 'image', executable: '/opt/chrome-headless-shell/chrome-headless-shell' })).toBe(
      driver,
    )
    expect(installs).toEqual([])
    expect(launches).toEqual([
      { sandbox: false, system: 'linux', profileDir: expect.stringContaining(tmpdir()), start: expect.any(Function) },
    ])
  })
})

describe("createLaunchBrowser in visual-check's container", () => {
  let fake: FakeDocker | undefined

  afterEach(() => {
    fake?.remove()
    fake = undefined
  })

  it('stops the pull and launches nothing when the signal aborts during the pull', async () => {
    const docker = installFakeDocker({ imagePresent: false, pullHangs: true })

    fake = docker

    const controller = new AbortController()
    const reason = new Error('The check was cancelled.')
    const { launchBrowser, launches } = fakeLauncher([driver])
    const launch = launchBrowser({
      ...containerLaunch,
      progress: () => controller.abort(reason),
      signal: controller.signal,
    })

    await expect(launch).rejects.toBe(reason)
    await expect.poll(() => docker.pullIsRunning()).toBe(false)
    expect(launches).toEqual([])
  })

  it('launches nothing when the signal aborts as the inspect ends that finds the image', async () => {
    const docker = installFakeDocker({ holdInspect: true })

    fake = docker

    const controller = new AbortController()
    const reason = new Error('The check was cancelled.')
    const { launchBrowser, launches } = fakeLauncher([driver])
    const launch = launchBrowser({ ...containerLaunch, signal: controller.signal })

    // The process is gone, so the abort can't kill it, but its output hasn't ended.
    await expect.poll(() => docker.inspectIsRunning()).toBe(false)
    controller.abort(reason)
    docker.releaseInspect()
    await expect(launch).rejects.toBe(reason)
    expect(docker.calls()).toHaveLength(1)
    expect(launches).toEqual([])
  })

  it('launches nothing when the signal has aborted before the launch', async () => {
    fake = installFakeDocker()

    const reason = new Error('The check was cancelled.')
    const { launchBrowser, launches } = fakeLauncher([driver])

    await expect(launchBrowser({ ...containerLaunch, signal: AbortSignal.abort(reason) })).rejects.toBe(reason)
    expect(fake.calls()).toEqual([])
    expect(launches).toEqual([])
  })
})
