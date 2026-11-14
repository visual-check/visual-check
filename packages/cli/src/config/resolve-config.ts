import { dirname, relative, resolve } from 'node:path'
import { ConfigError } from './config-error.js'
import type {
  AffectedSettings,
  ColorScheme,
  Config,
  LocalAndCi,
  Platform,
  StorybookSettings,
  Tolerance,
  Viewport,
} from './define-config.js'
import { isHttpUrl } from './is-http-url.js'

/**
 * One Storybook with every default filled in and every path made absolute.
 *
 * @public
 */
export interface ResolvedStorybook {
  /**
   * The name the config gives the Storybook.
   */
  name: string
  /**
   * The absolute folder Storybook runs in.
   */
  dir: string
  /**
   * The absolute path of Storybook's config folder.
   */
  configDir: string
  /**
   * The absolute path of the folder that holds the baselines.
   */
  baselines: string
  /**
   * Where the running Storybook is served, for the current environment.
   */
  url: string
}

/**
 * The config with every default filled in, every `{ local, ci }` pair picked for the current environment and every
 * path made absolute.
 *
 * @public
 */
export interface ResolvedConfig {
  /**
   * The absolute path of the config file.
   */
  path: string
  /**
   * The Storybooks the run covers, in config order: every one, or the one `--storybook` names.
   */
  storybooks: ResolvedStorybook[]
  /**
   * Where the browser runs.
   */
  platform: Platform
  /**
   * The Docker image the browser runs in. `undefined` when the config sets none: the browser package's image is filled
   * in when the run starts.
   */
  image: string | undefined
  /**
   * The project's default tolerance.
   */
  tolerance: Required<Tolerance>
  /**
   * The project's default viewport.
   */
  viewport: Required<Viewport>
  /**
   * The color that paints masked regions.
   */
  maskColor: string
  /**
   * The timezone the browser emulates.
   */
  timezone: string
  /**
   * The locale the browser emulates.
   */
  locale: string
  /**
   * The color scheme the browser emulates.
   */
  colorScheme: ColorScheme
  /**
   * The size of the worker pool. `'auto'` is sized from the machine when the run starts.
   */
  workers: 'auto' | number
  /**
   * How long to wait for a story to be ready, in milliseconds.
   */
  readyTimeout: number
  /**
   * How many more times a failing snapshot is captured before it fails.
   */
  retries: number
  /**
   * Hosts whose requests `update`'s warnings skip.
   */
  silenceHosts: string[]
  /**
   * The globs that select every story or none, as written: relative to the config file's folder.
   */
  affected: Required<AffectedSettings>
}

/**
 * What `resolveConfig` needs to know about the run.
 */
interface ResolveOptions {
  /**
   * The path of the config file, absolute or relative to `cwd`.
   */
  path: string
  /**
   * The folder the CLI runs in. Paths in messages are relative to it.
   */
  cwd: string
  /**
   * Whether the `CI` environment variable is set, which picks the `ci` side of every `{ local, ci }` pair.
   */
  ci: boolean
  /**
   * The Storybook `--storybook` names. The run covers only it, so only it needs a URL for the current environment.
   */
  storybook?: string
  /**
   * The URL `--url` gives. It replaces the URL of the one Storybook the run covers.
   */
  url?: string
}

/**
 * The value of every key the config leaves out.
 */
const configDefaults = {
  platform: 'linux/amd64',
  tolerance: { color: 0.01, pixels: 20 },
  viewport: { width: 1280, height: 720, deviceScaleFactor: 1, touch: false },
  maskColor: '#FF00FF',
  timezone: 'UTC',
  locale: 'en-US',
  colorScheme: 'light',
  workers: 'auto',
  readyTimeout: 10_000,
  retries: 1,
  silenceHosts: [],
  affected: { selectAll: [], ignore: [] },
} as const satisfies Omit<ResolvedConfig, 'path' | 'storybooks' | 'image'>

/**
 * The default folder of Storybook's config, relative to `dir`.
 */
const defaultConfigDir = '.storybook'

/**
 * The default folder of the baselines, relative to `dir`.
 */
const defaultBaselines = '.visual-check/baselines'

/**
 * A Storybook whose URL may be missing for the current environment.
 */
type PendingStorybook = Omit<ResolvedStorybook, 'url'> & { url: string | undefined }

/**
 * Picks the side of a value for the current environment. A plain value serves both sides. A missing side gives
 * `undefined`.
 */
function pickSide<T extends string | number>(value: T | LocalAndCi<T> | undefined, ci: boolean): T | undefined {
  if (typeof value === 'object') {
    return ci ? value.ci : value.local
  }

  return value
}

/**
 * Lists names as prose: `a`, `a and b`, `a, b and c`.
 */
function listNames(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '')
}

/**
 * Resolves one Storybook's paths and picks its URL, which is `undefined` when it has none for the current environment.
 */
function resolveStorybook(name: string, settings: StorybookSettings, options: ResolveOptions): PendingStorybook {
  const dir = resolve(dirname(options.path), settings.dir ?? '.')

  return {
    name,
    dir,
    configDir: resolve(dir, settings.configDir ?? defaultConfigDir),
    baselines: resolve(dir, settings.baselines ?? defaultBaselines),
    url: pickSide(settings.url, options.ci),
  }
}

