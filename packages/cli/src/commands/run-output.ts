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
 * Composes what a `test` that wrote its report prints on each stream. With `--reporter json`, stdout holds the report's
 * JSON document alone, the human lines are dropped, and stderr keeps its text and ends with the report line. With any
 * other reporter, stdout ends with the report line.
 */
export function cliOutputOf(
  output: { stdout: string; stderr: string },
  report: Report,
  reporter: Reporter | undefined,
  reportLine: string,
): { stdout: string; stderr: string } {
  if (reporter === 'json') {
    return { stdout: `${reportJsonOf(report)}\n`, stderr: `${output.stderr}${reportLine}\n` }
  }

  return { stdout: `${output.stdout}${reportLine}\n`, stderr: output.stderr }
}

/**
 * Composes what a `test` that exits 2 prints on each stream. stderr keeps its text and ends with `tail`: the report
 * line when the report was written, else what kept it from being written, or nothing. With `--reporter json`, stdout
 * holds the report's JSON document alone and the human lines are dropped. With any other reporter, stdout keeps them.
 */
export function stopOutputOf(
  output: { stdout: string; stderr: string },
  report: Report,
  reporter: Reporter | undefined,
  tail: string,
): { stdout: string; stderr: string } {
  return {
    stdout: reporter === 'json' ? `${reportJsonOf(report)}\n` : output.stdout,
    stderr: `${output.stderr}${tail}`,
  }
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
