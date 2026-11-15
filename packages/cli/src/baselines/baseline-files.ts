import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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
const shortenedPrefixBytes = 223

/**
 * How many hex characters of the full key's SHA-256 a shortened key ends with.
 */
const shortenedHashLength = 16

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
 * `<stem>.<kind>.png`. That's the key, or, for a key over 240 UTF-8 bytes, its first 223 bytes in whole characters,
 * then `-`, then the first 16 hex characters of the full key's SHA-256. The stem is at most 240 bytes, which leaves
 * room for the report's longest image suffix, `.snapshot.png`, within the 255 bytes a file name can take.
 *
 * @public
 */
export function baselineStemOf(key: string): string {
  if (Buffer.byteLength(key, 'utf8') <= longestKeptKeyBytes) {
    return key
  }

  const hash = createHash('sha256').update(key, 'utf8').digest('hex').slice(0, shortenedHashLength)

  return `${startWithinBytes(key, shortenedPrefixBytes)}-${hash}`
}

/**
 * Gives the file name of a snapshot's baseline: its stem, then `.png`. That's `<key>.png` for a key of up to 240 bytes.
 */
export function baselineFileNameOf(key: string): string {
  return `${baselineStemOf(key)}.png`
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

/**
 * Tells whether a snapshot and a baseline hold the same bytes.
 *
 * @public
 */
export function isByteIdentical(snapshot: Uint8Array, baseline: Uint8Array): boolean {
  return Buffer.from(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength).equals(baseline)
}
