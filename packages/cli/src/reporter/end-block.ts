import { join } from 'node:path'
import { displayPathOf } from '../report/display-path.js'
import {
  type ReportConsoleLevel,
  type ReportImages,
  reportDir,
  type TestReport,
  type TestReportCounts,
  type TestReportEntry,
} from '../report/report-document.js'
import { countsLineOf, orphanLabelOf } from './counts-line.js'
import { durationOf } from './duration.js'
import { pageErrorsBlockOf } from './page-errors-block.js'
import { realRequestsBlockOf } from './real-requests-block.js'

/**
 * What `test`'s end block needs besides the report.
 */
interface EndBlockContext {
  /**
   * The folder the CLI runs in. Printed paths are relative to it.
   */
  cwd: string
  /**
   * The config file's folder, which the report's baseline paths and folder are relative to.
   */
  configFolder: string
  /**
   * How long the run took so far, in ms.
   */
  elapsedMs: number
}

/**
 * Where an end block's paths are relative to.
 */
type PathContext = Pick<EndBlockContext, 'cwd' | 'configFolder'>

/**
 * What `update`'s end block shows of a broken snapshot: its name and the images it keeps.
 *
 * @public
 */
export interface UpdateBrokenSnapshot {
  /**
   * The snapshot's name: its Storybook, its story ID and its mode when it has one, two spaces apart.
   */
  name: string
  /**
   * The images it keeps in the report folder, relative to that folder. `undefined` when it keeps none.
   */
  images: ReportImages | undefined
}

/**
 * The statuses of the `test` entries that count as failures: the end block and the step summary list them.
 *
 * @public
 */
export const failureStatuses: readonly TestReportEntry['status'][] = ['differs', 'broken', 'missing', 'orphan']

/**
 * The console levels a broken story's failure lists.
 */
const listedConsoleLevels: readonly ReportConsoleLevel[] = ['error', 'warn']

/**
 * How many of a broken story's last console messages its failure lists.
 */
const listedConsoleCount = 5

/**
 * Names an entry by its Storybook, its story ID, or an orphan's file stem, and its mode when it has one, two spaces
 * apart.
 */
function entryNameOf({ storybook, story, id, mode }: TestReportEntry): string {
  const modeColumn = mode === null ? '' : `  ${mode}`

  return `${storybook}  ${story ?? id}${modeColumn}`
}

/**
 * Gives a failure's detail line: its status and what it means, the comparison's or broken story's message, or what to
 * run.
 */
function detailOf(entry: TestReportEntry, context: EndBlockContext): string {
  switch (entry.status) {
    case 'missing':
      return 'missing: no baseline yet; run visual-check update to write it'
    case 'orphan': {
      const path = displayPathOf(context.cwd, join(context.configFolder, entry.baseline))

      return `orphan: no story calls for ${path}; run visual-check update to delete it`
    }

    default:
      return `${entry.status}: ${entry.message}`
  }
}

/**
 * Gives a broken story's last console errors and warnings, the closest to the break, in order, each by its first line,
 * as stack traces span several, ending each at `\n` or `\r\n`.
 */
function consoleLinesOf(entry: TestReportEntry): string[] {
  if (entry.status !== 'broken') {
    return []
  }

  return entry.console
    .filter(({ level }) => listedConsoleLevels.includes(level))
    .slice(-listedConsoleCount)
    .map(({ level, text }) => `console ${level}: ${text.split(/\r?\n/)[0]}`)
}

/**
 * Gives the path of an image in the report folder, relative to the folder the CLI runs in.
 */
function reportImagePathOf(context: PathContext, image: string): string {
  return displayPathOf(context.cwd, join(context.configFolder, reportDir, image))
}

/**
 * Gives a failure's lines: its name, then indented by two spaces its detail, the path of its visual diff when it has
 * one, its hints, and for a broken story its last console errors and warnings.
 */
function failureLinesOf(entry: TestReportEntry, context: EndBlockContext): string[] {
  const { diff } = entry.images
  const diffLines = diff === null ? [] : [`diff: ${reportImagePathOf(context, diff)}`]
  const details = [
    detailOf(entry, context),
    ...diffLines,
    ...entry.hints.map(({ message }) => `hint: ${message}`),
    ...consoleLinesOf(entry),
  ]

  return [entryNameOf(entry), ...details.map((line) => `  ${line}`)]
}

