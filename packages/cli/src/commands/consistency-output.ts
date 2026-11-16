import { basename } from 'node:path'
import { stemOfFileName } from '../baselines/baseline-files.js'
import { type ConsistencyCheck, isConsistent, type StorybookBaselines } from './consistency-check.js'
import type { PlannedSnapshot } from './plan-snapshots.js'
import { countsLineOf, displayPathOf, failMark, snapshotCountOf, snapshotLineOf } from './run-output.js'
import { brokenResultOf, missingResultOf } from './snapshot-result.js'

/**
 * What the consistency output is built from.
 */
interface CheckedPlan {
  /**
   * The CLI's version, for the header.
   */
  version: string
  /**
   * The folder the CLI runs in. Printed paths are relative to it.
   */
  cwd: string
  /**
   * Every planned snapshot of the Storybooks the check covers, selected or not, broken ones included, in planned order.
   */
  planned: readonly PlannedSnapshot[]
  /**
   * What the check found in their baselines folders.
   */
  check: ConsistencyCheck
}

/**
 * What the consistency check found, and what it prints.
 */
interface ConsistencyOutput {
  /**
   * Whether it found nothing: no missing baseline, no story whose stories file failed to load, and no orphan.
   */
  consistent: boolean
  /**
   * The header, a line for each finding and the end line, each ending with a newline.
   */
  stdout: string
}

/**
 * The line that ends the consistency output when the check found nothing.
 */
const consistentLine = 'Consistent: every baseline the stories call for is there, and none is an orphan.'

/**
 * Labels a count of orphans: `orphan` for 1, `orphans` otherwise.
 */
export function orphanLabelOf(count: number): string {
  return count === 1 ? 'orphan' : 'orphans'
}

/**
 * Builds a line for each orphan, Storybooks in the order given, then file name order: the fail mark, the Storybook, the
 * orphan's file name without `.png`, and that no story calls for its path, relative to the folder the CLI runs in, so
 * `update` would delete it.
 */
export function orphanLinesOf(cwd: string, storybooks: readonly StorybookBaselines[]): string[] {
  return storybooks.flatMap(({ storybook, orphans }) =>
    orphans.map(
      (path) =>
        `${failMark} ${storybook.name}  ${stemOfFileName(basename(path))}  orphan: no story calls for ` +
        `${displayPathOf(cwd, path)}; run visual-check update to delete it`,
    ),
  )
}

/**
 * Builds what the consistency check prints, without capturing: the header, which counts the planned snapshots, then in
 * planned order the line of each snapshot whose baseline is missing and of each story whose stories file failed to
 * load, as `test` prints them, then a line for each orphan. It ends with a line that says the baselines are consistent
 * when it found nothing, or else with the counts of missing baselines, broken snapshots and orphans, each but the first
 * left out at zero. A broken snapshot counts as broken alone, whether its baseline is there or not.
 */
export function consistencyOutputOf({ version, cwd, planned, check }: CheckedPlan): ConsistencyOutput {
  const findings: string[] = []
  let missing = 0
  let broken = 0

  for (const item of planned) {
    if ('broken' in item) {
      broken += 1
      findings.push(snapshotLineOf(item, brokenResultOf(item.broken, { attempts: 0 })))
    } else if (check.missing.has(item)) {
      missing += 1
      findings.push(snapshotLineOf(item, missingResultOf()))
    }
  }

  const orphanLines = orphanLinesOf(cwd, check.storybooks)
  const counts = [
    ['missing', missing],
    ['broken', broken],
    [orphanLabelOf(orphanLines.length), orphanLines.length],
  ] as const
  const consistent = isConsistent(check, planned)
  const lines = [
    `visual-check ${version} · test · consistency · ${snapshotCountOf(planned.length)}`,
    ...findings,
    ...orphanLines,
    consistent ? consistentLine : countsLineOf(counts),
  ]

  return { consistent, stdout: lines.map((line) => `${line}\n`).join('') }
}
