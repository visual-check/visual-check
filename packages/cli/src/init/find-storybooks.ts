import { execFile } from 'node:child_process'
import { basename, join, posix, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { isFile } from '../config/find-config.js'
import { configDirOf, defaultConfigDir, type StorybookCall } from './storybook-scripts.js'

/**
 * Lists the files of a project: the paths, relative to the root and `/` separated, that git tracks or would track.
 *
 * @public
 */
export type ListFiles = (root: string) => Promise<string[]>

/**
 * `execFile` that returns a promise.
 */
const execFileAsync = promisify(execFile)

/**
 * The most output a `git ls-files` may write, in bytes. A big repo lists a few hundred thousand paths.
 */
const maxListBytes = 256 * 1024 * 1024

/**
 * The extensions a Storybook main file takes.
 */
const mainFileExtensions = ['ts', 'js', 'mjs', 'cjs', 'mts', 'cts']

/**
 * A path that is the main file of a config folder: `.storybook/main.<extension>`, in the root or deeper.
 */
const mainFilePath = new RegExp(`(?:^|/)\\.storybook/main\\.(?:${mainFileExtensions.join('|')})$`)

/**
 * Returns a check for whether a config folder, relative to `root`, holds a `main.<extension>` file on disk.
 */
export function mainFileOnDiskIn(root: string): (configDir: string) => boolean {
  return (configDir) => mainFileExtensions.some((extension) => isFile(join(root, configDir, `main.${extension}`)))
}

/**
 * Lists the files git tracks or would track in `root`: tracked files and untracked ones that `.gitignore` doesn't
 * exclude. That skips ignored worktrees and copies. Gives `[]` when git fails: there's no repo, or no git.
 *
 * @public
 */
export async function listProjectFiles(root: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      maxBuffer: maxListBytes,
    })

    return stdout.split('\0').filter((path) => path !== '')
  } catch {
    return []
  }
}

/**
 * Returns `path` relative to `from`, written the way `init` writes a config folder and shows a path: `/` separated,
 * with no `./`, no trailing `/`, and `.` for `from` itself.
 */
export function relativePathOf(from: string, path: string): string {
  return relative(from, path).split(sep).join('/') || '.'
}

/**
 * Orders config folders: `.storybook` first, then by path.
 */
function compareConfigDirs(left: string, right: string): number {
  const leftRank = left === defaultConfigDir ? 0 : 1
  const rightRank = right === defaultConfigDir ? 0 : 1

  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }

  if (left === right) {
    return 0
  }

  return left < right ? -1 : 1
}

/**
 * Whether a normalized folder, relative to the project root, is inside it: not `..`, not under `../`, and not an
 * absolute path (posix or a Windows drive).
 */
export function isInsideRoot(configDir: string): boolean {
  return (
    configDir !== '..' && !configDir.startsWith('../') && !posix.isAbsolute(configDir) && !/^[A-Za-z]:/.test(configDir)
  )
}

/**
 * Finds the Storybook config folders of a project, relative to the root. A folder counts when the listed files hold
 * `.storybook/main.<ts, js, mjs, cjs, mts or cts>` in it. So does each folder a `storybook dev` or `storybook build`
 * call names, `.storybook` for a call without `-c`, when `hasMainFile` says it holds a `main.<extension>` directly. A
 * folder outside the root (`..`, `../x`, an absolute path) never counts. Each shows once, `.storybook` first, then by
 * code point.
 */
export function storybookConfigDirsOf(
  files: readonly string[],
  calls: readonly StorybookCall[],
  hasMainFile: (configDir: string) => boolean,
): string[] {
  const found = new Set(files.filter((file) => mainFilePath.test(file)).map((file) => posix.dirname(file)))

  for (const configDir of new Set(calls.map((call) => configDirOf(call)))) {
    if (isInsideRoot(configDir) && hasMainFile(configDir)) {
      found.add(configDir)
    }
  }

  return [...found].sort(compareConfigDirs)
}

/**
 * Turns text into a Storybook name: lowercase, every run of characters outside `a-z` and `0-9` becomes `-`, and the
 * ends are trimmed of `-`. Text with nothing left gives `storybook`.
 */
function slugOf(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug === '' ? 'storybook' : slug
}

/**
 * Returns the text a Storybook's default name comes from. For the root's `.storybook` or the root itself (`.`) that's
 * the package name without its scope, else the root folder's name. For another folder it's the name of the folder
 * holding the config folder, or the config folder's own name without a leading `.` when it isn't called `.storybook`.
 */
function nameSourceOf(configDir: string, packageName: unknown, rootDir: string): string {
  if (configDir === defaultConfigDir || configDir === '.') {
    return typeof packageName === 'string' && packageName !== ''
      ? packageName.replace(/^@[^/]+\//, '')
      : basename(rootDir)
  }

  if (posix.basename(configDir) === defaultConfigDir) {
    return posix.basename(posix.dirname(configDir))
  }

  return posix.basename(configDir).replace(/^\./, '')
}

/**
 * A config folder with its default Storybook name.
 */
export interface NamedConfigDir {
  /**
   * The config folder, relative to the project root.
   */
  configDir: string
  /**
   * The Storybook name: valid, and unique in the list.
   */
  name: string
}

/**
 * Returns `base`, or when `used` holds it, the first of `base-2`, `base-3` and so on that it doesn't hold. Adds the
 * name it returns to `used`.
 */
export function takeUniqueName(base: string, used: Set<string>): string {
  let name = base

  for (let suffix = 2; used.has(name); suffix += 1) {
    name = `${base}-${suffix}`
  }
  used.add(name)

  return name
}

/**
 * Gives each config folder a valid Storybook name, unique in the list. A name taken by an earlier folder gets `-2`,
 * `-3` and so on.
 */
export function nameConfigDirs(configDirs: readonly string[], packageName: unknown, rootDir: string): NamedConfigDir[] {
  const used = new Set<string>()

  return configDirs.map((configDir) => ({
    configDir,
    name: takeUniqueName(slugOf(nameSourceOf(configDir, packageName, rootDir)), used),
  }))
}
