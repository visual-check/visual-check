import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { systemReasonOf } from '../system-error/system-reason.js'
import { type Report, type ReportImages, reportImagePathOf, reportJsonOf } from './report-document.js'

/**
 * The images a snapshot leaves in the report, in the order they are written.
 */
const imageKinds = ['baseline', 'snapshot', 'diff', 'compared'] as const

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
   * What failed: clearing the report folder, writing a report file, or copying a baseline.
   */
  readonly action: 'clear' | 'write' | 'copy'

  /**
   * The report folder's path, the file's, or for a copy the baseline's.
   */
  readonly path: string

  /**
   * The operating system's reason, such as `EACCES: permission denied`.
   */
  readonly reason: string

  /**
   * Keeps what failed, the path and the reason the error that caused it gives.
   */
  constructor(action: 'clear' | 'write' | 'copy', path: string, cause: unknown) {
    const reason = systemReasonOf(cause)

    super(`Couldn't ${action} ${path}: ${reason}.`, { cause })
    this.action = action
    this.path = path
    this.reason = reason
  }
}

/**
 * The images of one snapshot the report lists, each a PNG file.
 *
 * @public
 */
export interface ReportImageBytes {
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
  /**
   * The capture the snapshot was compared with, for a broken story whose captures disagreed.
   */
  compared: Uint8Array
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
 * Writes the given images to `images/<storybook>/<stem>.baseline.png`, `.snapshot.png`, `.diff.png` and
 * `.compared.png` in the report folder, each exactly as given, creating the folders first. The stem is its baseline's: the snapshot's key, shortened
 * when long. Images left out aren't written.
 *
 * @returns The written images' paths relative to the report folder, `null` for the rest.
 *
 * @throws {ReportError} When a folder or an image can't be written.
 *
 * @public
 */
export async function writeReportImages(
  folder: string,
  storybook: string,
  stem: string,
  images: Partial<ReportImageBytes>,
): Promise<ReportImages> {
  const paths: ReportImages = { baseline: null, snapshot: null, diff: null, compared: null }
  const imagesFolder = join(folder, 'images', storybook)

  await makeFolder(imagesFolder)

  for (const kind of imageKinds) {
    const bytes = images[kind]

    if (bytes === undefined) {
      continue
    }

    const path = join(imagesFolder, `${stem}.${kind}.png`)

    try {
      await writeFile(path, bytes)
    } catch (error) {
      throw new ReportError('write', path, error)
    }

    paths[kind] = reportImagePathOf(storybook, stem, kind)
  }

  return paths
}

/**
 * Copies a baseline to `images/<storybook>/<stem>.baseline.png` in the report folder, creating the folders first.
 *
 * @returns The copy's path relative to the report folder.
 *
 * @throws {ReportError} When a folder can't be made (`write`) or the baseline can't be copied (`copy`, naming it).
 *
 * @public
 */
export async function copyBaselineToReport(
  folder: string,
  storybook: string,
  stem: string,
  baselinePath: string,
): Promise<string> {
  const imagesFolder = join(folder, 'images', storybook)
  const path = join(imagesFolder, `${stem}.baseline.png`)

  await makeFolder(imagesFolder)

  try {
    await copyFile(baselinePath, path)
  } catch (error) {
    throw new ReportError('copy', baselinePath, error)
  }

  return reportImagePathOf(storybook, stem, 'baseline')
}

/**
 * Writes `report.json` in the report folder, creating the folder first.
 *
 * @throws {ReportError} When the folder or the file can't be written.
 *
 * @public
 */
export async function writeReportJson(folder: string, report: Report): Promise<void> {
  await makeFolder(folder)

  const path = join(folder, 'report.json')

  try {
    await writeFile(path, `${reportJsonOf(report)}\n`)
  } catch (error) {
    throw new ReportError('write', path, error)
  }
}

/**
 * Replaces the report folder with a report that holds only the run's error: the old report is cleared first, so none
 * of its images linger.
 *
 * @throws {ReportError} When the folder can't be cleared or the report can't be written.
 *
 * @public
 */
export async function writeErrorReport(folder: string, report: Report): Promise<void> {
  await clearReport(folder)
  await writeReportJson(folder, report)
}

/**
 * Makes a folder and its parents.
 *
 * @throws {ReportError} When the folder can't be made.
 */
async function makeFolder(folder: string): Promise<void> {
  try {
    await mkdir(folder, { recursive: true })
  } catch (error) {
    throw new ReportError('write', folder, error)
  }
}
