import { join, posix } from 'node:path'
import { isFile } from '../config/find-config.js'
import { isAbsoluteFolder } from './find-storybooks.js'
import { isJsonObject, lockfileNames, type Manifest, scriptsOf } from './package-manager.js'
import { configDirOf, type StorybookCall, storybookCallsOf } from './storybook-scripts.js'
import { readTextFile } from './workspace.js'

/**
 * A package of the workspace, with what `init` reads of it.
 */
export interface WorkspacePackage {
  /**
   * The package folder, relative to the workspace root: `/` separated, `.` for the root.
   */
  dir: string
  /**
   * Whether the folder holds a `package.json`. An Nx project may have only a `project.json`.
   */
  hasManifest: boolean
  /**
   * The parsed `package.json`, or `{}` when there's none or it can't be read.
   */
  manifest: Manifest
  /**
   * What is wrong with the `package.json`: the parse error, that it isn't a JSON object, or that its `scripts` isn't
   * one. `undefined` when it is fine or missing.
   */
  manifestProblem: string | undefined
  /**
   * The `storybook dev` and `storybook build` calls of its scripts, each `-c` folder relative to the package.
   */
  calls: StorybookCall[]
}

/**
 * What reading a `package.json` gave.
 */
interface ManifestRead {
  /**
   * The parsed manifest, or `{}` when it can't be read or isn't a JSON object.
   */
  manifest: Manifest
  /**
   * What is wrong with the file, or `undefined` when it is fine.
   */
  problem: string | undefined
}

/**
 * Reads a `package.json`, without a leading byte order mark. A file that can't be read or parsed, isn't a JSON object
 * or has `scripts` that isn't one, gives an empty manifest and the problem.
 */
function readManifest(path: string): ManifestRead {
  try {
    const parsed: unknown = JSON.parse(readTextFile(path))

    if (!isJsonObject(parsed)) {
      return { manifest: {}, problem: 'the file must hold a JSON object' }
    }

    if (parsed.scripts !== undefined && !isJsonObject(parsed.scripts)) {
      return { manifest: {}, problem: '"scripts" must be an object' }
    }

    return { manifest: parsed as Manifest, problem: undefined }
  } catch (error) {
    return { manifest: {}, problem: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Reads the package in `dir`, relative to the workspace root: its `package.json`, when it has one, and its scripts'
 * Storybook calls.
 */
function readPackage(root: string, dir: string): WorkspacePackage {
  const path = join(root, dir, 'package.json')
  const hasManifest = isFile(path)
  const { manifest, problem } = hasManifest ? readManifest(path) : { manifest: {}, problem: undefined }

  return { dir, hasManifest, manifest, manifestProblem: problem, calls: storybookCallsOf(scriptsOf(manifest)) }
}

/**
 * Reads the packages of a workspace. Gives them all, the root first, and the root's on its own. The root is a package
 * even when it isn't one of `packageDirs`, so a Storybook outside every package has one.
 */
export function packagesOf(
  root: string,
  packageDirs: readonly string[],
): { rootPackage: WorkspacePackage; packages: WorkspacePackage[] } {
  const rootPackage = readPackage(root, '.')
  const others = packageDirs.filter((dir) => dir !== '.').map((dir) => readPackage(root, dir))

  return { rootPackage, packages: [rootPackage, ...others] }
}

/**
 * Whether a folder, relative to the workspace root, is `dir` or inside it.
 */
function isWithin(dir: string, folder: string): boolean {
  return dir === '.' || folder === dir || folder.startsWith(`${dir}/`)
}

/**
 * Returns the deepest of `packages` that holds a folder, relative to the workspace root, and that `accepts` takes.
 * Else gives `rootPackage`. The packages holding a folder nest, so each one deeper is inside the one before.
 */
export function packageOf(
  packages: readonly WorkspacePackage[],
  rootPackage: WorkspacePackage,
  folder: string,
  accepts: (workspacePackage: WorkspacePackage) => boolean = () => true,
): WorkspacePackage {
  const holding = packages.filter(
    (workspacePackage) => isWithin(workspacePackage.dir, folder) && accepts(workspacePackage),
  )

  return (
    holding.reduce<WorkspacePackage | undefined>(
      (deepest, workspacePackage) =>
        deepest === undefined || isWithin(deepest.dir, workspacePackage.dir) ? workspacePackage : deepest,
      undefined,
    ) ?? rootPackage
  )
}

/**
 * Returns a folder relative to the workspace root as it is relative to the package in `packageDir`: `.` for the
 * package itself.
 */
export function packageRelativeOf(packageDir: string, folder: string): string {
  return posix.relative(packageDir, folder) || '.'
}

/**
 * Returns a call of the package in `packageDir` with its config folder relative to the workspace root, so it names the
 * same folder from there. An absolute folder stays as it is.
 */
export function rootRelativeCallOf(packageDir: string, call: StorybookCall): StorybookCall {
  const configDir = configDirOf(call)

  return { ...call, configDir: isAbsoluteFolder(configDir) ? configDir : posix.join(packageDir, configDir) }
}

/**
 * Returns the outermost folder strictly below the root, at or above `configDir`, that holds a lockfile on disk and
 * isn't one of `packageDirs`, or `undefined` for none. Such a folder is a workspace of its own. A package of the
 * workspace may hold its own lockfile, as pnpm's `shared-workspace-lockfile=false` writes.
 */
export function nestedWorkspaceOf(root: string, configDir: string, packageDirs: readonly string[]): string | undefined {
  const parts = configDir.split('/')
  const folders = parts
    .map((_, index) => parts.slice(0, index + 1).join('/'))
    .filter((folder) => folder !== '.' && !packageDirs.includes(folder))

  return folders.find((folder) => lockfileNames.some((name) => isFile(join(root, folder, name))))
}
