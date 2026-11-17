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
 * Returns whether `value` is the name of a package manager `init` knows.
 */
export function isPackageManager(value: unknown): value is PackageManager {
  return packageManagerNames.some((known) => known === value)
}

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
 * Reads the `devEngines.packageManager` field: an object with a `name`, or an array of them. Returns the first known
 * name.
 */
function fromDevEngines(devEngines: unknown): PackageManager | undefined {
  if (typeof devEngines !== 'object' || devEngines === null) {
    return undefined
  }

  const field = (devEngines as { packageManager?: unknown }).packageManager
  const entries: unknown[] = Array.isArray(field) ? field : [field]

  for (const entry of entries) {
    const name = typeof entry === 'object' && entry !== null ? (entry as { name?: unknown }).name : undefined
    const known = knownPackageManager(name)

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
 * The command that runs a `package.json` script, such as `pnpm run visual:test`. All four package managers take the
 * same form.
 */
export function runScriptCommandOf(packageManager: PackageManager, script: string): string {
  return `${packageManager} run ${script}`
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
 * Returns the command line as shown to the user: the program and its arguments joined with single spaces.
 */
export function commandLineOf({ command, args }: CommandLine): string {
  return [command, ...args].join(' ')
}
