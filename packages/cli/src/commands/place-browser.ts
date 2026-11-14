import { packageImageOf } from '../browser/browser-version.js'
import { chromeForTestingPlatformOf } from '../browser/chrome-for-testing-platform.js'
import { type ImageMarker, imageMarkerProblem, readImageMarker } from '../browser/image-marker.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import type { Platform } from '../config/define-config.js'
import type { BrowserPlace } from './launch-browser.js'

/**
 * The OS and CPU architecture of the machine the CLI runs on, as Node names them.
 */
export interface MachineSystem {
  /**
   * The OS, such as `darwin`.
   */
  os: NodeJS.Platform
  /**
   * The CPU architecture, such as `arm64`.
   */
  arch: NodeJS.Architecture
}

/**
 * Decides where the run's browser runs: directly inside visual-check's image when the marker says the CLI runs in it
 * and fits the browser package and the platform; else on the host, as the headless shell for the machine's OS and
 * architecture, when the platform is the host; else in visual-check's container. Gives the problem that exits 2 when
 * the marker is unreadable or doesn't fit, or when Chrome for Testing has no build for the machine.
 */
export function placeBrowser(
  platform: Platform,
  browserPackage: BrowserPackage,
  markerPath: string,
  machineSystem: MachineSystem = { os: process.platform, arch: process.arch },
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
    const host = chromeForTestingPlatformOf(machineSystem.os, machineSystem.arch)

    return 'problem' in host ? host : { place: { in: 'host', platform: host.platform } }
  }

  return { place: { in: 'container', platform } }
}
