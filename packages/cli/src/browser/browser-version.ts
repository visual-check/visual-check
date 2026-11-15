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
 * Gives the image a run's browser runs in: the config's `image`, or the browser package's `<tag>@<digest>`.
 *
 * @public
 */
export function runImageOf(browserPackage: BrowserPackage, configImage: string | undefined): string {
  return configImage ?? packageImageOf(browserPackage)
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
 * Where the browser that answered runs: in visual-check's container, from the config's image or the browser package's,
 * directly inside the image the CLI runs in, or on the host, from the headless shell visual-check downloaded.
 *
 * @public
 */
export type CheckedBrowser =
  | {
      /**
       * The browser runs in visual-check's container.
       */
      in: 'container'
      /**
       * The config's `image`, which replaces the browser package's, or `undefined`.
       */
      configImage: string | undefined
    }
  | {
      /**
       * The browser runs directly inside the image the CLI runs in.
       */
      in: 'image'
    }
  | {
      /**
       * The browser runs on the host.
       */
      in: 'host'
      /**
       * The folder in visual-check's cache the headless shell was downloaded into.
       */
      folder: string
    }

/**
 * Checks that the browser that answered, with this exact version, is the browser package's build. No option accepts a
 * mismatch, for the config's image too.
 *
 * @throws {BrowserMismatchError} Naming where the browser runs, both versions and the fix: rebuilding the config's
 * image from the browser package's, reinstalling the browser package when the config sets no image, running in the
 * browser package's image when the browser runs inside the CLI's own image, or removing the download's folder when the
 * browser runs on the host.
 *
 * @public
 */
export function checkBrowserVersion(version: string, browserPackage: BrowserPackage, browser: CheckedBrowser): void {
  if (version === browserPackage.chromium) {
    return
  }

  const versions =
    `is Chromium ${version}, but the browser package ${packageName} ${browserPackage.packageVersion} ` +
    `names Chromium ${browserPackage.chromium}.`

  if (browser.in === 'image') {
    throw new BrowserMismatchError(
      `The browser in this container ${versions}\n` +
        `Run in ${packageImageOf(browserPackage)}, or rebuild your image FROM it.`,
    )
  }

  if (browser.in === 'host') {
    throw new BrowserMismatchError(
      `The browser in ${browser.folder} ${versions}\n` +
        `Remove ${browser.folder}, then run visual-check again to download it afresh. ` +
        `If it happens again, reinstall the browser package ${packageName}.`,
    )
  }

  const { configImage } = browser
  const fix =
    configImage === undefined
      ? `Reinstall the browser package ${packageName}, then run visual-check again.`
      : `Rebuild ${configImage} FROM ${packageImageOf(browserPackage)}.`

  throw new BrowserMismatchError(`The browser in ${runImageOf(browserPackage, configImage)} ${versions}\n${fix}`)
}
