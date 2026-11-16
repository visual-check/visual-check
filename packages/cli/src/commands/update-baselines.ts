import { BaselineError } from '../baselines/baseline-error.js'
import { deleteOrphans, readBaseline } from '../baselines/baseline-files.js'
import { runWorkerPool } from '../capture/worker-pool.js'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import type { VisualDiff } from '../visual-diff/visual-diff.js'
import { checkConsistency, type StorybookBaselines } from './consistency-check.js'
import type { PlannedSnapshot } from './plan-snapshots.js'
import { countsLineOf, displayPathOf } from './run-output.js'

/**
 * What `update` takes and deletes.
 */
interface UpdatePlan {
  /**
   * The snapshots it takes, in the planned order: each selected one, and each one outside the selection whose
   * baseline is missing, a broken one included.
   */
  snapshots: PlannedSnapshot[]
  /**
   * The orphans it deletes once every snapshot is taken, by Storybook in config order.
   */
  orphans: StorybookBaselines[]
}

/**
 * A baseline `update` deleted: an orphan, with its Storybook.
 *
 * @public
 */
export interface DeletedBaseline {
  /**
   * The Storybook whose baselines folder held it.
   */
  storybook: ResolvedStorybook
  /**
   * Its path.
   */
  path: string
}

/**
 * What `update` did, for the counts and path lines of the block that ends its output.
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
async function checkBaselinesDecode(
  paths: readonly string[],
  visualDiff: VisualDiff,
  concurrency: number,
): Promise<void> {
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
 * Plans what `update` takes and deletes, before any capture. One Storybook at a time, in the order given, it runs the
 * consistency check of its baselines folder, then decodes every baseline in it on the visual diff's threads, reading
 * `concurrency` at once. It goes one Storybook at a time so that a Storybook's undecodable baseline is reported before
 * the next one's folder that can't be listed. It takes every selected snapshot, and every snapshot outside the
 * selection that has no baseline, a broken one included, in the planned order. The orphans are the baselines no planned
 * snapshot calls for, selected or not, apart from any that could belong to a story whose stories file didn't load, and
 * any the file system takes for an expected baseline.
 *
 * @throws {BaselineError} When a folder can't be listed, or a baseline can't be read or decoded, for the first such
 * one in config order, then file name order. Or when a baseline's path can't be looked at, for one of the paths that
 * can't be.
 */
export async function planUpdate(
  storybooks: readonly ResolvedStorybook[],
  planned: readonly PlannedSnapshot[],
  visualDiff: VisualDiff,
  concurrency: number,
): Promise<UpdatePlan> {
  const orphans: StorybookBaselines[] = []
  const missing = new Set<PlannedSnapshot>()

  for (const storybook of storybooks) {
    const own = planned.filter((snapshot) => snapshot.storybook === storybook)
    const check = await checkConsistency([storybook], own)

    await checkBaselinesDecode(
      check.storybooks.flatMap(({ paths }) => paths),
      visualDiff,
      concurrency,
    )

    orphans.push(...check.storybooks)

    for (const snapshot of check.missing) {
      missing.add(snapshot)
    }
  }

  return { snapshots: planned.filter((snapshot) => snapshot.selected || missing.has(snapshot)), orphans }
}

/**
 * Deletes the orphans, Storybook by Storybook in the order given, and gives the baselines deleted, each with its
 * Storybook. An orphan the file system takes for one of its Storybook's expected baselines stays.
 *
 * @throws {BaselineError} When one can't be deleted. The ones after it stay.
 */
export async function deleteStorybookOrphans(storybooks: readonly StorybookBaselines[]): Promise<DeletedBaseline[]> {
  const deleted: DeletedBaseline[] = []

  for (const { storybook, orphans, expected } of storybooks) {
    deleted.push(...(await deleteOrphans(orphans, expected)).map((path) => ({ storybook, path })))
  }

  return deleted
}

/**
 * Builds the counts and path lines that open the block ending `update`'s output, which the flaky snapshots follow: the
 * counts of written, deleted and kept baselines and broken snapshots, each but the first left out at zero, then
 * `written <path>` for each baseline written, then `deleted <path>` for each orphan deleted, with paths relative to the
 * folder the CLI runs in.
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
