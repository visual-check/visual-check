import { packageImageOf } from '../browser/browser-version.js'
import { type ImageMarker, imageMarkerProblem, readImageMarker } from '../browser/image-marker.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import type { Platform } from '../config/define-config.js'
import type { BrowserPlace } from './launch-browser.js'

/**
 * Decides where the run's browser runs: directly inside visual-check's image when the marker says the CLI runs in it
 * and fits the browser package and the platform, else in visual-check's container. Gives the problem that exits 2 when
 * the marker is unreadable or doesn't fit, or when the platform is the host outside the image.
 */
export function placeBrowser(
  platform: Platform,
  browserPackage: BrowserPackage,
  markerPath: string,
): { place: BrowserPlace } | { problem: string } {
  let marker: ImageMarker | undefined

  try {
    marker = readImageMarker(markerPath)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)

    return {
      problem:
        `visual-check can't read ${markerPath}, the marker of visual-check's image: ${reason}.\n` +
        `Run in ${packageImageOf(browserPackage)}, or rebuild your image FROM it.`,
    }
  }

  if (marker !== undefined) {
    const problem = imageMarkerProblem(marker, browserPackage, platform)

    return problem === undefined ? { place: { in: 'image' } } : { problem }
  }

  if (platform === 'host') {
    return {
      problem:
        "visual-check can't run the browser on the host yet. " +
        "Set platform to 'linux/amd64' or 'linux/arm64' in the config.",
    }
  }

  return { place: { in: 'container', platform } }
}
