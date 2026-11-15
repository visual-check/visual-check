import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { systemReasonOf } from '../system-error/system-reason.js'

/**
 * The images a differing snapshot leaves in the report, in the order they are written.
 */
const imageKinds = ['baseline', 'snapshot', 'diff'] as const

/**
 * The report folder couldn't be cleared, or a report image couldn't be written, such as for a folder that isn't
 * writable or a full disk.
 *
 * @public
 */
export class ReportError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `ReportError`.
   */
  override name = 'ReportError'

  /**
   * What failed: clearing the report folder or writing a report image.
   */
  readonly action: 'clear' | 'write'

  /**
   * The report folder's path, or the image's.
   */
  readonly path: string

  /**
   * The operating system's reason, such as `EACCES: permission denied`.
   */
  readonly reason: string

  /**
   * Keeps what failed, the path and the reason the error that caused it gives.
   */
  constructor(action: 'clear' | 'write', path: string, cause: unknown) {
    const reason = systemReasonOf(cause)

    super(`Couldn't ${action} ${path}: ${reason}.`, { cause })
    this.action = action
    this.path = path
    this.reason = reason
  }
}

/**
 * The images of one snapshot that differs from its baseline, each a PNG file.
 *
 * @public
 */
export interface FailureImages {
  /**
   * The baseline, as stored.
   */
  baseline: Uint8Array
  /**
   * The snapshot, as the browser returned it.
   */
  snapshot: Uint8Array
  /**
   * The visual diff.
   */
  diff: Uint8Array
}

/**
 * Gives the report folder: `.visual-check/report` in the config file's folder.
 *
 * @public
 */
export function reportFolderOf(configPath: string): string {
  return join(dirname(configPath), '.visual-check', 'report')
}

/**
 * Removes the report folder and everything in it. A missing folder is already clear.
 *
 * @throws {ReportError} When the folder is there but can't be removed.
 *
 * @public
 */
export async function clearReport(folder: string): Promise<void> {
  try {
    await rm(folder, { recursive: true, force: true })
  } catch (error) {
    throw new ReportError('clear', folder, error)
  }
}

/**
 * Writes a differing snapshot's images to `images/<storybook>/<key>.baseline.png`, `.snapshot.png` and `.diff.png` in
 * the report folder, each exactly as given, creating the folders first.
 *
 * @throws {ReportError} When a folder or an image can't be written.
 *
 * @public
 */
export async function writeFailureImages(
  folder: string,
  storybook: string,
  key: string,
  images: FailureImages,
): Promise<void> {
  const imagesFolder = join(folder, 'images', storybook)

  try {
    await mkdir(imagesFolder, { recursive: true })
  } catch (error) {
    throw new ReportError('write', imagesFolder, error)
  }

  for (const kind of imageKinds) {
    const path = join(imagesFolder, `${key}.${kind}.png`)

    try {
      await writeFile(path, images[kind])
    } catch (error) {
      throw new ReportError('write', path, error)
    }
  }
}
