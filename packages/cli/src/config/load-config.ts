import { relative, resolve } from 'node:path'
import { ConfigError } from './config-error.js'
import type { Config } from './define-config.js'
import { evaluateDefault } from './evaluate-config.js'
import { findConfig, hasConfigExtension, isFile } from './find-config.js'
import { type ResolvedConfig, resolveConfig } from './resolve-config.js'
import { validateConfig } from './validate-config.js'

/**
 * What `loadConfig` needs to know about the run.
 *
 * @public
 */
export interface LoadConfigOptions {
  /**
   * The absolute folder the CLI runs in. The search starts there, and paths in messages are relative to it.
   */
  cwd: string
  /**
   * Whether the `CI` environment variable is set, which picks the `ci` side of every `{ local, ci }` pair.
   */
  ci: boolean
  /**
   * The path given to `--config`, absolute or relative to `cwd`. It replaces the search.
   */
  path?: string
  /**
   * The Storybook `--storybook` names. The run covers only it, so only it needs a URL for the current environment.
   */
  storybook?: string
  /**
   * The URL `--url` gives. It replaces the URL of the one Storybook the run covers. It must be an http(s) URL with no
   * login, which the command line reader has checked.
   */
  url?: string
}

/**
 * A path as messages show it: relative to `cwd`, or `the current folder` when it is `cwd`.
 */
export function displayPathOf(path: string, cwd: string): string {
  return relative(cwd, path) || 'the current folder'
}

/**
 * Returns the absolute path of the nearest config the search finds from `startDirectory`, an absolute folder.
 *
 * @throws {ConfigError} When the search finds none. The message points to `visual-check init`.
 */
export function searchConfig(startDirectory: string): string {
  const path = findConfig(startDirectory)

  if (path === undefined) {
    throw new ConfigError(
      'No visual-check.config.ts (or .mts, .js, .mjs) found in the current folder or its parents. ' +
        'Run visual-check init to create one.',
    )
  }

  return path
}

/**
 * Returns the absolute path of the config `--config` gives, absolute or relative to `cwd`.
 *
 * @throws {ConfigError} When the path doesn't end in a config file's extension, or no file is there.
 */
function checkGivenPath(givenPath: string, cwd: string): string {
  const path = resolve(cwd, givenPath)
  const displayPath = displayPathOf(path, cwd)

  if (!hasConfigExtension(path)) {
    throw new ConfigError(
      `Can't use ${displayPath} as a config: a config is a .ts, .mts, .js or .mjs file, and JSON and YAML aren't ` +
        'supported. Write visual-check.config.ts and pass its path to --config.',
    )
  }

  if (!isFile(path)) {
    throw new ConfigError(`No config at ${displayPath}. Check the path given to --config.`)
  }

  return path
}

/**
 * Gives the error for a config that couldn't be loaded because of `error`, its `cause`. The message shows the config's
 * path as `displayPath`.
 */
export function loadErrorOf(error: unknown, path: string, displayPath: string): ConfigError {
  const message = error instanceof Error ? error.message : String(error)

  return new ConfigError(`Couldn't load ${displayPath}: ${message.replaceAll(path, displayPath)}`, { cause: error })
}

/**
 * Loads the config file at `path`, an absolute path, and validates it.
 *
 * @throws {ConfigError} When the file can't be read or run (a syntax error, a failing import, a throw at its top level
 * or a default export that rejects), with the original error as the `cause`, and when the config is invalid. The
 * message shows the config's path relative to `cwd`.
 */
export async function readConfig(path: string, cwd: string): Promise<Config> {
  const displayPath = displayPathOf(path, cwd)
  const value = await evaluateDefault(path).catch((error: unknown) => {
    throw loadErrorOf(error, path, displayPath)
  })

  return validateConfig(value, displayPath)
}

/**
 * Runs `load`, which uses the config at `path`, and names that path as the `configPath` of a `ConfigError` it fails
 * with.
 */
export async function namingConfig<T>(path: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load()
  } catch (error) {
    if (error instanceof ConfigError) {
      throw new ConfigError(error.message, { cause: error.cause, configPath: path })
    }

    throw error
  }
}

/**
 * Finds the config, or takes the one `--config` gives, then loads, validates and resolves it. The config file runs
 * through jiti, never through Node's own type stripping, and tsconfig `paths` aren't resolved, whatever the `JITI_*`
 * environment variables say.
 *
 * @throws {ConfigError} When no config is found, when `--config` gives a path that isn't a config file, when the
 * config can't be loaded, when it's invalid or can't be used, and when `storybook` or `url` can't be used. Once the
 * config is found, the error names its path as `configPath`.
 *
 * @public
 */
export async function loadConfig(options: LoadConfigOptions): Promise<ResolvedConfig> {
  const path = options.path === undefined ? searchConfig(options.cwd) : checkGivenPath(options.path, options.cwd)

  return await namingConfig(path, async () => resolveConfig(await readConfig(path, options.cwd), { ...options, path }))
}
