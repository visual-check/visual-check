import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type ImageMarker, imageMarkerProblem, parseImageMarker, readImageMarker } from './image-marker.js'
import type { BrowserPackage } from './read-browser-package.js'

/**
 * A browser package as `chromium.json` names it.
 */
const browserPackage: BrowserPackage = {
  packageVersion: '157.0.0',
  chromium: '157.0.8103.78',
  image: { tag: 'ghcr.io/visual-check/chromium:157.0.0', digest: `sha256:${'ab'.repeat(32)}` },
  headlessShell: '/opt/chrome-headless-shell/chrome-headless-shell',
}

/**
 * The browser package's image as it is pulled.
 */
const packageImage = `ghcr.io/visual-check/chromium:157.0.0@sha256:${'ab'.repeat(32)}`

/**
 * The folders the tests made, removed after each test.
 */
const folders: string[] = []

/**
 * Makes a temporary folder, to be removed after the test.
 */
function createFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'visual-check-marker-'))

  folders.push(folder)

  return folder
}

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

describe('parseImageMarker', () => {
  it("reads the image's version and architecture, with the trailing newline", () => {
    expect(parseImageMarker('{"version":"157.0.0","arch":"amd64"}\n')).toEqual({ version: '157.0.0', arch: 'amd64' })
    expect(parseImageMarker('{"version":"157.0.0","arch":"arm64"}')).toEqual({ version: '157.0.0', arch: 'arm64' })
  })

  it("throws when the text isn't JSON", () => {
    expect(() => parseImageMarker('nope')).toThrow(/^it isn't JSON: /)
  })

  it("throws when the text isn't an object", () => {
    expect(() => parseImageMarker('[]')).toThrow("it isn't a JSON object")
    expect(() => parseImageMarker('null')).toThrow("it isn't a JSON object")
  })

  it('throws when the version is missing or not a string', () => {
    expect(() => parseImageMarker('{"arch":"amd64"}')).toThrow(
      'it has no valid version: it must be a string, and it is missing',
    )
    expect(() => parseImageMarker('{"version":157,"arch":"amd64"}')).toThrow(
      'it has no valid version: it must be a string, and it is 157',
    )
  })

  it('throws when the arch is neither amd64 nor arm64', () => {
    expect(() => parseImageMarker('{"version":"157.0.0","arch":"x86"}')).toThrow(
      'it has no valid arch: it must be amd64 or arm64, and it is "x86"',
    )
    expect(() => parseImageMarker('{"version":"157.0.0"}')).toThrow(
      'it has no valid arch: it must be amd64 or arm64, and it is missing',
    )
  })
})

describe('readImageMarker', () => {
  it('reads the marker in the file', () => {
    const path = join(createFolder(), 'chromium.json')

    writeFileSync(path, '{"version":"157.0.0","arch":"arm64"}\n')

    expect(readImageMarker(path)).toEqual({ version: '157.0.0', arch: 'arm64' })
  })

  it('gives undefined when there is no file', () => {
    expect(readImageMarker(join(createFolder(), 'chromium.json'))).toBeUndefined()
  })

  it("throws when the path can't be read", () => {
    expect(() => readImageMarker(createFolder())).toThrow(/EISDIR/)
  })

  it('throws when the file is malformed', () => {
    const path = join(createFolder(), 'chromium.json')

    writeFileSync(path, '{}')

    expect(() => readImageMarker(path)).toThrow(/^it has no valid version/)
  })
})

describe('imageMarkerProblem', () => {
  const marker: ImageMarker = { version: '157.0.0', arch: 'amd64' }

  it('gives nothing when the marker matches the browser package and the platform', () => {
    expect(imageMarkerProblem(marker, browserPackage, 'linux/amd64')).toBeUndefined()
    expect(imageMarkerProblem({ ...marker, arch: 'arm64' }, browserPackage, 'linux/arm64')).toBeUndefined()
    expect(imageMarkerProblem(marker, browserPackage, 'host')).toBeUndefined()
  })

  it('names both versions and the fix when the version differs', () => {
    expect(imageMarkerProblem({ ...marker, version: '156.0.0' }, browserPackage, 'linux/amd64')).toBe(
      "This container runs visual-check's image for @visual-check/chromium 156.0.0, but @visual-check/chromium " +
        '157.0.0 is installed.\n' +
        `Run in ${packageImage}, or rebuild your image FROM it.`,
    )
  })

  it("names both architectures and the fix when the platform doesn't fit the image", () => {
    expect(imageMarkerProblem({ ...marker, arch: 'arm64' }, browserPackage, 'linux/amd64')).toBe(
      "This container runs visual-check's image for arm64, but the config's platform is linux/amd64.\n" +
        'Run the container as linux/amd64, such as with docker run --platform linux/amd64 or ' +
        '"runArgs": ["--platform=linux/amd64"] in devcontainer.json, or set platform to ' +
        "'linux/arm64' in the config, which changes it for the whole project.",
    )
  })

  it('lists the version first when both differ', () => {
    expect(imageMarkerProblem({ version: '156.0.0', arch: 'arm64' }, browserPackage, 'linux/amd64')).toBe(
      "This container runs visual-check's image for @visual-check/chromium 156.0.0, but @visual-check/chromium " +
        '157.0.0 is installed.\n' +
        `Run in ${packageImage}, or rebuild your image FROM it.\n` +
        "This container runs visual-check's image for arm64, but the config's platform is linux/amd64.\n" +
        'Run the container as linux/amd64, such as with docker run --platform linux/amd64 or ' +
        '"runArgs": ["--platform=linux/amd64"] in devcontainer.json, or set platform to ' +
        "'linux/arm64' in the config, which changes it for the whole project.",
    )
  })

  it("ignores the architecture for the host's platform but not the version", () => {
    expect(imageMarkerProblem({ version: '156.0.0', arch: 'arm64' }, browserPackage, 'host')).toBe(
      "This container runs visual-check's image for @visual-check/chromium 156.0.0, but @visual-check/chromium " +
        '157.0.0 is installed.\n' +
        `Run in ${packageImage}, or rebuild your image FROM it.`,
    )
  })
})
