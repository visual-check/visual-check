import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ReadStoriesMatchers, traceChanges } from '../affected-stories/affected-stories.js'
import type { FindReachedFiles } from '../affected-stories/fallow-graph.js'
import { commit, isolateGit, makeRepo, removeRepos, writeFiles } from '../affected-stories/git-repo.fixture.js'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import type { Story } from '../storybook/read-stories.js'
import {
  effectiveSelectionOf,
  emptySelectionNotesOf,
  fallbackWarningOf,
  leftOutNotesOf,
  workOutRequiredStorybooks,
  workOutRunSelection,
} from './run-selection.js'

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
    expect(emptySelectionNotesOf({ base, changedFiles: 0, fallback: null }, nothing)).toEqual([
      'No files changed since 0123456, so no story is affected. Run with --all to cover every story.',
    ])
  })

  it('says the one changed file affects no story', () => {
    expect(emptySelectionNotesOf({ base, changedFiles: 1, fallback: null }, nothing)).toEqual([
      'The changed file affects no story. Run with --all to cover every story.',
    ])
  })

  it('counts the changed files when none affects a story', () => {
    expect(emptySelectionNotesOf({ base, changedFiles: 3, fallback: null }, nothing)).toEqual([
      'None of the 3 changed files affects a story. Run with --all to cover every story.',
    ])
  })

  it('gives no note when a Storybook has a selected story', () => {
    const other = { ...storybook, name: 'docs' }
    const selections = [...nothing, { storybook: other, version: '10.0.0', stories, allStories: stories }]

    expect(emptySelectionNotesOf({ base, changedFiles: 3, fallback: null }, selections)).toEqual([])
  })

  it('gives no note when the run fell back to every story', () => {
    expect(emptySelectionNotesOf({ base, changedFiles: 3, fallback: 'Fallow failed' }, nothing)).toEqual([])
  })
})

describe('leftOutNotesOf', () => {
  it('gives no note when no Storybook is left out', () => {
    expect(leftOutNotesOf([])).toEqual([])
  })

  it('names the one Storybook left out', () => {
    expect(leftOutNotesOf([{ name: 'docs' }])).toEqual([
      'Storybook docs is left out, since no changed file reaches it.',
    ])
  })

  it.each([
    [['web', 'docs'], 'Storybooks web and docs are left out, since no changed file reaches them.'],
    [['web', 'docs', 'admin'], 'Storybooks web, docs and admin are left out, since no changed file reaches them.'],
  ])('names the Storybooks %j left out, in the order given', (names, note) => {
    expect(leftOutNotesOf(names.map((name) => ({ name })))).toEqual([note])
  })
})

/**
 * A graph that fails the test if it's asked.
 */
const graphNeverAsked: FindReachedFiles = () => Promise.reject(new Error('The run asked for the import graph.'))

/**
 * A stories globs reader that fails the test if it's asked.
 */
const globsNeverRead: ReadStoriesMatchers = () => Promise.reject(new Error('The run read the stories globs.'))

