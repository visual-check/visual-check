import { packageImageOf } from '../browser/browser-version.js'
import { type ImageMarker, imageMarkerProblem, readImageMarker } from '../browser/image-marker.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import type { Platform } from '../config/define-config.js'
import type { ContainerPlatform } from '../container/browser-container.js'

/**
 * Reads whether the CLI runs inside visual-check's image, which the marker says when it fits the browser package and
 * the platform, and else gives the platform visual-check's container runs on. Gives the problem that exits 2 when the
 * marker is unreadable or doesn't fit, or when the platform is the host outside the image.
 */
export function readImageFit(
  platform: Platform,
  browserPackage: BrowserPackage,
  markerPath: string,
): { problem: string } | { insideImage: true } | { insideImage: false; platform: ContainerPlatform } {
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

  if (platform === 'host') {
    return {
      problem:
        "visual-check can't run the browser on the host yet. " +
        "Set platform to 'linux/amd64' or 'linux/arm64' in the config.",
    }
  }

  return { insideImage: false, platform }
}
