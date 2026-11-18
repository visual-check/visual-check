import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FindReachedFiles } from '../affected-stories/fallow-graph.js'
import { commit, isolateGit, makeRepo, removeRepos, writeFiles } from '../affected-stories/git-repo.fixture.js'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import type { Story } from '../storybook/read-stories.js'
import { effectiveSelectionOf, emptySelectionNotesOf, fallbackWarningOf, workOutRunSelection } from './run-selection.js'

/**
 * A Storybook in the run.
 */
const storybook: ResolvedStorybook = {
  name: 'web',
  dir: '/project',
  configDir: '/project/.storybook',
  baselines: '/project/.visual-check/baselines',
  url: 'http://web.test',
}

/**
 * Builds a story with the given ID in the given stories file.
 */
function storyOf(id: string, importPath: string): Story {
  return { id, title: 'Title', name: 'Name', importPath }
}

/**
 * Two stories of a button and one of a card.
 */
const stories = [
  storyOf('button--primary', './button.stories.tsx'),
  storyOf('button--secondary', './button.stories.tsx'),
  storyOf('card--primary', './card.stories.tsx'),
]

/**
 * A run that is local, not a shard and not `test --consistency`.
 */
const localRun = { ci: false, sharded: false, consistencyOnly: false }

describe('effectiveSelectionOf', () => {
  it('covers the affected stories with no selection flag, locally', () => {
    expect(effectiveSelectionOf({ kind: 'default' }, localRun)).toEqual({ kind: 'affected' })
  })

  it.each([
    ['in CI', { ...localRun, ci: true }],
    ['for a shard', { ...localRun, sharded: true }],
    ['for test --consistency', { ...localRun, consistencyOnly: true }],
  ])('covers every story with no selection flag %s', (_name, run) => {
    expect(effectiveSelectionOf({ kind: 'default' }, run)).toEqual({ kind: 'all' })
  })

  it.each([{ kind: 'all' }, { kind: 'affected' }, { kind: 'filter', pattern: /button/ }] as const)(
    'keeps the selection a flag gives, %j, locally and in CI',
    (selection) => {
      expect(effectiveSelectionOf(selection, localRun)).toBe(selection)
      expect(effectiveSelectionOf(selection, { ...localRun, ci: true })).toBe(selection)
    },
  )
})

describe('fallbackWarningOf', () => {
  it('gives no warning when the affected stories were worked out', () => {
    expect(fallbackWarningOf(null)).toBe('')
  })

  it('says why every story is covered, on a line of its own', () => {
    expect(fallbackWarningOf("the folder isn't in a git repository")).toBe(
      "Warning: visual-check can't work out the affected stories, so it covers every story: " +
        "the folder isn't in a git repository.\n",
    )
  })
})

describe('emptySelectionNotesOf', () => {
  /**
   * What a run that selected nothing takes in the one Storybook.
   */
  const nothing = [{ storybook, version: '10.0.0', stories: [], allStories: stories }]
  /**
   * The SHA of the base.
   */
  const base = '0123456789abcdef0123456789abcdef01234567'

  it('says no file changed since the base, by its short SHA, and hints at --all', () => {
    expect(emptySelectionNotesOf({ base, changedFiles: 0, fallback: null, storybooks: [] }, nothing)).toEqual([
      'No files changed since 0123456, so no story is affected. Run with --all to cover every story.',
    ])
  })

  it('says the one changed file affects no story', () => {
    expect(emptySelectionNotesOf({ base, changedFiles: 1, fallback: null, storybooks: [] }, nothing)).toEqual([
      'The changed file affects no story. Run with --all to cover every story.',
    ])
  })

  it('counts the changed files when none affects a story', () => {
    expect(emptySelectionNotesOf({ base, changedFiles: 3, fallback: null, storybooks: [] }, nothing)).toEqual([
      'None of the 3 changed files affects a story. Run with --all to cover every story.',
    ])
  })

  it('gives no note when a Storybook has a selected story', () => {
    const other = { ...storybook, name: 'docs' }
    const selections = [...nothing, { storybook: other, version: '10.0.0', stories, allStories: stories }]

    expect(emptySelectionNotesOf({ base, changedFiles: 3, fallback: null, storybooks: [] }, selections)).toEqual([])
  })

  it('gives no note when the run fell back to every story', () => {
    expect(
      emptySelectionNotesOf({ base, changedFiles: 3, fallback: 'Fallow failed', storybooks: [] }, nothing),
    ).toEqual([])
  })
})

