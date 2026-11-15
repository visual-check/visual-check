import {
  type Check,
  checkKeys,
  checksOf,
  isPlainObject,
  join,
  meets,
  mustBe,
  nonEmptyString,
  objectOf,
  optional,
  type Requirement,
  toleranceExample,
  toleranceRequirements,
  unknownKeyIssues,
  viewportExample,
  viewportRequirements,
  withoutUndefined,
} from './checks.js'
import type { Tolerance, Viewport } from './define-config.js'

/**
 * A mode's definition: the globals and the viewport it sets.
 */
interface ModeDefinition {
  /**
   * The Storybook globals the mode sets.
   */
  globals?: Record<string, string | number | boolean>
  /**
   * The viewport the mode sets.
   */
  viewport?: Viewport
}

/**
 * A region to paint over, found by a CSS selector or by the host of its remote content.
 */
type StoryMask = { selector: string } | { host: string }

/**
 * The options one story sets, as `parameters.visualCheck` holds them once validated. The `wait` hook runs in the page,
 * so it isn't here.
 *
 * @public
 */
export interface StoryOptions {
  /**
   * One entry per declared mode: its definition when the story captures it, `null` when it doesn't.
   */
  modes?: Record<string, ModeDefinition | null>
  /**
   * The default capture's viewport.
   */
  viewport?: Viewport
  /**
   * A CSS selector for the element to capture, or `null` for the full page.
   */
  element?: string | null
  /**
   * The regions to paint over, by name, or `null` for none. A name set to `null` drops one mask.
   */
  masks?: Record<string, StoryMask | null> | null
  /**
   * How much a snapshot may differ from its baseline.
   */
  tolerance?: Tolerance
  /**
   * Whether to leave the story out.
   */
  disable?: boolean
}

/**
 * The key path of `parameters.visualCheck` in an issue.
 */
const rootPath = 'visualCheck'

/**
 * What an issue for a key directly under `visualCheck` that the CLI doesn't know adds.
 */
const newerHelperHint = ' If a newer @visual-check/storybook wrote it, install @visual-check/cli at the same version.'

/**
 * Wraps a requirement as the check of a key that may be absent.
 */
function optionalKey(requirement: Requirement): Check {
  return optional(meets(requirement))
}

/**
 * Checks a key that takes `null` or a value meeting a requirement.
 */
function orNull(requirement: Requirement): Check {
  return optional((value, path) => (value === null ? [] : meets(requirement)(value, path)))
}

/**
 * The entries of a plain object that are set, as `[key, value]` pairs.
 */
function setEntries(value: Record<string, unknown>): [string, unknown][] {
  return Object.entries(value).filter(([, entry]) => entry !== undefined)
}

/**
 * Checks a viewport with the config's rules.
 */
const checkViewport: Check = optional(objectOf(checksOf(viewportRequirements, optionalKey), viewportExample))

/**
 * Checks a tolerance with the config's rules.
 */
const checkTolerance: Check = optional(objectOf(checksOf(toleranceRequirements, optionalKey), toleranceExample))

/**
 * What a global's value must be.
 */
const globalValue: Requirement = {
  text: 'a string, a finite number or a boolean',
  accepts: (value) =>
    typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)),
}

/**
 * Checks the globals of a mode.
 */
const checkGlobals: Check = optional((value, path) => {
  if (!isPlainObject(value)) {
    return [mustBe(path, "an object of globals, such as { theme: 'dark' }", value)]
  }

  return setEntries(value).flatMap(([name, entry]) => meets(globalValue)(entry, join(path, name)))
})

/**
 * The keys of a mode's definition.
 */
const modeKeys = { globals: checkGlobals, viewport: checkViewport } satisfies Record<keyof ModeDefinition, Check>

/**
 * Checks one mode's definition, or `null` for a mode the level leaves out.
 */
function checkModeEntry(value: unknown, path: string): string[] {
  if (value === null) {
    return []
  }

  if (!isPlainObject(value)) {
    return [mustBe(path, "a mode definition such as { globals: { theme: 'dark' } }, or null", value)]
  }

  return checkKeys(modeKeys, value, path)
}

/**
 * Checks `modes`: one entry per declared mode. Mode names and the mode rules are another check's job. The types inside
 * the modes are checked here.
 */
