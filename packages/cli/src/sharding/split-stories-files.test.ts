import { describe, expect, it } from 'vitest'
import type { Story } from '../storybook/read-stories.js'
import { deal, type StorybookToSplit, storiesFilesOfShard } from './split-stories-files.js'

/**
 * The folder of the config file every test's Storybooks sit in or under.
 */
const configFolder = '/project'

/**
 * Builds a story of a stories file, with a title and name that don't matter to the split.
 */
function storyOf(id: string, importPath: string): Story {
  return { id, title: id, name: id, importPath }
}

/**
 * Builds a stories file's stories, `<file>--story-1` and so on, so that each has its own ID.
 */
function storiesOf(file: string, count: number): Story[] {
  return Array.from({ length: count }, (_, index) => storyOf(`${file}--story-${index + 1}`, `./${file}.stories.ts`))
}

/**
 * Builds the baseline file names of a story's default capture and its modes, `<story-id>.png` then
 * `<story-id>.mode-1.png` and so on, `count` in all.
 */
function baselinesOf(storyId: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => (index === 0 ? `${storyId}.png` : `${storyId}.mode-${index}.png`))
}

/**
 * Gives every shard's stories files, from 1 to `total`, each as a sorted list per Storybook.
 */
function everyShardOf(storybooks: readonly StorybookToSplit[], total: number): string[][][] {
  return Array.from({ length: total }, (_, index) =>
    storiesFilesOfShard(storybooks, configFolder, { index: index + 1, total }).map((files) => [...files].sort()),
  )
}

/**
 * A Storybook of fourteen stories files of different sizes. Most have baselines, some for their modes too, and two
 * have none yet.
 */
function realisticStorybook(): StorybookToSplit {
  const sizes = [
    { file: 'button', stories: 6, baselinesPerStory: 2 },
    { file: 'card', stories: 4, baselinesPerStory: 3 },
    { file: 'dialog', stories: 3, baselinesPerStory: 1 },
    { file: 'form', stories: 8, baselinesPerStory: 1 },
    { file: 'grid', stories: 1, baselinesPerStory: 5 },
    { file: 'icon', stories: 12, baselinesPerStory: 1 },
    { file: 'input', stories: 5, baselinesPerStory: 2 },
    { file: 'link', stories: 2, baselinesPerStory: 1 },
    { file: 'menu', stories: 3, baselinesPerStory: 0 },
    { file: 'modal', stories: 2, baselinesPerStory: 2 },
    { file: 'select', stories: 4, baselinesPerStory: 1 },
    { file: 'table', stories: 7, baselinesPerStory: 1 },
    { file: 'tabs', stories: 1, baselinesPerStory: 0 },
    { file: 'tooltip', stories: 2, baselinesPerStory: 1 },
  ]
  const stories = sizes.flatMap(({ file, stories: count }) => storiesOf(file, count))
  const baselineFileNames = sizes.flatMap(({ file, stories: count, baselinesPerStory }) =>
    storiesOf(file, count).flatMap((story) => baselinesOf(story.id, baselinesPerStory)),
  )

  return { dir: configFolder, stories, baselineFileNames }
}

