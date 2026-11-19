import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { readInstalledStorybookVersion } from '../storybook/storybook-version.js'
import {
  defaultNameOf,
  type ListFiles,
  mainFileOnDiskIn,
  relativePathOf,
  storybookConfigDirsOf,
  takeUniqueName,
} from './find-storybooks.js'
import {
  lockfileNames,
  type Manifest,
  nodeLinkerOf,
  nonEmptyTextOf,
  type PackageManager,
  packageManagerOf,
  yarnPnpOf,
} from './package-manager.js'
import { startScriptOf } from './storybook-scripts.js'
import { nxProjectNameOf, nxStartOf, nxStorybookPluginTargetOf, type StorybookStart } from './storybook-start.js'
import { findWorkspace, readJsonFile, readTextFile, type Workspace } from './workspace.js'
import {
  nestedWorkspaceOf,
  packageOf,
  packageRelativeOf,
  packagesOf,
  rootRelativeCallOf,
  type WorkspacePackage,
} from './workspace-packages.js'

/**
 * A Storybook `init` found.
 */
export interface DetectedStorybook {
  /**
   * The config folder, relative to the workspace root: `/` separated, with no `./` and no trailing `/`, such as
   * `.storybook` or `packages/ui/.storybook`.
   */
  configDir: string
  /**
   * The absolute folder of the package the Storybook belongs to, where it runs: the deepest package folder holding its
   * config folder, else the workspace root. An Nx project's folder may hold no `package.json`.
   */
  packageDir: string
  /**
   * The absolute folder of the `package.json` the Storybook's dependencies go in: the deepest package folder holding
   * its config folder that has one, else the workspace root. Mostly `packageDir`.
   */
  manifestDir: string
  /**
   * The parsed `package.json` in `manifestDir`, or `{}` when there's none or it can't be read.
   */
  manifest: Manifest
  /**
   * What is wrong with the `package.json` in `manifestDir`, as for the root's. `undefined` when it is fine or missing.
   */
  manifestProblem: string | undefined
  /**
   * The name the `package.json` in `packageDir` gives, or `undefined` when it holds none or it names none.
   */
  packageName: string | undefined
  /**
   * A valid Storybook name, unique within the workspace.
   */
  defaultName: string
  /**
   * How the Storybook starts, or `undefined` when no script and no Nx target does.
   */
  start: StorybookStart | undefined
  /**
   * The installed `storybook` version, or `undefined` when it isn't installed.
   */
  version: string | undefined
}

/**
 * What `init` found out about a project.
 */
export interface DetectedProject {
  /**
   * The absolute project root: the root of the workspace `init` runs in, where the config goes.
   */
  root: string
  /**
   * The root's parsed `package.json`.
   */
  manifest: Manifest
  /**
   * The absolute path of the root's `package.json`.
   */
  manifestPath: string
  /**
   * Whether the root holds a `package.json`. Only a workspace, such as Rush's, can lack one.
   */
  hasManifest: boolean
  /**
   * What is wrong with the root's `package.json`: the parse error, that it isn't a JSON object, or that its
   * `scripts` isn't one. `undefined` when it is fine or missing. `manifest` is `{}` otherwise.
   */
  manifestProblem: string | undefined
  /**
   * The package manager, or `undefined` when nothing shows one.
   */
  packageManager: PackageManager | undefined
  /**
   * Whether the root shows Yarn 2 or later. It means something only when the package manager is Yarn.
   */
  yarnBerry: boolean
  /**
   * Whether Yarn is the package manager and installs with Plug'n'Play, so no Storybook's version can be read.
   */
  yarnPnp: boolean
  /**
   * The Deno file found in the root, or `undefined` for none.
   */
  denoFile: string | undefined
  /**
   * What lists the workspace's packages, and the lists a package manager reads.
   */
  workspace: Pick<Workspace, 'kind' | 'packageManagerLists'>
  /**
   * The Storybooks, `.storybook` first, then by path.
   */
  storybooks: DetectedStorybook[]
  /**
   * The hints about what detection found, a line each, in order: that `init` works at a workspace root above the
   * folder it runs in, then each Storybook it skips.
   */
  notes: string[]
}

