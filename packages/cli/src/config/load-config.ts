import { readFileSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import { createJiti, type JitiOptions } from 'jiti'
import { ConfigError } from './config-error.js'
import { configFileNames, findConfig, isFile } from './find-config.js'
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
}

/**
 * How jiti reads the config file, following the spec: always through jiti, never Node's own type stripping, and
 * tsconfig `paths` aren't resolved. Each option is set here, so its `JITI_*` environment variable can't change it.
 */
const jitiOptions: JitiOptions = {
  // Never hand a file to Node's own loader first, nor a package by name.
  tryNative: false,
  nativeModules: [],
  // Read every file afresh on every load, so a config edited in a long-lived process loads as it is now.
  moduleCache: false,
  fsCache: false,
  // Keep each module as it is: a config with no default export has no `default`, and the config's own imports behave
  // closer to real ESM.
  interopDefault: false,
  // tsconfig `paths` aren't supported, and neither is any other alias.
  tsconfigPaths: false,
  alias: {},
}

/**
 * A path as messages show it: relative to `cwd`, or `the current folder` when it is `cwd`.
 */
function displayPathOf(path: string, cwd: string): string {
  return relative(cwd, path) || 'the current folder'
}

/**
 * Returns the absolute path of the nearest config the search finds from `cwd`.
 *
 * @throws {ConfigError} When the search finds none. The message points to `visual-check init`.
 */
function searchConfig(cwd: string): string {
  const path = findConfig(cwd)

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

  if (!configFileNames.some((name) => extname(name) === extname(path))) {
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
 * Runs the config file through jiti and returns its default export, or `undefined` when it has none. The default
 * export is awaited here, so a promise that rejects fails the load like any other error.
 */
async function evaluateDefault(path: string): Promise<unknown> {
  // `jiti.import` would hand an `.mjs` config, or a `.js` one in a `"type": "module"` package, to Node's own
  // `import()`, which keeps the first version of a file for the life of the process. `forceTranspile` runs the config
  // file through jiti instead. The files it imports that Node treats as ESM (`.mjs`, and `.js` in a `"type": "module"`
  // package) still load through Node's own loader: the cost of jiti's async mode, which top-level await needs.
  const namespace: unknown = await createJiti(path, jitiOptions).evalModule(readFileSync(path, 'utf8'), {
    filename: path,
    async: true,
    forceTranspile: true,
  })

  return typeof namespace === 'object' && namespace !== null && 'default' in namespace
    ? await namespace.default
    : undefined
}

/**
 * Returns the config file's default export, or `undefined` when it has none.
 *
 * @throws {ConfigError} When the file can't be read or run: a syntax error, a failing import, a throw at its top level
 * or a default export that rejects. The message shows the config's path as `displayPath`, and the original error is
 * the `cause`.
 */
async function importDefault(path: string, displayPath: string): Promise<unknown> {
  try {
    return await evaluateDefault(path)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new ConfigError(`Couldn't load ${displayPath}: ${message.replaceAll(path, displayPath)}`, { cause: error })
  }
}

/**
 * Finds the config, or takes the one `--config` gives, then loads, validates and resolves it. The config file runs
 * through jiti, never through Node's own type stripping, and tsconfig `paths` aren't resolved, whatever the `JITI_*`
 * environment variables say.
 *
 * @throws {ConfigError} When no config is found, when `--config` gives a path that isn't a config file, when the
 * config can't be loaded, and when it's invalid or can't be used.
 *
 * @public
 */
export async function loadConfig(options: LoadConfigOptions): Promise<ResolvedConfig> {
  const path = options.path === undefined ? searchConfig(options.cwd) : checkGivenPath(options.path, options.cwd)
  const displayPath = displayPathOf(path, options.cwd)
  const config = validateConfig(await importDefault(path, displayPath), displayPath)

  return resolveConfig(config, { path, cwd: options.cwd, ci: options.ci })
}