/**
 * Whether a Storybook has a URL for the current environment.
 */
function hasUrl(storybook: PendingStorybook): storybook is ResolvedStorybook {
  return storybook.url !== undefined
}

/**
 * Returns one issue per Storybook with no URL for the current environment.
 */
function findMissingUrls(storybooks: PendingStorybook[], ci: boolean): string[] {
  return storybooks
    .filter((storybook) => !hasUrl(storybook))
    .map(
      ({ name }) =>
        `Storybook ${name} has no URL for ${ci ? 'CI' : 'local runs'}. Set storybooks.${name}.url.${ci ? 'ci' : 'local'}.`,
    )
}

/**
 * Returns one issue per baselines folder that more than one Storybook keeps its baselines in.
 */
function findSharedBaselines(storybooks: PendingStorybook[], cwd: string): string[] {
  const namesByFolder = new Map<string, string[]>()
  for (const storybook of storybooks) {
    namesByFolder.set(storybook.baselines, [...(namesByFolder.get(storybook.baselines) ?? []), storybook.name])
  }

  return [...namesByFolder]
    .filter(([, names]) => names.length > 1)
    .map(
      ([folder, names]) =>
        `Storybooks ${listNames(names)} ${names.length > 2 ? 'all' : 'both'} keep baselines in ` +
        `${relative(cwd, folder) || 'the current folder'}. Give each its own dir or baselines.`,
    )
}

/**
 * Checks the Storybook name and the URL the command line gives against the config's Storybooks.
 *
 * @throws {ConfigError} With a single message when the name isn't a Storybook in the config, when the URL isn't an
 * http(s) URL, and when a URL comes with several Storybooks and no name.
 */
function checkFlags(names: string[], options: ResolveOptions, displayPath: string): void {
  const { storybook, url } = options

  if (storybook !== undefined && !names.includes(storybook)) {
    const choices = names.length > 1 ? `Pick one of ${listNames(names)}.` : `The config has one: ${listNames(names)}.`

    throw new ConfigError(`--storybook ${storybook} isn't a Storybook in ${displayPath}. ${choices}`)
  }

  if (url !== undefined && !isHttpUrl(url)) {
    throw new ConfigError(`--url takes an http: or https: URL, such as 'http://127.0.0.1:6006'. Got '${url}'.`)
  }

  if (url !== undefined && storybook === undefined && names.length > 1) {
    throw new ConfigError(
      `--url sets one Storybook's URL, and ${displayPath} has several: ${listNames(names)}. Name the one with --storybook.`,
    )
  }
}

/**
 * Returns the Storybooks the run covers (every one, or the one `--storybook` names), with the URL `--url` gives in
 * place of theirs.
 */
function storybooksInRun(storybooks: PendingStorybook[], options: ResolveOptions): PendingStorybook[] {
  const inRun =
    options.storybook === undefined ? storybooks : storybooks.filter(({ name }) => name === options.storybook)

  return options.url === undefined ? inRun : inRun.map((storybook) => ({ ...storybook, url: options.url }))
}

/**
 * Fills in the defaults, picks the `{ local, ci }` side for the current environment and resolves the paths.
 *
 * `storybook` narrows the result to one Storybook before the URL check, and `url` replaces the URL of the one
 * Storybook the run covers before it. Shared baselines are checked across every Storybook in the config.
 *
 * @throws {ConfigError} For a `storybook` or `url` that can't be used, for a Storybook in the run with no URL for the
 * current environment, and for Storybooks that share a baselines folder.
 */
export function resolveConfig(config: Config, options: ResolveOptions): ResolvedConfig {
  const path = resolve(options.cwd, options.path)
  const displayPath = relative(options.cwd, path)

  checkFlags(Object.keys(config.storybooks), options, displayPath)

  const pending = Object.entries(config.storybooks).map(([name, settings]) =>
    resolveStorybook(name, settings, { ...options, path }),
  )
  const inRun = storybooksInRun(pending, options)
  const issues = [...findMissingUrls(inRun, options.ci), ...findSharedBaselines(pending, options.cwd)]

  if (issues.length > 0) {
    throw new ConfigError([`${displayPath} can't be used:`, ...issues.map((issue) => `  - ${issue}`)].join('\n'))
  }

  return {
    path,
    storybooks: inRun.filter(hasUrl),
    platform: config.platform ?? configDefaults.platform,
    image: config.image,
    tolerance: { ...configDefaults.tolerance, ...config.tolerance },
    viewport: { ...configDefaults.viewport, ...config.viewport },
    maskColor: config.maskColor ?? configDefaults.maskColor,
    timezone: config.timezone ?? configDefaults.timezone,
    locale: config.locale ?? configDefaults.locale,
    colorScheme: config.colorScheme ?? configDefaults.colorScheme,
    workers: pickSide(config.workers, options.ci) ?? configDefaults.workers,
    readyTimeout: pickSide(config.readyTimeout, options.ci) ?? configDefaults.readyTimeout,
    retries: config.retries ?? configDefaults.retries,
    silenceHosts: [...(config.silenceHosts ?? configDefaults.silenceHosts)],
    affected: {
      selectAll: [...(config.affected?.selectAll ?? configDefaults.affected.selectAll)],
      ignore: [...(config.affected?.ignore ?? configDefaults.affected.ignore)],
    },
  }
}
