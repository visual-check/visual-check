import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { addonImageFolders } from './addon-image-folders.js'
import { ConfigError } from './config-error.js'
import type { Config, StorybookSettings } from './define-config.js'
import { displayPathOf, namingConfig, searchConfig } from './load-config.js'
import { readConfigAfresh } from './read-config-afresh.js'
import {
  configDirOf,
  listNames,
  type ResolvedConfig,
  type ResolvedStorybook,
  resolveConfig,
  urlSideOf,
} from './resolve-config.js'

/**
 * What `loadStorybookConfig` needs to know about the running Storybook.
 *
 * @public
 */
export interface StorybookConfigOptions {
  /**
   * The absolute path of Storybook's config folder. The search starts there.
   */
  configDir: string
  /**
   * Where Storybook is served. It replaces the URL the config gives.
   */
  url: string
  /**
   * The absolute folder Storybook runs in. Paths in messages are relative to it.
   */
  cwd: string
  /**
   * Whether the `CI` environment variable is set, which picks the `ci` side of every `{ local, ci }` pair.
   */
  ci: boolean
  /**
   * Stops loading the config, even one that never ends.
   */
  signal?: AbortSignal
}

/**
 * The config of a running Storybook.
 *
 * @public
 */
export interface StorybookConfig {
  /**
   * The config, resolved for that Storybook alone.
   */
  config: ResolvedConfig
  /**
   * The Storybook, with the address it's served at as its URL.
   */
  storybook: ResolvedStorybook
  /**
   * The URL the config gives the Storybook for the current environment, or `undefined` when it gives none.
   */
  configUrl: string | undefined
}

/**
 * Returns the real path of a folder, in the letter case it has on disk. The part of it that can't be read stays as it
 * is.
 */
function realPathOf(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    const parent = dirname(path)

    return parent === path ? path : join(realPathOf(parent), basename(path))
  }
}

/**
 * Whether a path is the folder's or lies under it.
 */
function isWithin(path: string, folder: string): boolean {
  const fromFolder = relative(folder, path)

  return fromFolder !== '..' && !fromFolder.startsWith(`..${sep}`) && !isAbsolute(fromFolder)
}

/**
 * Checks that a Storybook's baselines aren't where the addon writes its images, which it also removes.
 *
 * @throws {ConfigError} When they are.
 */
function checkBaselinesFolder({ name, dir, baselines }: ResolvedStorybook, cwd: string): void {
  const realBaselines = realPathOf(baselines)
  const folder = addonImageFolders
    .map((imageFolder) => join(dir, '.visual-check', imageFolder))
    .find((path) => isWithin(realBaselines, realPathOf(path)))

  if (folder === undefined) {
    return
  }

  const inside = baselines === folder ? '' : `inside ${displayPathOf(folder, cwd)}, `

  throw new ConfigError(
    `storybooks.${name}.baselines is ${displayPathOf(baselines, cwd)}, ${inside}` +
      'where the Storybook addon writes its own images. Set another folder.',
  )
}

/**
 * Returns the name and the settings of the first Storybook in the config at `path` whose config folder is the running
 * Storybook's.
 *
 * @throws {ConfigError} When there is none. The message lists the config's Storybooks.
 */
function findStorybook(
  config: Config,
  path: string,
  { configDir, cwd }: Pick<StorybookConfigOptions, 'configDir' | 'cwd'>,
): [name: string, settings: StorybookSettings] {
  const storybooks = Object.entries(config.storybooks)
  const realConfigDir = realPathOf(configDir)
  const found = storybooks.find(([, settings]) => realPathOf(configDirOf(settings, path)) === realConfigDir)

  if (found === undefined) {
    const listed = storybooks.map(([name, settings]) => `${name} (${displayPathOf(configDirOf(settings, path), cwd)})`)

    throw new ConfigError(
      `${displayPathOf(path, cwd)} lists no Storybook whose config folder is ${displayPathOf(configDir, cwd)}. ` +
        `It lists ${listNames(listed)}.`,
    )
  }

  return found
}

/**
 * Finds the config from a running Storybook's config folder, loads it and all it imports as they are now, and resolves
 * it for that Storybook alone, at the address it's served at.
 *
 * @throws {ConfigError} When no config is found, when the config can't be loaded, when it's invalid or can't be used,
 * when it lists no Storybook with that config folder, and when that Storybook's baselines are where the addon writes its
 * images. Once the config is found, the error names its path as `configPath`.
 * @throws {unknown} The signal's reason, when it aborts first.
 *
 * @public
 */
export async function loadStorybookConfig(options: StorybookConfigOptions): Promise<StorybookConfig> {
  const { configDir, url, cwd, ci } = options
  const path = searchConfig(configDir)

  return await namingConfig(path, async () => {
    const config = await readConfigAfresh(path, cwd, options.signal)
    const [name, settings] = findStorybook(config, path, options)
    const resolved = resolveConfig(config, { path, cwd, ci, storybook: name, url })
    // `resolveConfig` gives the one Storybook it's narrowed to.
    const [storybook] = resolved.storybooks as [ResolvedStorybook]

    checkBaselinesFolder(storybook, cwd)

    return { config: resolved, storybook, configUrl: urlSideOf(settings, ci) }
  })
}

/**
 * Finds the config from a Storybook's config folder, loads it and all it imports as they are now, and gives the name of
 * the first Storybook it lists with that config folder. A static build has no address, so it needs no URL.
 *
 * @throws {ConfigError} When no config is found, when the config can't be loaded or is invalid, and when it lists no
 * Storybook with that config folder. Once the config is found, the error names its path as `configPath`.
 * @throws {unknown} The signal's reason, when it aborts first.
 *
 * @public
 */
export async function storybookNameOf(
  options: Pick<StorybookConfigOptions, 'configDir' | 'cwd' | 'signal'>,
): Promise<string> {
  const path = searchConfig(options.configDir)

  return await namingConfig(path, async () => {
    const config = await readConfigAfresh(path, options.cwd, options.signal)
    const [name] = findStorybook(config, path, options)

    return name
  })
}
