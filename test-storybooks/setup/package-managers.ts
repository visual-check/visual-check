// The package managers the Setup check sets a project up with, and what differs between them: the `packageManager`
// field, the commands that install, run a package without installing it, run a script and run an installed binary,
// and the files that point the `@visual-check` scope at the local registry with a cache of the project's own. Yarn runs
// through Corepack's `yarn` shim, which picks the version the `packageManager` field names.
import { join } from 'node:path'

/**
 * The package managers the check knows, as `--package-manager` names them.
 */
export const packageManagerNames = ['npm', 'pnpm', 'yarn1', 'yarn4'] as const

/**
 * A package manager the check knows.
 */
export type PackageManagerName = (typeof packageManagerNames)[number]

/**
 * A command and its arguments.
 */
export interface CommandLine {
  /**
   * The program to run.
   */
  command: string
  /**
   * Its arguments.
   */
  args: string[]
}

/**
 * What the check writes into a project so a package manager sets it up.
 */
export interface ProjectFiles {
  /**
   * The files to write, by path relative to the project.
   */
  files: Record<string, string>
  /**
   * The fields to add to the root `package.json`.
   */
  manifestFields: Record<string, unknown>
}

/**
 * A package manager, and the commands the check runs with it.
 */
export interface PackageManager {
  /**
   * Its name, as `--package-manager` gives it.
   */
  name: PackageManagerName
  /**
   * The `packageManager` field the project declares, such as `pnpm@9.12.3`.
   */
  packageManagerField: string
  /**
   * Whether it runs through Corepack's `yarn` shim.
   */
  usesCorepackShim: boolean
  /**
   * Where it reads a workspace's packages from: `pnpm-workspace.yaml`, or the root `package.json`'s `workspaces`.
   */
  workspacesIn: 'pnpm-workspace.yaml' | 'package.json'
  /**
   * Installs a project that has no lockfile yet, writing one, under `CI` too.
   */
  install: CommandLine
  /**
   * Installs the project from its lockfile, which must not change.
   */
  frozenInstall: CommandLine
  /**
   * Runs a package's binary without installing it in the project, such as `pnpm dlx <spec> <args>`.
   */
  dlx: (spec: string, args: readonly string[]) => CommandLine
  /**
   * Runs one of the project's scripts, passing `args` on to it.
   */
  runScript: (script: string, args?: readonly string[]) => CommandLine
  /**
   * The line a workspace package's script runs a binary the root installed with, as `init` writes it: Yarn 4 puts only
   * the package's own binaries on the script's `PATH`, so it runs the root's through `yarn run -T`.
   */
  rootBinScript: (bin: string, args: readonly string[]) => string
  /**
   * Runs a binary the project installed, with `args`, as `init` itself does.
   */
  execBin: (bin: string, args: readonly string[]) => CommandLine
  /**
   * The files that name the registry for the `@visual-check` scope, with a store and cache in `folder`, so nothing
   * from an earlier run is reused.
   */
  registryFiles: (registryUrl: string, folder: string) => Record<string, string>
}

/**
 * Runs a binary through `npx`, as npm and Yarn 1 do: only the project's own one, never one npx would download.
 */
function npxNoInstall(bin: string, args: readonly string[]): CommandLine {
  return { command: 'npx', args: ['--no-install', bin, ...args] }
}

/**
 * Runs a package's binary through `npx -y`, as npm and Yarn 1, which has no `dlx`, do. `npx` reads the project's
 * `.npmrc`, so it finds the registry.
 */
function npxDlx(spec: string, args: readonly string[]): CommandLine {
  return { command: 'npx', args: ['-y', spec, ...args] }
}

/**
 * Gives a binary and its arguments as one line, as a script runs it.
 */
function binLineOf(bin: string, args: readonly string[]): string {
  return [bin, ...args].join(' ')
}

/**
 * Runs a script with `args` the way pnpm and Yarn do: after the script's name.
 */
function runScriptWith(command: string): (script: string, args?: readonly string[]) => CommandLine {
  return (script, args = []) => ({ command, args: ['run', script, ...args] })
}

/**
 * The line of an `.npmrc` that names the registry for the `@visual-check` scope.
 */
function scopeRegistryLine(registryUrl: string): string {
  return `@visual-check:registry=${registryUrl}/`
}

/**
 * The text of a file made of lines, each ending in a newline.
 */
function linesOf(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join('')
}

/**
 * Every package manager the check knows, by name.
 */
