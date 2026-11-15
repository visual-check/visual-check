import { join } from 'node:path'
import { BaselineError } from '../baselines/baseline-error.js'
import { baselinePathOf, deleteOrphans, hasBaseline, listBaselines, readBaseline } from '../baselines/baseline-files.js'
import { orphansOf } from '../baselines/baseline-set.js'
import { runWorkerPool } from '../capture/worker-pool.js'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import type { VisualDiff } from '../visual-diff/visual-diff.js'
import type { PlannedSnapshot } from './plan-snapshots.js'
import { countsLineOf, displayPathOf } from './run-output.js'

/**
 * One Storybook's orphans, and the baselines its snapshots call for.
 */
export interface StorybookOrphans {
  /**
   * The path of each orphan, in file name order.
   */
  orphans: string[]
  /**
   * The path of every baseline the Storybook's snapshots call for, selected or not, there or not.
   */
  expected: string[]
}

/**
 * What `update` takes and deletes.
 */
interface UpdatePlan {
  /**
   * The snapshots it takes, in the planned order: each selected one, and each one outside the selection that isn't
   * broken and whose baseline is missing.
   */
  snapshots: PlannedSnapshot[]
  /**
   * The orphans it deletes once every snapshot is taken, by Storybook in config order.
   */
  orphans: StorybookOrphans[]
}

/**
 * What `update` did, for the block that ends its output.
 */
interface UpdateSummary {
  /**
   * The path of each baseline written, in the snapshots' order.
   */
  written: string[]
  /**
   * The path of each orphan deleted, in config order, then file name order.
   */
  deleted: string[]
  /**
   * How many baselines were kept untouched.
   */
  kept: number
  /**
   * How many snapshots were broken.
   */
  broken: number
}

/**
 * Reads and decodes each baseline on the visual diff's threads, `concurrency` at once, as a comparison decodes it.
 * Every baseline is checked before the first problem, in the order given, is thrown. A baseline gone since the listing
 * is skipped.
 *
 * @throws {BaselineError} When a baseline can't be read, or can't be decoded, for the first such one.
 */
async function checkDecodable(paths: readonly string[], visualDiff: VisualDiff, concurrency: number): Promise<void> {
  const problems: (BaselineError | undefined)[] = paths.map(() => undefined)

  await runWorkerPool(concurrency, paths, async (path, index) => {
    try {
      const bytes = await readBaseline(path)
      const reason = bytes === undefined ? undefined : await visualDiff.undecodableReasonOf(bytes)

      problems[index] = reason === undefined ? undefined : new BaselineError('decode', path, new Error(reason))
    } catch (error) {
      if (!(error instanceof BaselineError)) {
        throw error
      }

      problems[index] = error
    }
  })

  const first = problems.find((problem) => problem !== undefined)

  if (first !== undefined) {
    throw first
  }
}

/**
 * Lists one Storybook's baselines folder, checks that each baseline decodes, and finds its orphans: the baselines
 * that none of its planned snapshots, selected or not, calls for, apart from any that could belong to a story whose
 * stories file didn't load.
 *
 * @throws {BaselineError} When the folder can't be listed, or a baseline can't be read or decoded, for the first one
 * in file name order.
 */
async function checkFolder(
  storybook: ResolvedStorybook,
  planned: readonly PlannedSnapshot[],
  visualDiff: VisualDiff,
  concurrency: number,
): Promise<StorybookOrphans> {
  const fileNames = await listBaselines(storybook.baselines)

  await checkDecodable(
    fileNames.map((name) => join(storybook.baselines, name)),
    visualDiff,
    concurrency,
  )

  const own = planned.filter((snapshot) => snapshot.storybook === storybook)
  const expectedKeys = own.map(({ key }) => key)
  const unloadedStoryIds = own.flatMap((snapshot) => ('broken' in snapshot ? [snapshot.story.id] : []))

  return {
    orphans: orphansOf({ fileNames, expectedKeys, unloadedStoryIds }).map((name) => join(storybook.baselines, name)),
    expected: expectedKeys.map((key) => baselinePathOf(storybook.baselines, key)),
  }
}

