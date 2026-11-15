import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { parseBrowserPackage, readBrowserPackage } from './read-browser-package.js'

/**
 * A well-formed `chromium.json`.
 */
const chromiumJson = {
  chromium: '157.0.8103.78',
  image: {
    tag: 'ghcr.io/visual-check/chromium:157.0.0',
    digest: `sha256:${'ab'.repeat(32)}`,
  },
  headlessShell: '/opt/chrome-headless-shell/chrome-headless-shell',
  sha256: {
    linux64: '1'.repeat(64),
    'linux-arm64': '2'.repeat(64),
    'mac-x64': '3'.repeat(64),
    'mac-arm64': '4'.repeat(64),
    win64: '5'.repeat(64),
    other: 'ignored',
  },
}

describe('parseBrowserPackage', () => {
  it('reads the build, the image, the headless shell and its checksums, with the package version', () => {
    expect(parseBrowserPackage(chromiumJson, '157.0.0')).toEqual({
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
    })
  })

  it('throws for a file that is not an object', () => {
    expect(() => parseBrowserPackage([], '157.0.0')).toThrow("its chromium.json isn't a JSON object")
  })

  const malformed: [string, Record<string, unknown>][] = [
    ['chromium', { chromium: undefined }],
    ['chromium', { chromium: '157' }],
    ['chromium', { chromium: 157 }],
    ['image', { image: 'ghcr.io/visual-check/chromium:157.0.0' }],
    ['image.tag', { image: { ...chromiumJson.image, tag: '' } }],
    ['image.digest', { image: { ...chromiumJson.image, digest: 'sha256:abc' } }],
    ['image.digest', { image: { tag: chromiumJson.image.tag } }],
    ['headlessShell', { headlessShell: 'chrome-headless-shell' }],
    ['headlessShell', { headlessShell: undefined }],
    ['sha256', { sha256: undefined }],
    ['sha256', { sha256: [] }],
    ['sha256.mac-arm64', { sha256: { ...chromiumJson.sha256, 'mac-arm64': undefined } }],
    ['sha256.win64', { sha256: { ...chromiumJson.sha256, win64: '5'.repeat(63) } }],
    ['sha256.linux64', { sha256: { ...chromiumJson.sha256, linux64: 'A'.repeat(64) } }],
  ]

  it.each(malformed)('names %s when it is malformed', (field, change) => {
    expect(() => parseBrowserPackage({ ...chromiumJson, ...change }, '157.0.0')).toThrow(
      `its chromium.json has no valid ${field}: it must be `,
    )
  })

  it('says a missing platform of sha256 by its path', () => {
    const { win64: _win64, ...rest } = chromiumJson.sha256

    expect(() => parseBrowserPackage({ ...chromiumJson, sha256: rest }, '157.0.0')).toThrow(
      'its chromium.json has no valid sha256.win64: it must be 64 lowercase hex digits, and it is missing',
    )
  })

  it('says what a malformed field holds, or that it is missing', () => {
    expect(() =>
      parseBrowserPackage({ ...chromiumJson, image: { ...chromiumJson.image, digest: 'sha256:abc' } }, '157.0.0'),
    ).toThrow(
      'its chromium.json has no valid image.digest: it must be sha256: and 64 hex digits, and it is "sha256:abc"',
    )
    expect(() => parseBrowserPackage({ ...chromiumJson, chromium: undefined }, '157.0.0')).toThrow(
      'its chromium.json has no valid chromium: it must be a Chromium version such as 157.0.8103.78, and it is missing',
    )
  })
})

describe('readBrowserPackage', () => {
  it("reads the workspace's browser package", () => {
    const require = createRequire(import.meta.url)
    const { version } = JSON.parse(readFileSync(require.resolve('@visual-check/chromium/package.json'), 'utf8')) as {
      version: string
    }
    const json = JSON.parse(readFileSync(require.resolve('@visual-check/chromium'), 'utf8')) as typeof chromiumJson

    expect(readBrowserPackage(version)).toEqual({
      packageVersion: version,
      chromium: json.chromium,
      image: json.image,
      headlessShell: json.headlessShell,
      sha256: json.sha256,
    })
  })
})
