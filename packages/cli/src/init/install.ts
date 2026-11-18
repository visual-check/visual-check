import type { AddonAnswer } from './addon-question.js'
import {
  addDevDependenciesCommandOf,
  type CommandLine,
  commandLineOf,
  listsDependency,
  type Manifest,
  type PackageManager,
  storybookCommandOf,
} from './package-manager.js'
import type { RunCommand } from './run-command.js'
import { runStep, type SetupProgress } from './setup-progress.js'
import { defaultConfigDir } from './storybook-scripts.js'

/**
 * A package that gets dependencies.
 */
export interface DependenciesToAdd {
  /**
   * The folder of the package.
   */
  dir: string
  /**
   * The specs to add, such as `@visual-check/cli@1.2.3`.
   */
  specs: string[]
}

/**
 * A Storybook's package: its folder and its manifest.
 */
interface StorybookPackage {
  /**
   * The folder of the package.
   */
  packageDir: string
  /**
   * The package's manifest.
   */
  manifest: Manifest
}

/**
 * What `dependenciesToAddOf` needs.
 */
interface DependenciesToAddInput {
  /**
   * The project root.
   */
  root: string
  /**
   * The manifest of the root package.
   */
  rootManifest: Manifest
  /**
   * The package of each Storybook.
   */
  storybooks: StorybookPackage[]
  /**
   * The version of the CLI that runs `init`.
   */
  cliVersion: string
  /**
   * The range of `@visual-check/chromium` the CLI works with.
   */
  browserRange: string
}

/**
 * Returns the specs of `wanted` the manifest doesn't list yet. Each is a name and a version or range.
 */
function missingSpecsOf(manifest: Manifest, wanted: readonly (readonly [string, string])[]): string[] {
  return wanted.filter(([name]) => !listsDependency(manifest, name)).map(([name, version]) => `${name}@${version}`)
}

/**
 * Works out the dependencies each package still needs: the CLI and the browser for the root, the Storybook package
 * for each Storybook. A package that already lists a name doesn't get it again. Packages in the same folder merge into
 * one entry, and a folder with nothing to add gets none. The root comes first.
 */
export function dependenciesToAddOf(input: DependenciesToAddInput): DependenciesToAdd[] {
  const { root, rootManifest, storybooks, cliVersion, browserRange } = input
  const found: DependenciesToAdd[] = [
    {
      dir: root,
      specs: missingSpecsOf(rootManifest, [
        ['@visual-check/cli', cliVersion],
        ['@visual-check/chromium', browserRange],
      ]),
    },
    ...storybooks.map(({ packageDir, manifest }) => ({
      dir: packageDir,
      specs: missingSpecsOf(manifest, [['@visual-check/storybook', cliVersion]]),
    })),
  ]
  const merged = new Map<string, string[]>()

  for (const { dir, specs } of found) {
    const specsSoFar = merged.get(dir) ?? []

    merged.set(dir, [...specsSoFar, ...specs.filter((spec) => !specsSoFar.includes(spec))])
  }

  return [...merged].filter(([, specs]) => specs.length > 0).map(([dir, specs]) => ({ dir, specs }))
}

/**
 * The title of a step that adds visual-check's packages. It's short, so it fits on one line, and the running step shows
 * the exact command under it.
 */
export const installTitle = "Install visual-check's packages"

/**
 * Returns the title of the step that adds the addon to a Storybook.
 */
export function addonTitleOf(name: string): string {
  return `Add the Storybook addon to ${name}`
}

/**
 * What `installDependencies` needs.
 */
interface InstallDependenciesInput {
  /**
   * The dependencies to add, one entry per folder.
   */
  installs: readonly DependenciesToAdd[]
  /**
   * The package manager of the project.
   */
  packageManager: PackageManager
  /**
   * Runs a command.
   */
  runCommand: RunCommand
  /**
   * Reports each step as it starts and ends.
   */
  progress: SetupProgress
}

/**
 * Runs the package manager's add command for each folder, in order. Stops at the first one that fails and returns the
 * problem, or returns `undefined` when all succeed.
 */
export async function installDependencies(input: InstallDependenciesInput): Promise<string | undefined> {
  const { installs, packageManager, runCommand, progress } = input

  for (const { dir, specs } of installs) {
    const commandLine = addDevDependenciesCommandOf(packageManager, specs)
    const shown = commandLineOf(commandLine)

    const exitCode = await runStep(
      progress,
      { title: installTitle, command: shown },
      () => runCommand(commandLine.command, commandLine.args, dir),
      (code) => (code === 0 ? 'done' : 'failed'),
    )

    if (exitCode !== 0) {
      return `${shown} failed with exit code ${exitCode}. Run it yourself, then run visual-check init again.`
    }
  }

  return undefined
}

/**
 * What `addAddons` needs.
 */
interface AddAddonsInput {
  /**
   * The Storybooks that get the addon.
   */
  addons: readonly AddonAnswer[]
  /**
   * The package manager of the project.
   */
  packageManager: PackageManager
  /**
   * The version of the CLI that runs `init`, which is the addon's version too.
   */
  cliVersion: string
  /**
   * The project root, where the command runs.
   */
  root: string
  /**
   * Runs a command.
   */
  runCommand: RunCommand
  /**
   * Reports each step as it starts and ends.
   */
  progress: SetupProgress
}

/**
 * Returns the command that adds the addon to a Storybook. The config folder is passed when it isn't `.storybook`.
 */
function addonCommandOf(packageManager: PackageManager, cliVersion: string, configDir: string): CommandLine {
  const configArgs = configDir === defaultConfigDir ? [] : ['-c', configDir]

  return storybookCommandOf(packageManager, [
    'add',
    `@visual-check/storybook-addon@${cliVersion}`,
    '--yes',
    ...configArgs,
  ])
}

/**
 * Adds the addon to each Storybook with `storybook add`. A command that fails or throws gives a warning, and the next
 * Storybook still runs. Returns the warnings.
 */
export async function addAddons(input: AddAddonsInput): Promise<string[]> {
  const { addons, packageManager, cliVersion, root, runCommand, progress } = input
  const warnings: string[] = []

  for (const { configDir, name } of addons) {
    const commandLine = addonCommandOf(packageManager, cliVersion, configDir)
    const shown = commandLineOf(commandLine)

    const exitCode = await runStep(
      progress,
      { title: addonTitleOf(name), command: shown },
      () => runCommand(commandLine.command, commandLine.args, root).catch(() => -1),
      (code) => (code === 0 ? 'done' : 'warned'),
    )

    if (exitCode !== 0) {
      warnings.push(`Warning: ${shown} failed, so ${name} has no addon. Run it yourself to add it.`)
    }
  }

  return warnings
}