describe('workOutRunSelection', () => {
  /**
   * The input of a run that traced no changes and leaves no Storybook out.
   */
  const input = {
    storybooks: [{ storybook, version: '10.0.0', stories }],
    required: { traced: undefined, leftOut: [] },
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

describe('workOutRequiredStorybooks', () => {
  beforeEach(() => {
    isolateGit()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    removeRepos()
  })

  /**
   * Makes a git repository with the Storybooks `web`, `docs` and `admin` in `apps/`, each with a stories file, all
   * committed, then changes the stories files given. Returns the input of an affected local run in it, whose graph
   * reaches only the changed files and whose reader gives every Storybook the matcher of `./src/*.stories.tsx`,
   * recording the folders it reads.
   */
  function requiredRunIn(changed: string[]) {
    const repo = makeRepo()
    const names = ['web', 'docs', 'admin']

    commit(repo, Object.fromEntries(names.map((name) => [`apps/${name}/src/${name}.stories.tsx`, ''])))
    writeFiles(repo, Object.fromEntries(changed.map((file) => [file, 'changed\n'])))

    const storybooks: ResolvedStorybook[] = names.map((name) => ({
      name,
      dir: join(repo, 'apps', name),
      configDir: join(repo, 'apps', name, '.storybook'),
      baselines: join(repo, 'apps', name, '.visual-check/baselines'),
      url: `http://${name}.test`,
    }))
    const reads: string[] = []
    const readStoriesMatchers: ReadStoriesMatchers = async ({ dir }) => {
      reads.push(dir)

      return [/^\.\/src\/[^/]+\.stories\.tsx$/]
    }

    return {
      input: {
        selection: { kind: 'affected' } as const,
        ci: false,
        baseRef: undefined,
        environment: {},
        cwd: repo,
        storybooks,
        baselinesFolders: storybooks.map(({ baselines }) => baselines),
        configPath: join(repo, 'visual-check.config.ts'),
        affected: { selectAll: [], ignore: [] },
        findReachedFiles: async (_root: string, files: readonly string[]) => ({
          reached: new Set(files),
          reachedFromFolders: () => new Set<string>(),
        }),
        readStoriesMatchers,
      },
      storybooks,
      reads,
    }
  }

  it.each([{ kind: 'all' }, { kind: 'filter', pattern: /button/ }] as const)(
    'requires every Storybook for %j, tracing nothing',
    async (selection) => {
      const result = await workOutRequiredStorybooks({
        selection,
        ci: false,
        baseRef: undefined,
        environment: {},
        cwd: '/nowhere',
        storybooks: [storybook],
        baselinesFolders: [storybook.baselines],
        configPath: '/nowhere/visual-check.config.ts',
        affected: { selectAll: [], ignore: [] },
        findReachedFiles: graphNeverAsked,
        readStoriesMatchers: globsNeverRead,
      })

      expect(result).toEqual({ required: [storybook], leftOut: [], traced: undefined })
    },
  )

  it('requires every Storybook of an affected run in CI, tracing the changes and reading no globs', async () => {
    const { input, storybooks } = requiredRunIn(['apps/docs/src/docs.stories.tsx'])
    const result = await workOutRequiredStorybooks({ ...input, ci: true, readStoriesMatchers: globsNeverRead })

    expect(result.required).toEqual(storybooks)
    expect(result.leftOut).toEqual([])
    expect(result.traced).toMatchObject({ changedFiles: 1, fallback: null })
  })

  it('requires only the Storybooks a changed file reaches locally, in config order, leaving the others out', async () => {
    const { input, storybooks, reads } = requiredRunIn([
      'apps/admin/src/admin.stories.tsx',
      'apps/web/src/web.stories.tsx',
    ])
    const [web, docs, admin] = storybooks
    const result = await workOutRequiredStorybooks(input)

    expect(result.required).toEqual([web, admin])
    expect(result.leftOut).toEqual([docs])
    expect(result.traced).toMatchObject({ changedFiles: 2, fallback: null })
    expect(reads).toEqual(storybooks.map(({ dir }) => dir))
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
   * Storybook config folder, all committed, then changes the button's component. Returns the trace options of an
   * affected run in it, with the graph given, the Storybook in it, and the commit's SHA.
   */
  function affectedRunIn(findReachedFiles: FindReachedFiles) {
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
      trace: {
        baseRef: undefined,
        environment: {},
        cwd: repo,
        storybooks: [storybookInRepo],
        baselinesFolders: [storybookInRepo.baselines],
        configPath: join(repo, 'visual-check.config.ts'),
        affected: { selectAll: [], ignore: [] },
        findReachedFiles,
      },
      storybook: storybookInRepo,
      head,
      repo,
    }
  }

  /**
   * Traces the changes, then works out the affected run's selection in the Storybook, leaving out those given.
   */
  async function selectionOf(
    run: ReturnType<typeof affectedRunIn>,
    options: { ignore?: string[]; leftOut?: ResolvedStorybook[] } = {},
  ) {
    const traced = await traceChanges({ ...run.trace, affected: { selectAll: [], ignore: options.ignore ?? [] } })

    return await workOutRunSelection({
      selection: { kind: 'affected' },
      storybooks: [{ storybook: run.storybook, version: '10.0.0', stories }],
      required: { traced, leftOut: options.leftOut ?? [] },
    })
  }

  it('keeps the stories of the stories files the changed files reach, asking the graph once', async () => {
    const calls: (readonly string[])[] = []
    const run = affectedRunIn(async (_root, files) => {
      calls.push(files)

      return { reached: new Set(['button.tsx', 'button.stories.tsx']), reachedFromFolders: () => new Set<string>() }
    })
    const result = await selectionOf(run)

    expect(calls).toEqual([['button.tsx']])
    expect(result.selections.map((selection) => selection.stories.map((story) => story.id))).toEqual([
      ['button--primary', 'button--secondary'],
    ])
    expect(result.selections[0]?.allStories).toBe(stories)
    expect(result).toMatchObject({
      report: { by: 'affected', base: run.head, changedFiles: 1, fallback: null },
      warning: '',
      notes: [],
    })
  })

  it("keeps a changed baseline's story beside the stories of the reached stories files", async () => {
    const run = affectedRunIn(async () => ({
      reached: new Set(['button.tsx', 'button.stories.tsx']),
      reachedFromFolders: () => new Set<string>(),
    }))

    writeFiles(run.repo, { '.visual-check/baselines/card--primary.png': 'png' })

    const result = await selectionOf(run)

    expect(result.selections.map((selection) => selection.stories.map((story) => story.id))).toEqual([
      ['button--primary', 'button--secondary', 'card--primary'],
    ])
  })

  it('keeps no story when every changed file matches affected.ignore', async () => {
    const result = await selectionOf(affectedRunIn(graphNeverAsked), { ignore: ['*.tsx'] })

    expect(result.selections[0]?.stories).toEqual([])
    expect(result.notes).toEqual(['The changed file affects no story. Run with --all to cover every story.'])
  })

  it('notes that the changed file affects no story when the graph reaches no stories file', async () => {
    const result = await selectionOf(
      affectedRunIn(async () => ({ reached: new Set(['button.tsx']), reachedFromFolders: () => new Set<string>() })),
    )

    expect(result.selections[0]?.stories).toEqual([])
    expect(result.notes).toEqual(['The changed file affects no story. Run with --all to cover every story.'])
  })

  it('names the Storybooks left out after the note that no story is affected', async () => {
    const result = await selectionOf(
      affectedRunIn(async () => ({ reached: new Set(['button.tsx']), reachedFromFolders: () => new Set<string>() })),
      { leftOut: [{ ...storybook, name: 'docs' }] },
    )

    expect(result.notes).toEqual([
      'The changed file affects no story. Run with --all to cover every story.',
      'Storybook docs is left out, since no changed file reaches it.',
    ])
  })

  it("keeps every story, with a warning that says why, when the graph can't answer", async () => {
    const run = affectedRunIn(async () => ({ cantAnswer: 'Fallow failed' }))
    const result = await selectionOf(run)

    expect(result.selections[0]?.stories).toEqual(stories)
    expect(result.report).toEqual({ by: 'affected', base: run.head, changedFiles: 1, fallback: 'Fallow failed' })
    expect(result.warning).toBe(fallbackWarningOf('Fallow failed'))
    expect(result.notes).toEqual([])
  })
})
