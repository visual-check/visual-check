import { readFileSync } from 'node:fs'
import type { Platform } from '../config/define-config.js'
import { packageImageOf } from './browser-version.js'
import { type BrowserPackage, packageName } from './read-browser-package.js'

/**
 * Where visual-check's image keeps its marker.
 *
 * @public
 */
export const imageMarkerPath = '/etc/visual-check/chromium.json'

/**
 * What the marker of visual-check's image says it holds.
 *
 * @public
 */
export interface ImageMarker {
  /**
   * The browser package version the image was built for, such as `157.0.0`.
   */
  version: string
  /**
   * The image's CPU architecture.
   */
  arch: 'amd64' | 'arm64'
}

/**
 * Whether a value is a non-null object that isn't an array.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parses the marker's text.
 *
 * @throws {Error} With a message that names what is wrong and reads after "…: ", when the text isn't JSON, isn't an
 * object, or its `version` or `arch` is missing or malformed.
 */
export function parseImageMarker(text: string): ImageMarker {
  let json: unknown

  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new Error(`it isn't JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!isRecord(json)) {
    throw new Error("it isn't a JSON object")
  }

  const { version, arch } = json

  if (typeof version !== 'string') {
    throw new Error(`it has no valid version: it must be a string, and it is ${JSON.stringify(version) ?? 'missing'}`)
  }

  if (arch !== 'amd64' && arch !== 'arm64') {
    throw new Error(`it has no valid arch: it must be amd64 or arm64, and it is ${JSON.stringify(arch) ?? 'missing'}`)
  }

  return { version, arch }
}

/**
 * Reads the marker, or gives `undefined` when there is none.
 *
 * @throws {Error} With a message that reads after "…: ", when the marker can't be read or is malformed.
 *
 * @public
 */
export function readImageMarker(path: string): ImageMarker | undefined {
  let text: string

  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }

    throw new Error(error instanceof Error ? error.message : String(error), { cause: error })
  }

  return parseImageMarker(text)
}

/**
 * Says why the marker doesn't fit the installed browser package and the platform, or gives `undefined` when it does.
 * The version has to match for every platform; the architecture has to match unless the platform is the host.
 *
 * @public
 */
export function imageMarkerProblem(
  marker: ImageMarker,
  browserPackage: BrowserPackage,
  platform: Platform,
): string | undefined {
  const lines: string[] = []

  if (marker.version !== browserPackage.packageVersion) {
    lines.push(
      `This container runs visual-check's image for ${packageName} ${marker.version}, but ${packageName} ` +
        `${browserPackage.packageVersion} is installed.`,
      `Run in ${packageImageOf(browserPackage)}, or rebuild your image FROM it.`,
    )
  }

  if (platform !== 'host' && platform !== `linux/${marker.arch}`) {
    lines.push(
      `This container runs visual-check's image for ${marker.arch}, but the config's platform is ${platform}.`,
      `Run the container as ${platform}, such as with docker run --platform ${platform} or ` +
        `"runArgs": ["--platform=${platform}"] in devcontainer.json, or set platform to 'linux/${marker.arch}' in ` +
        'the config, which changes it for the whole project.',
    )
  }

  return lines.length === 0 ? undefined : lines.join('\n')
}
