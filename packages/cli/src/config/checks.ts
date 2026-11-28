import { isRegExp } from 'node:util/types'
import type { PageErrorCheck, RealRequestCheck, Tolerance, Viewport } from './define-config.js'
import { mayHoldLogin } from './find-storybook-url-problem.js'
import { UnrunnableRegExp } from './unrunnable-regexp.js'

/**
 * Checks the value at a key path and returns one issue per problem, each starting with its key path. A key that is
 * absent reaches its check as `undefined`.
 */
export type Check = (value: unknown, path: string) => string[]

/**
 * The keys one object level takes, each with its check. Unknown-key issues list these keys.
 */
export type Keys = Record<string, Check>

/**
 * What a value must be.
 */
export interface Requirement {
  /**
   * What the value must be, as it reads after "must be".
   */
  text: string
  /**
   * Whether a value meets the requirement.
   */
  accepts: (value: unknown) => boolean
  /**
   * The reason a value that isn't accepted fails, as a sentence that follows its key path, when the usual "must be"
   * would mislead. `undefined` leaves the usual issue.
   */
  explain?: (value: unknown) => string | undefined
}

/**
 * What a Storybook's or a mode's name may hold: lowercase letters, digits and -.
 */
export const lowercaseNamePattern = /^[a-z0-9-]+$/

/**
 * The most characters a value takes in an issue before it's cut short.
 */
const maxShownLength = 40

/**
 * Whether a value is a plain object: an object literal or one with a `null` prototype. An array, a `Date` or a class
 * instance isn't.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * Renders an object for an issue: an array or a plain object as JSON, any other object by its class, such as
 * `an instance of Date`.
 */
function renderObject(value: object): string {
  if (!Array.isArray(value) && !isPlainObject(value)) {
    const name: unknown = Object.getPrototypeOf(value)?.constructor?.name

    return typeof name === 'string' && name !== '' ? `an instance of ${name}` : 'an object'
  }

  try {
    return JSON.stringify(value)
  } catch {
    return Array.isArray(value) ? 'an array' : 'an object'
  }
}

/**
 * Renders a value for an issue: a string as JSON, an object by `renderObject`, anything else as text.
 */
export function render(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    return renderObject(value)
  }

  if (typeof value === 'string') {
    return JSON.stringify(value)
  }

  if (typeof value === 'bigint') {
    return `${value}n`
  }

  return typeof value === 'function' ? 'a function' : String(value)
}

/**
 * The reason a value isn't what `text` says, showing `rendered`, the value as an issue renders it, briefly. A value
 * that may hold a login isn't shown, so no issue prints a password.
 */
function mustBeReason(text: string, rendered: string): string {
  if (mayHoldLogin(rendered)) {
    return `must be ${text}.`
  }

  const characters = Array.from(rendered)
  const brief =
    characters.length > maxShownLength ? `${characters.slice(0, maxShownLength - 1).join('')}…` : characters.join('')

  return `must be ${text}. Got ${brief}.`
}

/**
 * The issue for a value at `path` that isn't what `text` says, showing the value briefly. A value that may hold a login
 * isn't shown, so no issue prints a password.
 */
export function mustBe(path: string, text: string, value: unknown): string {
  return `${path}: ${mustBeReason(text, render(value))}`
}

/**
 * The key path of `key` inside the object at `path`, whose path is empty at the root. A key that isn't a plain name
 * reads as `["a b"]`.
 */
export function join(path: string, key: string): string {
  if (!/^[\w$-]+$/.test(key)) {
    return `${path}[${JSON.stringify(key)}]`
  }

  return path === '' ? key : `${path}.${key}`
}

/**
 * Checks that a value meets a requirement, reporting `undefined` like any other value.
 */
export function meets(requirement: Requirement): Check {
  return (value, path) => {
    if (requirement.accepts(value)) {
      return []
    }

    const reason = requirement.explain?.(value)

    return [reason === undefined ? mustBe(path, requirement.text, value) : `${path}: ${reason}`]
  }
}

/**
 * Checks a key that may be absent: an absent key passes.
 */
export function optional(check: Check): Check {
  return (value, path) => (value === undefined ? [] : check(value, path))
}

/**
 * The unknown-key issues of an object: one per key that isn't in `knownKeys`, except keys set to `undefined`. `hint`
 * ends each issue.
 */
export function unknownKeyIssues(
  knownKeys: string[],
  value: Record<string, unknown>,
  path: string,
  hint = '',
): string[] {
  const known = knownKeys.join(', ')

  return Object.keys(value)
    .filter((key) => !knownKeys.includes(key) && value[key] !== undefined)
    .map((key) => `${join(path, key)}: unknown key. Known keys: ${known}.${hint}`)
}

/**
 * Checks each key of an object: unknown keys first, then every known key in order. A key set to `undefined` is
 * absent. `unknownKeyHint` ends each unknown-key issue.
 */
export function checkKeys(keys: Keys, value: Record<string, unknown>, path: string, unknownKeyHint = ''): string[] {
  const unknownIssues = unknownKeyIssues(Object.keys(keys), value, path, unknownKeyHint)

  return [...unknownIssues, ...Object.entries(keys).flatMap(([key, check]) => check(value[key], join(path, key)))]
}

