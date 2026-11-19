import { join } from 'node:path'
import { type AddonAnswer, addonPackage } from './addon-question.js'
import { relativePathOf } from './find-storybooks.js'
import {
  addDevDependenciesCommandOf,
  type CommandLine,
  commandInFolderOf,
  commandLineOf,
  listsDependency,
  type Manifest,
  type PackageManager,
  storybookCommandOf,
} from './package-manager.js'
import type { RunCommand } from './run-command.js'
import { pinDependency } from './setup-files.js'
import { runStep, type SetupProgress } from './setup-progress.js'
import { defaultConfigDir } from './storybook-scripts.js'
import { type PackageManagerLists, packageManagerListOf } from './workspace.js'

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
  /**
   * Whether the package manager saves each at the exact version it resolves to, with no `^`: the packages that move in
   * lockstep with the CLI. The browser package keeps the CLI's range.
   */
  exact: boolean
}

/**
 * A Storybook's package: the folder of its `package.json`, and its manifest.
 */
interface StorybookPackage {
  /**
   * The folder of the package's `package.json`.
   */
  manifestDir: string
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
  storybooks: readonly StorybookPackage[]
  /**
   * The package of each Storybook that gets the addon.
   */
  addons: readonly StorybookPackage[]
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
 * Works out the dependencies each package still needs: the CLI for the root, the Storybook package for each Storybook,
 * and the addon for each that gets it, all exact, merged into one entry per folder; and the browser for the root at the
 * CLI's range, in an entry of its own right after the root's exact one. A package that already lists a name doesn't get
 * it again, and an entry with nothing to add is left out. The root comes first.
 */
export function dependenciesToAddOf(input: DependenciesToAddInput): DependenciesToAdd[] {
  const { root, rootManifest, storybooks, addons, cliVersion, browserRange } = input
  const found: Omit<DependenciesToAdd, 'exact'>[] = [
    { dir: root, specs: missingSpecsOf(rootManifest, [['@visual-check/cli', cliVersion]]) },
    ...storybooks.map(({ manifestDir, manifest }) => ({
      dir: manifestDir,
      specs: missingSpecsOf(manifest, [['@visual-check/storybook', cliVersion]]),
    })),
    ...addons.map(({ manifestDir, manifest }) => ({
      dir: manifestDir,
      specs: missingSpecsOf(manifest, [[addonPackage, cliVersion]]),
    })),
  ]
  const merged = new Map<string, string[]>()

  for (const { dir, specs } of found) {
    const specsSoFar = merged.get(dir) ?? []

    merged.set(dir, [...specsSoFar, ...specs.filter((spec) => !specsSoFar.includes(spec))])
  }

  const [rootAdd, ...packageAdds] = [...merged].map(([dir, specs]) => ({ dir, specs, exact: true }))
  const browserAdd = {
    dir: root,
    specs: missingSpecsOf(rootManifest, [['@visual-check/chromium', browserRange]]),
    exact: false,
  }

  return [rootAdd, browserAdd, ...packageAdds].filter(
    (add): add is DependenciesToAdd => add !== undefined && add.specs.length > 0,
  )
}

/**
 * A command to run, and the folder it runs in.
 */
export interface PlannedCommand {
  /**
   * The absolute folder the command runs in.
   */
  dir: string
  /**
   * The command.
   */
  commandLine: CommandLine
}

/**
 * An add command, with the title of the step that runs it.
 */
export interface InstallStep extends PlannedCommand {
  /**
   * The title of the step: what it installs, and where unless that's the root.
   */
  title: string
}

/**
 * The project an add command runs in.
 */
interface AddContext {
  /**
   * The package manager of the project.
   */
  packageManager: PackageManager
  /**
   * Whether Yarn is Yarn 2 or later.
   */
  yarnBerry: boolean
  /**
   * The absolute workspace root.
   */
  root: string
  /**
   * The lists of packages the root holds that a package manager reads itself.
   */
  packageManagerLists: PackageManagerLists
}

/**
 * What `installStepsOf` needs.
 */
interface InstallStepsInput extends AddContext {
  /**
   * The dependencies to add, in order.
   */
  installs: readonly DependenciesToAdd[]
}

/**
 * Returns the add command for an entry, and where it runs, with the exact flag for an exact entry. The root's runs at
 * the root, with `-w` for pnpm when the root holds `pnpm-workspace.yaml`, and `-W` for Yarn 1 when its `package.json`
 * has `workspaces`. A package's runs in its folder, but npm's runs at the root with `--workspace <folder>` when its
 * list names the package.
 */
function addCommandOf({ dir, specs, exact }: DependenciesToAdd, context: AddContext): PlannedCommand {
  const { packageManager, yarnBerry, root, packageManagerLists } = context
  const listed = packageManagerListOf(packageManagerLists, packageManager)

  if (dir === root) {
    const workspaceRoot = listed !== undefined

    return { dir, commandLine: addDevDependenciesCommandOf(packageManager, specs, { exact, workspaceRoot, yarnBerry }) }
  }

  const npmWorkspace = relativePathOf(root, dir)

  if (packageManager === 'npm' && listed?.includes(npmWorkspace)) {
    return { dir: root, commandLine: addDevDependenciesCommandOf(packageManager, specs, { exact, npmWorkspace }) }
  }

  return { dir, commandLine: addDevDependenciesCommandOf(packageManager, specs, { exact }) }
}

/**
 * The title of the step that adds visual-check's packages to the root. It's short, so it fits on one line, and the
 * running step shows the exact command under it.
 */
const installTitle = "Install visual-check's packages"

/**
 * The title of the step that adds the browser package to the root.
 */
const browserInstallTitle = 'Install the browser package'

/**
 * Returns the title of the step that adds an entry: the browser's, the root's, or the one that names the package's
 * folder, relative to the root.
 */
function installTitleOf({ dir, exact }: DependenciesToAdd, root: string): string {
  if (!exact) {
    return browserInstallTitle
  }

  return dir === root ? installTitle : `${installTitle} in ${relativePathOf(root, dir)}`
}

/**
 * Returns the step for each entry, in order: its add command as `addCommandOf` words it, where it runs, and its title.
 */
export function installStepsOf({ installs, ...context }: InstallStepsInput): InstallStep[] {
  return installs.map((install) => ({
    ...addCommandOf(install, context),
    title: installTitleOf(install, context.root),
  }))
}

/**
 * Returns the title of the step that adds the addon to a Storybook.
 */
export function addonTitleOf(name: string): string {
  return `Add the Storybook addon to ${name}`
}

/**
 * Returns where a command must run, for a message: ` in <folder>`, relative to `cwd`, or nothing for `cwd` itself.
 */
function inFolderTextOf(cwd: string, dir: string): string {
  return dir === cwd ? '' : ` in ${relativePathOf(cwd, dir)}`
}

/**
 * What `installDependencies` needs.
 */
interface InstallDependenciesInput {
  /**
   * The install steps, in order.
   */
  steps: readonly InstallStep[]
  /**
   * The folder `init` runs in. The problem names the folder relative to it.
   */
  cwd: string
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
 * Runs each add command in its folder, in order. Stops at the first one that fails and returns the problem, which names
 * the folder to run it in, or returns `undefined` when all succeed.
 */
export async function installDependencies(input: InstallDependenciesInput): Promise<string | undefined> {
  const { steps, cwd, runCommand, progress } = input

  for (const { title, dir, commandLine } of steps) {
    const shown = commandLineOf(commandLine)

    const exitCode = await runStep(
      progress,
      { title, command: shown },
      () => runCommand(commandLine.command, commandLine.args, dir),
      (code) => (code === 0 ? 'done' : 'failed'),
    )

    if (exitCode !== 0) {
      return (
        `${shown} failed with exit code ${exitCode}. ` +
        `Run it yourself${inFolderTextOf(cwd, dir)}, then run visual-check init again.`
      )
    }
  }

  return undefined
}

/**
 * The `storybook add` command for one Storybook: the Storybook's name, the command and the folder it runs in, and the
 * `package.json` whose addon spec it changes.
 */
export interface AddonStep extends PlannedCommand {
  /**
   * The name of the Storybook.
   */
  name: string
  /**
   * The absolute folder of the `package.json` the addon is in.
   */
  manifestDir: string
  /**
   * The exact version the addon was added at, which is the CLI's.
   */
  version: string
}

/**
 * What `addonStepsOf` needs.
 */
interface AddonStepsInput {
  /**
   * The Storybooks that get the addon.
   */
  addons: readonly AddonAnswer[]
  /**
   * The package manager of the project.
   */
  packageManager: PackageManager
  /**
   * Whether Yarn is Yarn 2 or later, which runs the `storybook` binary differently.
   */
  yarnBerry: boolean
  /**
   * The version of the CLI that runs `init`, which is the addon's version too.
   */
  cliVersion: string
  /**
   * The absolute workspace root, which the config folders are relative to.
   */
  root: string
}

/**
 * Returns the `storybook add` command for each Storybook that gets the addon. It runs in the Storybook's package
 * folder, with `-c` and the config folder relative to it when that isn't `.storybook`. `--skip-install` keeps
 * `storybook add` from installing the addon, which the add command installs at its exact version.
 */
export function addonStepsOf(input: AddonStepsInput): AddonStep[] {
  const { addons, packageManager, yarnBerry, cliVersion, root } = input

  return addons.map(({ configDir, name, packageDir, manifestDir }) => {
    const ownConfigDir = relativePathOf(packageDir, join(root, configDir))
    const configArgs = ownConfigDir === defaultConfigDir ? [] : ['-c', ownConfigDir]
    const commandLine = storybookCommandOf(
      packageManager,
      ['add', `${addonPackage}@${cliVersion}`, '--yes', '--skip-install', ...configArgs],
      yarnBerry,
    )

    return { name, dir: packageDir, commandLine, manifestDir, version: cliVersion }
  })
}

/**
 * What `addAddons` needs.
 */
interface AddAddonsInput {
  /**
   * The `storybook add` command of each Storybook that gets the addon.
   */
  steps: readonly AddonStep[]
  /**
   * The folder `init` runs in. The warnings name folders and files relative to it.
   */
  cwd: string
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
 * Runs one `storybook add`, then sets the addon's spec back to its exact version, since `storybook add` saves a `^`
 * range even with `--skip-install`. The lockfile still holds the exact version the add command installed, so they
 * agree again. Gives the warning when the command fails or throws, or the spec can't be set back, else `undefined`.
 * Each says where to run the command and which `package.json` to fix, relative to `cwd`.
 */
async function addAddon(step: AddonStep, cwd: string, runCommand: RunCommand): Promise<string | undefined> {
  const { name, dir, commandLine, manifestDir, version } = step
  const shown = commandLineOf(commandLine)
  const manifestPath = join(manifestDir, 'package.json')
  const pinText = `set ${addonPackage} back to "${version}" in ${relativePathOf(cwd, manifestPath)}`
  const exitCode = await runCommand(commandLine.command, commandLine.args, dir).catch(() => -1)

  if (exitCode !== 0) {
    return (
      `Warning: ${shown} failed, so ${name} has no addon. ` +
      `Run it yourself${inFolderTextOf(cwd, dir)} to add it, then ${pinText}.`
    )
  }

  try {
    pinDependency(manifestPath, addonPackage, version)

    return undefined
  } catch {
    return `Warning: storybook add saved ${addonPackage} at a range, and init couldn't ${pinText}. Set it yourself.`
  }
}

/**
 * Adds the addon to each Storybook with `storybook add`, and keeps its spec exact. A step that fails gives a warning,
 * and the next Storybook still runs. Returns the warnings.
 */
export async function addAddons(input: AddAddonsInput): Promise<string[]> {
  const { steps, cwd, runCommand, progress } = input
  const warnings: string[] = []

  for (const step of steps) {
    const warning = await runStep(
      progress,
      { title: addonTitleOf(step.name), command: commandLineOf(step.commandLine) },
      () => addAddon(step, cwd, runCommand),
      (found) => (found === undefined ? 'done' : 'warned'),
    )

    if (warning !== undefined) {
      warnings.push(warning)
    }
  }

  return warnings
}

/**
 * The install steps `init` prints for a person to run, under Rush, where it installs nothing itself.
 *
 * @public
 */
export interface ManualInstall {
  /**
   * The line before the commands.
   */
  heading: string
  /**
   * The commands, in order, each run from the workspace root.
   */
  commands: string[]
}

/**
 * What `rushInstallOf` needs.
 */
interface RushInstallInput extends AddContext {
  /**
   * The folder `init` runs in. Below the root, the heading says to run the commands from the root.
   */
  cwd: string
  /**
   * The dependencies to add, the root's exact ones and its browser first.
   */
  installs: readonly DependenciesToAdd[]
  /**
   * The `storybook add` command of each Storybook that gets the addon.
   */
  addonSteps: readonly AddonStep[]
}

/**
 * Returns a command line as a person copies it: each argument holding `^` in double quotes, which `cmd.exe` would
 * otherwise drop.
 */
function copyableCommandLineOf({ command, args }: CommandLine): string {
  return [command, ...args].map((arg) => (arg.includes('^') ? `"${arg}"` : arg)).join(' ')
}

/**
 * Returns the steps a person runs to install visual-check's packages under Rush:
 *
 * 1. `storybook add … --skip-install` in each Storybook's package, which lists the addon in `main.*` and at a `^`
 *    range in `package.json`, without installing it;
 * 2. the root's packages with Rush's package manager, as outside Rush, since `rush add` works only in a project's
 *    folder;
 * 3. `rush add --exact --skip-update` in each project's folder, which also sets the addon back to its exact version;
 * 4. one `rush update`, which installs them all.
 *
 * The commands run from the workspace root, which the heading names when `init` runs below it. Gives `undefined` when
 * there's nothing to add.
 */
export function rushInstallOf({ cwd, installs, addonSteps, ...context }: RushInstallInput): ManualInstall | undefined {
  const { root } = context

  if (installs.length === 0) {
    return undefined
  }

  const addonCommands = addonSteps.map(({ dir, commandLine }) =>
    commandInFolderOf(root, dir, copyableCommandLineOf(commandLine)),
  )
  const addCommands = installs.map((install) => {
    if (install.dir === root) {
      return copyableCommandLineOf(addCommandOf(install, context).commandLine)
    }

    const rushAdd = copyableCommandLineOf({
      command: 'rush',
      args: ['add', '--dev', '--exact', '--skip-update', ...install.specs.flatMap((spec) => ['-p', spec])],
    })

    return commandInFolderOf(root, install.dir, rushAdd)
  })

  const what =
    addonSteps.length === 0
      ? "Install visual-check's packages yourself"
      : "Add the Storybook addon and install visual-check's packages yourself"

  return {
    heading: cwd === root ? `${what}:` : `${what}, from ${relativePathOf(cwd, root)}:`,
    commands: [...addonCommands, ...addCommands, 'rush update'],
  }
}

/**
 * Returns the install steps as plain text: the heading, then each command on its own line, indented.
 */
export function manualInstallTextOf({ heading, commands }: ManualInstall): string {
  return [heading, ...commands.map((command) => `  ${command}`)].join('\n')
}
