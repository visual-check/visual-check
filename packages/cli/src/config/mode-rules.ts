import { join, lowercaseNamePattern, mustBe, render } from './checks.js'
import type { ModeDefinition, StoryOptions } from './story-options.js'

/**
 * One story as the mode rules need it.
 *
 * @public
 */
export interface ModeRulesStory {
  /**
   * The story's ID.
   */
  id: string
  /**
   * The story's options, as `checkStoryOptions` gives them once valid, so no key is set to `undefined`.
   */
  options: StoryOptions
  /**
   * The keys of the globals the story or its meta pins in its own `globals`.
   */
  pinnedGlobals: readonly string[]
}

/**
 * A mode a story lists: one it captures, with its definition.
 */
interface ListedMode {
  /**
   * The mode's name.
   */
  name: string
  /**
   * The mode's key path, which starts at `visualCheck`.
   */
  path: string
  /**
   * What the mode sets.
   */
  definition: ModeDefinition
}

/**
 * The value of a global a mode sets.
 */
type GlobalValue = NonNullable<ModeDefinition['globals']>[string]

/**
 * One global a listed mode sets.
 */
interface ModeGlobal {
  /**
   * The mode that sets it.
   */
  mode: ListedMode
  /**
   * The global's key.
   */
  key: string
  /**
   * The global's value.
   */
  value: GlobalValue
  /**
   * The global's key path, which starts at `visualCheck`.
   */
  path: string
}

/**
 * The first story that lists a mode, which fixes what the mode means in its Storybook.
 */
interface FirstListing {
  /**
   * The story's ID.
   */
  storyId: string
  /**
   * The mode's definition in that story.
   */
  definition: ModeDefinition
}

/**
 * What the check has learned of a Storybook's modes from the stories before the current one.
 */
interface ModesSeen {
  /**
   * Whether each mode name checked so far is valid.
   */
  validNames: Map<string, boolean>
  /**
   * The first story that lists each mode.
   */
  firstListings: Map<string, FirstListing>
}

/**
 * The key path of a story's modes in an issue.
 */
const modesPath = 'visualCheck.modes'

/**
 * The names kept for browsers' baselines.
 */
const reservedNames = ['chromium', 'webkit', 'firefox']

/**
 * What a mode-name issue ends with.
 */
const renameFix = 'Rename it in <configDir>/visual-check.ts.'

/**
 * What Storybook keeps of a global's key or string value in the URL. It drops any other character. The storybook
 * module encodes globals with the same pattern, and this module can't import it.
 */
const urlSafeGlobalPattern = /^[a-zA-Z0-9 _-]*$/

/**
 * What Storybook reads back from the URL as a number: digits with an optional leading `-` and an optional fraction.
 * The storybook module encodes globals with the same pattern, and this module can't import it.
 */
const plainDecimalPattern = /^-?\d+(\.\d+)?$/

/**
 * The issues of a mode's name: one when it holds other characters than lowercase letters, digits and -, or when it's
 * reserved.
 */
function nameIssues(name: string, path: string): string[] {
  if (!lowercaseNamePattern.test(name)) {
    return [`${path}: a mode name takes lowercase letters, digits and -. ${renameFix}`]
  }

  if (reservedNames.includes(name)) {
    return [
      `${path}: chromium, webkit and firefox are kept for browsers' baselines, so no mode can take them. ${renameFix}`,
    ]
  }

  return []
}

/**
 * The entries of an object sorted by key, so two objects that hold the same entries give the same list.
 */
function sortedEntries(value: object): [string, unknown][] {
  return Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1))
}

/**
 * What a definition means, as text that two definitions share when they set the same globals and viewport. Key order
 * doesn't count, and absent `globals` or `viewport` reads as empty.
 */
function meaningOf({ globals = {}, viewport = {} }: ModeDefinition): string {
  return JSON.stringify([sortedEntries(globals), sortedEntries(viewport)])
}

/**
 * The issue of a listed mode that means something other than in the first story that lists it. A mode no story listed
 * before has none.
 */
function conflictIssues(mode: ListedMode, first: FirstListing | undefined): string[] {
  if (first === undefined || meaningOf(first.definition) === meaningOf(mode.definition)) {
    return []
  }

  const here = render(mode.definition)
  const there = render(first.definition)

  return [
    `${mode.path}: sets ${here} here but ${there} in ${first.storyId}. A mode means one thing in a Storybook, so declare it once in <configDir>/visual-check.ts.`,
  ]
}

/**
 * The issue of a global the Storybook doesn't declare.
 */
function undeclaredIssue({ key, path }: ModeGlobal, storybookName: string): string {
  return `${path}: Storybook ${storybookName} doesn't declare the global ${key}, so it would drop it from the story's URL. Add ${key} to initialGlobals or globalTypes in <configDir>/preview.`
}

/**
 * The issue of a global's value when Storybook wouldn't read it back from the story's URL.
 */
function valueIssues(value: GlobalValue, path: string): string[] {
  if (typeof value === 'boolean') {
    return []
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && plainDecimalPattern.test(String(value))
      ? []
      : [
          mustBe(
            path,
            "a number in plain decimal digits, such as 1.5 or -2, or Storybook doesn't read it from the story's URL as a number",
            value,
          ),
        ]
  }

  return urlSafeGlobalPattern.test(value)
    ? []
    : [
        mustBe(
          path,
          "a string of only letters, digits, spaces, _ and -, or Storybook drops it from the story's URL",
          value,
        ),
      ]
}

