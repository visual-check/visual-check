import { createWriteStream } from 'node:fs'
import { mkdir, symlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { text } from 'node:stream/consumers'
import { pipeline } from 'node:stream/promises'
import * as yauzl from 'yauzl'

/**
 * The system an entry's `versionMadeBy` names, in its high byte, when the zip was made on Unix.
 */
const madeOnUnix = 3

/**
 * The bits of a Unix mode that give a file's type.
 */
const fileTypeBits = 0o170000

/**
 * The file type bits of a symlink.
 */
const symlinkType = 0o120000

/**
 * The mode of a file whose entry gives no permissions, as a zip made on Windows does.
 */
const defaultFileMode = 0o644

/**
 * The Unix mode an entry holds in the high 16 bits of its external attributes when the zip was made on Unix, else 0,
 * since other systems keep something else there.
 */
function unixModeOf(entry: yauzl.Entry): number {
  return entry.versionMadeBy >>> 8 === madeOnUnix ? entry.externalFileAttributes >>> 16 : 0
}

/**
 * Whether a symlink's target is a relative path with no `..`, so it points into the symlink's own folder. A chain of
 * such symlinks, and a file written through one, stays inside the destination too. Both `/` and `\` count as
 * separators, and a drive letter counts as absolute, as they do on Windows.
 */
function pointsDown(target: string): boolean {
  return !/^([a-z]:|[/\\])/i.test(target) && !target.split(/[/\\]/).includes('..')
}

/**
 * Makes the symlink an entry holds, whose content is its target, when the target points into its own folder.
 */
async function extractSymlink(zip: yauzl.ZipFile, entry: yauzl.Entry, destination: string): Promise<void> {
  const path = join(destination, entry.fileName)
  const target = await text(await zip.openReadStreamPromise(entry))

  if (!pointsDown(target)) {
    throw new Error(
      `the symlink ${entry.fileName} points to ${target}, but its target must be a relative path without a .. in it`,
    )
  }

  await mkdir(dirname(path), { recursive: true })
  await symlink(target, path)
}

/**
 * Writes the file an entry holds, with the permissions it holds, or 0644 when it holds none.
 */
async function extractFile(zip: yauzl.ZipFile, entry: yauzl.Entry, destination: string): Promise<void> {
  const path = join(destination, entry.fileName)
  const permissions = unixModeOf(entry) & 0o777

  await mkdir(dirname(path), { recursive: true })
  await pipeline(
    await zip.openReadStreamPromise(entry),
    createWriteStream(path, { mode: permissions === 0 ? defaultFileMode : permissions }),
  )
}

/**
 * Extracts every entry of the opened zip into the destination, one at a time.
 */
async function extractEntries(zip: yauzl.ZipFile, destination: string): Promise<void> {
  for await (const entry of zip.eachEntry()) {
    if (entry.fileName.endsWith('/')) {
      await mkdir(join(destination, entry.fileName), { recursive: true })
    } else if ((unixModeOf(entry) & fileTypeBits) === symlinkType) {
      await extractSymlink(zip, entry, destination)
    } else {
      await extractFile(zip, entry, destination)
    }
  }
}

/**
 * Extracts the zip into the destination folder, which it makes when missing: folders, files with the permissions a
 * zip made on Unix holds, and symlinks whose target is a relative path with no `..`. yauzl refuses entries with an
 * absolute name or a `..` in it, so nothing lands outside the destination.
 *
 * @throws {Error} yauzl's, zlib's or the file system's own error, when the zip isn't one, is damaged, or can't be read
 * or written; the file system's carries the `syscall` that failed. An error naming the symlink and its target, when a
 * symlink could point outside the destination.
 */
export async function unzip(zipPath: string, destination: string): Promise<void> {
  const destinationFolder = resolve(destination)
  // `openPromise` reads entries one at a time, as `eachEntry` needs. The `finally` closes the zip.
  const zip = await yauzl.openPromise(zipPath, { autoClose: false })

  try {
    await mkdir(destinationFolder, { recursive: true })
    await extractEntries(zip, destinationFolder)
  } finally {
    zip.close()
  }
}
