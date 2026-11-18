import { rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workOutAffectedStories } from './affected-stories.js'
import type { CantAnswer, FindReachedFiles, ReachedFiles } from './fallow-graph.js'
import { InvalidBaseError } from './git-changes.js'
import { commit, git, isolateGit, makeFolder, makeRepo, removeRepos, writeFiles } from './git-repo.fixture.js'
import type { ImportGraph } from './import-graph.js'
import type { AffectedStorybook, AffectedStorybookInput } from './storybook-rules.js'
import { filesReachedFrom, filesReachedFromFolders } from './walk-back.js'

// The tests of `workOutAffectedStories` run git several times each, which a machine busy with the other test files can
// slow to seconds.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })

/**
 * Gives the result that selects these stories files.
 */
function some(...storiesFiles: string[]): AffectedStorybook {
  return { all: false, storiesFiles: new Set(storiesFiles), storyIds: new Set() }
}

/**
 * A fake `FindReachedFiles` that records its calls and gives `result`.
 */
function fakeFindReachedFiles(result: ReachedFiles | CantAnswer) {
  const calls: { root: string; files: readonly string[] }[] = []
  const findReachedFiles: FindReachedFiles = (calledRoot, files) => {
    calls.push({ root: calledRoot, files })

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
      baselines: join(repo, '.visual-check/baselines'),
      storyIds: ['button--primary', 'card--primary'],
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
      baselinesFolders: [storybook.baselines],
      configPath: join(repo, 'visual-check.config.ts'),
      affected: { selectAll: [], ignore: [] },
      findReachedFiles,
    })
  }

  it("affects nothing and doesn't ask the graph when no file changed", async () => {
    const fake = fakeFindReachedFiles({ reached: new Set(), reachedFromFolders: () => new Set() })

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

    const fake = fakeFindReachedFiles({
      reached: new Set(['src/button.tsx', 'src/button.stories.tsx']),
      reachedFromFolders: () => new Set(),
    })

    expect(await workOut(fake.findReachedFiles)).toEqual({
      base,
      changedFiles: 2,
      fallback: null,
      storybooks: [some('./src/button.stories.tsx')],
    })
    expect(fake.calls).toEqual([{ root: repo, files: ['README.md', 'src/button.tsx'] }])
  })

  it('selects the right stories files when the Storybook is given through a symlink to the repository', async () => {
    commit(repo, { 'src/button.tsx': 'export const Button = 2\n' })

    const link = join(makeFolder(), 'link')

    symlinkSync(repo, link)
    storybook = { ...storybook, dir: link, configDir: join(link, '.storybook') }

    const fake = fakeFindReachedFiles({
      reached: new Set(['src/button.tsx', 'src/button.stories.tsx']),
      reachedFromFolders: () => new Set(),
    })

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
    const fake = fakeFindReachedFiles({ reached: new Set(), reachedFromFolders: () => new Set() })

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

    const fake = fakeFindReachedFiles({ reached: new Set(), reachedFromFolders: () => new Set() })
    const result = await workOut(fake.findReachedFiles)

    expect(result).toMatchObject({ base: null, changedFiles: null, storybooks: [{ all: true }] })
    expect(result.fallback).toMatch(/^no base branch found/)
  })

  it('rejects with InvalidBaseError for a --base that names no commit', async () => {
    const fake = fakeFindReachedFiles({ reached: new Set(), reachedFromFolders: () => new Set() })

    await expect(workOut(fake.findReachedFiles, { baseRef: 'nope' })).rejects.toThrow(InvalidBaseError)
  })
})

