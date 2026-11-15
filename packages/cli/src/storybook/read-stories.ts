import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { StorybookError, StorybookUnreachableError } from './storybook-error.js'

/**
 * The most characters of a failed index's response body an error message quotes.
 */
const bodyLengthLimit = 500

/**
 * The fix the messages about a login name, which reads after "visual-check sends no login:". The `config` module words
 * the same fix for the config and `--url`, and this module can't import it.
 */
const loginFix =
  'serve Storybook where visual-check runs (storybook dev, or its static build served in the same CI job) ' +
  'and point its URL at that.'

/**
 * How long the index request may take, in milliseconds, body included. A dev server's first `index.json` can be slow,
 * so the limit is generous. Without one, a server that accepts the connection and never answers would hang the run
 * for undici's default 300 s.
 */
const indexTimeoutMilliseconds = 60_000

/**
 * One story a Storybook's index lists.
 *
 * @public
 */
export interface Story {
  /**
   * The story's ID, such as `button--primary`.
   */
  id: string
  /**
   * The title of the component the story belongs to.
   */
  title: string
  /**
   * The story's name.
   */
  name: string
  /**
   * The path of the stories file, relative to the Storybook's folder.
   */
  importPath: string
}

/**
 * Whether a value is a non-null object that isn't an array.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads a string field of an index entry.
 *
 * @throws {Error} When the entry has no such field, or the field isn't a string.
 */
function stringFieldOf(entry: Record<string, unknown>, key: string, field: string): string {
  const value = entry[field]

  if (typeof value === 'string') {
    return value
  }

  const name = typeof entry.id === 'string' ? entry.id : key

  throw new Error(
    value === undefined ? `entry ${name} has no ${field}` : `entry ${name} has a ${field} that isn't a string`,
  )
}

/**
 * Reads one index entry. Returns the story it describes, or `undefined` for an entry that isn't a story: a docs entry
 * or a CSF Next `.test()` entry.
 *
 * @throws {Error} When the entry isn't an object with the string fields an index entry has.
 */
function parseEntry(key: string, entry: unknown): Story | undefined {
  if (!isRecord(entry)) {
    throw new Error(`entry ${key} isn't an object`)
  }

  const id = stringFieldOf(entry, key, 'id')
  const title = stringFieldOf(entry, key, 'title')
  const name = stringFieldOf(entry, key, 'name')
  const importPath = stringFieldOf(entry, key, 'importPath')
  const type = stringFieldOf(entry, key, 'type')

  if (type !== 'story' || entry.subtype === 'test') {
    return undefined
  }

  return { id, title, name, importPath }
}

/**
 * Reads a Storybook index's stories. Docs entries and CSF Next `.test()` entries aren't stories, so they are left out.
 *
 * @throws {Error} With the reason as its message when `json` isn't a Storybook index.
 */
export function parseIndex(json: unknown): Story[] {
  if (!isRecord(json) || !isRecord(json.entries)) {
    throw new Error('it has no entries object')
  }

  return Object.entries(json.entries).flatMap(([key, entry]) => parseEntry(key, entry) ?? [])
}

/**
 * Names what made a request fail: the cause's code, else the cause's message, else the error's own message.
 */
function causeOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }

  const { cause } = error

  if (isRecord(cause) && typeof cause.code === 'string') {
    return cause.code
  }

  if (cause instanceof Error) {
    return cause.message
  }

  return error.message
}

/**
 * Names a thrown value by its message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Builds the URL a Storybook's own files are found under: the Storybook's path keeps its place and ends in `/`, and a
 * query, a hash and credentials are left out, so the credentials are neither sent nor shown. The config and `--url`
 * reject a URL that holds a login, so none reaches here; leaving them out is a second guard against sending or printing
 * one.
 */
function storybookBaseOf(url: string): URL {
  const base = new URL(url)

  base.search = ''
  base.hash = ''
  base.username = ''
  base.password = ''

  if (!base.pathname.endsWith('/')) {
    base.pathname += '/'
  }

  return base
}

/**
 * Builds the URL of a Storybook's `index.json`.
 */
function indexUrlOf(url: string): URL {
  return new URL('index.json', storybookBaseOf(url))
}

/**
 * The value of a Storybook global in a story URL.
 */
type GlobalValue = string | number | boolean

/**
 * What Storybook keeps of a global's key or string value in the URL. It drops any other character, with a warning.
 */
const urlSafeGlobalPattern = /^[a-zA-Z0-9 _-]*$/

/**
 * What Storybook reads back from the URL as a number: digits with an optional leading `-` and an optional fraction. It
 * reads an exponent, such as `1e+21` or `1e-7`, as a string.
 */