/**
 * The issues of a global whose key or value Storybook wouldn't read back from the story's URL: the key's first, then
 * the value's.
 */
function characterIssues({ key, value, path }: ModeGlobal): string[] {
  const keyIssues =
    key !== '' && urlSafeGlobalPattern.test(key)
      ? []
      : [
          `${path}: a global's name may hold only letters, digits, spaces, _ and -, and can't be empty, or Storybook drops it from the story's URL.`,
        ]

  return [...keyIssues, ...valueIssues(value, path)]
}

/**
 * The issue of a global the story or its meta pins, whose value wins over the mode's.
 */
function pinnedIssue({ mode, key, path }: ModeGlobal): string {
  return `${path}: the story or its meta pins ${key} in its own globals, which win over the mode's, so the mode's ${key} never reaches the story. Leave ${mode.name} out of the story's modes, or ${key} out of its globals.`
}

/**
 * The issues of the mode names no story before has held, which it records in `validNames`.
 */
function newNameIssues(names: readonly string[], validNames: Map<string, boolean>): string[] {
  return names.flatMap((name) => {
    if (validNames.has(name)) {
      return []
    }

    const issues = nameIssues(name, join(modesPath, name))

    validNames.set(name, issues.length === 0)

    return issues
  })
}

/**
 * The modes a story lists, in the order its options hold them. A mode set to `null` is declared but not listed.
 */
function listedModesOf(modes: Record<string, ModeDefinition | null>): ListedMode[] {
  return Object.entries(modes).flatMap(([name, definition]) =>
    definition === null ? [] : [{ name, path: join(modesPath, name), definition }],
  )
}

/**
 * The globals the listed modes set, mode by mode, in the order each definition holds them.
 */
function modeGlobalsOf(modes: readonly ListedMode[]): ModeGlobal[] {
  return modes.flatMap((mode) =>
    Object.entries(mode.definition.globals ?? {}).map(([key, value]) => ({
      mode,
      key,
      value,
      path: join(join(mode.path, 'globals'), key),
    })),
  )
}

/**
 * The issues of one story, in rule order, given what the stories before it showed. Records the names it checks and
 * the modes it lists first in `seen`.
 */
function storyIssues(
  story: ModeRulesStory,
  storybookName: string,
  declaredGlobals: ReadonlySet<string> | null,
  seen: ModesSeen,
): string[] {
  const modes = story.options.modes ?? {}
  const namingIssues = newNameIssues(Object.keys(modes), seen.validNames)
  const listed = listedModesOf(modes).filter(({ name }) => seen.validNames.get(name) === true)
  const conflicts = listed.flatMap((mode) => conflictIssues(mode, seen.firstListings.get(mode.name)))
  const firsts = listed.filter(({ name }) => !seen.firstListings.has(name))

  for (const mode of firsts) {
    seen.firstListings.set(mode.name, { storyId: story.id, definition: mode.definition })
  }

  const firstGlobals = modeGlobalsOf(firsts)
  const undeclared = declaredGlobals === null ? [] : firstGlobals.filter(({ key }) => !declaredGlobals.has(key))
  const pinned = modeGlobalsOf(listed).filter(({ key }) => story.pinnedGlobals.includes(key))

  return [
    ...namingIssues,
    ...conflicts,
    ...undeclared.map((global) => undeclaredIssue(global, storybookName)),
    ...firstGlobals.flatMap(characterIssues),
    ...pinned.map(pinnedIssue),
  ]
}

/**
 * Checks the mode rules of one Storybook's stories, given in `index.json` order. Gives each issue as
 * `<story-id>: <issue>`, whose key path starts at `visualCheck`: by story, then by rule, then in the order the modes and
 * their globals are held. The rules:
 *
 * 1. A mode's name, `null` entries included, takes lowercase letters, digits and -, and isn't `chromium`, `webkit` or
 *    `firefox`. A mode whose name fails skips the other rules.
 * 2. A listed mode means one thing: the first story that lists it fixes its definition, and a later story that lists it
 *    with other globals or another viewport has an issue naming the first.
 * 3. A listed mode's global is one the Storybook declares. `declaredGlobals` set to `null` skips this rule.
 * 4. A listed mode's global has a key and a value Storybook reads back from the story's URL.
 * 5. A listed mode's global isn't one the story pins.
 *
 * The helper writes every declared mode into every story, so one bad declaration would repeat in every story. Each
 * issue is given once instead: a name's on the first story that holds it, and a definition's (rules 3 and 4) on the
 * first story that lists the mode. A later story that lists it the same way has none, and one that lists it another
 * way has rule 2's. Rule 5 depends on the story, so each story has its own.
 *
 * @public
 */
export function checkModeRules(
  storybookName: string,
  stories: readonly ModeRulesStory[],
  declaredGlobals: ReadonlySet<string> | null,
): string[] {
  const seen: ModesSeen = { validNames: new Map(), firstListings: new Map() }

  return stories.flatMap((story) =>
    storyIssues(story, storybookName, declaredGlobals, seen).map((issue) => `${story.id}: ${issue}`),
  )
}
