import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

/**
 * The browser package's name, as every message of this module writes it.
 */
export const packageName = '@visual-check/chromium'

/**
 * What the browser package names: the exact Chromium build, the image it runs in and where the image holds it.
 *
 * @public
 */
export interface BrowserPackage {
  /**
   * The browser package's own version, such as `157.0.0`.
   */
  packageVersion: string
  /**
   * The exact Chromium version, such as `157.0.8103.78`.
   */
  chromium: string
  /**
   * visual-check's container image, which is pulled as `<tag>@<digest>`.
   */
  image: {
    /**
     * The image's tag, such as `ghcr.io/visual-check/chromium:157.0.0`.
     */
    tag: string
    /**
     * The image's index digest, such as `sha256:…`.
     */
    digest: string
  }
  /**
   * The path of the headless shell's executable inside the image.
   */
  headlessShell: string
}

/**
 * Whether a value is a non-null object that isn't an array.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * What a field of `chromium.json` must hold.
 */
interface FieldRule {
  /**
   * The field's path in the file, such as `image.digest`.
   */
  field: string
  /**
   * What a valid value matches.
   */
  pattern: RegExp
  /**
   * What a valid value is, as a phrase that follows "it must be".
   */
  expected: string
}

/**
 * The exact Chromium version.
 */
const chromiumRule: FieldRule = {
  field: 'chromium',
  pattern: /^\d+\.\d+\.\d+\.\d+$/,
  expected: 'a Chromium version such as 157.0.8103.78',
}

/**
 * The image's tag.
 */
const tagRule: FieldRule = { field: 'image.tag', pattern: /^\S+$/, expected: 'an image tag' }

/**
 * The image's index digest.
 */
const digestRule: FieldRule = {
  field: 'image.digest',
  pattern: /^sha256:[0-9a-f]{64}$/,
  expected: 'sha256: and 64 hex digits',
}

/**
 * The headless shell's path inside the image.
 */
const headlessShellRule: FieldRule = {
  field: 'headlessShell',
  pattern: /^\/\S/,
  expected: 'an absolute path in the image',
}

/**
 * Builds the error for a malformed field, naming it, what it must be and what it is.
 */
function malformedField(rule: Pick<FieldRule, 'field' | 'expected'>, value: unknown): Error {
  return new Error(
    `its chromium.json has no valid ${rule.field}: it must be ${rule.expected}, and it is ${JSON.stringify(value) ?? 'missing'}`,
  )
}

/**
 * Reads a string field that must match its rule's pattern.
 *
 * @throws {Error} Naming the field and what it must be, when it is missing or doesn't match.
 */
function stringFieldOf(record: Record<string, unknown>, key: string, rule: FieldRule): string {
  const value = record[key]

  if (typeof value === 'string' && rule.pattern.test(value)) {
    return value
  }

  throw malformedField(rule, value)
}

/**
 * Reads the fields of a browser package's `chromium.json` that a run needs.
 *
 * @throws {Error} With a message that names the field and reads after "can't be read:", when the file isn't an object
 * or a field is missing or malformed.
 */
export function parseBrowserPackage(json: unknown, packageVersion: string): BrowserPackage {
  if (!isRecord(json)) {
    throw new Error("its chromium.json isn't a JSON object")
  }

  const { image } = json

  if (!isRecord(image)) {
    throw malformedField({ field: 'image', expected: 'an object with tag and digest' }, image)
  }

  return {
    packageVersion,
    chromium: stringFieldOf(json, 'chromium', chromiumRule),
    image: {
      tag: stringFieldOf(image, 'tag', tagRule),
      digest: stringFieldOf(image, 'digest', digestRule),
    },
    headlessShell: stringFieldOf(json, 'headlessShell', headlessShellRule),
  }
}

/**
 * Reads the installed browser package's `chromium.json`, its `exports["."]`, for the package version already read
 * from its `package.json`.
 *
 * @throws {Error} With a message that reads after "can't be read:", when the file can't be found or read, isn't JSON,
 * or is malformed.
 */
export function readBrowserPackage(packageVersion: string): BrowserPackage {
  const text = readFileSync(createRequire(import.meta.url).resolve(packageName), 'utf8')
  let json: unknown

  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new Error(`its chromium.json isn't JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  return parseBrowserPackage(json, packageVersion)
}
