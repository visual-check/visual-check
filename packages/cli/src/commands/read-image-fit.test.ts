import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import { readImageFit } from './read-image-fit.js'

/**
 * A browser package as `chromium.json` names it.
 */
const browserPackage: BrowserPackage = {
  packageVersion: '157.0.0',
  chromium: '157.0.8103.78',
  image: { tag: 'ghcr.io/visual-check/chromium:157.0.0', digest: `sha256:${'ab'.repeat(32)}` },
  headlessShell: '/opt/chrome-headless-shell/chrome-headless-shell',
  sha256: {
    linux64: '1'.repeat(64),
    'linux-arm64': '2'.repeat(64),
    'mac-x64': '3'.repeat(64),
    'mac-arm64': '4'.repeat(64),
    win64: '5'.repeat(64),
  },
}

/**
 * The browser package's image as it is pulled.
 */
const packageImage = `ghcr.io/visual-check/chromium:157.0.0@sha256:${'ab'.repeat(32)}`

/**
 * The fix line every marker problem that names the image ends with.
 */
const imageFix = `Run in ${packageImage}, or rebuild your image FROM it.`

/**
 * The folders the tests made, removed after each test.
 */
const folders: string[] = []

/**
 * Makes a temporary folder, to be removed after the test.
 */
function createFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'visual-check-image-fit-'))

  folders.push(folder)

  return folder
}

/**
 * Writes a marker file with the given text in a temporary folder. Returns its path.
 */
function writeMarker(text: string): string {
  const path = join(createFolder(), 'chromium.json')

  writeFileSync(path, text)

  return path
}

/**
 * Gives a marker path where no file exists.
 */
function absentMarker(): string {
  return join(createFolder(), 'chromium.json')
}

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

describe('readImageFit', () => {
  it("says the CLI runs inside visual-check's image when the marker fits, for every platform", () => {
    const amd64 = writeMarker('{"version":"157.0.0","arch":"amd64"}\n')

    expect(readImageFit('linux/amd64', browserPackage, amd64)).toEqual({ insideImage: true })
    expect(readImageFit('host', browserPackage, amd64)).toEqual({ insideImage: true })
    expect(readImageFit('linux/arm64', browserPackage, writeMarker('{"version":"157.0.0","arch":"arm64"}\n'))).toEqual({
      insideImage: true,
    })
  })

  it('gives the version problem when the image is for another browser package version', () => {
    const problem = readImageFit('linux/amd64', browserPackage, writeMarker('{"version":"156.0.0","arch":"amd64"}\n'))

    expect(problem).toEqual({
      problem:
        "This container runs visual-check's image for @visual-check/chromium 156.0.0, but @visual-check/chromium " +
        `157.0.0 is installed.\n${imageFix}`,
    })
  })

  it("gives the architecture problem when the image's isn't the platform's", () => {
    const marker = writeMarker('{"version":"157.0.0","arch":"arm64"}\n')

    expect(readImageFit('linux/amd64', browserPackage, marker)).toEqual({
      problem:
        "This container runs visual-check's image for arm64, but the config's platform is linux/amd64.\n" +
        'Run the container as linux/amd64, such as with docker run --platform linux/amd64 or ' +
        '"runArgs": ["--platform=linux/amd64"] in devcontainer.json, or set platform to ' +
        "'linux/arm64' in the config, which changes it for the whole project.",
    })
  })

  it("ignores the image's architecture for the host platform", () => {
    expect(readImageFit('host', browserPackage, writeMarker('{"version":"157.0.0","arch":"arm64"}\n'))).toEqual({
      insideImage: true,
    })
  })

  it('gives a problem that names the marker and the fix when it is malformed', () => {
    const path = writeMarker('not json')
    const result = readImageFit('linux/amd64', browserPackage, path)

    expect(result).toHaveProperty('problem')

    const { problem } = result as { problem: string }

    expect(problem.startsWith(`visual-check can't read ${path}, the marker of visual-check's image: `)).toBe(true)
    expect(problem).toContain("it isn't JSON")
    expect(problem.endsWith(`.\n${imageFix}`)).toBe(true)
  })

  it("gives a problem that names the marker when it can't be read", () => {
    const path = createFolder()
    const result = readImageFit('linux/amd64', browserPackage, path)

    expect(result).toHaveProperty('problem')

    const { problem } = result as { problem: string }

    expect(problem.startsWith(`visual-check can't read ${path}, the marker of visual-check's image: `)).toBe(true)
    expect(problem).toContain('EISDIR')
    expect(problem.endsWith(`.\n${imageFix}`)).toBe(true)
  })

  it("gives the host platform outside visual-check's image", () => {
    expect(readImageFit('host', browserPackage, absentMarker())).toEqual({ insideImage: false, platform: 'host' })
  })

  it("gives the config's platform for the container outside visual-check's image", () => {
    expect(readImageFit('linux/arm64', browserPackage, absentMarker())).toEqual({
      insideImage: false,
      platform: 'linux/arm64',
    })
  })
})
