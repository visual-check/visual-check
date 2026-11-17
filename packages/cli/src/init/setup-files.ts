import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isJsonObject } from './package-manager.js'

/**
 * The content of each `.visual-check/.gitignore`: ignore everything except the baselines and this file.
 */
export const visualCheckGitignore = '/*\n!/baselines/\n!/.gitignore\n'

/**
 * The content of `<configDir>/visual-check.ts`: no modes, and a commented example of one.
 */
export const modesFileSource = `import { defineVisualCheck } from '@visual-check/storybook'

export const visualCheck = defineVisualCheck({
  modes: {
    // Each mode a story lists adds one snapshot besides its default capture. For example:
    // mobile: { viewport: { width: 375, height: 667, deviceScaleFactor: 2, touch: true } },
  },
})
`

/**
 * A Storybook to put in the config.
 */
export interface ConfigStorybook {
  /**
   * The Storybook's name, which is its key in `storybooks`.
   */
  name: string
  /**
   * The URL the Storybook is served at.
   */
  url: string
  /**
   * The Storybook's package folder, relative to the config's folder. Left out when it is `'.'`.
   */
  dir?: string
  /**
   * Storybook's config folder, relative to `dir`. Left out when it is `'.storybook'`.
   */
  configDir?: string
}

/**
 * The matcher for a property name that needs no quotes in an object literal.
 */
const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Returns `value` as a single-quoted string literal, escaping `\`, `'` and the line breaks.
 */
function quoted(value: string): string {
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')

  return `'${escaped}'`
}

/**
 * Returns `name` as an object key: bare when it is a valid identifier, single-quoted otherwise.
 */
function keyOf(name: string): string {
  return identifierPattern.test(name) ? name : quoted(name)
}

/**
 * Returns the one-line object literal of a Storybook. The properties come in a fixed order: `dir`, `configDir`,
 * `url`. `dir` is left out when it is `'.'` and `configDir` when it is `'.storybook'`, the defaults.
 */
function storybookLiteralOf(storybook: ConfigStorybook): string {
  const properties: string[] = []

  if (storybook.dir !== undefined && storybook.dir !== '.') {
    properties.push(`dir: ${quoted(storybook.dir)}`)
  }

  if (storybook.configDir !== undefined && storybook.configDir !== '.storybook') {
    properties.push(`configDir: ${quoted(storybook.configDir)}`)
  }

  properties.push(`url: ${quoted(storybook.url)}`)

  return `{ ${properties.join(', ')} }`
}

/**
 * Returns the entry of one Storybook under `storybooks`, as one line with no indentation, such as
 * `'web-app': { url: 'http://127.0.0.1:6006' },`. The name is quoted when it isn't an identifier.
 */
export function configEntryOf(storybook: ConfigStorybook): string {
  return `${keyOf(storybook.name)}: ${storybookLiteralOf(storybook)},`
}

/**
 * Returns the source of `visual-check.config.ts`. It holds only what differs from the defaults: each Storybook's
 * `url`, plus its `dir` and `configDir` when they aren't the defaults. Never `platform`, `image` or any other key.
 */
export function configSourceOf(storybooks: readonly ConfigStorybook[]): string {
  const lines = storybooks.map((storybook) => `    ${configEntryOf(storybook)}`)

  return [
    "import { defineConfig } from '@visual-check/cli'",
    '',
    'export default defineConfig({',
    '  storybooks: {',
    ...lines,
    '  },',
    '})',
    '',
  ].join('\n')
}

/**
 * Writes `content` to `path`, creating the parent folders. Never overwrites: returns `false` when the file already
 * exists, `true` when it wrote it. Any other error is thrown.
 */
export function writeIfMissing(path: string, content: string): boolean {
  mkdirSync(dirname(path), { recursive: true })

  try {
    writeFileSync(path, content, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false
    }

    throw error
  }

  return true
}

/**
 * Returns the indentation a JSON text uses: the leading whitespace of its first indented line, or two spaces when
 * no line is indented.
 */
function indentationOf(text: string): string {
  return /^[ \t]+(?=\S)/m.exec(text)?.[0] ?? '  '
}

/**
 * Returns the `scripts` of a manifest as a plain object, or `undefined` when it has none. Throws when `scripts` is
 * there but isn't an object.
 */
function ownScriptsOf(manifest: Record<string, unknown>, manifestPath: string): Record<string, unknown> | undefined {
  const { scripts } = manifest

  if (scripts === undefined) {
    return undefined
  }

  if (!isJsonObject(scripts)) {
    throw new Error(`The "scripts" field of ${manifestPath} is not an object, so init can't add scripts to it.`)
  }

  return scripts
}

/**
 * A script `init` replaced in `package.json`.
 */
export interface ReplacedScript {
  /**
   * The script's name.
   */
  name: string
  /**
   * What the script ran before.
   */
  previous: string
}

/**
 * The scripts `init` changed in `package.json`.
 */
export interface ScriptChanges {
  /**
   * The names of the scripts it added, in the given order.
   */
  added: string[]
  /**
   * The scripts it replaced, in the given order.
   */
  replaced: ReplacedScript[]
}

/**
 * Sets the scripts of a `package.json`: adds the missing ones and replaces the ones that run something else. Gives
 * what it changed. The file keeps its indentation, its line endings (LF or CRLF), its key order and its trailing
 * newline (or lack of one). When nothing changes, the file isn't written. Throws when the file isn't a JSON object or
 * its `scripts` isn't one.
 */
export function setScripts(manifestPath: string, scripts: Record<string, string>): ScriptChanges {
  const text = readFileSync(manifestPath, 'utf8')
  const manifest: unknown = JSON.parse(text)

  if (!isJsonObject(manifest)) {
    throw new Error(`${manifestPath} is not a JSON object, so init can't add scripts to it.`)
  }

  const existing = ownScriptsOf(manifest, manifestPath) ?? {}
  const changes: ScriptChanges = { added: [], replaced: [] }

  for (const [name, command] of Object.entries(scripts)) {
    const previous = existing[name]

    if (!Object.hasOwn(existing, name)) {
      changes.added.push(name)
    } else if (previous !== command) {
      changes.replaced.push({ name, previous: typeof previous === 'string' ? previous : JSON.stringify(previous) })
    }
  }

  if (changes.added.length === 0 && changes.replaced.length === 0) {
    return changes
  }

  manifest.scripts = { ...existing, ...scripts }
  const json = JSON.stringify(manifest, null, indentationOf(text)) + (text.endsWith('\n') ? '\n' : '')

  writeFileSync(manifestPath, text.includes('\r\n') ? json.replaceAll('\n', '\r\n') : json)

  return changes
}
