import { type ChildProcessByStdio, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'

/**
 * Where a Storybook whose stories globs are read sits.
 */
interface StorybookLocation {
  /**
   * The folder the Storybook runs in, an absolute path.
   */
  dir: string
  /**
   * The Storybook's config folder, an absolute path.
   */
  configDir: string
}

/**
 * How `readStoriesMatchers` reads a Storybook's stories globs.
 */
interface StoriesMatchersOptions {
  /**
   * The longest the reading may take, in milliseconds. 30 s when not given.
   */
  timeoutMs?: number
}

/**
 * The longest the reading may take by default, in milliseconds.
 */
const defaultTimeoutMs = 30_000

/**
 * How much of the end of the child's output is kept, in characters: far more than the result line needs.
 */
const keptOutputLength = 1_000_000

/**
 * The module the child process runs: it loads the Storybook's `main.*` with the Storybook's own
 * `storybook/internal/common`, and prints each normalized stories specifier's import path matcher, as its source and
 * flags, on the last line. Storybook 9 calls the cache option `noCache` and later versions `skipCache`, so it passes
 * both. Storybook 9's build is CommonJS, which Node gives as `.default` only when imported. It exits once the result is
 * written, since a `main.*` may leave a timer, watcher or socket open that would keep it running.
 */
const loaderScript = [
  "import { pathToFileURL } from 'node:url'",
  'const { commonPath, configDir, workingDir } = JSON.parse(process.argv[1])',
  'const imported = await import(pathToFileURL(commonPath).href)',
  "const common = typeof imported.loadMainConfig === 'function' ? imported : imported.default",
  'const main = await common.loadMainConfig({ configDir, cwd: workingDir, noCache: true, skipCache: true })',
  "if (!Array.isArray(main.stories)) throw new Error('stories is not a list')",
  'const specifiers = common.normalizeStories(main.stories, { configDir, workingDir })',
  'const pairs = specifiers.map(({ importPathMatcher }) => [importPathMatcher.source, importPathMatcher.flags])',
  "process.stdout.write('\\n' + JSON.stringify(pairs) + '\\n', () => process.exit(0))",
].join('\n')

/**
 * Resolves `storybook/internal/common` from the Storybook's folder, only from a `node_modules/storybook` in the folder
 * or one of its parents, never from the folders `NODE_PATH` names, which a package manager's scripts may set to a
 * store that holds another Storybook. Throws when none resolves.
 */
function resolveStorybookCommon(dir: string): string {
  let folder = dir

  while (!existsSync(join(folder, 'node_modules', 'storybook', 'package.json'))) {
    const parent = dirname(folder)

    if (parent === folder) {
      throw new Error('No storybook package resolves from the Storybook.')
    }

    folder = parent
  }

  // The nearest `node_modules/storybook` comes before any `NODE_PATH` folder in the lookup.
  return createRequire(join(dir, 'package.json')).resolve('storybook/internal/common')
}

/**
 * Builds the matchers from the last non-empty line of the child's output, which must be a JSON list of
 * `[source, flags]` string pairs. The `g` and `y` flags are dropped, so `test` keeps no state between calls. Gives
 * `undefined` for anything else, or for a source that isn't a valid regular expression.
 */
function matchersOf(output: string): RegExp[] | undefined {
  const line = output
    .split('\n')
    .map((outputLine) => outputLine.trim())
    .findLast((outputLine) => outputLine !== '')

  if (line === undefined) {
    return undefined
  }

  try {
    const pairs: unknown = JSON.parse(line)

    if (!Array.isArray(pairs) || !pairs.every(isSourceAndFlags)) {
      return undefined
    }

    return pairs.map(([source, flags]) => new RegExp(source, flags.replace(/[gy]/g, '')))
  } catch {
    return undefined
  }
}

/**
 * Tells whether a value is a `[source, flags]` pair of strings.
 */
function isSourceAndFlags(value: unknown): value is [string, string] {
  return Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'string')
}

/**
 * Reads, without starting it, the regular expressions a Storybook matches its stories files' import paths with, from
 * the `stories` globs in its `main.*`. Each matches an import path relative to the Storybook's folder, starting `./` or
 * `../`. It loads `main.*` with the Storybook's own `storybook/internal/common`, resolved from its folder, in a child
 * process: Storybook 9 leaves a global `.ts` require hook behind, and each Storybook's version stays apart from the
 * others' and from visual-check's.
 *
 * Gives `undefined`, and never rejects, when no `storybook` package resolves from the folder or its parents, `main.*`
 * is missing or throws, `stories` isn't a list (a function's entries depend on presets, which it doesn't load), the
 * child can't start, exits other than with 0, doesn't finish within the time limit, or prints no list of valid
 * matchers last.
 *
 * @public
 */
export async function readStoriesMatchers(
  storybook: StorybookLocation,
  options: StoriesMatchersOptions = {},
): Promise<RegExp[] | undefined> {
  const { timeoutMs = defaultTimeoutMs } = options
  let commonPath: string

  try {
    commonPath = resolveStorybookCommon(storybook.dir)
  } catch {
    return undefined
  }

  return await new Promise((resolve) => {
    const input = JSON.stringify({ commonPath, configDir: storybook.configDir, workingDir: storybook.dir })
    let child: ChildProcessByStdio<null, Readable, null>

    try {
      child = spawn(process.execPath, ['--input-type=module', '-e', loaderScript, input], {
        cwd: storybook.dir,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      })
    } catch {
      resolve(undefined)

      return
    }

    let output = ''
    let settled = false

    /**
     * Gives the result once, and stops waiting for the timeout.
     */
    const settle = (result: RegExp[] | undefined) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    /**
     * Gives `undefined`, and stops the child and its output.
     */
    const stop = () => {
      settle(undefined)
      child.kill('SIGKILL')
      child.stdout.destroy()
    }

    const timer = setTimeout(stop, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output = (output + chunk).slice(-keptOutputLength)
    })
    // A stream error shows up as the child's failure or exit too, so the listener only keeps it from throwing.
    child.stdout.on('error', () => undefined)
    child.on('error', stop)
    child.on('close', (code) => {
      settle(code === 0 ? matchersOf(output) : undefined)
    })
  })
}
