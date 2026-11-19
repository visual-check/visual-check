import { relativePathOf } from './find-storybooks.js'

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
export const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const

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
 * Returns whether the start of a `yarn.lock` is in the format of Yarn 2 and later, which opens with a `__metadata:`
 * entry. Yarn 1's has none.
 */
export function isBerryLockfile(head: string): boolean {
  return /^__metadata:/m.test(head)
}

/**
 * Returns whether a project uses Yarn 2 or later, which `init` calls Yarn Berry: the root's files show it (a
 * `.yarnrc.yml`, or a `yarn.lock` in Yarn 2's format), or the manifest's `packageManager` or
 * `devEngines.packageManager` declares Yarn with a major version of 2 or more. It doesn't say whether Yarn is the
 * package manager: read it only when `packageManagerOf` gives `yarn`.
 */
export function yarnBerryOf(manifest: Manifest, filesShowBerry: boolean): boolean {
  const devEnginesVersions = devEnginesEntriesOf(manifest.devEngines).flatMap((entry) =>
    isJsonObject(entry) && entry.name === 'yarn' ? [entry.version] : [],
  )
  const versions = [yarnVersionOfField(manifest.packageManager), ...devEnginesVersions]

  return filesShowBerry || versions.some((version) => (majorOf(version) ?? 0) >= 2)
}

/**
 * Reads the top-level `nodeLinker` of a `.yarnrc.yml`, which says how Yarn 2 and later install: `pnp`,
 * `node-modules` or `pnpm`. Gives `undefined` when it sets none.
 */
export function nodeLinkerOf(yarnrc: string): string | undefined {
  return /^nodeLinker:[ \t]*["']?([\w-]+)/m.exec(yarnrc)?.[1]
}

/**
 * Returns whether Yarn installs with Plug'n'Play, which leaves no `node_modules` to read versions from. A `nodeLinker`
 * that is set decides. Else Plug'n'Play's loader file shows it, or under Yarn 2 and later, whose default it is, no
 * `node_modules` folder in the root.
 */
export function yarnPnpOf(clues: {
  /**
   * Whether the root holds Plug'n'Play's loader, `.pnp.cjs` or `.pnp.js`.
   */
  hasPnpFile: boolean
  /**
   * The `.yarnrc.yml`'s `nodeLinker`, or `undefined` when it sets none.
   */
  nodeLinker: string | undefined
  /**
   * Whether Yarn is Yarn 2 or later.
   */
  yarnBerry: boolean
  /**
   * Whether the root holds a `node_modules` folder.
   */
  hasNodeModules: boolean
}): boolean {
  const { hasPnpFile, nodeLinker, yarnBerry, hasNodeModules } = clues

  if (nodeLinker !== undefined) {
    return nodeLinker === 'pnp'
  }

  return hasPnpFile || (yarnBerry && !hasNodeModules)
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
 * How an add command adds dependencies, besides the folder it runs in.
 */
export interface AddOptions {
  /**
   * Whether it saves each at the exact version it resolves to, with no `^`: `--save-exact` for npm and pnpm, `--exact`
   * for Yarn and Bun. Only npm also pins a range, such as `^1.0.0`, to its newest version; the others keep the range.
   */
  exact: boolean
  /**
   * Whether it runs at the root of a workspace whose packages the package manager's own list names. pnpm then takes
   * `-w`, and Yarn 1 `-W`, to add to the root.
   */
  workspaceRoot?: boolean
  /**
   * Whether Yarn is Yarn 2 or later, which adds to a workspace root without a flag.
   */
  yarnBerry?: boolean
  /**
   * The package folder, relative to the root, that npm adds to from the root with `--workspace`.
   */
  npmWorkspace?: string
}

/**
 * The command that adds `specs`, such as `@visual-check/cli@1.2.3`, to `devDependencies`, with the flags `options`
 * call for.
 */
export function addDevDependenciesCommandOf(
  packageManager: PackageManager,
  specs: readonly string[],
  options: AddOptions,
): CommandLine {
  const { exact, workspaceRoot = false, yarnBerry = false, npmWorkspace } = options
  const flagIf = (condition: boolean, flag: string) => (condition ? [flag] : [])

  switch (packageManager) {
    case 'npm': {
      const workspaceArgs = npmWorkspace === undefined ? [] : ['--workspace', npmWorkspace]

      return {
        command: 'npm',
        args: ['install', '--save-dev', ...flagIf(exact, '--save-exact'), ...workspaceArgs, ...specs],
      }
    }

    case 'pnpm':
      return {
        command: 'pnpm',
        args: ['add', '--save-dev', ...flagIf(exact, '--save-exact'), ...flagIf(workspaceRoot, '-w'), ...specs],
      }
    case 'yarn':
      return {
        command: 'yarn',
        args: ['add', '--dev', ...flagIf(exact, '--exact'), ...flagIf(workspaceRoot && !yarnBerry, '-W'), ...specs],
      }
    case 'bun':
      return { command: 'bun', args: ['add', '--dev', ...flagIf(exact, '--exact'), ...specs] }
  }
}

/**
 * The command that runs a binary the project installed, such as `storybook`, with `args`. `yarn <bin>` would run a
 * script of that name instead, such as the usual `storybook` one, so Yarn 2 or later runs it with `yarn exec`, and Yarn
 * 1, which has no such command that passes every flag on, with `npx --no-install`.
 */
function binCommandOf(
  packageManager: PackageManager,
  bin: string,
  args: readonly string[],
  yarnBerry: boolean,
): CommandLine {
  switch (packageManager) {
    case 'pnpm':
      return { command: 'pnpm', args: ['exec', bin, ...args] }
    case 'npm':
      return { command: 'npx', args: [bin, ...args] }
    case 'yarn':
      return yarnBerry
        ? { command: 'yarn', args: ['exec', bin, ...args] }
        : { command: 'npx', args: ['--no-install', bin, ...args] }
    case 'bun':
      return { command: 'bunx', args: [bin, ...args] }
  }
}

/**
 * The command that runs the project's `storybook` binary with `args`, such as `['dev', '-p', '6006']`. `yarnBerry`
 * says whether Yarn is Yarn 2 or later.
 */
export function storybookCommandOf(
  packageManager: PackageManager,
  args: readonly string[],
  yarnBerry: boolean,
): CommandLine {
  return binCommandOf(packageManager, 'storybook', args, yarnBerry)
}

/**
 * The command that runs the project's `nx` binary with `args`, such as `['run', 'ui:storybook']`. `yarnBerry` says
 * whether Yarn is Yarn 2 or later.
 */
export function nxCommandOf(packageManager: PackageManager, args: readonly string[], yarnBerry: boolean): CommandLine {
  return binCommandOf(packageManager, 'nx', args, yarnBerry)
}

/**
 * Returns the command that runs `command` in `dir` from `from`: as it is when they're the same folder, else after going
 * into `dir`, relative to `from`, as in `cd packages/ui && pnpm run storybook`.
 */
export function commandInFolderOf(from: string, dir: string, command: string): string {
  return dir === from ? command : `cd ${relativePathOf(from, dir)} && ${command}`
}

/**
 * Returns the command line as shown to the user: the program and its arguments joined with single spaces.
 */
export function commandLineOf({ command, args }: CommandLine): string {
  return [command, ...args].join(' ')
}
