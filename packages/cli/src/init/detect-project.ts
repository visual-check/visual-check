import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isFile } from '../config/find-config.js'
import { readInstalledStorybookVersion } from '../storybook/storybook-version.js'
import { type ListFiles, mainFileOnDiskIn, nameConfigDirs, storybookConfigDirsOf } from './find-storybooks.js'
import { lockfileNames, type Manifest, type PackageManager, packageManagerOf } from './package-manager.js'
import { type StorybookCall, startScriptOf, storybookCallsOf } from './storybook-scripts.js'

/**
 * A Storybook `init` found.
 */
export interface DetectedStorybook {
  /**
   * The config folder, relative to the project root: `/` separated, with no `./` and no trailing `/`, such as
   * `.storybook` or `docs/.storybook`.
   */
  configDir: string
  /**
   * The absolute folder of the package the Storybook belongs to. In a single package, the project root.
   */
  packageDir: string
  /**
   * A valid Storybook name, unique within the project.
   */
  defaultName: string
  /**
   * The script call that starts the Storybook, or `undefined` when no script does.
   */
  startScript: StorybookCall | undefined
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
   * The absolute project root: the nearest folder holding a `package.json`.
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
   * What is wrong with the root's `package.json`: the parse error, or that it isn't a JSON object. `undefined` when it
   * is fine. `manifest` is `{}` otherwise.
   */
  manifestProblem: string | undefined
  /**
   * The package manager, or `undefined` when nothing shows one.
   */
  packageManager: PackageManager | undefined
  /**
   * The Deno file found in the root, or `undefined` for none.
   */
  denoFile: string | undefined
  /**
   * The Storybooks, `.storybook` first, then by path.
   */
  storybooks: DetectedStorybook[]
}

/**
 * The files whose presence in the root shows a Deno project, in the order they are tried.
 */
const denoFileNames = ['deno.json', 'deno.jsonc', 'deno.lock']

/**
 * Finds the project root: the nearest folder from `cwd` up that holds `package.json`. The search stops after the folder
 * that holds `.git` (a folder, or a file in a worktree or a submodule), or at the filesystem root. Returns `undefined`
 * when it finds none.
 */
function findRoot(cwd: string): string | undefined {
  if (isFile(join(cwd, 'package.json'))) {
    return cwd
  }

  const parent = dirname(cwd)

  if (parent === cwd || existsSync(join(cwd, '.git'))) {
    return undefined
  }

  return findRoot(parent)
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
 * Reads a `package.json`. A file that can't be read or parsed, or isn't a JSON object, gives an empty manifest and the
 * problem.
 */
function readManifest(path: string): ManifestRead {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { manifest: {}, problem: 'the file must hold a JSON object' }
    }

    return { manifest: parsed as Manifest, problem: undefined }
  } catch (error) {
    return { manifest: {}, problem: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Returns the manifest's scripts that are text, in key order.
 */
function scriptsOf(manifest: Manifest): Record<string, string> {
  if (typeof manifest.scripts !== 'object' || manifest.scripts === null) {
    return {}
  }

  return Object.fromEntries(Object.entries(manifest.scripts).filter(([, command]) => typeof command === 'string'))
}

/**
 * Finds the Storybooks of the root package, each with its start command, name and installed version.
 */
function storybooksOf(root: string, manifest: Manifest, files: readonly string[]): DetectedStorybook[] {
  const calls = storybookCallsOf(scriptsOf(manifest))
  const configDirs = storybookConfigDirsOf(files, calls, mainFileOnDiskIn(root))
  const version = readInstalledStorybookVersion(root)

  return nameConfigDirs(configDirs, manifest.name, root).map(({ configDir, name }) => ({
    configDir,
    packageDir: root,
    defaultName: name,
    startScript: startScriptOf(calls, configDir),
    version,
  }))
}

/**
 * Detects the project `init` sets up: the root, its package manager, a Deno file and its Storybooks. Every Storybook
 * belongs to the root package. Returns `undefined` when there's no `package.json` from `cwd` up to the repo root.
 */
export async function detectProject(cwd: string, listFiles: ListFiles): Promise<DetectedProject | undefined> {
  const root = findRoot(resolve(cwd))

  if (root === undefined) {
    return undefined
  }

  const manifestPath = join(root, 'package.json')
  const { manifest, problem } = readManifest(manifestPath)
  const lockfiles = lockfileNames.filter((name) => existsSync(join(root, name)))

  return {
    root,
    manifest,
    manifestPath,
    manifestProblem: problem,
    packageManager: packageManagerOf(manifest, lockfiles),
    denoFile: denoFileNames.find((name) => existsSync(join(root, name))),
    storybooks: storybooksOf(root, manifest, await listFiles(root)),
  }
}