describe('storiesFilesOfShard', () => {
  it('deals the heaviest file first, each to the shard with the lowest total so far', () => {
    const stories = [...storiesOf('a', 1), ...storiesOf('b', 1), ...storiesOf('c', 1)]
    const baselineFileNames = [
      ...baselinesOf('a--story-1', 3),
      ...baselinesOf('b--story-1', 1),
      ...baselinesOf('c--story-1', 2),
    ]

    expect(everyShardOf([{ dir: configFolder, stories, baselineFileNames }], 2)).toEqual([
      [['./a.stories.ts']],
      [['./b.stories.ts', './c.stories.ts']],
    ])
  })

  it('weighs a file with no baselines by its number of stories', () => {
    const stories = [...storiesOf('x', 3), ...storiesOf('y', 1), ...storiesOf('z', 1)]
    const baselineFileNames = [...baselinesOf('y--story-1', 2), ...baselinesOf('z--story-1', 1)]

    expect(everyShardOf([{ dir: configFolder, stories, baselineFileNames }], 2)).toEqual([
      [['./x.stories.ts']],
      [['./y.stories.ts', './z.stories.ts']],
    ])
  })

  it('weighs a file with baselines by its baselines, not its stories', () => {
    const stories = [...storiesOf('few', 1), ...storiesOf('many', 3), ...storiesOf('plain', 1)]
    const baselineFileNames = [...baselinesOf('few--story-1', 2), ...baselinesOf('many--story-1', 1)]

    expect(everyShardOf([{ dir: configFolder, stories, baselineFileNames }], 2)).toEqual([
      [['./few.stories.ts']],
      [['./many.stories.ts', './plain.stories.ts']],
    ])
  })

  it("doesn't weigh a file by a neighbour's baselines", () => {
    const stories = [...storiesOf('a', 2), ...storiesOf('b', 1)]
    const baselineFileNames = ['a--story-1.png', 'gone.png', 'gone.dark.png', 'b--story-1.png', 'b--story-1-x.png']

    expect(everyShardOf([{ dir: configFolder, stories, baselineFileNames }], 2)).toEqual([
      [['./a.stories.ts']],
      [['./b.stories.ts']],
    ])
  })

  it('breaks a tie between files of the same weight by path, in code unit order', () => {
    const stories = [...storiesOf('b', 1), ...storiesOf('a', 1), ...storiesOf('B', 1)]

    expect(everyShardOf([{ dir: configFolder, stories, baselineFileNames: [] }], 3)).toEqual([
      [['./B.stories.ts']],
      [['./a.stories.ts']],
      [['./b.stories.ts']],
    ])
  })

  it('gives a file the lowest shard when several have the same lowest total', () => {
    const stories = [...storiesOf('a', 2), ...storiesOf('b', 1), ...storiesOf('c', 1)]

    expect(everyShardOf([{ dir: configFolder, stories, baselineFileNames: [] }], 3)).toEqual([
      [['./a.stories.ts']],
      [['./b.stories.ts']],
      [['./c.stories.ts']],
    ])
  })

  it('splits the files of several Storybooks together, in config order, telling apart files of the same importPath', () => {
    const web = {
      dir: `${configFolder}/web`,
      stories: [...storiesOf('button', 1), ...storiesOf('card', 1)],
      baselineFileNames: [],
    }
    const docs = { dir: `${configFolder}/docs`, stories: storiesOf('button', 1), baselineFileNames: [] }

    expect(everyShardOf([web, docs], 2)).toEqual([
      [['./card.stories.ts'], ['./button.stories.ts']],
      [['./button.stories.ts'], []],
    ])
  })

  it('leaves the shards after the last file empty when there are more shards than files', () => {
    const stories = [...storiesOf('a', 1), ...storiesOf('b', 1)]

    expect(everyShardOf([{ dir: configFolder, stories, baselineFileNames: [] }], 4)).toEqual([
      [['./a.stories.ts']],
      [['./b.stories.ts']],
      [[]],
      [[]],
    ])
  })

  it('deals every file to exactly one shard', () => {
    const storybook = realisticStorybook()
    const files = [...new Set(storybook.stories.map((story) => story.importPath))].sort()

    for (const total of [1, 2, 3, 4, 7, 20]) {
      const dealt = everyShardOf([storybook], total).flatMap(([shardFiles]) => shardFiles ?? [])

      expect(dealt.sort()).toEqual(files)
    }
  })

  it('works out the same split from the same stories and baselines, in any order', () => {
    const storybook = realisticStorybook()
    const reversed = {
      dir: storybook.dir,
      stories: [...storybook.stories].reverse(),
      baselineFileNames: [...storybook.baselineFileNames].reverse(),
    }

    expect(everyShardOf([reversed], 4)).toEqual(everyShardOf([storybook], 4))
  })
})

describe('deal', () => {
  /**
   * Gives each shard's total weight after the deal.
   */
  function totalsOf(weights: readonly number[], total: number): number[] {
    return deal(
      weights.map((weight) => ({ weight })),
      total,
    ).map((hand) => hand.reduce((sum, { weight }) => sum + weight, 0))
  }

  it('keeps every total within the heaviest weight of every other', () => {
    const weights = [24, 20, 13, 12, 10, 10, 8, 8, 7, 4, 4, 3, 2, 1]
    const heaviest = Math.max(...weights)

    expect(totalsOf(weights, 3)).toEqual([42, 42, 42])

    for (const total of [2, 3, 4, 5]) {
      const totals = totalsOf(weights, total)

      expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(heaviest)
    }
  })
})
