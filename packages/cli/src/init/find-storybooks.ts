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
 * Returns a comparator that orders paths with `first` first, then by code point.
 */
export function orderWithFirst(first: string): (left: string, right: string) => number {
  return (left, right) => {
    const rank = Number(left !== first) - Number(right !== first)

    if (rank !== 0 || left === right) {
      return rank
    }

    return left < right ? -1 : 1
  }
}

/**
 * Whether a folder is an absolute path: posix, or one on a Windows drive.
 */
export function isAbsoluteFolder(folder: string): boolean {
  return posix.isAbsolute(folder) || /^[A-Za-z]:/.test(folder)
}

/**
 * Whether a normalized folder, relative to the project root, is inside it: not `..`, not under `../`, and not an
 * absolute path.
 */
export function isInsideRoot(configDir: string): boolean {
  return configDir !== '..' && !configDir.startsWith('../') && !isAbsoluteFolder(configDir)
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

  return [...found].sort(orderWithFirst(defaultConfigDir))
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
 * Returns the text a Storybook's default name comes from, for a config folder relative to its package's folder. See
 * `defaultNameOf`.
 */
function nameSourceOf(configDir: string, packageName: string | undefined, packageDir: string): string {
  if (configDir === defaultConfigDir || configDir === '.') {
    return packageName === undefined ? basename(packageDir) : packageName.replace(/^@[^/]+\//, '')
  }

  if (posix.basename(configDir) === defaultConfigDir) {
    return posix.basename(posix.dirname(configDir))
  }

  return posix.basename(configDir).replace(/^\./, '')
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
 * Returns the default Storybook name of a config folder, relative to its package's folder `packageDir`: valid, but not
 * yet unique. A `.storybook` in the package, or the package itself (`.`), takes the package name without its scope,
 * else the package folder's name. Another folder takes the name of the folder holding it, or its own name without a
 * leading `.` when it isn't called `.storybook`.
 */
export function defaultNameOf(configDir: string, packageName: string | undefined, packageDir: string): string {
  return slugOf(nameSourceOf(configDir, packageName, packageDir))
}
