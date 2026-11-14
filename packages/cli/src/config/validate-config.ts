import { ConfigError } from './config-error.js'
import type {
  AffectedSettings,
  ColorScheme,
  Config,
  Platform,
  StorybookSettings,
  Tolerance,
  Viewport,
} from './define-config.js'
import { isHttpUrl } from './is-http-url.js'

/**
 * Checks the value at a key path and returns one issue per problem, each starting with its key path. A key that is
 * absent reaches its check as `undefined`.
 */
type Check = (value: unknown, path: string) => string[]

/**
 * The keys one object level takes, each with its check. Unknown-key issues list these keys.
 */
type Keys = Record<string, Check>

/**
 * What a value must be.
 */
interface Requirement {
  /**
   * What the value must be, as it reads after "must be".
   */
  text: string
  /**
   * Whether a value meets the requirement.
   */
  accepts: (value: unknown) => boolean
}

/**
 * The URL the examples in issues use.
 */
const exampleUrl = 'http://127.0.0.1:6006'

/**
 * The most characters a value takes in an issue before it's cut short.
 */
const maxShownLength = 40

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
 * Whether a value is a plain object: an object literal or one with a `null` prototype. An array, a `Date` or a class
 * instance isn't.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

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
function render(value: unknown): string {
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
 * The issue for a value at `path` that isn't what `text` says, showing the value briefly.
 */
function mustBe(path: string, text: string, value: unknown): string {
  const characters = Array.from(render(value))
  const brief =
    characters.length > maxShownLength ? `${characters.slice(0, maxShownLength - 1).join('')}…` : characters.join('')

  return `${path}: must be ${text}. Got ${brief}.`
}

/**
 * The key path of `key` inside the object at `path`, whose path is empty at the root. A key that isn't a plain name
 * reads as `["a b"]`.
 */
function join(path: string, key: string): string {
  if (!/^[\w$-]+$/.test(key)) {
    return `${path}[${JSON.stringify(key)}]`
  }

  return path === '' ? key : `${path}.${key}`
}

/**
 * Checks that a value meets a requirement, reporting `undefined` like any other value.
 */
function meets(requirement: Requirement): Check {
  return (value, path) => (requirement.accepts(value) ? [] : [mustBe(path, requirement.text, value)])
}

/**
 * Checks a key that may be absent: an absent key passes.
 */
function optional(check: Check): Check {
  return (value, path) => (value === undefined ? [] : check(value, path))
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
 * Checks each key of an object: unknown keys first, then every known key in order. A key set to `undefined` is
 * absent.
 */
function checkKeys(keys: Keys, value: Record<string, unknown>, path: string): string[] {
  const known = Object.keys(keys).join(', ')
  const unknownIssues = Object.keys(value)
    .filter((key) => !Object.hasOwn(keys, key) && value[key] !== undefined)
    .map((key) => `${join(path, key)}: unknown key. Known keys: ${known}.`)

  return [...unknownIssues, ...Object.entries(keys).flatMap(([key, check]) => check(value[key], join(path, key)))]
}

/**
 * Checks a key that takes an object with some of `keys`. `example` shows one such object.
 */
function objectOf(keys: Keys, example: string): Check {
  return noPair((value, path) =>
    isPlainObject(value) ? checkKeys(keys, value, path) : [mustBe(path, `an object such as ${example}`, value)],
  )
}

/**
 * Checks a key that takes an array of items meeting `item`. `text` says what the array must be.
 */
function arrayOf(item: Requirement, text: string): Check {
  const checkItem = meets(item)

  return noPair((value, path) =>
    Array.isArray(value)
      ? Array.from(value).flatMap((entry, index) => checkItem(entry, `${path}[${index}]`))
      : [mustBe(path, text, value)],
  )
}

/**
 * A whole number from `minimum` to `maximum`.
 */
function wholeNumber(minimum: number, maximum = Number.MAX_SAFE_INTEGER): Requirement {
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
 * One of the keys of `members`. Pass the union as the type argument, so a missing member fails to compile.
 */
function oneOf<Member extends string>(members: Record<Member, true>): Requirement {
  const values = Object.keys(members)
  const quoted = values.map((value) => `'${value}'`)

  return {
    text: `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}`,
    accepts: (value) => values.some((allowed) => allowed === value),
  }
}

/**
 * A string with at least one character.
 */
const nonEmptyString: Requirement = {
  text: 'a non-empty string',
  accepts: (value) => typeof value === 'string' && value !== '',
}

/**
 * Checks one Storybook's settings.
 */
const checkStorybook = objectOf(
  {
    url: required(
      `Set the URL the Storybook answers at, such as '${exampleUrl}'.`,
      pairOf({
        text: 'an http: or https: URL string',
        accepts: isHttpUrl,
      }),
    ),
    dir: oneValue(nonEmptyString),
    configDir: oneValue(nonEmptyString),
    baselines: oneValue(nonEmptyString),
  } satisfies Record<keyof StorybookSettings, Check>,
  `{ url: '${exampleUrl}' }`,
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
    ...(/^[a-z0-9-]+$/.test(name)
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
  tolerance: objectOf(
    {
      color: oneValue({
        text: 'a number from 0 to 1',
        accepts: (value) => typeof value === 'number' && value >= 0 && value <= 1,
      }),
      pixels: oneValue({
        text: "a whole number of 0 or more, or a string from '0%' to '100%'",
        accepts: (value) =>
          wholeNumber(0).accepts(value) ||
          (typeof value === 'string' && /^\d+(\.\d+)?%$/.test(value) && Number.parseFloat(value) <= 100),
      }),
    } satisfies Record<keyof Tolerance, Check>,
    '{ color: 0.01, pixels: 20 }',
  ),
  viewport: objectOf(
    {
      width: oneValue(wholeNumber(1)),
      height: oneValue(wholeNumber(1)),
      deviceScaleFactor: oneValue({
        text: 'a number greater than 0',
        accepts: (value) => typeof value === 'number' && Number.isFinite(value) && value > 0,
      }),
      touch: oneValue({ text: 'true or false', accepts: (value) => typeof value === 'boolean' }),
    } satisfies Record<keyof Viewport, Check>,
    '{ width: 1280, height: 720 }',
  ),
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
  affected: objectOf(
    {
      selectAll: arrayOf(nonEmptyString, "an array of globs, such as ['package.json']"),
      ignore: arrayOf(nonEmptyString, "an array of globs, such as ['**/*.md']"),
    } satisfies Record<keyof AffectedSettings, Check>,
    "{ selectAll: ['package.json'] }",
  ),
} satisfies Record<keyof Config, Check>

/**
 * A copy of a value with the keys set to `undefined` left out, in every plain object at every level. Arrays are copied
 * as they are.
 */
function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return [...value]
  }

  if (!isPlainObject(value)) {
    return value
  }

  const entries = Object.entries(value).filter(([, item]) => item !== undefined)

  return Object.fromEntries(entries.map(([key, item]) => [key, withoutUndefined(item)]))
}

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
