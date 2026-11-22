import { availableParallelism, totalmem } from 'node:os'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { ContainerError } from '../container/container-error.js'
import { type PlaceBrowserOptions, placeBrowser, workerCountOf } from './place-browser.js'
import {
  absentMarkerPath,
  browserPackage,
  cleanUpRuns,
  containerId,
  desktopProbe,
  markerOf,
  removeMarkerFolder,
  writeMarker,
} from './run-cli.fixture.js'

/**
 * The machine the CLI runs on, whose CPUs and memory differ from the Docker engine's.
 */
const machine = { cpus: 8, memoryBytes: 32 * 2 ** 30 }

/**
 * What the Docker probe finds: an engine that isn't Docker Desktop's, with CPUs and memory unlike the machine's.
 */
const engine = { cpus: 4, memoryBytes: 16 * 2 ** 30, desktop: false }

/**
 * Options that place the browser on Linux on x64, outside visual-check's image and outside any container.
 */
const linuxOptions = {
  imageMarkerPath: absentMarkerPath,
  machine,
  os: 'linux',
  arch: 'x64',
  probeDocker: async () => engine,
  findKnownContainer: async () => undefined,
} satisfies PlaceBrowserOptions

/**
 * Options that fail the test when Docker is asked for anything.
 */
const noDocker = {
  ...linuxOptions,
  probeDocker: () => Promise.reject(new Error('Docker was probed.')),
  findKnownContainer: () => Promise.reject(new Error('The container was looked for.')),
} satisfies PlaceBrowserOptions

/**
 * Options of a run whose Docker is missing.
 */
const noEngine = {
  ...linuxOptions,
  probeDocker: () => Promise.reject(new ContainerError('Docker is gone.')),
} satisfies PlaceBrowserOptions

/**
 * A config that runs the browser on linux/amd64 in the browser package's image.
 */
const amd64 = { platform: 'linux/amd64', image: undefined } as const

/**
 * A config that runs the browser on the host.
 */
const host = { platform: 'host', image: undefined } as const

afterEach(cleanUpRuns)

afterAll(removeMarkerFolder)

describe("placeBrowser inside visual-check's image", () => {
  it('runs the browser directly, on the machine, and asks no Docker', async () => {
    const options = { ...noDocker, imageMarkerPath: writeMarker(markerOf('amd64')) }

    expect(await placeBrowser(amd64, browserPackage, true, options)).toEqual({ place: { in: 'image' }, host: machine })
  })

  it('reads the CPUs and memory of the machine it runs on when none are given', async () => {
    const { machine: _, ...options } = { ...noDocker, imageMarkerPath: writeMarker(markerOf('amd64')) }

    expect(await placeBrowser(amd64, browserPackage, true, options)).toEqual({
      place: { in: 'image' },
      host: { cpus: availableParallelism(), memoryBytes: totalmem() },
    })
  })

  it("gives the problem of a marker that can't be read, ending with a newline", async () => {
    const imageMarkerPath = writeMarker('{')

    expect(await placeBrowser(amd64, browserPackage, true, { ...noDocker, imageMarkerPath })).toEqual({
      problem: expect.stringMatching(/^visual-check can't read .*chromium\.json, the marker of [^\n]+\n.+\.\n$/),
    })
  })
})

describe('placeBrowser on the host', () => {
  it('gives the platform built for the OS and architecture, on the machine, and asks no Docker', async () => {
    const options = { ...noDocker, os: 'darwin', arch: 'arm64' } satisfies PlaceBrowserOptions

    expect(await placeBrowser(host, browserPackage, false, options)).toEqual({
      place: { in: 'host', platform: 'mac-arm64' },
      host: machine,
    })
  })

  it('gives the problem when Chrome for Testing has no build for the machine', async () => {
    const options = { ...noDocker, os: 'win32', arch: 'arm64' } satisfies PlaceBrowserOptions

    expect(await placeBrowser(host, browserPackage, false, options)).toEqual({
      problem:
        "Chrome for Testing has no build for Windows on Arm, so platform: 'host' can't run here. " +
        "Set platform to 'linux/arm64' in the config to run the browser in visual-check's container.\n",
    })
  })
})

describe("placeBrowser in visual-check's container", () => {
  it('uses host networking on Linux, with the CPUs and memory of the engine', async () => {
    const config = { platform: 'linux/arm64', image: undefined } as const

    expect(await placeBrowser(config, browserPackage, false, linuxOptions)).toEqual({
      place: { in: 'container', platform: 'linux/arm64', route: 'host' },
      host: engine,
    })
  })

  it.each<[string, PlaceBrowserOptions, string]>([
    ['Docker Desktop on Linux', { probeDocker: desktopProbe }, 'proxy'],
    ['macOS without Docker Desktop', { os: 'darwin' }, 'proxy'],
    ['a container Docker knows', { findKnownContainer: async () => containerId }, `container:${containerId}`],
  ])('takes the route of %s', async (_name, options, route) => {
    expect(await placeBrowser(amd64, browserPackage, false, { ...linuxOptions, ...options })).toMatchObject({
      place: { in: 'container', platform: 'linux/amd64', route },
    })
  })

  it('gives what to print when Docker is missing', async () => {
    expect(await placeBrowser(amd64, browserPackage, false, noEngine)).toEqual({
      problem: "Docker is gone.\nStart or install Docker, or set platform: 'host' in the config.\n",
    })
  })

  it.each([
    ["the config's image", 'registry.test/chromium:1', 'registry.test/chromium:1'],
    ["the browser package's image", undefined, browserPackage.imageReference],
  ])('names %s in the fix inside a container', async (_name, image, named) => {
    expect(await placeBrowser({ ...amd64, image }, browserPackage, true, noEngine)).toEqual({
      problem: expect.stringContaining(`in a job container on visual-check's image, ${named}, which needs no Docker.`),
    })
  })

  it("passes on an error the probe throws that isn't a Docker problem", async () => {
    const options = { ...linuxOptions, probeDocker: () => Promise.reject(new TypeError('A bug.')) }

    await expect(placeBrowser(amd64, browserPackage, false, options)).rejects.toThrow(new TypeError('A bug.'))
  })
})

describe('workerCountOf', () => {
  it('gives the number asked for, whatever the CPUs and memory', () => {
    expect(workerCountOf(12, { cpus: 2, memoryBytes: 2 ** 30 })).toBe(12)
  })

  it.each([
    ['CPUs', { cpus: 3, memoryBytes: 16 * 2 ** 30 }],
    ['memory', { cpus: 8, memoryBytes: 4 * 2 ** 30 }],
  ])('gives what the %s allow for auto', (_name, allowed) => {
    expect(workerCountOf('auto', allowed)).toBe(3)
  })
})