const plainDecimalPattern = /^-?\d+(\.\d+)?$/

/**
 * Builds the error for a global Storybook would drop from the URL.
 */
function unusableGlobalErrorOf(key: string, reason: string): Error {
  return new Error(`Storybook can't take the global "${key}" from the URL: ${reason}.`)
}

/**
 * Encodes one global as `key:value`, as Storybook reads it from the URL: a string as is, a boolean as `!true` or
 * `!false`, a number in plain digits.
 *
 * @throws {Error} Naming the key when the key is empty or holds a character Storybook drops, a string value holds one,
 * or a number isn't finite or isn't written in plain decimal digits, such as `1e21` or `1e-7`.
 */
function encodeGlobal(key: string, value: GlobalValue): string {
  if (key === '' || !urlSafeGlobalPattern.test(key)) {
    throw unusableGlobalErrorOf(key, 'its key may hold only letters, digits, spaces, _ and -, and may not be empty')
  }

  if (typeof value === 'boolean') {
    return `${key}:!${value}`
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw unusableGlobalErrorOf(key, `its value ${value} isn't a finite number`)
    }

    const digits = String(value)

    if (!plainDecimalPattern.test(digits)) {
      throw unusableGlobalErrorOf(key, `its value ${digits} isn't a number in plain decimal digits`)
    }

    return `${key}:${digits}`
  }

  if (!urlSafeGlobalPattern.test(value)) {
    throw unusableGlobalErrorOf(key, `its value "${value}" may hold only letters, digits, spaces, _ and -`)
  }

  return `${key}:${value}`
}

/**
 * Builds the URL of a story on its own page, `iframe.html?id=<story id>&viewMode=story`, under the Storybook's URL as
 * `index.json` is.
 *
 * When `globals` has entries, the URL gains `&globals=<key:value;...>` in their order, which sets them for the story.
 * With none, or an empty record, the URL has no `globals` parameter.
 *
 * @throws {Error} Naming the global when its key or value is one Storybook would drop from the URL.
 *
 * @public
 */
export function storyUrlOf(
  storybookUrl: string,
  storyId: string,
  globals?: Readonly<Record<string, GlobalValue>>,
): string {
  const pairs = Object.entries(globals ?? {}).map(([key, value]) => encodeGlobal(key, value))
  const globalsParameter = pairs.length > 0 ? `&globals=${encodeURIComponent(pairs.join(';'))}` : ''

  return new URL(
    `iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story${globalsParameter}`,
    storybookBaseOf(storybookUrl),
  ).href
}

/**
 * Builds the error for an index request that took longer than its timeout.
 */
function timeoutErrorOf(name: string, indexUrl: string, timeoutMilliseconds: number): StorybookUnreachableError {
  return new StorybookUnreachableError(
    `Storybook ${name} didn't answer at ${indexUrl} within ${timeoutMilliseconds / 1000} s. ` +
      "Check what's listening there, or restart Storybook.",
  )
}

/**
 * Builds the lines that follow a failed index's status: the response body when it has text, cut to a limit, then the
 * fix. A server error points at the stories file that breaks the index. Any other status points at the URL, since the
 * body of such a response, such as a dev server's rejected host, often explains the fix.
 */
function failureDetailOf(status: number, body: string): string {
  const text = body.trim()
  const quoted = text.length > bodyLengthLimit ? `${text.slice(0, bodyLengthLimit)}…` : text
  const quotedLine = quoted === '' ? '' : `\n${quoted}`
  const fix =
    status >= 500
      ? "Fix what Storybook reports: on a dev server, a stories file that doesn't parse breaks index.json."
      : 'Check that the URL points at the running Storybook.'

  return `${quotedLine}\n${fix}`
}

/**
 * Builds the error for a body that isn't a Storybook index after a redirect, which is likely a login page. The final
 * URL shows without its query, hash and credentials, since a login redirect carries tokens.
 */
function redirectedErrorOf(name: string, indexUrl: string, finalUrl: string): StorybookError {
  const final = new URL(finalUrl)

  return new StorybookError(
    `Storybook ${name}'s index.json at ${indexUrl} redirected to ${final.origin}${final.pathname} and didn't get a ` +
      `Storybook index, likely a login page. visual-check sends no login: ${loginFix}`,
  )
}

/**
 * Builds the error for a failed index request: a message that says the Storybook asks for a login on a 401, else the
 * status, the body and the fix.
 */
