import { listBaselines } from '../baselines/baseline-files.js'
import type { Shard } from '../sharding/shard.js'
import { type StorybookToSplit, storiesFilesOfShard } from '../sharding/split-stories-files.js'
import type { Story } from '../storybook/read-stories.js'
import type { StorybookStories } from './plan-snapshots.js'

/**
 * One shard's share of a run.
 */
export interface ShardShare<Selection extends StorybookStories> {
  /**
   * The shard.
   */
  shard: Shard
  /**
   * Each Storybook, in the order given, narrowed to the stories files dealt to the shard.
   */
  selections: Selection[]
  /**
   * How many stories files were dealt to the shard, across every Storybook.
   */
  storiesFiles: number
}

/**
 * Works out a shard's share of a run from each Storybook's selected stories and baselines folder, with no browser. The
 * stories files of every Storybook are split together, each weighed by the selected stories in it, so a file with no
 * selected story is dealt to no shard. Gives each Storybook, in the order given, with only the stories in the shard's
 * stories files, both of its selected stories and of every story its `index.json` lists. So the options read loads
 * only the shard's files, and a Storybook with no file in the shard isn't read at all.
 *
 * @throws {BaselineError} When a baselines folder can't be listed, the first one in the order given.
 */
export async function shardShareOf<Selection extends StorybookStories>(
  selections: readonly Selection[],
  configFolder: string,
  shard: Shard,
): Promise<ShardShare<Selection>> {
  const storybooks: StorybookToSplit[] = []

  for (const { storybook, stories } of selections) {
    storybooks.push({ dir: storybook.dir, stories, baselineFileNames: await listBaselines(storybook.baselines) })
  }

  const filesByStorybook = storiesFilesOfShard(storybooks, configFolder, shard)

  return {
    shard,
    selections: selections.map((selection, index) => {
      const files = filesByStorybook[index] ?? new Set<string>()
      const inShare = (story: Story) => files.has(story.importPath)

      return {
        ...selection,
        stories: selection.stories.filter(inShare),
        allStories: selection.allStories.filter(inShare),
      }
    }),
    storiesFiles: filesByStorybook.reduce((count, files) => count + files.size, 0),
  }
}

/**
 * Writes a shard as `k/n`, such as `2/4`.
 */
function shardLabelOf({ index, total }: Shard): string {
  return `${index}/${total}`
}

/**
 * Builds the header's part for a shard, such as ` · shard 2/4 · 12 stories files`, or nothing for a run that isn't
 * sharded.
 */
export function shardHeaderPartOf(share: ShardShare<StorybookStories> | undefined): string {
  if (share === undefined) {
    return ''
  }

  const files = `${share.storiesFiles} ${share.storiesFiles === 1 ? 'stories file' : 'stories files'}`

  return ` · shard ${shardLabelOf(share.shard)} · ${files}`
}

/**
 * Gives the notes a shard prints after its header: that it leaves the consistency check to `test --consistency`, then,
 * when it takes none of the run's `count` snapshots, that it has nothing to capture. Gives none for a run that isn't
 * sharded.
 */
export function shardNotesOf(share: ShardShare<StorybookStories> | undefined, count: number): string[] {
  if (share === undefined) {
    return []
  }

  const nothing = count === 0 ? [`Shard ${shardLabelOf(share.shard)} has nothing to capture.`] : []

  return ['Missing baselines and orphans are left to test --consistency.', ...nothing]
}
