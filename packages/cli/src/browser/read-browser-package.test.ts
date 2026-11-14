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
  sha256: { linux64: 'f9' },
}

describe('parseBrowserPackage', () => {
  it('reads the build, the image and the headless shell, with the package version', () => {
    expect(parseBrowserPackage(chromiumJson, '157.0.0')).toEqual({
      packageVersion: '157.0.0',
      chromium: '157.0.8103.78',
      image: { tag: 'ghcr.io/visual-check/chromium:157.0.0', digest: `sha256:${'ab'.repeat(32)}` },
      headlessShell: '/opt/chrome-headless-shell/chrome-headless-shell',
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
  ]

  it.each(malformed)('names %s when it is malformed', (field, change) => {
    expect(() => parseBrowserPackage({ ...chromiumJson, ...change }, '157.0.0')).toThrow(
      `its chromium.json has no valid ${field}: it must be `,
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
    })
  })
})
