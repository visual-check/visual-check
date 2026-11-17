import { symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AffectedStorybook,
  type AffectedStorybookInput,
  affectedStoriesFilesOf,
  workOutAffectedStories,
} from './affected-stories.js'
import type { CantAnswer, FindReachedFiles, ReachedFiles } from './fallow-graph.js'
import { InvalidBaseError } from './git-changes.js'
import { commit, git, isolateGit, makeFolder, makeRepo, removeRepos, writeFiles } from './git-repo.fixture.js'

// The tests of `workOutAffectedStories` run git several times each, which a machine busy with the other test files can
// slow to seconds.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })

/**
 * The project root the rules tests use. Never read from disk.
 */
const root = '/project'

/**
 * A Storybook at the project root, with its config in `.storybook/`.
 */
const rootStorybook: AffectedStorybookInput = {
  dir: root,
  configDir: join(root, '.storybook'),
  storiesFiles: ['./src/button.stories.tsx', './src/card.stories.tsx', 'src/badge.stories.tsx'],
}

/**
 * Gives the stories files the rules select in the root Storybook, given the reached and the changed files.
 */
function affectedIn(reached: readonly string[], changedFiles: readonly string[] = reached): AffectedStorybook[] {
  return affectedStoriesFilesOf({ root, storybooks: [rootStorybook], reached: new Set(reached), changedFiles })
}

/**
 * Gives the result that selects these stories files.
 */
function some(...storiesFiles: string[]): AffectedStorybook {
  return { all: false, storiesFiles: new Set(storiesFiles) }
}

