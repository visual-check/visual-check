import { dirname, join } from 'node:path'
import { ConfigError } from '../config/config-error.js'
import { findConfig } from '../config/find-config.js'
import { loadConfig } from '../config/load-config.js'
import { defaultBaselinesIn, type ResolvedConfig, type ResolvedStorybook } from '../config/resolve-config.js'
import type { SetUpStorybook } from './closing-message.js'
import type { DetectedProject, DetectedStorybook } from './detect-project.js'
import { isInsideRoot, mainFileOnDiskIn, relativePathOf, takeUniqueName } from './find-storybooks.js'
import { commandLineOf, type PackageManager, runScriptCommandOf, storybookCommandOf } from './package-manager.js'
import { defaultStorybookPort } from './questions.js'
import { configEntryOf } from './setup-files.js'
import { defaultConfigDir } from './storybook-scripts.js'

/**
 * A Storybook of a config that was already there, which `init` sets up: its name, its absolute folders and its URL.
 */
interface ConfigStorybookPlace {
  /**
   * The Storybook's name.
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
   * The absolute path of the folder that holds the Storybook's baselines.
   */
  baselines: string
  /**
   * The URL the config gives the Storybook outside CI, or `undefined` when the config can't be loaded.
   */
  url: string | undefined
}

/**
 * A config that was already there, which `init` leaves alone.
 */
export interface ExistingConfig {
  /**
   * The absolute path of the config.
   */
  path: string
  /**
   * The name of each Storybook in the config, by config folder relative to the project root: `/` separated, with no
   * `./`, no trailing `/`, and `.` for the root. When the config can't be loaded, the detected Storybooks' default
   * names.
   */
  names: Record<string, string>
  /**
   * The Storybooks whose files `init` adds when they're missing: the config's that are in the project and have a main
   * file, or the detected ones when the config can't be loaded.
   */
  storybooks: ConfigStorybookPlace[]
  /**
   * The hints and the warning about the config, a line each.
   */
  notes: string[]
}

/**
 * Reads the config that's already there, if any. One that loads gives its Storybooks, a hint for each one `init`
 * leaves alone, and a hint for each detected Storybook it doesn't hold. One that can't be loaded gives a warning, and
 * the detected Storybooks stand in for its own.
 *
 * @throws Any error loading it throws besides a `ConfigError`.
 */
export async function existingConfigOf(cwd: string, project: DetectedProject): Promise<ExistingConfig | undefined> {
  const path = findConfig(project.root)

  if (path === undefined) {
    return undefined
  }

  let config: ResolvedConfig

  try {
    config = await loadConfig({ cwd, ci: false, path })
  } catch (error) {
    if (error instanceof ConfigError) {
      return unloadableConfigOf(cwd, project, path, error)
    }

    throw error
  }

  return loadedConfigOf(cwd, project, path, config)
}

/**
 * Describes a config that loaded: its names by config folder, the Storybooks `init` sets up, and the hints for the
 * ones it leaves alone and for each detected Storybook the config doesn't hold.
 */
function loadedConfigOf(cwd: string, project: DetectedProject, path: string, config: ResolvedConfig): ExistingConfig {
  const names = Object.fromEntries(
    config.storybooks.map(({ name, configDir }) => [relativePathOf(project.root, configDir), name]),
  )
  const storybooks: ConfigStorybookPlace[] = []
  const notes: string[] = []

  for (const { name, dir, configDir, baselines, url } of config.storybooks) {
    const leftAlone = leftAloneHintOf(cwd, project.root, path, { name, dir, configDir })

    if (leftAlone === undefined) {
      storybooks.push({ name, dir, configDir, baselines, url })
    } else {
      notes.push(leftAlone)
    }
  }

  return { path, names, storybooks, notes: [...notes, ...missingStorybookHintsOf(cwd, project, path, names)] }
}

/**
 * Words the hint for a Storybook of the config that `init` leaves alone, so it writes nothing for it: one whose folder
 * or config folder is outside the project, or whose config folder has no main file. Gives `undefined` for a Storybook
 * it sets up.
 */