/**
 * Whether `update` takes a planned snapshot: a selected one always, one outside the selection only when it isn't
 * broken and the file system has no baseline at its exact path.
 *
 * @throws {BaselineError} When the baseline's path can't be looked at.
 */
async function isTaken(snapshot: PlannedSnapshot): Promise<boolean> {
  if (snapshot.selected) {
    return true
  }

  if ('broken' in snapshot) {
    return false
  }

  return !(await hasBaseline(baselinePathOf(snapshot.storybook.baselines, snapshot.key)))
}

/**
 * Plans what `update` takes and deletes, before any capture. One Storybook at a time, in the order given, it lists the
 * baselines folder and decodes every baseline in it on the visual diff's threads, reading `concurrency` at once. It
 * takes every selected snapshot, and every snapshot outside the selection that isn't broken and has no baseline, in the
 * planned order. The orphans are the baselines no planned snapshot calls for, selected or not, apart from any that
 * could belong to a story whose stories file didn't load.
 *
 * @throws {BaselineError} When a folder can't be listed, or a baseline can't be read or decoded, for the first such
 * one in config order, then file name order.
 */
export async function planUpdate(
  storybooks: readonly ResolvedStorybook[],
  planned: readonly PlannedSnapshot[],
  visualDiff: VisualDiff,
  concurrency: number,
): Promise<UpdatePlan> {
  const orphans: StorybookOrphans[] = []

  for (const storybook of storybooks) {
    orphans.push(await checkFolder(storybook, planned, visualDiff, concurrency))
  }

  const taken = await Promise.all(planned.map(isTaken))

  return { snapshots: planned.filter((_, index) => taken[index]), orphans }
}

/**
 * Deletes the orphans, Storybook by Storybook in the order given, and gives the paths deleted. An orphan the file
 * system takes for one of its Storybook's expected baselines stays.
 *
 * @throws {BaselineError} When one can't be deleted. The ones after it stay.
 */
export async function deleteStorybookOrphans(storybooks: readonly StorybookOrphans[]): Promise<string[]> {
  const deleted: string[] = []

  for (const { orphans, expected } of storybooks) {
    deleted.push(...(await deleteOrphans(orphans, expected)))
  }

  return deleted
}

/**
 * Builds the block that ends `update`'s output: the counts of written, deleted and kept baselines and broken
 * snapshots, each but the first left out at zero, then `written <path>` for each baseline written, then `deleted
 * <path>` for each orphan deleted, with paths relative to the folder the CLI runs in.
 */
export function updateEndLinesOf(cwd: string, summary: UpdateSummary): string[] {
  const counts = countsLineOf([
    ['written', summary.written.length],
    ['deleted', summary.deleted.length],
    ['kept', summary.kept],
    ['broken', summary.broken],
  ])

  return [
    counts,
    ...summary.written.map((path) => `written ${displayPathOf(cwd, path)}`),
    ...summary.deleted.map((path) => `deleted ${displayPathOf(cwd, path)}`),
  ]
}

/**
 * The longest path, in characters, that Windows takes without git's `core.longpaths`.
 */
const windowsPathLimit = 260

/**
 * Builds the warning for the baselines `update` wrote on Windows whose paths are longer than 260 characters, which git
 * there checks out only with `core.longpaths` set: a sentence with the fix, then one line for each such path, in
 * written order, relative to the folder the CLI runs in. Each line ends with a newline. Gives an empty string on any
 * other OS, or when no path is that long.
 */
export function longPathWarningOf(os: NodeJS.Platform, cwd: string, written: readonly string[]): string {
  const tooLong = written.filter((path) => path.length > windowsPathLimit)

  if (os !== 'win32' || tooLong.length === 0) {
    return ''
  }

  const lines = [
    "These baselines' paths are longer than 260 characters, which git on Windows checks out only with " +
      'core.longpaths set. Run git config core.longpaths true.',
    ...tooLong.map((path) => `  ${displayPathOf(cwd, path)}`),
  ]

  return lines.map((line) => `${line}\n`).join('')
}
