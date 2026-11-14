import { describe, expect, it } from 'vitest'
import { BrowserMismatchError, type CheckedBrowser, checkBrowserVersion, packageImageOf } from './browser-version.js'
import type { BrowserPackage } from './read-browser-package.js'

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

describe('packageImageOf', () => {
  it('pins the tag to the digest', () => {
    expect(packageImageOf(browserPackage)).toBe(packageImage)
  })
})

/**
 * Says the browser runs in visual-check's container, from the config's image when given.
 */
function inContainer(configImage?: string): CheckedBrowser {
  return { in: 'container', configImage }
}

describe('checkBrowserVersion', () => {
  it("accepts the browser package's exact build", () => {
    expect(() => checkBrowserVersion('157.0.8103.78', browserPackage, inContainer())).not.toThrow()
    expect(() =>
      checkBrowserVersion('157.0.8103.78', browserPackage, inContainer('example.com/chromium:custom')),
    ).not.toThrow()
  })

  it("names both versions and says to reinstall the browser package for the package's image", () => {
    expect(() => checkBrowserVersion('157.0.8103.79', browserPackage, inContainer())).toThrow(
      new BrowserMismatchError(
        `The browser in ${packageImage} is Chromium 157.0.8103.79, but the browser package @visual-check/chromium ` +
          '157.0.0 names Chromium 157.0.8103.78.\n' +
          'Reinstall the browser package @visual-check/chromium, then run visual-check again.',
      ),
    )
  })

  it("names the config's image and says to rebuild it FROM the browser package's image", () => {
    expect(() =>
      checkBrowserVersion('156.0.7000.1', browserPackage, inContainer('example.com/chromium:custom')),
    ).toThrow(
      new BrowserMismatchError(
        'The browser in example.com/chromium:custom is Chromium 156.0.7000.1, but the browser package ' +
          '@visual-check/chromium 157.0.0 names Chromium 157.0.8103.78.\n' +
          `Rebuild example.com/chromium:custom FROM ${packageImage}.`,
      ),
    )
  })

  it("names this container and says to run in the browser package's image for the browser inside the image", () => {
    expect(() => checkBrowserVersion('156.0.7000.1', browserPackage, { in: 'image' })).toThrow(
      new BrowserMismatchError(
        'The browser in this container is Chromium 156.0.7000.1, but the browser package @visual-check/chromium ' +
          '157.0.0 names Chromium 157.0.8103.78.\n' +
          `Run in ${packageImage}, or rebuild your image FROM it.`,
      ),
    )
  })

  it('throws a BrowserMismatchError', () => {
    expect(() => checkBrowserVersion('1.0.0.0', browserPackage, inContainer())).toThrow(BrowserMismatchError)
  })
})
