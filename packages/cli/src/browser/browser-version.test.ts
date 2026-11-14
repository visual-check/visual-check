import { describe, expect, it } from 'vitest'
import { BrowserMismatchError, checkBrowserVersion, packageImageOf } from './browser-version.js'
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

describe('packageImageOf', () => {
  it('pins the tag to the digest', () => {
    expect(packageImageOf(browserPackage)).toBe(packageImage)
  })
})

describe('checkBrowserVersion', () => {
  it("accepts the browser package's exact build", () => {
    expect(() => checkBrowserVersion('157.0.8103.78', browserPackage, undefined)).not.toThrow()
    expect(() => checkBrowserVersion('157.0.8103.78', browserPackage, 'example.com/chromium:custom')).not.toThrow()
  })

  it("names both versions and says to reinstall the browser package for the package's image", () => {
    expect(() => checkBrowserVersion('157.0.8103.79', browserPackage, undefined)).toThrow(
      new BrowserMismatchError(
        `The browser in ${packageImage} is Chromium 157.0.8103.79, but the browser package @visual-check/chromium ` +
          '157.0.0 names Chromium 157.0.8103.78.\n' +
          'Reinstall the browser package @visual-check/chromium, then run visual-check again.',
      ),
    )
  })

  it("names the config's image and says to rebuild it FROM the browser package's image", () => {
    expect(() => checkBrowserVersion('156.0.7000.1', browserPackage, 'example.com/chromium:custom')).toThrow(
      new BrowserMismatchError(
        'The browser in example.com/chromium:custom is Chromium 156.0.7000.1, but the browser package ' +
          '@visual-check/chromium 157.0.0 names Chromium 157.0.8103.78.\n' +
          `Rebuild example.com/chromium:custom FROM ${packageImage}.`,
      ),
    )
  })

  it('throws a BrowserMismatchError', () => {
    expect(() => checkBrowserVersion('1.0.0.0', browserPackage, undefined)).toThrow(BrowserMismatchError)
  })
})
