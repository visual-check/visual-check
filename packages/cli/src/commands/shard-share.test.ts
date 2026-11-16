import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BaselineError } from '../baselines/baseline-error.js'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import type { Story } from '../storybook/read-stories.js'
import { shardShareOf } from './shard-share.js'

/**
 * The temporary folders the tests made, removed after each test.
 */
const temporaryFolders: string[] = []

/**
 * Makes a temporary folder holding the Storybooks' folders, and returns its real path.
 */
function createFolder(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-shard-')))

  temporaryFolders.push(folder)

  return folder
}

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

/**
 * Builds a Storybook in `<root>/<name>` whose baselines folder holds a baseline for each of `baselines`, by stem.
 */
function storybookOf(root: string, name: string, baselines: readonly string[] = []): ResolvedStorybook {
  const dir = join(root, name)
  const folder = join(dir, '.visual-check', 'baselines')

  mkdirSync(folder, { recursive: true })

  for (const stem of baselines) {
    writeFileSync(join(folder, `${stem}.png`), '')
  }

  return { name, dir, configDir: join(dir, '.storybook'), baselines: folder, url: `http://${name}.test` }
}

/**
 * Builds a story with the given ID in the given stories file.
 */
function storyOf(id: string, importPath: string): Story {
  return { id, title: 'Title', name: id, importPath }
}

/**
 * Gives the IDs of the stories.
 */
function idsOf(stories: readonly Story[]): string[] {
  return stories.map(({ id }) => id)
}

describe('shardShareOf', () => {
  it("narrows every Storybook to the shard's stories files, keeping the rest of each selection", async () => {
    const root = createFolder()
    const web = storybookOf(root, 'web', ['a1', 'a2', 'b1'])
    const docs = storybookOf(root, 'docs', ['d1'])
    const webStories = [
      storyOf('a1', './a.stories.tsx'),
      storyOf('a2', './a.stories.tsx'),
      storyOf('b1', './b.stories.tsx'),
    ]
    const docsStories = [storyOf('d1', './d.stories.tsx')]
    const selections = [
      { storybook: web, version: '10.0.0', stories: webStories, allStories: webStories },
      { storybook: docs, version: '9.1.0', stories: docsStories, allStories: docsStories },
    ]

    const first = await shardShareOf(selections, root, { index: 1, total: 2 })
    const second = await shardShareOf(selections, root, { index: 2, total: 2 })

    expect(first.storiesFiles).toBe(1)
    expect(first.selections.map(({ version, stories }) => [version, idsOf(stories)])).toEqual([
      ['10.0.0', ['a1', 'a2']],
      ['9.1.0', []],
    ])
    expect(first.selections.map(({ allStories }) => idsOf(allStories))).toEqual([['a1', 'a2'], []])
    expect(second.storiesFiles).toBe(2)
    expect(second.selections.map(({ stories }) => idsOf(stories))).toEqual([['b1'], ['d1']])
    expect(second.shard).toEqual({ index: 2, total: 2 })
  })

  it("keeps unselected stories of the shard's files, and deals no file with none selected", async () => {
    const root = createFolder()
    const web = storybookOf(root, 'web')
    const allStories = [
      storyOf('a1', './a.stories.tsx'),
      storyOf('a2', './a.stories.tsx'),
      storyOf('b1', './b.stories.tsx'),
    ]
    const selections = [{ storybook: web, stories: [allStories[0] as Story], allStories }]

    const first = await shardShareOf(selections, root, { index: 1, total: 2 })
    const second = await shardShareOf(selections, root, { index: 2, total: 2 })

    expect(first.storiesFiles).toBe(1)
    expect(idsOf(first.selections[0]?.stories ?? [])).toEqual(['a1'])
    expect(idsOf(first.selections[0]?.allStories ?? [])).toEqual(['a1', 'a2'])
    expect(second.storiesFiles).toBe(0)
    expect(second.selections[0]?.allStories).toEqual([])
  })

  it('weighs each stories file by the baselines its folder holds for its stories', async () => {
    const root = createFolder()
    // ./a.stories.tsx weighs its 3 baselines, ./b.stories.tsx its 2 stories, as they have no baseline yet.
    const web = storybookOf(root, 'web', ['a', 'a.dark', 'a.light'])
    const stories = [
      storyOf('a', './a.stories.tsx'),
      storyOf('b1', './b.stories.tsx'),
      storyOf('b2', './b.stories.tsx'),
    ]
    const selections = [{ storybook: web, stories, allStories: stories }]

    const first = await shardShareOf(selections, root, { index: 1, total: 2 })

    expect(idsOf(first.selections[0]?.stories ?? [])).toEqual(['a'])
  })

  it("throws a BaselineError when a baselines folder can't be listed", async () => {
    const root = createFolder()
    const web = storybookOf(root, 'web')

    rmSync(web.baselines, { recursive: true })
    writeFileSync(web.baselines, '')

    const stories = [storyOf('a', './a.stories.tsx')]

    await expect(
      shardShareOf([{ storybook: web, stories, allStories: stories }], root, { index: 1, total: 1 }),
    ).rejects.toBeInstanceOf(BaselineError)
  })
})
