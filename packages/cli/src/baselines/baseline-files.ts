import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
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
 * Gives the path of a snapshot's baseline: `<key>.png` in the Storybook's baselines folder. The key is `<story-id>` for
 * a story's default capture and `<story-id>.<mode>` for one of its modes.
 *
 * @public
 */
export function baselinePathOf(baselinesFolder: string, key: string): string {
  return join(baselinesFolder, `${key}.png`)
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
 * file's name doesn't end in `.png`, so a leftover one is never taken for a baseline.
 *
 * @throws {BaselineError} When the folder, the temporary file or the rename fails. The temporary file is removed
 * first.
 *
 * @public
 */
export async function writeBaseline(path: string, bytes: Uint8Array): Promise<void> {
  const folder = dirname(path)
  const temporaryPath = join(folder, `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)

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
