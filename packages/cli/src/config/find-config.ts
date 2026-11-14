import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * The names a config file takes, in the order the search tries them in each folder.
 */
export const configFileNames = [
  'visual-check.config.ts',
  'visual-check.config.mts',
  'visual-check.config.js',
  'visual-check.config.mjs',
]

/**
 * Whether a path is a file, or a link to one. A folder, a missing path or one that can't be read, such as a link that
 * loops, isn't.
 */
export function isFile(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false
  } catch {
    return false
  }
}

/**
 * Returns the absolute path of the config nearest to `startDirectory`, an absolute folder: the first of
 * `configFileNames` that is a file in `startDirectory`, then in each parent. The search stops after the folder that
 * holds `.git` (a folder, or a file in a worktree or a submodule), or at the filesystem root. Returns `undefined` when
 * it finds none.
 */
export function findConfig(startDirectory: string): string | undefined {
  const found = configFileNames.map((name) => join(startDirectory, name)).find((path) => isFile(path))

  if (found !== undefined) {
    return found
  }

  const parent = dirname(startDirectory)

  if (parent === startDirectory || existsSync(join(startDirectory, '.git'))) {
    return undefined
  }

  return findConfig(parent)
}
