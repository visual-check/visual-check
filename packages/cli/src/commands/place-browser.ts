import { availableParallelism, totalmem } from 'node:os'
import { runImageOf } from '../browser/browser-version.js'
import { chromeForTestingPlatformOf } from '../browser/chrome-for-testing-platform.js'
import { imageMarkerPath } from '../browser/image-marker.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import { autoWorkerCount, type BrowserHost } from '../capture/worker-pool.js'
import type { ResolvedConfig } from '../config/resolve-config.js'
import type { ContainerPlatform } from '../container/browser-container.js'
import { ContainerError } from '../container/container-error.js'
import { type DockerHost, type ProbeDocker, probeDocker } from '../container/docker-probe.js'
import { knownContainerIdOf } from '../container/own-container.js'
import { type BrowserPlace, browserPlaceOf } from './browser-route.js'
import { dockerProblemOf } from './docker-problem.js'
import { readImageFit } from './read-image-fit.js'

/**
 * What a run's caller gives for placing the browser, each with its default when the caller gives none.
 */
export interface PlaceBrowserOptions {
  /**
   * Where the marker of visual-check's image is read from. `/etc/visual-check/chromium.json` by default. A test gives
   * another.
   */
  imageMarkerPath?: string
  /**
   * The CPUs and memory of the machine the CLI runs on, which `workers: 'auto'` reads when the browser runs inside
   * visual-check's image or on the host. By default `os.availableParallelism()` and `os.totalmem()`. A test gives its
   * own.
   */
  machine?: BrowserHost
  /**
   * The OS the CLI runs on, which decides between host networking and the proxy, whether `update` warns about baseline
   * paths too long for Windows, with `arch` picks the headless shell `platform: 'host'` downloads, and whether `init`'s
   * Docker warning adds the WSL sentence. `process.platform` by default. A test gives its own.
   */
  os?: NodeJS.Platform
  /**
   * The CPU architecture of the machine the CLI runs on, which with `os` picks the headless shell `platform: 'host'`
   * downloads. `process.arch` by default. A test gives its own.
   */
  arch?: NodeJS.Architecture
  /**
   * Asks Docker what its engine has, before a run whose browser runs in visual-check's container reaches a Storybook.
   * It also tells whether the engine is Docker Desktop's, which decides the browser's route to a Storybook. Inside
   * visual-check's image and on the host no Docker is used, so it isn't asked. `init` asks it once, to warn when Docker
   * can't run the browser. By default it runs `docker info`. A test gives a fake.
   */
  probeDocker?: ProbeDocker
  /**
   * Finds the ID of the container the CLI runs in, when the Docker daemon knows it. By default it reads
   * `/proc/self/mountinfo` and asks `docker inspect`. A test gives a fake.
   */
  findKnownContainer?: () => Promise<string | undefined>
}

/**
 * Where a run's browser runs, with what it has there.
 */
export interface BrowserPlacement {
  /**
   * Where the browser runs.
   */
  place: BrowserPlace
  /**
   * The CPUs and memory where the browser runs.
   */
  host: BrowserHost
}

/**
 * Decides where the run's browser runs and reads the CPUs and memory there: inside visual-check's image and on the
 * host the machine's own, with no Docker used, and in visual-check's container Docker's engine's, which the Docker
 * probe reads. In a container, the route to a Storybook comes from the container the CLI runs in, whether the engine
 * is Docker Desktop's, and the OS. Gives the place with them, or what to print when the browser has no place to run or
 * Docker can't run it.
 *
 * @throws {Error} Any error the probe throws besides a `ContainerError`.
 */
export async function placeBrowser(
  config: Pick<ResolvedConfig, 'platform' | 'image'>,
  browserPackage: BrowserPackage,
  insideContainer: boolean,
  options: PlaceBrowserOptions,
): Promise<BrowserPlacement | { problem: string }> {
  const imageFit = readImageFit(config.platform, browserPackage, options.imageMarkerPath ?? imageMarkerPath)

  if ('problem' in imageFit) {
    return { problem: `${imageFit.problem}\n` }
  }

  if (imageFit.insideImage) {
    return { place: browserPlaceOf({ insideImage: true }), host: options.machine ?? machineOf() }
  }

  if (imageFit.platform === 'host') {
    return hostPlaceOf(options)
  }

  let docker: DockerHost

  try {
    docker = await (options.probeDocker ?? probeDocker)()
  } catch (error) {
    if (error instanceof ContainerError) {
      return { problem: dockerProblemOf(error, { insideContainer, image: runImageOf(browserPackage, config.image) }) }
    }

    throw error
  }

  return { place: await containerPlaceOf(imageFit.platform, docker, options), host: docker }
}

/**
 * Places the browser on the host, as the headless shell Chrome for Testing builds for the machine's OS and CPU
 * architecture, with the machine's CPUs and memory. No Docker is used. Gives the problem that exits 2 when Chrome for
 * Testing has no build for the machine.
 */
function hostPlaceOf(options: PlaceBrowserOptions): BrowserPlacement | { problem: string } {
  const download = chromeForTestingPlatformOf(options.os ?? process.platform, options.arch ?? process.arch)

  if ('problem' in download) {
    return { problem: `${download.problem}\n` }
  }

  return { place: { in: 'host', platform: download.platform }, host: options.machine ?? machineOf() }
}

/**
 * Gives the place of a browser in visual-check's container on this platform, with the route the five rules give it
 * from the container the CLI runs in, whether Docker's engine is Docker Desktop's, and the OS.
 */
async function containerPlaceOf(
  platform: ContainerPlatform,
  docker: DockerHost,
  options: PlaceBrowserOptions,
): Promise<BrowserPlace> {
  return browserPlaceOf({
    insideImage: false,
    platform,
    containerId: await (options.findKnownContainer ?? knownContainerIdOf)(),
    dockerDesktop: docker.desktop,
    os: options.os ?? process.platform,
  })
}

/**
 * Reads the CPUs and memory of the machine the CLI runs on.
 */
function machineOf(): BrowserHost {
  return { cpus: availableParallelism(), memoryBytes: totalmem() }
}

/**
 * Gives how many workers a run captures with: the number asked for, and for `'auto'` what the CPUs and memory where the
 * browser runs allow.
 */
export function workerCountOf(requested: 'auto' | number, host: BrowserHost): number {
  return requested === 'auto' ? autoWorkerCount(host) : requested
}
