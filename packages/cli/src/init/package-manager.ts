/**
 * The package managers `init` sets a project up for.
 */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

/**
 * The `package.json` fields `init` reads. Each is `unknown`, because a manifest is user-written JSON: read it
 * defensively.
 */
export interface Manifest {
  /**
   * The package name.
   */
  name?: unknown
  /**
   * The `packageManager` field, such as `pnpm@9.12.3`.
   */
  packageManager?: unknown
  /**
   * The `devEngines` field, which may hold a `packageManager` entry.
   */
  devEngines?: unknown
  /**
   * The scripts, by name.
   */
  scripts?: unknown
  /**
   * The `workspaces` field: the globs of the workspace's packages, or an object holding them in `packages`.
   */
  workspaces?: unknown
  /**
   * The `dependencies`, by name.
   */
  dependencies?: unknown
  /**
   * The `devDependencies`, by name.
   */
  devDependencies?: unknown
  /**
   * The `optionalDependencies`, by name.
   */
  optionalDependencies?: unknown
  /**
   * The `peerDependencies`, by name.
   */
  peerDependencies?: unknown
}

/**
 * Returns whether `value` is a JSON object: not `null`, not an array, not a text or a number.
 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Returns `value` when it is text that isn't empty, else `undefined`. Reads a name from user-written JSON.
 */
export function nonEmptyTextOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * The manifest fields that list dependencies.
 */
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const

/**
 * Returns whether the manifest lists `name` in any of its dependency fields.
 */
export function listsDependency(manifest: Manifest, name: string): boolean {
  return dependencyFields.some((field) => {
    const listed = manifest[field]

    return isJsonObject(listed) && Object.hasOwn(listed, name)
  })
}

/**
 * Returns the manifest's scripts that are text, in key order. A script that isn't text is left out.
 */
export function scriptsOf(manifest: Manifest): Record<string, string> {
  if (!isJsonObject(manifest.scripts)) {
    return {}
  }

  const scripts: Record<string, string> = {}

  for (const [name, command] of Object.entries(manifest.scripts)) {
    if (typeof command === 'string') {
      scripts[name] = command
    }
  }

  return scripts
}

/**
 * The package managers a manifest field may name.
 */
const packageManagerNames: readonly PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun']

/**
 * The lockfiles that show a package manager, in the order `init` tries them.
 */
const lockfileOwners: readonly (readonly [string, PackageManager])[] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
]

/**
 * The names of the lockfiles `init` looks for in the project root.
 */
export const lockfileNames: readonly string[] = lockfileOwners.map(([name]) => name)

/**
 * Returns the package manager a name stands for, or `undefined` for a name `init` doesn't know.
 */
function knownPackageManager(name: unknown): PackageManager | undefined {
  return packageManagerNames.find((known) => known === name)
}

/**
 * Reads the `packageManager` field: the part of `pnpm@9.12.3` or `yarn@4.1.0+sha512...` before the first `@`.
 */
function fromPackageManagerField(value: unknown): PackageManager | undefined {
  return typeof value === 'string' ? knownPackageManager(value.split('@')[0]) : undefined
}

/**
 * Returns the entries of the `devEngines.packageManager` field, which holds one object or an array of them. Gives
 * `[]` when `devEngines` isn't an object.
 */
function devEnginesEntriesOf(devEngines: unknown): unknown[] {
  if (!isJsonObject(devEngines)) {
    return []
  }

  const field = devEngines.packageManager

  return Array.isArray(field) ? field : [field]
}

/**
 * Reads the `devEngines.packageManager` field: an object with a `name`, or an array of them. Returns the first known
 * name.
 */
function fromDevEngines(devEngines: unknown): PackageManager | undefined {
  for (const entry of devEnginesEntriesOf(devEngines)) {
    const known = knownPackageManager(isJsonObject(entry) ? entry.name : undefined)

    if (known !== undefined) {
      return known
    }
  }

  return undefined
}

/**
 * Returns the package manager of the first lockfile name in `lockfiles`, in the order `init` tries them.
 */
function fromLockfiles(lockfiles: readonly string[]): PackageManager | undefined {
  return lockfileOwners.find(([name]) => lockfiles.includes(name))?.[1]
}

/**
 * Finds the package manager of a project: the manifest's `packageManager`, then its `devEngines.packageManager`, then
 * the lockfiles found in the root. A name `init` doesn't know is skipped. Returns `undefined` when nothing shows one.
 */
export function packageManagerOf(manifest: Manifest, lockfiles: readonly string[]): PackageManager | undefined {
  return (
    fromPackageManagerField(manifest.packageManager) ?? fromDevEngines(manifest.devEngines) ?? fromLockfiles(lockfiles)
  )
}

/**
 * Returns the major version a version or range starts with, such as `4` for `4.1.0`, `^4.1.0` or `>=4`. Gives
 * `undefined` for one without a number, such as `*`, or a value that isn't text.
 */
function majorOf(version: unknown): number | undefined {
  const major = typeof version === 'string' ? /\d+/.exec(version)?.[0] : undefined

  return major === undefined ? undefined : Number(major)
}

/**
 * Returns the Yarn version the `packageManager` field declares, such as `4.1.0` for `yarn@4.1.0+sha512...`, or
 * `undefined` when it declares none or names another package manager.
 */
