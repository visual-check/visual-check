import { basename, dirname } from 'node:path'
import { stemOfFileName } from '../baselines/baseline-files.js'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import {
  emptyTestCounts,
  emptyUpdateCounts,
  type ReportSelection,
  type ReportShard,
  type ReportStorybook,
  type ReportWarning,
  reportDir,
  type TestReport,
  type TestReportEntry,
  testReportOf,
  type UpdateReport,
  updateReportOf,
} from '../report/report-document.js'
import { copyBaselineToReport, reportFolderOf } from '../report/report-folder.js'
import type { Shard } from '../sharding/shard.js'
import type { StorybookBaselines } from './consistency-check.js'
import type { Selection } from './parse-command-line.js'
import type { PlannedSnapshot } from './plan-snapshots.js'
import {
  deletedEntryOf,
  isListed,
  orphanEntryOf,
  testCountsOf,
  testEntryOf,
  updateCountsOf,
  updateEntryOf,
} from './report-entries.js'
import type { SnapshotResult } from './snapshot-result.js'
import type { DeletedBaseline } from './update-baselines.js'

/**
 * What a run that finished, or stopped after its consistency check, found: what the report lists and counts.
 */
export interface RunFindings {
  /**
   * The snapshots it took, or for a run stopped after its consistency check the ones the check found, in planned
   * order.
   */
  items: PlannedSnapshot[]
  /**
   * What became of each snapshot, by its index in `items`, `undefined` for one that didn't finish.
   */
  results: (SnapshotResult | undefined)[]
  /**
   * Each Storybook's baselines folder, in config order, with the orphans `test` reports. None for a shard.
   */
  baselines: StorybookBaselines[]
  /**
   * The baselines `update` deleted, in config order, then file name order. None for `test`.
   */
  deleted: DeletedBaseline[]
  /**
   * The warnings that end a finished `update`. None for `test`.
   */
  warnings: ReportWarning[]
}

/**
 * What a `test` report is built from.
 */
export interface TestReportFacts {
  /**
   * The CLI's version.
   */
  version: string
  /**
   * The config file's path. The report folder and the baselines' paths in the report are relative to its folder.
   */
  configPath: string
  /**
   * Whether the run is `test --consistency`.
   */
  consistencyOnly: boolean
  /**
   * The shard the run is, or `undefined` for a run that isn't sharded.
   */
  shard: Shard | undefined
  /**
   * How the run picked its stories.
   */
  selection: Selection
  /**
   * The Storybooks in the run, in config order.
   */
  storybooks: readonly ResolvedStorybook[]
  /**
   * The run's exit code.
   */
  exitCode: number
  /**
   * What the run found.
   */
  findings: RunFindings
}

/**
 * Gives the report's selection: `filter` for `--filter`, else `all`, since affected stories don't exist yet, so
 * nothing is known of a base, changed files or a fallback.
 */
export function selectionOf(selection: Selection): ReportSelection {
  return { by: selection.kind === 'filter' ? 'filter' : 'all', base: null, changedFiles: null, fallback: null }
}

/**
 * Gives the report's shard: its index and total, or `null` for a run that isn't sharded.
 */
function reportShardOf(shard: Shard | undefined): ReportShard | null {
  return shard === undefined ? null : { index: shard.index, total: shard.total }
}

/**
 * Gives the entry of each orphan, in config order then file name order, after copying its baseline into the report
 * folder.
 *
 * @throws {ReportError} When a baseline can't be copied.
 */
async function orphanEntriesOf(
  baselines: readonly StorybookBaselines[],
  folder: string,
  configFolder: string,
): Promise<TestReportEntry[]> {
  const entries: TestReportEntry[] = []

  for (const { storybook, orphans } of baselines) {
    for (const path of orphans) {
      const image = await copyBaselineToReport(folder, storybook.name, stemOfFileName(basename(path)), path)

      entries.push(orphanEntryOf(storybook, path, configFolder, image))
    }
  }

  return entries
}

/**
 * Gives the result of each snapshot that finished, and the entry `entryOf` gives each listed one, in planned order,
 * with its baseline's path relative to `configFolder`.
 */
function listedOf<Entry>(
  findings: RunFindings,
  configFolder: string,
  entryOf: (item: PlannedSnapshot, result: SnapshotResult, configFolder: string) => Entry,
): { results: SnapshotResult[]; entries: Entry[] } {
  const finished = findings.items.flatMap((item, index) => {
    const result = findings.results[index]

    return result === undefined ? [] : [{ item, result }]
  })

  return {
    results: finished.map(({ result }) => result),
    entries: finished.flatMap(({ item, result }) => (isListed(result) ? [entryOf(item, result, configFolder)] : [])),
  }
}