describe('workOutRunSelection', () => {
  /**
   * The input of a run in a folder that git never reads, whose graph fails the test if it's asked.
   */
  const input = {
    baseRef: undefined,
    environment: {},
    cwd: '/nowhere',
    storybooks: [{ storybook, version: '10.0.0', stories }],
    configPath: '/nowhere/visual-check.config.ts',
    affected: { selectAll: [], ignore: [] },
    findReachedFiles: () => Promise.reject(new Error('The run asked for the import graph.')),
  }

  it('keeps every story for all, working nothing out', async () => {
    expect(await workOutRunSelection({ ...input, selection: { kind: 'all' } })).toEqual({
      selections: [{ storybook, version: '10.0.0', stories, allStories: stories }],
      report: { by: 'all', base: null, changedFiles: null, fallback: null },
      warning: '',
      notes: [],
    })
  })

  it('keeps the stories a filter matches, working nothing out', async () => {
    const result = await workOutRunSelection({ ...input, selection: { kind: 'filter', pattern: /^card/ } })

    expect(result.selections.map((selection) => selection.stories.map((story) => story.id))).toEqual([
      ['card--primary'],
    ])
    expect(result.selections[0]?.allStories).toBe(stories)
    expect(result.report).toEqual({ by: 'filter', base: null, changedFiles: null, fallback: null })
  })
})

describe('workOutRunSelection for affected', () => {
  beforeEach(() => {
    isolateGit()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    removeRepos()
  })

  /**
   * Makes a git repository whose one Storybook lists the button and card stories, with the button's component and a
   * Storybook config folder, all committed, then changes the button's component. Returns the input of an affected run
   * in it, with the graph given, and the commit's SHA.
   */
  function affectedRunIn(findReachedFiles: FindReachedFiles): {
    input: Parameters<typeof workOutRunSelection>[0]
    head: string
    repo: string
  } {
    const repo = makeRepo()
    const head = commit(repo, {
      '.storybook/main.ts': 'export default {}\n',
      'button.tsx': 'export const Button = 1\n',
      'button.stories.tsx': '',
      'card.stories.tsx': '',
    })

    writeFiles(repo, { 'button.tsx': 'export const Button = 2\n' })

    const storybookInRepo = {
      ...storybook,
      dir: repo,
      configDir: join(repo, '.storybook'),
      baselines: join(repo, '.visual-check/baselines'),
    }

    return {
      input: {
        selection: { kind: 'affected' },
        baseRef: undefined,
        environment: {},
        cwd: repo,
        storybooks: [{ storybook: storybookInRepo, version: '10.0.0', stories }],
        configPath: join(repo, 'visual-check.config.ts'),
        affected: { selectAll: [], ignore: [] },
        findReachedFiles,
      },
      head,
      repo,
    }
  }

  it('keeps the stories of the stories files the changed files reach, asking the graph once', async () => {
    const calls: (readonly string[])[] = []
    const { input, head } = affectedRunIn(async (_root, files) => {
      calls.push(files)

      return { reached: new Set(['button.tsx', 'button.stories.tsx']), reachedFromFolders: () => new Set<string>() }
    })
    const result = await workOutRunSelection(input)

    expect(calls).toEqual([['button.tsx']])
    expect(result.selections.map((selection) => selection.stories.map((story) => story.id))).toEqual([
      ['button--primary', 'button--secondary'],
    ])
    expect(result.selections[0]?.allStories).toBe(stories)
    expect(result).toMatchObject({
      report: { by: 'affected', base: head, changedFiles: 1, fallback: null },
      warning: '',
      notes: [],
    })
  })

  it("keeps a changed baseline's story beside the stories of the reached stories files", async () => {
    const { input, repo } = affectedRunIn(async () => ({
      reached: new Set(['button.tsx', 'button.stories.tsx']),
      reachedFromFolders: () => new Set<string>(),
    }))

    writeFiles(repo, { '.visual-check/baselines/card--primary.png': 'png' })

    const result = await workOutRunSelection(input)

    expect(result.selections.map((selection) => selection.stories.map((story) => story.id))).toEqual([
      ['button--primary', 'button--secondary', 'card--primary'],
    ])
  })

  it('keeps no story when every changed file matches affected.ignore', async () => {
    const { input } = affectedRunIn(() => Promise.reject(new Error('The run asked for the import graph.')))
    const result = await workOutRunSelection({ ...input, affected: { selectAll: [], ignore: ['*.tsx'] } })

    expect(result.selections[0]?.stories).toEqual([])
    expect(result.notes).toEqual(['The changed file affects no story. Run with --all to cover every story.'])
  })

  it('notes that the changed file affects no story when the graph reaches no stories file', async () => {
    const { input } = affectedRunIn(async () => ({
      reached: new Set(['button.tsx']),
      reachedFromFolders: () => new Set<string>(),
    }))
    const result = await workOutRunSelection(input)

    expect(result.selections[0]?.stories).toEqual([])
    expect(result.notes).toEqual(['The changed file affects no story. Run with --all to cover every story.'])
  })

  it("keeps every story, with a warning that says why, when the graph can't answer", async () => {
    const { input, head } = affectedRunIn(async () => ({ cantAnswer: 'Fallow failed' }))
    const result = await workOutRunSelection(input)

    expect(result.selections[0]?.stories).toEqual(stories)
    expect(result.report).toEqual({ by: 'affected', base: head, changedFiles: 1, fallback: 'Fallow failed' })
    expect(result.warning).toBe(fallbackWarningOf('Fallow failed'))
    expect(result.notes).toEqual([])
  })
})
