import { type BrowserPackage, packageName } from './read-browser-package.js'

/**
 * Gives the browser package's image as it is pulled: `<tag>@<digest>`.
 *
 * @public
 */
export function packageImageOf(browserPackage: BrowserPackage): string {
  return `${browserPackage.image.tag}@${browserPackage.image.digest}`
}

/**
 * The browser that answered isn't the browser package's build.
 *
 * @public
 */
export class BrowserMismatchError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `BrowserMismatchError`.
   */
  override name = 'BrowserMismatchError'
}

/**
 * Checks that the browser that answered, with this exact version, is the browser package's build. No option accepts a
 * mismatch, for the config's image too.
 *
 * @throws {BrowserMismatchError} Naming the image, both versions and the fix: rebuilding the config's image from the
 * browser package's, or reinstalling the browser package when the config sets no image.
 *
 * @public
 */
export function checkBrowserVersion(
  version: string,
  browserPackage: BrowserPackage,
  configImage: string | undefined,
): void {
  if (version === browserPackage.chromium) {
    return
  }

  const fix =
    configImage === undefined
      ? `Reinstall the browser package ${packageName}, then run visual-check again.`
      : `Rebuild ${configImage} FROM ${packageImageOf(browserPackage)}.`

  throw new BrowserMismatchError(
    `The browser in ${configImage ?? packageImageOf(browserPackage)} is Chromium ${version}, but the browser package ` +
      `${packageName} ${browserPackage.packageVersion} names Chromium ${browserPackage.chromium}.\n${fix}`,
  )
}
