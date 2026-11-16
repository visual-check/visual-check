import { join } from 'node:path'
import { baselinePathOf, expectedBaselinesAt, listBaselines } from '../baselines/baseline-files.js'
import { orphansOf } from '../baselines/baseline-set.js'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import type { PlannedSnapshot } from './plan-snapshots.js'

/**
 * One Storybook's baselines folder, set against the snapshots its stories and config call for.
 */
export interface StorybookBaselines {
  /**
   * The Storybook.
   */
  storybook: ResolvedStorybook
  /**
   * The path of every baseline in its folder, in file name order.
   */
  paths: string[]
  /**
   * The path of each orphan, in file name order: a baseline that none of its planned snapshots, selected or not, calls
   * for, apart from any that could belong to a story whose stories file didn't load, and any the file system takes for
   * an expected baseline.
   */
  orphans: string[]
  /**
   * The path of every baseline its planned snapshots call for, selected or not, there or not.
   */
  expected: string[]
}

/**
 * What the baselines folders hold, set against the planned snapshots.
 */
export interface ConsistencyCheck {
  /**
   * Each Storybook's baselines, in the order the Storybooks were given.
   */
  storybooks: StorybookBaselines[]
  /**
   * The planned snapshots of the given Storybooks, in planned order, selected or not and broken ones included, that
   * have no file at the exact path of their baseline. The file system decides, so on macOS a file whose name differs
   * only in case or in how an accented letter is encoded counts as there.
   */
  missing: ReadonlySet<PlannedSnapshot>
}

/**
 * What the check finds in one Storybook's baselines folder.
 */
interface FolderCheck {
  /**
   * The Storybook's baselines, orphans and expected paths.
   */
  baselines: StorybookBaselines
  /**
   * Its planned snapshots with no file at their baseline's exact path.
   */
  missing: PlannedSnapshot[]
}

/**
 * Lists one Storybook's baselines folder, then looks at its expected baselines once, to find both its orphans and its
 * snapshots with a missing baseline. It doesn't decode any baseline.
 *
 * @throws {BaselineError} When the folder can't be listed, or an orphan or an expected baseline can't be looked at.
 */
async function folderCheckOf(storybook: ResolvedStorybook, own: readonly PlannedSnapshot[]): Promise<FolderCheck> {
  const fileNames = await listBaselines(storybook.baselines)
  const expectedKeys = own.map(({ key }) => key)
  const unloadedStoryIds = own.flatMap((snapshot) => ('broken' in snapshot ? [snapshot.story.id] : []))
  const expected = expectedKeys.map((key) => baselinePathOf(storybook.baselines, key))
  const orphanCandidates = orphansOf({ fileNames, expectedKeys, unloadedStoryIds }).map((name) =>
    join(storybook.baselines, name),
  )
  const looked = await expectedBaselinesAt(expected)

  return {
    baselines: {
      storybook,
      paths: fileNames.map((name) => join(storybook.baselines, name)),
      orphans: await looked.pathsNotExpected(orphanCandidates),
      expected,
    },
    missing: own.filter((_, index) => !looked.present[index]),
  }
}

/**
 * Sets the baselines folders against the planned snapshots, before any capture: lists each Storybook's folder, in the
 * order given, and finds the orphans, the baselines no planned snapshot calls for, and the missing baselines, the
 * planned snapshots whose baseline isn't there. Selected and unselected snapshots count alike, and so do broken ones,
 * whose key is the story ID. Snapshots of a Storybook that isn't given are left out. A missing folder holds no
 * baselines. It reads no baseline's bytes, so it doesn't decode.
 *
 * @throws {BaselineError} When a folder can't be listed, for the first such one in the order given. Otherwise, when a
 * baseline's path can't be looked at, for one of the paths that can't be.
 */
export async function checkConsistency(
  storybooks: readonly ResolvedStorybook[],
  planned: readonly PlannedSnapshot[],
): Promise<ConsistencyCheck> {
  const checked: StorybookBaselines[] = []
  const missing = new Set<PlannedSnapshot>()

  for (const storybook of storybooks) {
    const folder = await folderCheckOf(
      storybook,
      planned.filter((snapshot) => snapshot.storybook === storybook),
    )

    checked.push(folder.baselines)

    for (const snapshot of folder.missing) {
      missing.add(snapshot)
    }
  }

  return { storybooks: checked, missing: new Set(planned.filter((snapshot) => missing.has(snapshot))) }
}

/**
 * Whether any Storybook's baselines folder holds an orphan.
 */
export function hasOrphans(storybooks: readonly StorybookBaselines[]): boolean {
  return storybooks.some(({ orphans }) => orphans.length > 0)
}

/**
 * Whether the check found nothing: no planned snapshot with a missing baseline, no story whose stories file failed to
 * load, and no orphan. A local `test`'s exit code comes from its snapshots' statuses and `hasOrphans`, which agree with
 * this because every finding is taken locally.
 */
export function isConsistent(check: ConsistencyCheck, planned: readonly PlannedSnapshot[]): boolean {
  return !hasOrphans(check.storybooks) && !planned.some((item) => 'broken' in item || check.missing.has(item))
}