function leftAloneHintOf(
  cwd: string,
  root: string,
  configPath: string,
  { name, dir, configDir }: Pick<ResolvedStorybook, 'name' | 'dir' | 'configDir'>,
): string | undefined {
  const listed = `hint: ${relativePathOf(cwd, configPath)} lists the Storybook ${name}`
  const outside = [dir, configDir].find((folder) => !isInsideRoot(relativePathOf(root, folder)))

  if (outside !== undefined) {
    return `${listed} in ${relativePathOf(cwd, outside)}, outside this project, so init left it alone.`
  }

  if (!mainFileOnDiskIn(root)(relativePathOf(root, configDir))) {
    return `${listed} in ${relativePathOf(cwd, configDir)}, which has no main file, so init left it alone.`
  }

  return undefined
}

/**
 * Words a hint for each detected Storybook the config doesn't hold, with the entry to add under `storybooks`. Each
 * entry's name is one no Storybook in the config, nor an earlier hint, has.
 */
function missingStorybookHintsOf(
  cwd: string,
  project: DetectedProject,
  configPath: string,
  names: Record<string, string>,
): string[] {
  const usedNames = new Set(Object.values(names))

  return project.storybooks
    .filter(({ configDir }) => !Object.hasOwn(names, configDir))
    .map((storybook) =>
      missingStorybookHintOf(cwd, configPath, storybook, takeUniqueName(storybook.defaultName, usedNames)),
    )
}

/**
 * Words the hint for a detected Storybook the config doesn't hold, with the entry to add under `storybooks`, named
 * `name`.
 */
function missingStorybookHintOf(cwd: string, configPath: string, storybook: DetectedStorybook, name: string): string {
  const entry = configEntryOf({
    name,
    url: `http://127.0.0.1:${storybook.startScript?.port ?? defaultStorybookPort}`,
    dir: relativePathOf(dirname(configPath), storybook.packageDir),
    configDir: storybook.configDir,
  })

  return (
    `hint: ${relativePathOf(cwd, configPath)} lists no Storybook in ${storybook.configDir}. ` +
    `To add it, put this under storybooks: ${entry}`
  )
}

/**
 * Describes a config that can't be loaded: a warning, and the detected Storybooks with their default names and
 * baselines folders in place of its own.
 */
function unloadableConfigOf(cwd: string, project: DetectedProject, path: string, error: ConfigError): ExistingConfig {
  return {
    path,
    names: Object.fromEntries(project.storybooks.map(({ configDir, defaultName }) => [configDir, defaultName])),
    storybooks: project.storybooks.map(({ defaultName, packageDir, configDir }) => ({
      name: defaultName,
      dir: packageDir,
      configDir: join(project.root, configDir),
      baselines: defaultBaselinesIn(packageDir),
      url: undefined,
    })),
    notes: [`Warning: visual-check init left ${relativePathOf(cwd, path)} alone: ${error.message}`],
  }
}

/**
 * Lists the Storybooks of a config that was already there that `init` sets up, named as the config names them, each
 * started the way detection found.
 */
export function existingStorybooksOf(
  project: DetectedProject,
  existing: ExistingConfig,
  packageManager: PackageManager,
): SetUpStorybook[] {
  return existing.storybooks.map(({ name, dir, configDir, baselines, url }) => ({
    name,
    dir,
    configDir,
    baselines,
    startCommand: detectedStartCommandOf(project, packageManager, relativePathOf(project.root, configDir), url),
  }))
}

/**
 * Returns the port Storybook starts on for a URL: the one the URL names, else the default, as with no URL.
 */
function startPortOf(url: string | undefined): string {
  const port = url === undefined ? '' : new URL(url).port

  return port === '' ? String(defaultStorybookPort) : port
}

/**
 * Returns the command that starts the Storybook of a config folder, relative to the root: its start script, else
 * `storybook dev` on its URL's port, with `-c` when the folder isn't `.storybook`.
 */
function detectedStartCommandOf(
  project: DetectedProject,
  packageManager: PackageManager,
  configDir: string,
  url: string | undefined,
): string {
  const startScript = project.storybooks.find((storybook) => storybook.configDir === configDir)?.startScript

  if (startScript !== undefined) {
    return runScriptCommandOf(packageManager, startScript.script)
  }

  const configArgs = configDir === defaultConfigDir ? [] : ['-c', configDir]

  return commandLineOf(storybookCommandOf(packageManager, ['dev', '-p', startPortOf(url), ...configArgs]))
}
