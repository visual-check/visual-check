import {
  type Check,
  checkExpectedPageErrors,
  checkKeys,
  checksOf,
  isPlainObject,
  join,
  type Keys,
  listOf,
  lowercaseNamePattern,
  meets,
  mustBe,
  nonEmptyString,
  objectOf,
  oneOf,
  optional,
  pageErrorsRequirement,
  type Requirement,
  toleranceExample,
  toleranceRequirements,
  viewportExample,
  viewportRequirements,
  wholeNumber,
  withoutUndefined,
} from './checks.js'
import { ConfigError } from './config-error.js'
import type { AffectedSettings, ColorScheme, Config, Platform, StorybookSettings } from './define-config.js'
import { findStorybookUrlProblem, serveStorybookFix } from './find-storybook-url-problem.js'

/**
 * The URL the examples in issues use.
 */
const exampleUrl = 'http://127.0.0.1:6006'

/**
 * The longest timeout Node's `setTimeout` takes, in milliseconds. A longer one fires at once.
 */
const maxTimeout = 2_147_483_647

/**
 * What a key that doesn't take a `{ local, ci }` pair reports when it holds one.
 */
const cantTakePair =
  "can't take { local, ci }. Only storybooks.<name>.url, workers and readyTimeout differ between local runs and CI."

/**
 * Whether a value is a plain object whose keys are `local`, `ci` or both.
 */
function isPair(value: unknown): boolean {
  // Keys set to `undefined` count, so `retries: { ci: isCi ? 2 : undefined }` reads as the pair it is.
  const keys = isPlainObject(value) ? Object.keys(value) : []

  return keys.length > 0 && keys.every((key) => key === 'local' || key === 'ci')
}

/**
 * Whether an action finishes without throwing.
 */
function succeeds(action: () => unknown): boolean {
  try {
    action()

    return true
  } catch {
    return false
  }
}

/**
 * Checks a key that doesn't take a `{ local, ci }` pair: an absent key passes, and a pair is reported as such.
 */
function noPair(check: Check): Check {
  return optional((value, path) => (isPair(value) ? [`${path}: ${cantTakePair}`] : check(value, path)))
}

/**
 * Checks a key that takes one value meeting a requirement.
 */
function oneValue(requirement: Requirement): Check {
  return noPair(meets(requirement))
}

/**
 * Checks a key that must be set before its value is checked. `hint` says what to set.
 */
function required(hint: string, check: Check): Check {
  return (value, path) => (value === undefined ? [`${path}: required. ${hint}`] : check(value, path))
}

/**
 * Checks a key that takes a value meeting a requirement, or a `{ local, ci }` pair of those.
 */
function pairOf(requirement: Requirement): Check {
  const side = optional(meets(requirement))
  const sides: Keys = { local: side, ci: side }
  const checkPlainValue = meets({ ...requirement, text: `${requirement.text}, or a { local, ci } pair of those` })

  return optional((value, path) => {
    if (!isPlainObject(value)) {
      return checkPlainValue(value, path)
    }

    const issues = checkKeys(sides, value, path)

    return value.local === undefined && value.ci === undefined
      ? [...issues, `${path}: { local, ci } needs local, ci or both.`]
      : issues
  })
}

/**
 * Checks a key that takes an array of items meeting `item`. `text` says what the array must be.
 */
function arrayOf(item: Requirement, text: string): Check {
  return noPair(listOf(item, text))
}

/**
 * A Storybook URL: an http(s) URL string that holds no user name or password. The issue for a login doesn't show the
 * URL.
 */
const storybookUrl: Requirement = {
  text: 'an http: or https: URL string',
  accepts: (value) => findStorybookUrlProblem(value) === undefined,
  explain: (value) =>
    findStorybookUrlProblem(value) === 'login'
      ? `holds a user name or password. visual-check sends no login: ${serveStorybookFix} and point the URL at that.`
      : undefined,
}

/**
 * Checks one Storybook's settings.
 */
const checkStorybook = noPair(
  objectOf(
    {
      url: required(`Set the URL the Storybook answers at, such as '${exampleUrl}'.`, pairOf(storybookUrl)),
      dir: oneValue(nonEmptyString),
      configDir: oneValue(nonEmptyString),
      baselines: oneValue(nonEmptyString),
    } satisfies Record<keyof StorybookSettings, Check>,
    `{ url: '${exampleUrl}' }`,
  ),
)