const checkModes: Check = optional((value, path) => {
  if (!isPlainObject(value)) {
    return [mustBe(path, 'an object with one entry per declared mode, as visualCheck({ modes: [...] }) writes', value)]
  }

  return setEntries(value).flatMap(([name, entry]) => checkModeEntry(entry, join(path, name)))
})

/**
 * The keys of a mask.
 */
const maskKeys = ['selector', 'host']

/**
 * Whether a plain object names exactly one kind of mask: one of `selector` and `host` is a non-empty string, and the
 * other is absent or `null`.
 */
function namesOneKind(mask: Record<string, unknown>): boolean {
  const { selector, host } = mask
  const unused = (key: unknown): boolean => key === undefined || key === null

  return (nonEmptyString.accepts(selector) && unused(host)) || (nonEmptyString.accepts(host) && unused(selector))
}

/**
 * Checks one mask, or `null` to drop it. A mask with unknown keys reports only the unknown-key issues.
 */
function checkMask(value: unknown, path: string): string[] {
  if (value === null) {
    return []
  }

  const unknownIssues = isPlainObject(value) ? unknownKeyIssues(maskKeys, value, path) : []

  if (unknownIssues.length > 0) {
    return unknownIssues
  }

  return isPlainObject(value) && namesOneKind(value)
    ? []
    : [mustBe(path, "{ selector: '<selector>' } or { host: '<host>' }, or null to drop it", value)]
}

/**
 * Checks `masks`: `null`, or masks by name.
 */
const checkMasks: Check = optional((value, path) => {
  if (value === null) {
    return []
  }

  if (!isPlainObject(value)) {
    return [mustBe(path, 'an object of masks by name, or null', value)]
  }

  return setEntries(value).flatMap(([name, entry]) => checkMask(entry, join(path, name)))
})

/**
 * The keys of a story's options, in the order `VisualCheckOptions` declares them. `wait` is checked but not returned.
 */
const storyKeys = {
  modes: checkModes,
  viewport: checkViewport,
  element: orNull({ ...nonEmptyString, text: 'a non-empty string, or null' }),
  masks: checkMasks,
  tolerance: checkTolerance,
  disable: optionalKey({ text: 'true or false', accepts: (value) => typeof value === 'boolean' }),
  wait: orNull({
    text: "a function that takes the story's context, or null to turn an inherited one off",
    accepts: (value) => typeof value === 'function',
  }),
} satisfies Record<keyof StoryOptions | 'wait', Check>

/**
 * Writes a validated mask as `{ selector }` or `{ host }`, without the unused key. `null` stays `null`.
 */
function normalizeMask(mask: Record<string, unknown> | null): StoryMask | null {
  if (mask === null) {
    return null
  }

  if (typeof mask.selector === 'string') {
    return { selector: mask.selector }
  }

  return typeof mask.host === 'string' ? { host: mask.host } : null
}

/**
 * Copies validated options without the `undefined` keys and without `wait`, and writes each mask with one key.
 */
function toOptions(value: Record<string, unknown>): StoryOptions {
  const entries = Object.entries(withoutUndefined(value) as Record<string, unknown>).filter(([key]) => key !== 'wait')
  const options = Object.fromEntries(entries)

  if (isPlainObject(options.masks)) {
    options.masks = Object.fromEntries(
      Object.entries(options.masks).map(([name, mask]) => [name, normalizeMask(isPlainObject(mask) ? mask : null)]),
    )
  }

  // The checks guarantee that every key is one `StoryOptions` declares, holding a value of its declared type.
  return options as StoryOptions
}

/**
 * Checks one story's merged `parameters.visualCheck` and returns its options, or every issue. Each issue starts with
 * its key path, which starts at `visualCheck`. The caller adds the story.
 *
 * @public
 */
export function checkStoryOptions(value: unknown): { options: StoryOptions } | { issues: string[] } {
  if (value === undefined) {
    return { options: {} }
  }

  if (!isPlainObject(value)) {
    const text = 'an object, as visualCheck({ ... }) from <configDir>/visual-check.ts writes'

    return { issues: [mustBe(rootPath, text, value)] }
  }

  const issues = checkKeys(storyKeys, value, rootPath, newerHelperHint)

  return issues.length > 0 ? { issues } : { options: toOptions(value) }
}
