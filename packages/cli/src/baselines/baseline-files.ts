import { createHash, randomBytes } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { BaselineError } from './baseline-error.js'

/**
 * Gives a snapshot's key, which names its baseline: `<story-id>` for a story's default capture, which has no mode
 * part, and `<story-id>.<mode>` for one of its modes.
 *
 * @public
 */
export function snapshotKeyOf(storyId: string, mode?: string): string {
  return mode === undefined ? storyId : `${storyId}.${mode}`
}

/**
 * The most bytes a key keeps in its baseline's file name as it is. A longer key is shortened.
 */
const longestKeptKeyBytes = 240

/**
 * How many bytes of a shortened key's start its baseline's file name keeps.
 */
export const shortenedPrefixBytes = 223

/**
 * How many hex characters of the full key's SHA-256 a shortened key ends with.
 */
export const shortenedHashLength = 16

/**
 * The end of every baseline's file name.
 */
const baselineExtension = '.png'

/**
 * Gives the longest start of the text, in whole characters, that fits in `limit` UTF-8 bytes. A character is never
 * split, so the start can be a few bytes short of the limit.
 */
function startWithinBytes(text: string, limit: number): string {
  let bytes = 0
  let end = 0

  for (const character of text) {
    bytes += Buffer.byteLength(character, 'utf8')

    if (bytes > limit) {
      break
    }

    end += character.length
  }

  return text.slice(0, end)
}

/**
 * Gives the stem a snapshot's files are named after: its baseline, `<stem>.png`, and its report images,
 * `<stem>.<kind>.png`. That's the key in Unicode NFC, so an accented letter is encoded the same way on every OS and git
 * sees one name for one baseline. A key over 240 UTF-8 bytes keeps its first 223 bytes in whole characters, then `-`,
 * then the first 16 hex characters of the full key's SHA-256, all taken in NFC too. The stem is at most 240 bytes,
 * which leaves room for the report's longest image suffix, `.snapshot.png`, within the 255 bytes a file name can take.
 *
 * @public
 */
export function baselineStemOf(key: string): string {
  const composed = key.normalize('NFC')

  if (Buffer.byteLength(composed, 'utf8') <= longestKeptKeyBytes) {
    return composed
  }

  const hash = createHash('sha256').update(composed, 'utf8').digest('hex').slice(0, shortenedHashLength)

  return `${startWithinBytes(composed, shortenedPrefixBytes)}-${hash}`
}

/**
 * Gives the file name of a snapshot's baseline: its stem, then `.png`. That's `<key>.png` for a key of up to 240 bytes.
 */
export function baselineFileNameOf(key: string): string {
  return `${baselineStemOf(key)}${baselineExtension}`
}

/**
 * Folds a file name into the form two names share when some file system takes them for one file, since baselines are
 * committed and checked out on every OS. macOS ignores how an accented letter is encoded and folds case fully, so
 * `straße` and `STRASSE`, or `σ` and `ς`, are one file there. So the name goes to Unicode NFC, then upper case, which
 * turns `ß` into `SS` and `ς` into `Σ`, then lower case, then NFC again, since a case change can leave a letter and its
 * accent apart. That folds at least as much as macOS and Windows do.
 */
export function foldedFileNameOf(name: string): string {
  return name.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC')
}

/**
 * Gives a baseline's file name without its `.png`: the stem its snapshot's key gave it.
 */
export function stemOfFileName(fileName: string): string {
  return fileName.slice(0, -baselineExtension.length)
}

/**
 * Gives the path of a snapshot's baseline: its file name in the Storybook's baselines folder. That's `<key>.png`, the
 * key being `<story-id>` for a story's default capture and `<story-id>.<mode>` for one of its modes, with a key over
 * 240 bytes shortened.
 *
 * @public
 */
export function baselinePathOf(baselinesFolder: string, key: string): string {
  return join(baselinesFolder, baselineFileNameOf(key))
}

/**
 * Reads a baseline's bytes exactly as they are stored. Gives `undefined` for a missing baseline: no file at the path,
 * or no baselines folder at all.
 *
 * @throws {BaselineError} When the baseline is there but can't be read, or its path can't be followed.
 *
 * @public
 */
export async function readBaseline(path: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }

    throw new BaselineError('read', path, error)
  }
}

/**
 * Gives the identity of the file at the path, its device and inode, which two names of one file share. Gives
 * `undefined` when nothing is there.
 *
 * @throws {BaselineError} When the path can't be followed or looked at.
 */
async function fileIdentityOf(path: string): Promise<string | undefined> {
  try {
    const { dev, ino } = await stat(path, { bigint: true })

    return `${dev}:${ino}`
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }

    throw new BaselineError('read', path, error)
  }
}

/**
 * Whether a baseline is at the path. The file system decides, so on macOS a file whose name differs only in case or in
 * how an accented letter is encoded counts too. No baselines folder means no baseline.
 *
 * @throws {BaselineError} When the path can't be followed or looked at.
 *
 * @public
 */
export async function hasBaseline(path: string): Promise<boolean> {
  return (await fileIdentityOf(path)) !== undefined
}

/**
 * Gives the entries of a baselines folder, with their types. A missing folder has none.
 *
 * @throws {BaselineError} When the folder is there but can't be listed, such as a file in its place.
 */
async function folderEntriesOf(folder: string): Promise<Dirent[]> {
  try {
    return await readdir(folder, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }

    throw new BaselineError('list', folder, error)
  }
}