/**
 * Checks an object with some of `keys`: a plain object has each key checked, anything else is reported with `example`.
 * An absent value isn't an object, so a caller that allows one wraps this in `optional`.
 */
export function objectOf(keys: Keys, example: string): Check {
  return (value, path) =>
    isPlainObject(value) ? checkKeys(keys, value, path) : [mustBe(path, `an object such as ${example}`, value)]
}

/**
 * Checks an array whose items each meet `item`, one issue per item that doesn't. `text` says what the array must be. An
 * absent value isn't an array, so a caller that allows one wraps this in `optional`.
 */
export function listOf(item: Requirement, text: string): Check {
  const checkItem = meets(item)

  return (value, path) =>
    Array.isArray(value)
      ? Array.from(value).flatMap((entry, index) => checkItem(entry, `${path}[${index}]`))
      : [mustBe(path, text, value)]
}

/**
 * One of the keys of `members`. Pass the union as the type argument, so a missing member fails to compile.
 */
export function oneOf<Member extends string>(members: Record<Member, true>): Requirement {
  const values = Object.keys(members)
  const quoted = values.map((value) => `'${value}'`)

  return {
    text: `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}`,
    accepts: (value) => values.some((allowed) => allowed === value),
  }
}

/**
 * The example a tolerance's issue shows.
 */
export const toleranceExample = '{ color: 0.01, pixels: 20 }'

/**
 * The example a viewport's issue shows.
 */
export const viewportExample = '{ width: 1280, height: 720 }'

/**
 * A whole number from `minimum` to `maximum`.
 */
export function wholeNumber(minimum: number, maximum = Number.MAX_SAFE_INTEGER): Requirement {
  return {
    text:
      maximum === Number.MAX_SAFE_INTEGER
        ? `a whole number of ${minimum} or more`
        : `a whole number from ${minimum} to ${maximum}`,
    accepts: (value) =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum,
  }
}

/**
 * A string with at least one character.
 */
export const nonEmptyString: Requirement = {
  text: 'a non-empty string',
  accepts: (value) => typeof value === 'string' && value !== '',
}

/**
 * What each key of a tolerance must be. The config and a story's options share these.
 */
export const toleranceRequirements: Record<keyof Tolerance, Requirement> = {
  color: {
    text: 'a number from 0 to 1',
    accepts: (value) => typeof value === 'number' && value >= 0 && value <= 1,
  },
  pixels: {
    text: "a whole number of 0 or more, or a string from '0%' to '100%'",
    accepts: (value) =>
      wholeNumber(0).accepts(value) ||
      (typeof value === 'string' && /^\d+(\.\d+)?%$/.test(value) && Number.parseFloat(value) <= 100),
  },
}

/**
 * What each key of a viewport must be. The config and a story's options share these.
 */
export const viewportRequirements: Record<keyof Viewport, Requirement> = {
  width: wholeNumber(1),
  height: wholeNumber(1),
  deviceScaleFactor: {
    text: 'a number greater than 0',
    accepts: (value) => typeof value === 'number' && Number.isFinite(value) && value > 0,
  },
  touch: { text: 'true or false', accepts: (value) => typeof value === 'boolean' },
}

/**
 * What `pageErrors` must be. The config and a story's options share it.
 */
export const pageErrorsRequirement: Requirement = oneOf<PageErrorCheck>({ fail: true, warn: true, off: true })

/**
 * What `realRequests` must be. The config and a story's options share it.
 */
export const realRequestsRequirement: Requirement = oneOf<RealRequestCheck>({ fail: true, warn: true, off: true })

/**
 * What one entry of `expectedPageErrors` must be: a string that isn't empty, since an empty one would match every page
 * error, or a regular expression, from any realm. The config and a story's options share it. A regular expression from
 * the page that Node.js couldn't build is named as such, as a literal.
 */
const expectedPageError: Requirement = {
  text: 'a non-empty string or a regular expression',
  accepts: (value) => nonEmptyString.accepts(value) || isRegExp(value),
  explain: (value) =>
    value instanceof UnrunnableRegExp
      ? mustBeReason('a regular expression Node.js can run', `/${value.source}/${value.flags}`)
      : undefined,
}

/**
 * Checks `expectedPageErrors`: an array of entries, each a non-empty string or a regular expression. The config and a
 * story's options share it. An absent value isn't an array, so a caller that allows one wraps this in `optional`.
 */
export const checkExpectedPageErrors: Check = listOf(
  expectedPageError,
  "an array of strings or regular expressions, such as ['Failed to fetch', /ResizeObserver/]",
)

/**
 * The checks for an object's keys: each requirement wrapped by `wrap`, in the order the requirements list them.
 */
export function checksOf(requirements: Record<string, Requirement>, wrap: (requirement: Requirement) => Check): Keys {
  return Object.fromEntries(Object.entries(requirements).map(([key, requirement]) => [key, wrap(requirement)]))
}

/**
 * A copy of a value with the keys set to `undefined` left out, in every plain object at every level. Arrays are copied
 * as they are.
 */
export function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return [...value]
  }

  if (!isPlainObject(value)) {
    return value
  }

  const entries = Object.entries(value).filter(([, item]) => item !== undefined)

  return Object.fromEntries(entries.map(([key, item]) => [key, withoutUndefined(item)]))
}