export const packageManagers: Record<PackageManagerName, PackageManager> = {
  npm: {
    name: 'npm',
    // The npm Node 24 ships in CI. Nothing enforces it: npm runs as installed.
    packageManagerField: 'npm@11.19.1',
    usesCorepackShim: false,
    workspacesIn: 'package.json',
    install: { command: 'npm', args: ['install'] },
    frozenInstall: { command: 'npm', args: ['ci'] },
    dlx: npxDlx,
    // npm takes the flags after the script's name as its own, so they go after `--`.
    runScript: (script, args = []) => ({
      command: 'npm',
      args: ['run', script, ...(args.length === 0 ? [] : ['--', ...args])],
    }),
    rootBinScript: binLineOf,
    execBin: npxNoInstall,
    registryFiles: (registryUrl, folder) => ({
      '.npmrc': linesOf([scopeRegistryLine(registryUrl), `cache=${join(folder, 'cache')}`]),
    }),
  },
  pnpm: {
    name: 'pnpm',
    packageManagerField: 'pnpm@9.12.3',
    usesCorepackShim: false,
    workspacesIn: 'pnpm-workspace.yaml',
    // Under CI, pnpm takes --frozen-lockfile by default, and the project has no lockfile yet.
    install: { command: 'pnpm', args: ['install', '--no-frozen-lockfile'] },
    frozenInstall: { command: 'pnpm', args: ['install', '--frozen-lockfile'] },
    dlx: (spec, args) => ({ command: 'pnpm', args: ['dlx', spec, ...args] }),
    runScript: runScriptWith('pnpm'),
    rootBinScript: binLineOf,
    execBin: (bin, args) => ({ command: 'pnpm', args: ['exec', bin, ...args] }),
    registryFiles: (registryUrl, folder) => ({
      '.npmrc': linesOf([
        scopeRegistryLine(registryUrl),
        `store-dir=${join(folder, 'store')}`,
        `cache-dir=${join(folder, 'cache')}`,
      ]),
    }),
  },
  yarn1: {
    name: 'yarn1',
    packageManagerField: 'yarn@1.22.22',
    usesCorepackShim: true,
    workspacesIn: 'package.json',
    install: { command: 'yarn', args: ['install'] },
    frozenInstall: { command: 'yarn', args: ['install', '--frozen-lockfile'] },
    dlx: npxDlx,
    runScript: runScriptWith('yarn'),
    rootBinScript: binLineOf,
    execBin: npxNoInstall,
    // Yarn 1 reads the scope's registry from `.npmrc`, and its cache folder from `.yarnrc`. `npx` reads `cache`.
    registryFiles: (registryUrl, folder) => ({
      '.npmrc': linesOf([scopeRegistryLine(registryUrl), `cache=${join(folder, 'cache')}`]),
      '.yarnrc': linesOf([`cache-folder "${join(folder, 'yarn-cache')}"`]),
    }),
  },
  yarn4: {
    name: 'yarn4',
    packageManagerField: 'yarn@4.18.1',
    usesCorepackShim: true,
    workspacesIn: 'package.json',
    // Under CI, Yarn 4 takes --immutable by default, and the project has no lockfile yet.
    install: { command: 'yarn', args: ['install', '--no-immutable'] },
    frozenInstall: { command: 'yarn', args: ['install', '--immutable'] },
    dlx: (spec, args) => ({ command: 'yarn', args: ['dlx', spec, ...args] }),
    runScript: runScriptWith('yarn'),
    rootBinScript: (bin, args) => `yarn run -T ${binLineOf(bin, args)}`,
    execBin: (bin, args) => ({ command: 'yarn', args: ['exec', bin, ...args] }),
    // Yarn 4 reads no `.npmrc`. It refuses a registry over plain HTTP unless its host is whitelisted, and a version
    // published less than a day ago unless the package is preapproved: the packed ones are new on every run. It keeps
    // registry metadata in its global folder by host, without the port, so that folder is the project's own too.
    registryFiles: (registryUrl, folder) => ({
      '.yarnrc.yml': linesOf([
        'nodeLinker: node-modules',
        'enableGlobalCache: false',
        `globalFolder: ${JSON.stringify(join(folder, 'yarn-global'))}`,
        `cacheFolder: ${JSON.stringify(join(folder, 'yarn-cache'))}`,
        'enableTelemetry: false',
        `unsafeHttpWhitelist: [${JSON.stringify(new URL(registryUrl).hostname)}]`,
        'npmPreapprovedPackages: ["@visual-check/*"]',
        'npmScopes:',
        '  visual-check:',
        `    npmRegistryServer: ${JSON.stringify(registryUrl)}`,
      ]),
    }),
  },
}

/**
 * Gives what the check writes into a project for a package manager: the registry's files, the `packageManager` field,
 * and for a workspace its packages' patterns, where the package manager reads them.
 */
export function projectFilesOf(
  packageManager: PackageManager,
  { registryUrl, folder, workspaces }: { registryUrl: string; folder: string; workspaces: string[] | undefined },
): ProjectFiles {
  const files = packageManager.registryFiles(registryUrl, folder)
  const manifestFields: Record<string, unknown> = { packageManager: packageManager.packageManagerField }

  if (workspaces !== undefined && packageManager.workspacesIn === 'pnpm-workspace.yaml') {
    files['pnpm-workspace.yaml'] = linesOf(['packages:', ...workspaces.map((pattern) => `  - '${pattern}'`)])
  } else if (workspaces !== undefined) {
    manifestFields.workspaces = workspaces
  }

  return { files, manifestFields }
}

/**
 * Gives a command line as one text, its command and arguments joined with spaces.
 */
export function commandLineOf({ command, args }: CommandLine): string {
  return [command, ...args].join(' ')
}
