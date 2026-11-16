import { relative, sep } from 'node:path'
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
 * Writes a path relative to the folder the CLI runs in, with `/` on every OS.
 */
export function displayPathOf(cwd: string, path: string): string {
  return relative(cwd, path).split(sep).join('/')
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
