import { relative, resolve, sep } from 'node:path'
import { baselineCountsOf } from '../baselines/baseline-set.js'
import type { Story } from '../storybook/read-stories.js'
import type { Shard } from './shard.js'

/**
 * One Storybook's part in a split: what its index lists and what its baselines folder holds.
 *
 * @public
 */
export interface StorybookToSplit {
  /**
   * The Storybook's folder, which its stories' `importPath`s are relative to.
   */
  dir: string
  /**
   * The stories to split, each with the stories file it's in.
   */
  stories: readonly Story[]
  /**
   * The name of each baseline in the Storybook's baselines folder, each ending in `.png`.
   */
  baselineFileNames: readonly string[]
}

/**
 * One stories file of one Storybook, weighed for the deal.
 */
interface StoriesFile {
  /**
   * Where the file's Storybook is in the config's list of Storybooks.
   */
  storybookIndex: number
  /**
   * The file's path relative to its Storybook's folder, as the Storybook's index gives it.
   */
  importPath: string
  /**
   * The file's path relative to the config file's folder, `/`-separated on every OS, which breaks a tie between files
   * of the same weight.
   */
  path: string
  /**
   * How much capturing the file takes: the number of baselines its stories own, or its number of stories when they own
   * none.
   */
  weight: number
}

/**
 * Gives one Storybook's stories files, each weighed by the baselines its stories own, or by its number of stories when
 * they own none.
 */
function storiesFilesOf(storybook: StorybookToSplit, storybookIndex: number, configFolder: string): StoriesFile[] {
  const baselineCounts = baselineCountsOf(
    storybook.baselineFileNames,
    storybook.stories.map((story) => story.id),
  )
  const files = new Map<string, { stories: number; baselines: number }>()

  for (const { id, importPath } of storybook.stories) {
    const file = files.get(importPath) ?? { stories: 0, baselines: 0 }

    files.set(importPath, { stories: file.stories + 1, baselines: file.baselines + (baselineCounts.get(id) ?? 0) })
  }

  return [...files].map(([importPath, { stories, baselines }]) => ({
    storybookIndex,
    importPath,
    path: relative(configFolder, resolve(storybook.dir, importPath)).split(sep).join('/'),
    weight: baselines > 0 ? baselines : stories,
  }))
}

/**
 * Orders stories files for the deal: heaviest first, then by path in code unit order, which is the same on every
 * machine, unlike a locale's order.
 */
function dealOrder(first: StoriesFile, second: StoriesFile): number {
  if (first.weight !== second.weight) {
    return second.weight - first.weight
  }

  if (first.path === second.path) {
    return 0
  }

  return first.path < second.path ? -1 : 1
}

/**
 * Deals the items, in the order given, across `total` shards: each to the shard with the lowest total weight so far,
 * the lowest shard on a tie. Gives each shard's items, from shard 1 to shard `total`, some empty when there are fewer
 * items than shards. No shard's total ends up more than the heaviest item's weight above another's.
 */
export function deal<Item extends { weight: number }>(items: readonly Item[], total: number): Item[][] {
  const hands = Array.from({ length: total }, () => ({ items: [] as Item[], weight: 0 }))

  for (const item of items) {
    const lightest = hands.reduce((lowest, hand) => (hand.weight < lowest.weight ? hand : lowest))

    lightest.items.push(item)
    lightest.weight += item.weight
  }

  return hands.map((hand) => hand.items)
}

/**
 * Works out one shard's share of the stories files of every Storybook. Each shard works it out alone from the same
 * stories and baselines, so the split has to come out the same on every machine. A stories file is dealt whole, with
 * all its stories and their modes. It weighs the number of baselines its stories own, or its number of stories when
 * they own none yet, and an orphan weighs nothing. The files of every Storybook are dealt together, heaviest first, to
 * the shard with the lowest total so far, the lowest shard on a tie. Files of the same weight go by their path
 * relative to the config file's folder, so two Storybooks' files of the same `importPath` are told apart. Gives, for
 * each Storybook in the order given, the `importPath`s of the stories files dealt to the shard, none when there are
 * more shards than files. The shard's `index` must be from 1 to its `total`.
 *
 * @public
 */
export function storiesFilesOfShard(
  storybooks: readonly StorybookToSplit[],
  configFolder: string,
  shard: Shard,
): ReadonlySet<string>[] {
  const files = storybooks
    .flatMap((storybook, storybookIndex) => storiesFilesOf(storybook, storybookIndex, configFolder))
    .sort(dealOrder)
  const shares = storybooks.map(() => new Set<string>())

  for (const file of deal(files, shard.total)[shard.index - 1] ?? []) {
    shares[file.storybookIndex]?.add(file.importPath)
  }

  return shares
}
