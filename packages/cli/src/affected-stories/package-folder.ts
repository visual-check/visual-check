import { access } from 'node:fs/promises'
import { join, posix } from 'node:path'

/**
 * Tells whether a file is there.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path)

    return true
  } catch {
    return false
  }
}

/**
 * Gives a function that finds the package a changed file belongs to: the nearest folder, from the file's own folder up
 * to the root, that holds a `package.json` on disk, relative to the root, `/`-separated, and `.` for the root itself.
 * A `package.json` belongs to its own folder, even when it's deleted. A file with no `package.json` above it belongs
 * to the root. The function remembers each folder it looked at.
 */
export function packageFolderFinder(root: string): (file: string) => Promise<string> {
  const holdsManifest = new Map<string, Promise<boolean>>()

  /**
   * Tells whether a root-relative folder holds a `package.json`, looking once per folder.
   */
  const holdsManifestIn = (folder: string): Promise<boolean> => {
    let answer = holdsManifest.get(folder)

    if (answer === undefined) {
      answer = exists(join(root, folder, 'package.json'))
      holdsManifest.set(folder, answer)
    }

    return answer
  }

  return async (file) => {
    let folder = posix.dirname(file)

    if (posix.basename(file).toLowerCase() === 'package.json') {
      return folder
    }

    while (folder !== '.' && !(await holdsManifestIn(folder))) {
      folder = posix.dirname(folder)
    }

    return folder
  }
}