/**
 * Checks `storybooks`: at least one Storybook, each with a valid name and valid settings.
 */
function checkStorybooks(value: unknown, path: string): string[] {
  const entries = isPlainObject(value) ? Object.entries(value).filter(([, settings]) => settings !== undefined) : []

  if (entries.length === 0) {
    const text = `an object with at least one Storybook by name, such as { web: { url: '${exampleUrl}' } }`

    return [mustBe(path, text, value)]
  }

  return entries.flatMap(([name, settings]) => [
    ...(lowercaseNamePattern.test(name)
      ? []
      : [`${join(path, name)}: a Storybook name takes lowercase letters, digits and -.`]),
    ...checkStorybook(settings, join(path, name)),
  ])
}

/**
 * The keys of the config's root, in the order `Config` declares them.
 */
const configKeys = {
  storybooks: required(`Set the Storybooks to capture, such as { web: { url: '${exampleUrl}' } }.`, checkStorybooks),
  platform: oneValue(oneOf<Platform>({ 'linux/amd64': true, 'linux/arm64': true, host: true })),
  image: oneValue(nonEmptyString),
  tolerance: noPair(objectOf(checksOf(toleranceRequirements, oneValue), toleranceExample)),
  viewport: noPair(objectOf(checksOf(viewportRequirements, oneValue), viewportExample)),
  maskColor: oneValue({
    text: "a color as '#RGB' or '#RRGGBB', such as '#FF00FF'",
    accepts: (value) => typeof value === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value),
  }),
  timezone: oneValue({
    text: "an IANA time zone name, such as 'Europe/Warsaw'",
    accepts: (value) =>
      typeof value === 'string' &&
      !/^[+-]/.test(value) &&
      succeeds(() => new Intl.DateTimeFormat('en-US', { timeZone: value })),
  }),
  locale: oneValue({
    text: "a BCP 47 locale, such as 'en-US'",
    accepts: (value) => typeof value === 'string' && succeeds(() => Intl.getCanonicalLocales(value)),
  }),
  colorScheme: oneValue(oneOf<ColorScheme>({ light: true, dark: true })),
  workers: pairOf({
    text: `'auto' or ${wholeNumber(1).text}`,
    accepts: (value) => value === 'auto' || wholeNumber(1).accepts(value),
  }),
  readyTimeout: pairOf(wholeNumber(1, maxTimeout)),
  retries: oneValue(wholeNumber(0)),
  silenceHosts: arrayOf(
    {
      text: "a host such as 'example.com', or '*.' and a host, such as '*.example.com'",
      accepts: (value) => typeof value === 'string' && /^(\*\.)?[^*/\s]+$/.test(value),
    },
    "an array of hosts, such as ['example.com', '*.example.com']",
  ),
  pageErrors: oneValue(pageErrorsRequirement),
  expectedPageErrors: noPair(checkExpectedPageErrors),
  affected: noPair(
    objectOf(
      {
        selectAll: arrayOf(nonEmptyString, "an array of globs, such as ['package.json']"),
        ignore: arrayOf(nonEmptyString, "an array of globs, such as ['**/*.md']"),
      } satisfies Record<keyof AffectedSettings, Check>,
      "{ selectAll: ['package.json'] }",
    ),
  ),
} satisfies Record<keyof Config, Check>

/**
 * Turns the config module's default export into a `Config`: a copy without the keys set to `undefined`.
 * `displayPath` is the config's path as the user sees it.
 *
 * @throws {ConfigError} When the value isn't a valid config. The message lists every issue, each naming its key.
 */
export function validateConfig(value: unknown, displayPath: string): Config {
  if (!isPlainObject(value)) {
    throw new ConfigError(`${displayPath} must export a config object: export default defineConfig({ ... }).`)
  }

  const issues = checkKeys(configKeys, value, '')

  if (issues.length > 0) {
    throw new ConfigError([`${displayPath} is invalid:`, ...issues.map((issue) => `  - ${issue}`)].join('\n'))
  }

  // The checks guarantee that every key set to something other than `undefined` is one `Config` declares, holding a
  // value of its declared type, and that `storybooks` is set. The copy drops the keys set to `undefined`, which
  // `exactOptionalPropertyTypes` rules out.
  return withoutUndefined(value) as Config
}