function failedIndexErrorOf(name: string, indexUrl: string, response: Response, body: string): StorybookError {
  const status = `HTTP ${response.status} ${response.statusText}`

  if (response.status === 401) {
    return new StorybookError(
      `Storybook ${name} asks for a login at ${indexUrl} (${status}). visual-check sends no login: ${loginFix}`,
    )
  }

  return new StorybookError(
    `Storybook ${name}'s index.json failed at ${indexUrl}: ${status}.${failureDetailOf(response.status, body)}`,
  )
}

/**
 * Throws when the index lists stories files that aren't on disk. Each path is named once, relative to `cwd`.
 *
 * @throws {StorybookError} When a stories file is missing.
 */
function checkStoriesFiles(storybook: { name: string; dir: string }, stories: Story[], cwd: string): void {
  const missing = [...new Set(stories.map((story) => story.importPath))]
    .map((importPath) => resolve(storybook.dir, importPath))
    .filter((path) => !existsSync(path))
    .map((path) => relative(cwd, path))

  if (missing.length > 0) {
    throw new StorybookError(
      `Storybook ${storybook.name}'s index.json lists stories files that aren't on disk: ${missing.join(', ')}. ` +
        `Check storybooks.${storybook.name}.dir in the config, or restart Storybook so it indexes the current files.`,
    )
  }
}

/**
 * Tells whether a story ID can name a file in a flat folder: it holds no `/`, `\\` or NUL character, and isn't `.` or
 * `..`, so its baseline can't land outside the baselines folder.
 */
function isFileNameSafe(id: string): boolean {
  return !/[/\\\0]/.test(id) && id !== '.' && id !== '..'
}

/**
 * Throws when the index lists stories whose IDs can't name a baseline file.
 *
 * @throws {StorybookError} Naming the Storybook and each such ID.
 */
function checkStoryIds(name: string, stories: Story[]): void {
  const unsafe = stories.map((story) => story.id).filter((id) => !isFileNameSafe(id))

  if (unsafe.length > 0) {
    throw new StorybookError(
      `Storybook ${name}'s index.json lists stories whose IDs can't name a baseline file: ` +
        `${unsafe.map((id) => JSON.stringify(id)).join(', ')}. A story ID can't hold /, \\ or a NUL character, ` +
        'or be . or .. on its own. Give each of these stories an id without them.',
    )
  }
}

/**
 * Reaches `<url>/index.json` and returns its stories.
 *
 * `timeoutMilliseconds` limits the whole request, body included. It defaults to 60 s; a test passes a shorter one.
 *
 * @throws {StorybookUnreachableError} When nothing answers at the URL, the Storybook stops answering mid-response, or
 * the request takes longer than the timeout.
 * @throws {StorybookError} When the index fails, isn't a Storybook index, lists story IDs that can't name a baseline
 * file, or lists stories files that aren't on disk.
 *
 * @public
 */
export async function readStories(
  storybook: { name: string; url: string; dir: string },
  cwd: string,
  timeoutMilliseconds: number = indexTimeoutMilliseconds,
): Promise<Story[]> {
  const indexUrl = indexUrlOf(storybook.url).href
  const signal = AbortSignal.timeout(timeoutMilliseconds)
  let response: Response

  try {
    response = await fetch(indexUrl, { signal })
  } catch (error) {
    if (signal.aborted) {
      throw timeoutErrorOf(storybook.name, indexUrl, timeoutMilliseconds)
    }

    throw new StorybookUnreachableError(
      `Storybook ${storybook.name} doesn't answer at ${indexUrl} (${causeOf(error)}). ` +
        'Start it, or set its URL in the config or with --url.',
    )
  }

  let body: string

  try {
    body = await response.text()
  } catch (error) {
    if (signal.aborted) {
      throw timeoutErrorOf(storybook.name, indexUrl, timeoutMilliseconds)
    }

    throw new StorybookUnreachableError(
      `Storybook ${storybook.name} stopped answering at ${indexUrl} (${causeOf(error)}). Start it again, then rerun.`,
    )
  }

  if (!response.ok) {
    throw failedIndexErrorOf(storybook.name, indexUrl, response, body)
  }

  let stories: Story[]

  try {
    stories = parseIndex(JSON.parse(body))
  } catch (error) {
    if (response.redirected) {
      throw redirectedErrorOf(storybook.name, indexUrl, response.url)
    }

    throw new StorybookError(
      `Storybook ${storybook.name}'s index.json at ${indexUrl} isn't a Storybook index: ${messageOf(error)}. ` +
        'Check that the URL points at Storybook 9.1 or later.',
    )
  }

  checkStoryIds(storybook.name, stories)
  checkStoriesFiles(storybook, stories, cwd)

  return stories
}