/**
 * The files whose presence in the root shows a Deno project, in the order they are tried.
 */
const denoFileNames = ['deno.json', 'deno.jsonc', 'deno.lock']

/**
 * Words the hint for a Storybook `init` skips, because `folder` holds a lockfile of its own.
 */
function nestedWorkspaceNoteOf(configDir: string, folder: string): string {
  return (
    `hint: init skips the Storybook in ${configDir}: ${folder} has its own lockfile, so it's a workspace of its own. ` +
    'Run visual-check init there to set it up.'
  )
}

/**
 * What finding a Storybook's start reads besides its package.
 */
interface StartContext {
  /**
   * The absolute workspace root.
   */
  root: string
  /**
   * The root's package, whose scripts may start a package's Storybook with `-c`.
   */
  rootPackage: WorkspacePackage
  /**
   * The target `@nx/storybook/plugin` infers, or `undefined` when `nx.json` doesn't use it.
   */
  inferredTarget: string | undefined
}

/**
 * Finds how the Storybook in `configDir`, relative to the root, starts. The first that does wins:
 *
 * 1. its package's `storybook` script, when it runs `storybook dev` on that folder;
 * 2. the first script of its package whose `storybook dev` names that folder;
 * 3. the same two among the root's scripts, whose `-c` is relative to the root;
 * 4. Nx's `storybook` target in the package's `project.json`, or the one `@nx/storybook/plugin` infers.
 */
function startOf(
  { root, rootPackage, inferredTarget }: StartContext,
  workspacePackage: WorkspacePackage,
  projectJson: unknown,
  configDir: string,
): StorybookStart | undefined {
  const packageDir = join(root, workspacePackage.dir)
  const ownCall = startScriptOf(workspacePackage.calls, packageRelativeOf(workspacePackage.dir, configDir))

  if (ownCall !== undefined) {
    return { kind: 'script', call: ownCall, packageDir, packageName: nonEmptyTextOf(workspacePackage.manifest.name) }
  }

  const rootCall = startScriptOf(rootPackage.calls, configDir)

  if (rootCall !== undefined) {
    return { kind: 'script', call: rootCall, packageDir: root, packageName: nonEmptyTextOf(rootPackage.manifest.name) }
  }

  return nxStartOf({
    projectJson,
    packageName: nonEmptyTextOf(workspacePackage.manifest.name),
    hasManifest: workspacePackage.hasManifest,
    folderName: basename(packageDir),
    packageDir: workspacePackage.dir,
    configDir,
    inferredTarget,
  })
}

/**
 * Finds the Storybooks of a workspace among its listed `files` and its packages' scripts, each matched to its package
 * with its start, name and installed version. A Storybook under a nested workspace is skipped with a note. Each
 * default name is the one its package gives it, made unique across the workspace in order. A package's name is its
 * `package.json`'s, or for an Nx project without one, its `project.json`'s.
 */