describe('workOutAffectedStories in a monorepo', () => {
  /**
   * A repository on branch `work`, one commit after `main`: a root package, `packages/ui`, `packages/theme`, and the
   * Storybooks of `apps/web`, which imports `packages/ui`, and `apps/docs`, which imports `packages/theme`.
   */
  let repo: string

  /**
   * The Storybooks of `apps/web` and `apps/docs`.
   */
  let storybooks: AffectedStorybookInput[]

  /**
   * The graph, as the files that import each file. Every file it names is in the graph.
   */
  const importers: Record<string, string[]> = {
    'packages/ui/src/icons/star.svg': ['packages/ui/src/button.tsx'],
    'packages/ui/src/button.tsx': ['packages/ui/src/index.ts'],
    'packages/ui/src/index.ts': ['apps/web/src/page.tsx'],
    'apps/web/src/page.tsx': ['apps/web/src/page.stories.tsx'],
    'apps/web/src/page.stories.tsx': [],
    'apps/web/.storybook/main.ts': [],
    'packages/theme/src/theme.ts': ['apps/docs/src/intro.stories.tsx'],
    'apps/docs/src/intro.stories.tsx': [],
    'apps/docs/.storybook/main.ts': [],
  }

  beforeEach(() => {
    isolateGit()
    repo = makeRepo()
    commit(repo, {
      'package.json': '{}\n',
      'pnpm-workspace.yaml': 'packages: []\n',
      'pnpm-lock.yaml': '\n',
      'visual-check.config.ts': 'export default {}\n',
      'README.md': 'Read me.\n',
      'packages/ui/package.json': '{}\n',
      'packages/theme/package.json': '{}\n',
      ...Object.fromEntries(Object.keys(importers).map((file) => [file, '\n'])),
      'apps/web/package.json': '{}\n',
      'apps/web/.visual-check/baselines/page--default.png': 'png',
      'apps/docs/package.json': '{}\n',
      'apps/docs/src/old.ts': '\n',
    })
    git(repo, 'checkout', '-q', '-b', 'work')
    storybooks = ['web', 'docs'].map((name) => ({
      dir: join(repo, 'apps', name),
      configDir: join(repo, 'apps', name, '.storybook'),
      storiesFiles: [name === 'web' ? './src/page.stories.tsx' : './src/intro.stories.tsx'],
      baselines: join(repo, 'apps', name, '.visual-check/baselines'),
      storyIds: name === 'web' ? ['page--default', 'page--wide', 'page--default-dark'] : ['intro--page'],
    }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    removeRepos()
  })

  /**
   * Builds a graph of `importers` that the real walk goes back through from the changed files and from every graph file
   * under the folders it's asked about, and records every call, with the folders it was asked about, if any.
   */
  function fakeGraph() {
    const calls: { files: readonly string[]; folders: readonly string[] }[] = []
    const graph: ImportGraph = {
      files: new Set(Object.keys(importers)),
      importersOf: new Map(Object.entries(importers)),
    }
    const findReachedFiles: FindReachedFiles = async (_root, files) => {
      const call = { files, folders: [] as readonly string[] }

      calls.push(call)

      return {
        reached: filesReachedFrom(graph, files),
        reachedFromFolders: (folders) => {
          call.folders = folders

          return filesReachedFromFolders(graph, folders)
        },
      }
    }

    return { calls, findReachedFiles }
  }

  /**
   * Writes the changes, then works out the affected stories with the `affected` globs given, or none, in a run that
   * covers both Storybooks, or those `run` gives, and knows the baselines folders of both, unless `run` says otherwise.
   */
  async function affectedBy(
    changes: Record<string, string>,
    affected: { selectAll?: string[]; ignore?: string[] } = {},
    run: { storybooks?: AffectedStorybookInput[]; baselinesFolders?: string[] } = {},
  ) {
    writeFiles(repo, changes)

    const graph = fakeGraph()
    const inRun = run.storybooks ?? storybooks
    const result = await workOutAffectedStories({
      baseRef: undefined,
      environment: {},
      cwd: repo,
      storybooks: inRun,
      baselinesFolders: run.baselinesFolders ?? storybooks.map(({ baselines }) => baselines),
      configPath: join(repo, 'visual-check.config.ts'),
      affected: { selectAll: affected.selectAll ?? [], ignore: affected.ignore ?? [] },
      findReachedFiles: graph.findReachedFiles,
    })

    return { ...result, calls: graph.calls }
  }

  /**
   * Gives the result that selects these story IDs and no stories file.
   */
  function ids(...storyIds: string[]): AffectedStorybook {
    return { all: false, storiesFiles: new Set(), storyIds: new Set(storyIds) }
  }

  it('selects only the stories a graph file reaches', async () => {
    const result = await affectedBy({ 'packages/ui/src/button.tsx': 'changed\n' })

    expect(result.storybooks).toEqual([some('./src/page.stories.tsx'), some()])
  })

  it.each([
    ['the config file', 'visual-check.config.ts'],
    ['a lockfile', 'pnpm-lock.yaml'],
    ['a lockfile in a package', 'apps/docs/yarn.lock'],
    ['pnpm-workspace.yaml', 'pnpm-workspace.yaml'],
    ['the root package.json', 'package.json'],
    ['.env.local at the root', '.env.local'],
  ])('selects every story of every Storybook for %s, without asking the graph', async (_name, file) => {
    const result = await affectedBy({ [file]: 'changed\n' })

    expect(result.storybooks).toEqual([{ all: true }, { all: true }])
    expect(result.changedFiles).toBe(1)
    expect(result.calls).toEqual([])
  })

  it('selects every story of only the Storybooks whose graph reaches a changed package.json', async () => {
    const result = await affectedBy({ 'packages/ui/package.json': '{ "version": "2" }\n' })

    expect(result.storybooks).toEqual([{ all: true }, some()])
    expect(result.calls).toEqual([{ files: ['packages/ui/package.json'], folders: ['packages/ui'] }])
  })

  it('selects every story of the Storybook in the package of a changed tsconfig.json, without asking the graph', async () => {
    const result = await affectedBy({ 'apps/docs/tsconfig.json': '{}\n', 'apps/web/vite.config.ts': '\n' })

    expect(result.storybooks).toEqual([{ all: true }, { all: true }])
    expect(result.calls).toEqual([])
  })

  it('selects every story of the Storybook in the package of a changed .env file', async () => {
    const result = await affectedBy({ 'apps/docs/.env': 'A=1\n' })

    expect(result.storybooks).toEqual([some(), { all: true }])
  })

  it('selects like a package.json for an image the graph does not hold', async () => {
    const result = await affectedBy({ 'packages/ui/src/assets/bg.png': 'png' })

    expect(result.storybooks).toEqual([{ all: true }, some()])
  })

  it('selects like a package.json for a font the graph does not hold', async () => {
    expect((await affectedBy({ 'packages/ui/fonts/inter.woff2': 'font' })).storybooks).toEqual([{ all: true }, some()])
  })

  it('selects like a package.json for a data JSON file the graph does not hold', async () => {
    expect((await affectedBy({ 'apps/docs/src/data.json': '{}\n' })).storybooks).toEqual([some(), { all: true }])
  })

  it('selects what the graph says for an image the graph holds', async () => {
    const result = await affectedBy({ 'packages/ui/src/icons/star.svg': '<svg/>' })

    expect(result.storybooks).toEqual([some('./src/page.stories.tsx'), some()])
  })

  it("walks only the packages that count, so an image the graph holds doesn't scope its package", async () => {
    const result = await affectedBy({
      'packages/ui/src/icons/star.svg': '<svg/>',
      'packages/theme/package.json': '{ "version": "2" }\n',
    })

    expect(result.storybooks).toEqual([some('./src/page.stories.tsx'), { all: true }])
    expect(result.calls).toEqual([
      { files: ['packages/theme/package.json', 'packages/ui/src/icons/star.svg'], folders: ['packages/theme'] },
    ])
  })

  it('selects every story of every Storybook for an image at the root the graph does not hold', async () => {
    const result = await affectedBy({ 'logo.png': 'png' })

    expect(result.storybooks).toEqual([{ all: true }, { all: true }])
    expect(result.calls).toEqual([{ files: ['logo.png'], folders: ['.'] }])
  })

  it('selects nothing for a config JSON file the graph does not hold', async () => {
    const result = await affectedBy({ 'turbo.json': '{}\n', '.vscode/settings.json': '{}\n' })

    expect(result.storybooks).toEqual([some(), some()])
  })

  it("selects a changed baseline's story only, and a mode's baseline's story, without asking the graph", async () => {
    const result = await affectedBy({
      'apps/web/.visual-check/baselines/page--default.png': 'changed',
      'apps/web/.visual-check/baselines/page--wide.dark.png': 'new',
    })

    expect(result.storybooks).toEqual([ids('page--default', 'page--wide'), some()])
    expect(result.calls).toEqual([])
  })

  /**
   * A run that covers only web, and knows the baselines folders of docs and of a Storybook at the root besides.
   */
  function webOnly() {
    return {
      storybooks: storybooks.slice(0, 1),
      baselinesFolders: [join(repo, '.visual-check/baselines'), ...storybooks.map(({ baselines }) => baselines)],
    }
  }

  it('selects nothing for a baseline of a Storybook the run leaves out, never taking it for an image', async () => {
    const result = await affectedBy({ '.visual-check/baselines/home--page.png': 'png' }, {}, webOnly())

    expect(result.storybooks).toEqual([some()])
    expect(result.calls).toEqual([])
  })

  it("selects nothing for a baseline of a Storybook the run leaves out, in that Storybook's package", async () => {
    const result = await affectedBy({ 'apps/docs/.visual-check/baselines/intro--page.png': 'changed' }, {}, webOnly())

    expect(result.storybooks).toEqual([some()])
    expect(result.calls).toEqual([])
  })

  it('takes a .png in the baselines folder of a Storybook it is not told about for an image', async () => {
    const result = await affectedBy(
      { '.visual-check/baselines/home--page.png': 'png' },
      {},
      { storybooks: storybooks.slice(0, 1) },
    )

    expect(result.storybooks).toEqual([{ all: true }])
  })

  it('selects a baseline story beside the stories files the graph reaches', async () => {
    const result = await affectedBy({
      'apps/web/.visual-check/baselines/page--wide.png': 'new',
      'apps/docs/src/intro.stories.tsx': 'changed\n',
    })

    expect(result.storybooks).toEqual([ids('page--wide'), some('./src/intro.stories.tsx')])
    expect(result.calls).toEqual([{ files: ['apps/docs/src/intro.stories.tsx'], folders: [] }])
  })

  it('selects every story for a file loaded through a glob import that affected.selectAll matches', async () => {
    const result = await affectedBy(
      { 'packages/ui/src/docs/intro.md': '# Intro\n' },
      { selectAll: ['packages/ui/src/docs/**'] },
    )

    expect(result.storybooks).toEqual([{ all: true }, { all: true }])
    expect(result.calls).toEqual([])
  })

  it('selects nothing for that file without affected.selectAll', async () => {
    const result = await affectedBy({ 'packages/ui/src/docs/intro.md': '# Intro\n' })

    expect(result.storybooks).toEqual([some(), some()])
  })

  it('selects nothing for a README or a deleted source file', async () => {
    rmSync(join(repo, 'apps/docs/src/old.ts'))

    const result = await affectedBy({ 'README.md': 'Changed.\n' })

    expect(result.storybooks).toEqual([some(), some()])
    expect(result.changedFiles).toBe(2)
    expect(result.calls).toEqual([{ files: ['README.md', 'apps/docs/src/old.ts'], folders: [] }])
  })

  it('lets affected.ignore win over affected.selectAll, the config file, a lockfile and a graph file', async () => {
    const result = await affectedBy(
      {
        'visual-check.config.ts': 'changed\n',
        'pnpm-lock.yaml': 'changed\n',
        'packages/ui/src/button.tsx': 'changed\n',
        'packages/ui/src/docs/intro.md': 'changed\n',
      },
      {
        selectAll: ['packages/ui/src/docs/**'],
        ignore: ['visual-check.config.ts', 'pnpm-lock.yaml', 'packages/ui/src/**'],
      },
    )

    expect(result).toMatchObject({ changedFiles: 4, fallback: null, storybooks: [some(), some()] })
    expect(result.calls).toEqual([])
  })

  it('leaves the ignored files out of what the graph is asked', async () => {
    const result = await affectedBy(
      { 'packages/ui/src/button.tsx': 'changed\n', 'apps/docs/src/intro.stories.tsx': 'changed\n' },
      { ignore: ['packages/**'] },
    )

    expect(result.storybooks).toEqual([some(), some('./src/intro.stories.tsx')])
    expect(result.calls).toEqual([{ files: ['apps/docs/src/intro.stories.tsx'], folders: [] }])
  })

  it('reads the globs relative to the config file folder', async () => {
    writeFiles(repo, { 'apps/web/notes/a.txt': 'changed\n' })

    const atRoot = await workOutAffectedStories({
      baseRef: undefined,
      environment: {},
      cwd: repo,
      storybooks,
      baselinesFolders: storybooks.map(({ baselines }) => baselines),
      configPath: join(repo, 'visual-check.config.ts'),
      affected: { selectAll: ['notes/**'], ignore: [] },
      findReachedFiles: fakeGraph().findReachedFiles,
    })
    const result = await workOutAffectedStories({
      baseRef: undefined,
      environment: {},
      cwd: repo,
      storybooks,
      baselinesFolders: storybooks.map(({ baselines }) => baselines),
      configPath: join(repo, 'apps/web/visual-check.config.ts'),
      affected: { selectAll: ['notes/**'], ignore: [] },
      findReachedFiles: fakeGraph().findReachedFiles,
    })

    expect(atRoot.storybooks).toEqual([some(), some()])
    expect(result.storybooks).toEqual([{ all: true }, { all: true }])
  })
})