/**
 * Gives the failures under a heading that counts them, in the report's order. Gives no line when nothing failed.
 */
function failuresBlockOf(report: TestReport, context: EndBlockContext): string[] {
  const failures = report.snapshots.filter((entry) => failureStatuses.includes(entry.status))

  if (failures.length === 0) {
    return []
  }

  const heading = `── ${failures.length} ${failures.length === 1 ? 'failure' : 'failures'} ──`

  return [heading, ...failures.flatMap((entry) => failureLinesOf(entry, context))]
}

/**
 * Lists the snapshots that have page errors or stale expected page errors, whatever their status, in the report's
 * order, by name, under a heading that says how many fail the run. Gives no line when none has either.
 */
function testPageErrorsBlockOf(report: TestReport): string[] {
  return pageErrorsBlockOf(
    report.snapshots.map((entry) => ({ ...entry, name: entryNameOf(entry) })),
    'test',
  )
}

/**
 * Lists the snapshots that have real network requests, whatever their status, in the report's order, by name, under a
 * heading that says how many fail the run. Gives no line when none has any.
 */
function testRealRequestsBlockOf(report: TestReport): string[] {
  return realRequestsBlockOf(report.snapshots.map((entry) => ({ ...entry, name: entryNameOf(entry) })))
}

/**
 * Lists the snapshots that passed on a retry by name under a heading, each indented by two spaces. Gives no line when
 * none did.
 */
function flakyBlockOf(report: TestReport): string[] {
  const names = report.snapshots.flatMap((entry) =>
    entry.status === 'passed' && entry.flaky ? [`  ${entryNameOf(entry)}`] : [],
  )

  return names.length === 0 ? [] : ['Flaky snapshots, which passed on a retry:', ...names]
}

/**
 * Builds the counts line of a `test`, without how long it took: passed, saying how many are flaky when any is, then the
 * snapshots that differ, the broken and missing ones and the orphans, leaving out zero counts except the passed.
 *
 * @public
 */
export function testCountsLineOf(counts: TestReportCounts): string {
  return countsLineOf([
    [counts.flaky > 0 ? `passed (${counts.flaky} flaky)` : 'passed', counts.passed],
    ['differs', counts.differs],
    ['broken', counts.broken],
    ['missing', counts.missing],
    [orphanLabelOf(counts.orphan), counts.orphan],
  ])
}

/**
 * Builds the lines a `test` that captured ends with, from its report: the failures, each snapshot that differs, is
 * broken or missing and each orphan, in the report's order, with the detail of each, the path of its visual diff, its
 * hints and a broken story's last 5 console errors and warnings; then the snapshots with page errors, each with its
 * first 5 page errors and their severity and its stale expected page errors; then the snapshots with real network
 * requests, each with its first 5 hosts and their severity; then the snapshots that passed on a retry; then the counts
 * and how long the run took.
 *
 * @public
 */
export function testEndLinesOf(report: TestReport, context: EndBlockContext): string[] {
  return [
    ...failuresBlockOf(report, context),
    ...testPageErrorsBlockOf(report),
    ...testRealRequestsBlockOf(report),
    ...flakyBlockOf(report),
    `${testCountsLineOf(report.counts)} · ${durationOf(context.elapsedMs)}`,
  ]
}

/**
 * Gives the line of a broken snapshot's image: the path of its visual diff or, with none, of its snapshot. Gives none
 * when it has neither.
 */
function brokenImageLinesOf(images: ReportImages | undefined, context: PathContext): string[] {
  if (images === undefined) {
    return []
  }

  if (images.diff !== null) {
    return [`diff: ${reportImagePathOf(context, images.diff)}`]
  }

  return images.snapshot === null ? [] : [`snapshot: ${reportImagePathOf(context, images.snapshot)}`]
}

/**
 * Builds the lines of `update`'s broken snapshots, in the order given: `broken` and its name, then indented by two
 * spaces the path of its visual diff or, with none, of its snapshot, relative to the folder the CLI runs in. A broken
 * snapshot that keeps neither has its name alone. Gives no line when none is broken.
 *
 * @public
 */
export function updateBrokenLinesOf(broken: readonly UpdateBrokenSnapshot[], context: PathContext): string[] {
  return broken.flatMap(({ name, images }) => [
    `broken ${name}`,
    ...brokenImageLinesOf(images, context).map((line) => `  ${line}`),
  ])
}