function storybooksOf(
  root: string,
  { rootPackage, packages }: ReturnType<typeof packagesOf>,
  files: readonly string[],
): { storybooks: DetectedStorybook[]; notes: string[] } {
  const packageDirs = packages.map(({ dir }) => dir)
  const calls = packages.flatMap(({ dir, calls: packageCalls }) =>
    packageCalls.map((call) => rootRelativeCallOf(dir, call)),
  )
  const context = { root, rootPackage, inferredTarget: nxStorybookPluginTargetOf(readJsonFile(join(root, 'nx.json'))) }
  const usedNames = new Set<string>()
  const storybooks: DetectedStorybook[] = []
  const notes: string[] = []

  for (const configDir of storybookConfigDirsOf(files, calls, mainFileOnDiskIn(root))) {
    const nested = nestedWorkspaceOf(root, configDir, packageDirs)

    if (nested !== undefined) {
      notes.push(nestedWorkspaceNoteOf(configDir, nested))
      continue
    }

    const workspacePackage = packageOf(packages, rootPackage, configDir)
    const manifestPackage = packageOf(packages, rootPackage, configDir, ({ hasManifest }) => hasManifest)
    const packageDir = join(root, workspacePackage.dir)
    const projectJson = readJsonFile(join(packageDir, 'project.json'))
    const packageName = nonEmptyTextOf(workspacePackage.manifest.name)
    const name = defaultNameOf({
      configDir: packageRelativeOf(workspacePackage.dir, configDir),
      packageName: workspacePackage.hasManifest ? packageName : nxProjectNameOf(projectJson),
      packageDir,
      rootPackage: workspacePackage.dir === '.',
    })

    storybooks.push({
      configDir,
      packageDir,
      manifestDir: join(root, manifestPackage.dir),
      manifest: manifestPackage.manifest,
      manifestProblem: manifestPackage.manifestProblem,
      packageName,
      defaultName: takeUniqueName(name, usedNames),
      start: startOf(context, workspacePackage, projectJson, configDir),
      version: readInstalledStorybookVersion(packageDir),
    })
  }

  return { storybooks, notes }
}

/**
 * Returns whether the project at `root` is on Yarn with Plug'n'Play, from its `.yarnrc.yml`, its loader file and its
 * `node_modules` folder.
 */
function yarnPnpIn(root: string, packageManager: PackageManager | undefined, yarnBerry: boolean): boolean {
  if (packageManager !== 'yarn') {
    return false
  }

  let nodeLinker: string | undefined

  try {
    nodeLinker = nodeLinkerOf(readTextFile(join(root, '.yarnrc.yml')))
  } catch {
    nodeLinker = undefined
  }

  return yarnPnpOf({
    hasPnpFile: ['.pnp.cjs', '.pnp.js'].some((name) => existsSync(join(root, name))),
    nodeLinker,
    yarnBerry,
    hasNodeModules: existsSync(join(root, 'node_modules')),
  })
}

/**
 * Words the hint that `init` works at a workspace root above `startDir`, the folder it runs in. A lone package gets
 * none: there, `init` has always worked at the nearest `package.json`.
 */
function workspaceRootNotesOf(startDir: string, workspace: Workspace): string[] {
  if (workspace.kind === 'single' || workspace.root === startDir) {
    return []
  }

  const root = relativePathOf(startDir, workspace.root)

  return [`hint: init sets up the workspace at ${root}, where the config goes and the next steps run.`]
}

/**
 * Detects the project `init` sets up: the workspace `cwd` is in, its package manager, whether Yarn uses Plug'n'Play, a
 * Deno file and its Storybooks, each matched to its package. Returns `undefined` when there's neither a workspace nor
 * a `package.json` from `cwd` up to the repo root.
 */
export async function detectProject(cwd: string, listFiles: ListFiles): Promise<DetectedProject | undefined> {
  const startDir = resolve(cwd)
  const workspace = await findWorkspace(startDir, listFiles)

  if (workspace === undefined) {
    return undefined
  }

  const { root, kind, packageDirs, packageManagerLists } = workspace
  const packages = packagesOf(root, packageDirs)
  const { manifest, hasManifest, manifestProblem } = packages.rootPackage
  const lockfiles = lockfileNames.filter((name) => existsSync(join(root, name)))
  const { storybooks, notes } = storybooksOf(root, packages, workspace.files)
  const packageManager = workspace.packageManager ?? packageManagerOf(manifest, lockfiles)

  return {
    root,
    manifest,
    manifestPath: join(root, 'package.json'),
    hasManifest,
    manifestProblem,
    packageManager,
    yarnBerry: workspace.yarnBerry,
    yarnPnp: yarnPnpIn(root, packageManager, workspace.yarnBerry),
    denoFile: denoFileNames.find((name) => existsSync(join(root, name))),
    workspace: { kind, packageManagerLists },
    storybooks,
    notes: [...workspaceRootNotesOf(startDir, workspace), ...notes],
  }
}
