import { packageImageOf } from '../browser/browser-version.js'
import { type ImageMarker, imageMarkerProblem, readImageMarker } from '../browser/image-marker.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import type { Platform } from '../config/define-config.js'

/**
 * Reads whether the CLI runs inside visual-check's image, which the marker says when it fits the browser package and
 * the platform, and else gives the config's platform: the one visual-check's container runs on, or the host. Gives the
 * problem that exits 2 when the marker is unreadable or doesn't fit.
 */
export function readImageFit(
  platform: Platform,
  browserPackage: BrowserPackage,
  markerPath: string,
): { problem: string } | { insideImage: true } | { insideImage: false; platform: Platform } {
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

    return problem === undefined ? { insideImage: true } : { problem }
  }

  return { insideImage: false, platform }
}
