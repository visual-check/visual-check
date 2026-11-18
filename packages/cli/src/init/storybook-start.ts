import { posix } from 'node:path'
import { relativePathOf } from './find-storybooks.js'
import {
  commandLineOf,
  isJsonObject,
  nonEmptyTextOf,
  nxCommandOf,
  type PackageManager,
  runPackageScriptCommandOf,
  runScriptCommandOf,
} from './package-manager.js'
import { defaultConfigDir, type StorybookCall, tidyFolder } from './storybook-scripts.js'
import { packageManagerListOf, type Workspace } from './workspace.js'

/**
 * How a Storybook starts: a `storybook dev` call in a script, or an Nx target of the project its package is.
 */
export type StorybookStart =
  | {
      /**
       * A script starts it: one of its package's, or of the root package.
       */
      kind: 'script'
      /**
       * The `storybook dev` call that starts it.
       */
      call: StorybookCall
      /**
       * The absolute folder of the `package.json` that holds the script: the Storybook's package's, or the root's.
       */
      packageDir: string
      /**
       * The name that `package.json` gives, or `undefined` when it names none.
       */
      packageName: string | undefined
    }
  | {
      /**
       * An Nx target starts it: the `storybook` target of its `project.json`, or the one `@nx/storybook/plugin` infers.
       */
      kind: 'nx'
      /**
       * The Nx project the target belongs to.
       */
      project: string
      /**
       * The name of the target.
       */
      target: string
      /**
       * The port the target's `port` option sets, or `undefined` when it sets none, it isn't a port, or the target is
       * inferred.
       */
      port: number | undefined
    }

/**
 * Returns a whole number from 1 to 65535. Anything else gives `undefined`.
 */
function portOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535 ? value : undefined
}

/**
 * What `nxStartOf` reads of a package to find how Nx starts one of its Storybooks.
 */
export interface NxStartInput {
  /**
   * The package's parsed `project.json`, or `undefined` when it has none or it can't be read.
   */
  projectJson: unknown
  /**
   * The name its `package.json` gives, or `undefined` for none.
   */
  packageName: string | undefined
  /**
   * Whether the package holds a `package.json`.
   */
  hasManifest: boolean
  /**
   * The name of the package's folder.
   */
  folderName: string
  /**
   * The package's folder, relative to the workspace root.
   */
  packageDir: string
  /**
   * The Storybook's config folder, relative to the workspace root.
   */
  configDir: string
  /**
   * The name of the target `@nx/storybook/plugin` infers to serve a project's `.storybook`, or `undefined` when
   * `nx.json` doesn't use the plugin.
   */
  inferredTarget: string | undefined
}

/**
 * The plugin that infers Nx targets for each project with a `.storybook` folder.
 */
const nxStorybookPlugin = '@nx/storybook/plugin'

/**
 * Reads, from a parsed `nx.json`, the name of the target `@nx/storybook/plugin` infers to serve a Storybook: its
 * `serveStorybookTargetName` option, else `storybook`. The plugin is listed by name, or as `{ plugin, options }`.
 * Gives `undefined` when `nx.json` doesn't list it.
 */
export function nxStorybookPluginTargetOf(nxJson: unknown): string | undefined {
  const plugins = isJsonObject(nxJson) && Array.isArray(nxJson.plugins) ? nxJson.plugins : []
  const entry = plugins.find(
    (plugin) => plugin === nxStorybookPlugin || (isJsonObject(plugin) && plugin.plugin === nxStorybookPlugin),
  )

  if (entry === undefined) {
    return undefined
  }

  const options = isJsonObject(entry) && isJsonObject(entry.options) ? entry.options : {}

  return nonEmptyTextOf(options.serveStorybookTargetName) ?? 'storybook'
}

/**
 * Returns the `name` of a parsed `project.json`, or `undefined` when it names none.
 */
export function nxProjectNameOf(projectJson: unknown): string | undefined {
  return isJsonObject(projectJson) ? nonEmptyTextOf(projectJson.name) : undefined
}

/**
 * Finds how Nx starts the Storybook in a package's config folder. Nx's project is `project.json`'s `name`, else the
 * `package.json`'s, else the folder's name.
 *
 * - The `storybook` target in `project.json` starts the config folder its `configDir` option names, relative to the
 *   workspace root as Nx reads it, else the package's `.storybook`. Its port is its `port` option.
 * - Else, with `@nx/storybook/plugin` in `nx.json`, the target it infers starts the `.storybook` of a package that
 *   holds a `project.json` or a `package.json`. It sets no port.
 *
 * Gives `undefined` when neither starts it.
 */