describe('affectedStoriesFilesOf', () => {
  it("selects only the importers' stories files of a component imported directly", () => {
    expect(affectedIn(['src/button.tsx', 'src/button.stories.tsx'], ['src/button.tsx'])).toEqual([
      some('./src/button.stories.tsx'),
    ])
  })

  it("selects only the importers' stories files of a component imported through another file", () => {
    const reached = ['src/icon.tsx', 'src/button.tsx', 'src/button.stories.tsx', 'src/card.stories.tsx']

    expect(affectedIn(reached, ['src/icon.tsx'])).toEqual([some('./src/button.stories.tsx', './src/card.stories.tsx')])
  })

  it('selects a changed stories file itself', () => {
    expect(affectedIn(['src/card.stories.tsx'])).toEqual([some('./src/card.stories.tsx')])
  })

  it('matches an import path with and without a leading ./', () => {
    expect(affectedIn(['src/badge.stories.tsx', 'src/button.stories.tsx'])).toEqual([
      some('./src/button.stories.tsx', 'src/badge.stories.tsx'),
    ])
  })

  it('ignores a reached file that is no stories file', () => {
    expect(affectedIn(['src/button.tsx', 'src/unused.tsx'])).toEqual([some()])
  })

  it('selects nothing for a changed file not in the graph', () => {
    expect(affectedIn([], ['README.md'])).toEqual([some()])
  })

  it('selects every story when preview.tsx changes', () => {
    expect(affectedIn(['.storybook/preview.tsx'])).toEqual([{ all: true }])
  })

  it('selects every story when main.ts changes', () => {
    expect(affectedIn(['.storybook/main.ts'])).toEqual([{ all: true }])
  })

  it('selects every story when preview-head.html changes, though it is not in the graph', () => {
    expect(affectedIn([], ['.storybook/preview-head.html'])).toEqual([{ all: true }])
  })

  it('selects every story when preview-body.html changes', () => {
    expect(affectedIn([], ['.storybook/preview-body.html'])).toEqual([{ all: true }])
  })

  it('selects every story when the walk reaches main.ts', () => {
    expect(affectedIn(['src/addon.ts', '.storybook/main.ts'], ['src/addon.ts'])).toEqual([{ all: true }])
  })

  it('selects every story when the walk reaches preview.ts', () => {
    expect(affectedIn(['src/theme.ts', '.storybook/preview.ts'], ['src/theme.ts'])).toEqual([{ all: true }])
  })

  it('selects what the graph says when another config file is reached', () => {
    const reached = ['src/viewports.ts', '.storybook/visual-check.ts', 'src/card.stories.tsx']

    expect(affectedIn(reached, ['src/viewports.ts'])).toEqual([some('./src/card.stories.tsx')])
  })

  it('does not count a preview file in a subfolder of the config folder', () => {
    expect(affectedIn(['.storybook/sub/preview.ts', '.storybook/sub/main.ts'])).toEqual([some()])
  })

  it('does not count a preview file outside the config folder', () => {
    expect(affectedIn(['src/preview.ts', 'main.ts'])).toEqual([some()])
  })

  it('counts config file names whatever their case', () => {
    expect(affectedIn(['.storybook/Preview.tsx'])).toEqual([{ all: true }])
    expect(affectedIn(['.storybook/Main.ts'])).toEqual([{ all: true }])
  })

  it('counts any file whose name starts with preview or main, such as previewer.ts or maintenance.ts', () => {
    expect(affectedIn(['.storybook/previewer.ts'])).toEqual([{ all: true }])
    expect(affectedIn(['.storybook/maintenance.ts'])).toEqual([{ all: true }])
  })

  it('selects every story when preview.ts is deleted, though the graph no longer has it', () => {
    expect(affectedIn([], ['.storybook/preview.ts'])).toEqual([{ all: true }])
  })

  it('selects every story of only the Storybook whose folder is outside the root', () => {
    const outside: AffectedStorybookInput = {
      dir: '/elsewhere',
      configDir: join(root, '.storybook'),
      storiesFiles: ['./src/button.stories.tsx'],
    }

    expect(
      affectedStoriesFilesOf({
        root,
        storybooks: [outside, rootStorybook],
        reached: new Set(['src/card.stories.tsx']),
        changedFiles: ['src/card.stories.tsx'],
      }),
    ).toEqual([{ all: true }, some('./src/card.stories.tsx')])
  })

  it('selects every story of only the Storybook whose config folder is outside the root', () => {
    const outside: AffectedStorybookInput = {
      dir: root,
      configDir: '/elsewhere/.storybook',
      storiesFiles: ['./src/button.stories.tsx'],
    }

    expect(
      affectedStoriesFilesOf({
        root,
        storybooks: [outside, rootStorybook],
        reached: new Set(['src/card.stories.tsx']),
        changedFiles: ['src/card.stories.tsx'],
      }),
    ).toEqual([{ all: true }, some('./src/card.stories.tsx')])
  })

  it('selects every story when the config folder is the Storybook folder itself', () => {
    const storybook: AffectedStorybookInput = { dir: root, configDir: root, storiesFiles: ['./a.stories.tsx'] }

    expect(
      affectedStoriesFilesOf({ root, storybooks: [storybook], reached: new Set(['preview.ts']), changedFiles: [] }),
    ).toEqual([{ all: true }])
  })

  describe('in a monorepo with two Storybooks', () => {
    /**
     * A Storybook in `packages/web`.
     */
    const web: AffectedStorybookInput = {
      dir: join(root, 'packages/web'),
      configDir: join(root, 'packages/web/.storybook'),
      storiesFiles: ['./src/page.stories.tsx'],
    }

    /**
     * A Storybook in `packages/ui`, with its config in a folder of its own name.
     */
    const ui: AffectedStorybookInput = {
      dir: join(root, 'packages/ui'),
      configDir: join(root, 'packages/ui/storybook-config'),
      storiesFiles: ['./src/button.stories.tsx', './src/card.stories.tsx'],
    }

    /**
     * Gives the stories files the rules select in both Storybooks.
     */
    function affectedInBoth(reached: readonly string[], changedFiles: readonly string[] = reached) {
      return affectedStoriesFilesOf({ root, storybooks: [web, ui], reached: new Set(reached), changedFiles })
    }

    it('selects the stories files of each Storybook from the root-relative paths', () => {
      const reached = [
        'packages/ui/src/button.tsx',
        'packages/ui/src/button.stories.tsx',
        'packages/web/src/page.stories.tsx',
      ]

      expect(affectedInBoth(reached, ['packages/ui/src/button.tsx'])).toEqual([
        some('./src/page.stories.tsx'),
        some('./src/button.stories.tsx'),
      ])
    })

    it('selects every story of only the Storybook whose preview changed', () => {
      expect(affectedInBoth(['packages/ui/storybook-config/preview.tsx'])).toEqual([some(), { all: true }])
    })

    it('matches an import path without a leading ./ against the Storybook folder', () => {
      const docs: AffectedStorybookInput = {
        dir: join(root, 'packages/docs'),
        configDir: join(root, 'packages/docs/.storybook'),
        storiesFiles: ['src/intro.stories.tsx', 'src/other.stories.tsx'],
      }

      expect(
        affectedStoriesFilesOf({
          root,
          storybooks: [docs],
          reached: new Set(['packages/docs/src/intro.stories.tsx', 'src/other.stories.tsx']),
          changedFiles: ['packages/docs/src/intro.stories.tsx'],
        }),
      ).toEqual([some('src/intro.stories.tsx')])
    })

    it("does not count another Storybook's config folder", () => {
      expect(affectedInBoth(['packages/ui/.storybook/preview.tsx'])).toEqual([some(), some()])
    })
  })
})

/**
 * A fake `FindReachedFiles` that records its calls and gives `result`.
 */