/**
 * Whether a symbolic link leads to a regular file. A broken link, whose target is missing, doesn't, nor does one that
 * leads to a folder.
 *
 * @throws {BaselineError} When the link's target can't be looked at for another reason.
 */
async function linksToFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }

    throw new BaselineError('read', path, error)
  }
}

/**
 * Whether an entry of a baselines folder is a baseline: its name ends in `.png`, and it's a regular file or a symbolic
 * link that leads to one.
 *
 * @throws {BaselineError} When a link's target can't be looked at, apart from a missing one.
 */
async function isBaselineEntry(folder: string, entry: Dirent): Promise<boolean> {
  if (!entry.name.endsWith(baselineExtension)) {
    return false
  }

  if (entry.isFile()) {
    return true
  }

  return entry.isSymbolicLink() && (await linksToFile(join(folder, entry.name)))
}

/**
 * Lists the names of the baselines in a baselines folder, sorted by name: every regular file whose name ends in
 * `.png`, as written, and every symbolic link of such a name that leads to a regular file. Other files, such as a
 * temporary file a killed run left, subfolders, broken links and links to folders are left out. A missing folder holds
 * no baselines.
 *
 * @throws {BaselineError} When the folder is there but can't be listed, such as a file in its place, or a link's
 * target can't be looked at, apart from a missing one.
 *
 * @public
 */
export async function listBaselines(folder: string): Promise<string[]> {
  const entries = await folderEntriesOf(folder)
  const isBaseline = await Promise.all(entries.map((entry) => isBaselineEntry(folder, entry)))

  return entries
    .filter((_, index) => isBaseline[index])
    .map((entry) => entry.name)
    .sort()
}

/**
 * What the file system holds at the paths of the baselines a Storybook's snapshots call for.
 */
interface ExpectedBaselines {
  /**
   * For each expected path, in the order given, whether a file is at that exact path. The file system decides, so on
   * macOS a file whose name differs only in case or in how an accented letter is encoded counts too.
   */
  present: boolean[]
  /**
   * Gives the paths, in the order given, that are none of the expected baselines. A path is one when it is the same
   * file as an expected path: another name of it that the file system folds to the same name, as macOS does for names
   * that differ only in case or encoding, a hard link to it, or a symbolic link to it. A path with no file is left
   * out, since there is nothing there to tell apart.
   *
   * @throws {BaselineError} When a path can't be followed or looked at.
   */
  pathsNotExpected(paths: readonly string[]): Promise<string[]>
}

/**
 * Looks at the paths of the baselines a Storybook's snapshots call for, there or not, once, so that both what is
 * missing and what is not expected come from the same look.
 *
 * @throws {BaselineError} When an expected path can't be followed or looked at.
 *
 * @public
 */
export async function expectedBaselinesAt(expectedPaths: readonly string[]): Promise<ExpectedBaselines> {
  const identities = await Promise.all(expectedPaths.map(fileIdentityOf))
  const expected = new Set(identities)

  return {
    present: identities.map((identity) => identity !== undefined),
    async pathsNotExpected(paths) {
      const pathIdentities = await Promise.all(paths.map(fileIdentityOf))

      return paths.filter((_, index) => {
        const identity = pathIdentities[index]

        return identity !== undefined && !expected.has(identity)
      })
    },
  }
}

/**
 * Deletes a baseline. One that is already gone counts as deleted. For a symbolic link, only the link goes.
 *
 * @throws {BaselineError} When it can't be deleted, such as when its folder isn't writable.
 */
async function deleteBaseline(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new BaselineError('delete', path, error)
    }
  }
}

/**
 * Deletes the orphans of one baselines folder, one at a time in the order given, and gives the paths deleted. An
 * orphan the file system takes for one of the expected baselines, as macOS can for names that differ only in a way it
 * folds, is the same file, so it stays and isn't given. So does a link to one. An orphan that is a symbolic link to
 * another file loses the link only. `expectedPaths` are the paths of every baseline the Storybook's snapshots call
 * for, there or not.
 *
 * @throws {BaselineError} When an expected baseline can't be looked at, or an orphan can't be deleted. The orphans
 * after it stay.
 *
 * @public
 */
export async function deleteOrphans(
  orphanPaths: readonly string[],
  expectedPaths: readonly string[],
): Promise<string[]> {
  if (orphanPaths.length === 0) {
    return []
  }

  const expected = new Set(await Promise.all(expectedPaths.map(fileIdentityOf)))
  const deleted: string[] = []

  for (const path of orphanPaths) {
    const identity = await fileIdentityOf(path)

    if (identity !== undefined && !expected.has(identity)) {
      await deleteBaseline(path)
      deleted.push(path)
    }
  }

  return deleted
}

/**
 * Writes a baseline's bytes exactly as given, creating its folder first. The bytes go to a temporary file in the same
 * folder, which is then renamed over the baseline, so a run killed midway never leaves part of a PNG. The temporary
 * file's name doesn't end in `.png`, so a leftover one is never taken for a baseline. It leaves out the baseline's
 * name, so it stays short when that name is near the 255 bytes a file name can take.
 *
 * @throws {BaselineError} When the folder, the temporary file or the rename fails. The temporary file is removed first.
 *
 * @public
 */
export async function writeBaseline(path: string, bytes: Uint8Array): Promise<void> {
  const folder = dirname(path)
  const temporaryPath = join(folder, `.visual-check-${randomBytes(6).toString('hex')}.tmp`)

  try {
    await mkdir(folder, { recursive: true })
    await writeFile(temporaryPath, bytes, { flag: 'wx' })
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)

    throw new BaselineError('write', path, error)
  }
}