export function nxStartOf(input: NxStartInput): StorybookStart | undefined {
  const { projectJson, packageName, hasManifest, folderName, packageDir, configDir, inferredTarget } = input
  const project = nxProjectNameOf(projectJson) ?? packageName ?? folderName
  const targets = isJsonObject(projectJson) ? projectJson.targets : undefined
  const target = isJsonObject(targets) ? targets.storybook : undefined
  const ownConfigDir = posix.join(packageDir, defaultConfigDir)

  if (isJsonObject(target)) {
    const options = isJsonObject(target.options) ? target.options : {}
    const served = typeof options.configDir === 'string' ? tidyFolder(options.configDir) : ownConfigDir

    if (served === configDir) {
      return { kind: 'nx', project, target: 'storybook', port: portOf(options.port) }
    }
  }

  const isProject = isJsonObject(projectJson) || hasManifest

  return inferredTarget !== undefined && isProject && configDir === ownConfigDir
    ? { kind: 'nx', project, target: inferredTarget, port: undefined }
    : undefined
}

/**
 * Returns the port a Storybook's start sets: its script call's, or its Nx target's. `undefined` when it sets none, or
 * there's no start.
 */
export function portOfStart(start: StorybookStart | undefined): number | undefined {
  return start?.kind === 'script' ? start.call.port : start?.port
}

/**
 * The workspace a start command runs in: its root, and the packages the package manager runs scripts of itself.
 */
export interface StartWorkspace {
  /**
   * The absolute workspace root, where the command runs.
   */
  root: string
  /**
   * The package folders, relative to the root, that the package manager's own list names: `pnpm-workspace.yaml` for
   * pnpm, `package.json#workspaces` for npm, Yarn and Bun. It can run their scripts from the root.
   */
  listedPackageDirs: readonly string[]
  /**
   * Whether Yarn is Yarn 2 or later, which runs a binary differently.
   */
  yarnBerry: boolean
}

/**
 * Returns the workspace a project's start commands run in, under `packageManager`: its root, and the packages that
 * package manager's own list names. A package only Nx, Lerna or Rush finds isn't one of them.
 */
export function startWorkspaceOf(
  project: {
    /**
     * The absolute workspace root.
     */
    root: string
    /**
     * Whether the root shows Yarn 2 or later.
     */
    yarnBerry: boolean
    /**
     * The workspace, with the lists of packages its root holds that a package manager reads.
     */
    workspace: Pick<Workspace, 'packageManagerLists'>
  },
  packageManager: PackageManager,
): StartWorkspace {
  return {
    root: project.root,
    listedPackageDirs: packageManagerListOf(project.workspace.packageManagerLists, packageManager) ?? [],
    yarnBerry: project.yarnBerry,
  }
}

/**
 * Returns the command that runs a Storybook's start script from the workspace root. A root script runs as is. Another
 * package's runs through the package manager's workspace support, when its own list names the package and it can pick
 * the package. Else the command goes into the package's folder first.
 */
function scriptStartCommandOf(
  start: Extract<StorybookStart, { kind: 'script' }>,
  packageManager: PackageManager,
  { root, listedPackageDirs }: StartWorkspace,
): string {
  const { call, packageDir, packageName } = start

  if (packageDir === root) {
    return runScriptCommandOf(packageManager, call.script)
  }

  const dir = relativePathOf(root, packageDir)
  const throughWorkspace = listedPackageDirs.includes(dir)
    ? runPackageScriptCommandOf(packageManager, call.script, { dir, name: packageName })
    : undefined

  return throughWorkspace ?? `cd ${dir} && ${runScriptCommandOf(packageManager, call.script)}`
}

/**
 * Returns the command that starts a Storybook from the workspace root, as shown to the user: the package manager
 * running its script, or `nx run <project>:<target>` through the package manager's runner.
 */
export function startCommandOf(
  start: StorybookStart,
  packageManager: PackageManager,
  workspace: StartWorkspace,
): string {
  if (start.kind === 'script') {
    return scriptStartCommandOf(start, packageManager, workspace)
  }

  return commandLineOf(nxCommandOf(packageManager, ['run', `${start.project}:${start.target}`], workspace.yarnBerry))
}