function fakeFindReachedFiles(result: ReachedFiles | CantAnswer) {
  const calls: { root: string; changedFiles: readonly string[] }[] = []
  const findReachedFiles: FindReachedFiles = (calledRoot, changedFiles) => {
    calls.push({ root: calledRoot, changedFiles })

    return Promise.resolve(result)
  }

  return { calls, findReachedFiles }
}

describe('workOutAffectedStories', () => {
  /**
   * A repository on branch `work`, one commit after `main`.
   */
  let repo: string

  /**
   * The SHA `main` points at, the base.
   */
  let base: string

  /**
   * The repository's Storybook.
   */
  let storybook: AffectedStorybookInput

  beforeEach(() => {
    isolateGit()
    repo = makeRepo()
    base = commit(repo, {
      '.storybook/main.ts': 'export default {}\n',
      'src/button.tsx': 'export const Button = 1\n',
      'src/button.stories.tsx': "import './button'\n",
      'src/card.stories.tsx': 'export default {}\n',
    })
    git(repo, 'checkout', '-q', '-b', 'work')
    storybook = {
      dir: repo,
      configDir: join(repo, '.storybook'),
      storiesFiles: ['./src/button.stories.tsx', './src/card.stories.tsx'],
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    removeRepos()
  })

  /**
   * Works out the affected stories in `cwd` with no `--base` and no environment, unless given.
   */
  function workOut(findReachedFiles: FindReachedFiles, options: { cwd?: string; baseRef?: string } = {}) {
    return workOutAffectedStories({
      baseRef: options.baseRef,
      environment: {},
      cwd: options.cwd ?? repo,
      storybooks: [storybook],
      findReachedFiles,
    })
  }

  it("affects nothing and doesn't ask the graph when no file changed", async () => {
    const fake = fakeFindReachedFiles({ reached: new Set() })

    expect(await workOut(fake.findReachedFiles)).toEqual({
      base,
      changedFiles: 0,
      fallback: null,
      storybooks: [some()],
    })
    expect(fake.calls).toEqual([])
  })

  it('asks the graph once with the root and the changed files, and applies the rules to its answer', async () => {
    commit(repo, { 'src/button.tsx': 'export const Button = 2\n' })
    writeFiles(repo, { 'README.md': 'hi\n' })

    const fake = fakeFindReachedFiles({ reached: new Set(['src/button.tsx', 'src/button.stories.tsx']) })

    expect(await workOut(fake.findReachedFiles)).toEqual({
      base,
      changedFiles: 2,
      fallback: null,
      storybooks: [some('./src/button.stories.tsx')],
    })
    expect(fake.calls).toEqual([{ root: repo, changedFiles: ['README.md', 'src/button.tsx'] }])
  })

  it('selects the right stories files when the Storybook is given through a symlink to the repository', async () => {
    commit(repo, { 'src/button.tsx': 'export const Button = 2\n' })

    const link = join(makeFolder(), 'link')

    symlinkSync(repo, link)
    storybook = { ...storybook, dir: link, configDir: join(link, '.storybook') }

    const fake = fakeFindReachedFiles({ reached: new Set(['src/button.tsx', 'src/button.stories.tsx']) })

    expect(await workOut(fake.findReachedFiles)).toMatchObject({ storybooks: [some('./src/button.stories.tsx')] })
  })

  it("affects every story, keeping the base and the count, when the graph can't answer", async () => {
    commit(repo, { 'src/button.tsx': 'export const Button = 2\n' })

    const fake = fakeFindReachedFiles({ cantAnswer: 'Fallow failed: boom' })

    expect(await workOut(fake.findReachedFiles)).toEqual({
      base,
      changedFiles: 1,
      fallback: 'Fallow failed: boom',
      storybooks: [{ all: true }],
    })
  })

  it("affects every story when the folder isn't in a git repository", async () => {
    const fake = fakeFindReachedFiles({ reached: new Set() })

    expect(await workOut(fake.findReachedFiles, { cwd: makeFolder() })).toEqual({
      base: null,
      changedFiles: null,
      fallback: "the folder isn't in a git repository",
      storybooks: [{ all: true }],
    })
    expect(fake.calls).toEqual([])
  })

  it('affects every story when no base branch is found', async () => {
    git(repo, 'branch', '-D', 'main')

    const fake = fakeFindReachedFiles({ reached: new Set() })
    const result = await workOut(fake.findReachedFiles)

    expect(result).toMatchObject({ base: null, changedFiles: null, storybooks: [{ all: true }] })
    expect(result.fallback).toMatch(/^no base branch found/)
  })

  it('rejects with InvalidBaseError for a --base that names no commit', async () => {
    const fake = fakeFindReachedFiles({ reached: new Set() })

    await expect(workOut(fake.findReachedFiles, { baseRef: 'nope' })).rejects.toThrow(InvalidBaseError)
  })
})