function yarnVersionOfField(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const [name, version] = value.split('@')

  return name === 'yarn' ? version : undefined
}

/**
 * Returns whether a project uses Yarn 2 or later, which `init` calls Yarn Berry: the root holds a `.yarnrc.yml`, or the
 * manifest's `packageManager` or `devEngines.packageManager` declares Yarn with a major version of 2 or more. It
 * doesn't say whether Yarn is the package manager: read it only when `packageManagerOf` gives `yarn`.
 */
export function yarnBerryOf(manifest: Manifest, hasYarnrcYml: boolean): boolean {
  const devEnginesVersions = devEnginesEntriesOf(manifest.devEngines).flatMap((entry) =>
    isJsonObject(entry) && entry.name === 'yarn' ? [entry.version] : [],
  )
  const versions = [yarnVersionOfField(manifest.packageManager), ...devEnginesVersions]

  return hasYarnrcYml || versions.some((version) => (majorOf(version) ?? 0) >= 2)
}

/**
 * The `rush.json` fields that name the package manager and its version, in the order `init` tries them.
 */
const rushVersionFields: readonly (readonly [string, PackageManager])[] = [
  ['pnpmVersion', 'pnpm'],
  ['npmVersion', 'npm'],
  ['yarnVersion', 'yarn'],
]

/**
 * Finds the package manager of a Rush workspace from its parsed `rush.json`: the first of `pnpmVersion`, `npmVersion`
 * and `yarnVersion` that is text. Returns `undefined` when none is, or `rush` isn't a JSON object.
 */
export function rushPackageManagerOf(rush: unknown): PackageManager | undefined {
  if (!isJsonObject(rush)) {
    return undefined
  }

  return rushVersionFields.find(([field]) => typeof rush[field] === 'string')?.[1]
}

/**
 * The command that runs a `package.json` script, such as `pnpm run visual:check`. All four package managers take the
 * same form.
 */
export function runScriptCommandOf(packageManager: PackageManager, script: string): string {
  return `${packageManager} run ${script}`
}

/**
 * Returns the command that runs a workspace package's script from the workspace root, through the package manager's
 * own workspace support. npm's `--workspace` takes the package's folder. pnpm's and Bun's `--filter` take its name,
 * else its folder as `./<dir>`. Yarn's `workspace` takes its name, so a package with none gives `undefined`.
 */
export function runPackageScriptCommandOf(
  packageManager: PackageManager,
  script: string,
  workspacePackage: {
    /**
     * The package's folder, relative to the workspace root.
     */
    dir: string
    /**
     * The name the package's `package.json` gives, or `undefined` for none.
     */
    name: string | undefined
  },
): string | undefined {
  const { dir, name } = workspacePackage
  const selector = name ?? `./${dir}`

  switch (packageManager) {
    case 'npm':
      return `npm run ${script} --workspace ${dir}`
    case 'pnpm':
      return `pnpm --filter ${selector} run ${script}`
    case 'yarn':
      return name === undefined ? undefined : `yarn workspace ${name} run ${script}`
    case 'bun':
      return `bun run --filter ${selector} ${script}`
  }
}

/**
 * A command to run: the program and its arguments.
 */
export interface CommandLine {
  /**
   * The program to run.
   */
  command: string
  /**
   * The arguments to pass it.
   */
  args: string[]
}

/**
 * The command that adds `specs`, such as `@visual-check/cli@1.2.3`, to `devDependencies`.
 */
export function addDevDependenciesCommandOf(packageManager: PackageManager, specs: readonly string[]): CommandLine {
  switch (packageManager) {
    case 'npm':
      return { command: 'npm', args: ['install', '--save-dev', ...specs] }
    case 'pnpm':
      return { command: 'pnpm', args: ['add', '--save-dev', ...specs] }
    case 'yarn':
      return { command: 'yarn', args: ['add', '--dev', ...specs] }
    case 'bun':
      return { command: 'bun', args: ['add', '--dev', ...specs] }
  }
}

/**
 * The command that runs a binary the project installed, such as `storybook`, with `args`.
 */
function binCommandOf(packageManager: PackageManager, bin: string, args: readonly string[]): CommandLine {
  switch (packageManager) {
    case 'pnpm':
      return { command: 'pnpm', args: ['exec', bin, ...args] }
    case 'npm':
      return { command: 'npx', args: [bin, ...args] }
    case 'yarn':
      return { command: 'yarn', args: [bin, ...args] }
    case 'bun':
      return { command: 'bunx', args: [bin, ...args] }
  }
}

/**
 * The command that runs the project's `storybook` binary with `args`, such as `['dev', '-p', '6006']`.
 */
export function storybookCommandOf(packageManager: PackageManager, args: readonly string[]): CommandLine {
  return binCommandOf(packageManager, 'storybook', args)
}

/**
 * The command that runs the project's `nx` binary with `args`, such as `['run', 'ui:storybook']`.
 */
export function nxCommandOf(packageManager: PackageManager, args: readonly string[]): CommandLine {
  return binCommandOf(packageManager, 'nx', args)
}

/**
 * Returns the command line as shown to the user: the program and its arguments joined with single spaces.
 */
export function commandLineOf({ command, args }: CommandLine): string {
  return [command, ...args].join(' ')
}
