import { join, relative, sep } from 'node:path'
import { type Report, reportJsonOf } from '../report/report-document.js'
import type { Reporter } from './parse-command-line.js'
import type { PlannedSnapshot } from './plan-snapshots.js'
import type { SnapshotResult, SnapshotStatus } from './snapshot-result.js'

/**
 * The mark of a line that fails the run: a snapshot that differs or is missing, and an orphan.
 */
export const failMark = '✗'

/**
 * The mark each status's line starts with.
 */
const marks: Record<SnapshotStatus, string> = {
  passed: '✓',
  written: '✓',
  kept: '✓',
  differs: failMark,
  missing: failMark,
  broken: '!',
}

/**
 * Writes a path relative to `folder`, such as the folder the CLI runs in or the config's, with `/` on every OS.
 */
export function displayPathOf(folder: string, path: string): string {
  return relative(folder, path).split(sep).join('/')
}

/**
 * Builds the line that ends a `test`'s output: the path of the report folder's `report.json`, relative to `cwd`.
 */
export function reportLineOf(cwd: string, folder: string): string {
  return `Report: ${displayPathOf(cwd, join(folder, 'report.json'))}`
}

/**
 * The line that ends a run's output, the path of the report it wrote, with the stream it goes on. It is written after
 * both streams, so it is the run's last line whatever stderr holds.
 */
export interface ReportLine {
  /**
   * The stream it goes on: stdout, ending the block a human reporter ends a `test` with, else stderr.
   */
  stream: 'stdout' | 'stderr'
  /**
   * The line, without its newline.
   */
  text: string
}

/**
 * What a run prints: the text for each stream, then the report line when it wrote a report.
 */
export interface RunOutput {
  /**
   * Text for standard output.
   */
  stdout: string
  /**
   * Text for standard error.
   */
  stderr: string
  /**
   * The line written after both streams: the report's path. Absent when no report was written.
   */
  reportLine?: ReportLine
}

/**
 * Composes what a run prints from what it printed on each stream, its report or document, and its report line when it
 * wrote a report, given with the stream a human reporter puts it on: stdout for a `test` that exits 0 or 1, else
 * stderr. With `--reporter json`, stdout holds the JSON document alone, so the human lines move to stderr, before its
 * own text, and the report line goes on stderr. With any other reporter, both streams keep their text.
 */
export function runOutputOf(
  output: { stdout: string; stderr: string },
  report: Report,
  reporter: Reporter | undefined,
  reportLine: ReportLine | undefined,
): RunOutput {
  const streams =
    reporter === 'json'
      ? { stdout: `${reportJsonOf(report)}\n`, stderr: `${output.stdout}${output.stderr}` }
      : { stdout: output.stdout, stderr: output.stderr }

  if (reportLine === undefined) {
    return streams
  }

  return { ...streams, reportLine: reporter === 'json' ? { stream: 'stderr', text: reportLine.text } : reportLine }
}

/**
 * Builds a counts line, such as `2 written · 1 kept`: each label with its count, in the order given, leaving out zero
 * counts except the first.
 */
export function countsLineOf(counts: readonly (readonly [label: string, count: number])[]): string {
  return counts.flatMap(([label, count], index) => (index === 0 || count > 0 ? [`${count} ${label}`] : [])).join(' · ')
}

/**
 * Writes a count of snapshots with the noun in the right number, such as `1 snapshot` or `3 snapshots`.
 */
export function snapshotCountOf(count: number): string {
  return `${count} ${count === 1 ? 'snapshot' : 'snapshots'}`
}

/**
 * Names a snapshot by its Storybook, story ID and mode when it has one, two spaces apart.
 */
export function snapshotNameOf({ storybook, story, mode }: PlannedSnapshot): string {
  const modeColumn = mode === undefined ? '' : `  ${mode}`

  return `${storybook.name}  ${story.id}${modeColumn}`
}

/**
 * Builds a finished snapshot's line: its status's mark, its name and its result's detail, two spaces apart. It leaves
 * out the result's hint.
 */
export function snapshotLineOf(item: PlannedSnapshot, result: SnapshotResult): string {
  return `${marks[result.status]} ${snapshotNameOf(item)}  ${result.detail}`
}
