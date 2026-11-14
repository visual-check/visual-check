import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { StorybookError, StorybookUnreachableError } from './storybook-error.js'

/**
 * The most characters of a failed index's response body an error message quotes.
 */
const bodyLengthLimit = 500

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
 * Builds the URL of a Storybook's `index.json`: the Storybook's path keeps its place, and a query, a hash and
 * credentials are left out, so the credentials are neither sent nor shown.
 */
function indexUrlOf(url: string): URL {
  const base = new URL(url)
  base.search = ''
  base.hash = ''
  base.username = ''
  base.password = ''

  if (!base.pathname.endsWith('/')) {
    base.pathname += '/'
  }

  return new URL('index.json', base)
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
 * fix.
 */
function failureDetailOf(body: string): string {
  const text = body.trim()
  const quoted = text.length > bodyLengthLimit ? `${text.slice(0, bodyLengthLimit)}…` : text
  const quotedLine = quoted === '' ? '' : `\n${quoted}`

  return `${quotedLine}\nFix what Storybook reports: on a dev server, a stories file that doesn't parse breaks index.json.`
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
 * Reaches `<url>/index.json` and returns its stories.
 *
 * `timeoutMilliseconds` limits the whole request, body included. It defaults to 60 s; a test passes a shorter one.
 *
 * @throws {StorybookUnreachableError} When nothing answers at the URL, the Storybook stops answering mid-response, or
 * the request takes longer than the timeout.
 * @throws {StorybookError} When the index fails, isn't a Storybook index, or lists stories files that aren't on disk.
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
    throw new StorybookError(
      `Storybook ${storybook.name}'s index.json failed at ${indexUrl}: HTTP ${response.status} ${response.statusText}.${failureDetailOf(body)}`,
    )
  }

  let stories: Story[]

  try {
    stories = parseIndex(JSON.parse(body))
  } catch (error) {
    throw new StorybookError(
      `Storybook ${storybook.name}'s index.json at ${indexUrl} isn't a Storybook index: ${messageOf(error)}. ` +
        'Check that the URL points at Storybook 9.1 or later.',
    )
  }

  checkStoriesFiles(storybook, stories, cwd)

  return stories
}