/**
 * Builds a `test` report of a run that exits 0 or 1: an entry for each listed snapshot, in planned order, then one for
 * each orphan, whose baseline it copies into the report folder, and the counts of every finished snapshot and orphan.
 * Plain passes are only counted.
 *
 * @throws {ReportError} When an orphan's baseline can't be copied.
 */
export async function testReportFor(facts: TestReportFacts): Promise<TestReport> {
  const { findings } = facts
  const configFolder = dirname(facts.configPath)
  const { results, entries } = listedOf(findings, configFolder, testEntryOf)
  const orphans = await orphanEntriesOf(findings.baselines, reportFolderOf(facts.configPath), configFolder)

  return testReportOf({
    visualCheck: facts.version,
    consistencyOnly: facts.consistencyOnly,
    exitCode: facts.exitCode,
    shard: reportShardOf(facts.shard),
    selection: selectionOf(facts.selection),
    reportDir,
    storybooks: facts.storybooks.map(({ name, url }) => ({ name, url })),
    counts: testCountsOf(results, orphans.length),
    snapshots: [...entries, ...orphans],
    error: null,
  })
}

/**
 * What the report of a `test` that exits 2 is built from.
 */
export interface TestErrorReportFacts {
  /**
   * The CLI's version.
   */
  version: string
  /**
   * Whether the run is `test --consistency`.
   */
  consistencyOnly: boolean
  /**
   * The shard the run is, or `undefined` for a run that isn't sharded.
   */
  shard: Shard | undefined
  /**
   * How the run picked its stories.
   */
  selection: Selection
  /**
   * The Storybooks in the run, in config order. None when the run stopped before its config was loaded.
   */
  storybooks: readonly ReportStorybook[]
  /**
   * What stopped the run, as printed.
   */
  message: string
  /**
   * The Storybooks where nothing answers, in config order.
   */
  unreachable: readonly ReportStorybook[]
  /**
   * Whether the report is written to the report folder.
   */
  written: boolean
}

/**
 * Builds the report of a `test` that exits 2: the error, its message trimmed, with the unreachable Storybooks, and no
 * results. Its `reportDir` is `null` when it isn't written.
 */
export function testErrorReportOf(facts: TestErrorReportFacts): TestReport {
  return testReportOf({
    visualCheck: facts.version,
    consistencyOnly: facts.consistencyOnly,
    exitCode: 2,
    shard: reportShardOf(facts.shard),
    selection: selectionOf(facts.selection),
    reportDir: facts.written ? reportDir : null,
    storybooks: facts.storybooks.map(({ name, url }) => ({ name, url })),
    counts: emptyTestCounts(),
    snapshots: [],
    error: {
      message: facts.message.trim(),
      storybooks: facts.unreachable.map(({ name, url }) => ({ name, url })),
    },
  })
}

/**
 * What an `update` report is built from.
 */
export type UpdateReportFacts = Omit<TestReportFacts, 'consistencyOnly' | 'shard'>

/**
 * Builds the report of an `update` that exits 0 or 1: an entry for each written or broken snapshot, in planned order,
 * then one for each deleted baseline, the counts of every finished snapshot and deleted baseline, and the warnings.
 * Kept baselines are only counted. It has no report folder, since `update` never writes one.
 */
export function updateReportFor(facts: UpdateReportFacts): UpdateReport {
  const { findings } = facts
  const configFolder = dirname(facts.configPath)
  const { results, entries } = listedOf(findings, configFolder, updateEntryOf)
  const deleted = findings.deleted.map(({ storybook, path }) => deletedEntryOf(storybook, path, configFolder))

  return updateReportOf({
    visualCheck: facts.version,
    exitCode: facts.exitCode,
    selection: selectionOf(facts.selection),
    storybooks: facts.storybooks.map(({ name, url }) => ({ name, url })),
    counts: updateCountsOf(results, deleted.length),
    snapshots: [...entries, ...deleted],
    warnings: findings.warnings,
    error: null,
  })
}

/**
 * What the report of an `update` that exits 2 is built from.
 */
export type UpdateErrorReportFacts = Omit<TestErrorReportFacts, 'consistencyOnly' | 'shard' | 'written'>

/**
 * Builds the report of an `update` that exits 2: the error, its message trimmed, with the unreachable Storybooks, and
 * no results or warnings.
 */
export function updateErrorReportOf(facts: UpdateErrorReportFacts): UpdateReport {
  return updateReportOf({
    visualCheck: facts.version,
    exitCode: 2,
    selection: selectionOf(facts.selection),
    storybooks: facts.storybooks.map(({ name, url }) => ({ name, url })),
    counts: emptyUpdateCounts(),
    snapshots: [],
    warnings: [],
    error: {
      message: facts.message.trim(),
      storybooks: facts.unreachable.map(({ name, url }) => ({ name, url })),
    },
  })
}
