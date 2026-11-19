import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadStoriesMatchers } from '../affected-stories/affected-stories.js'
import type { FindReachedFiles } from '../affected-stories/fallow-graph.js'
import { commit, isolateGit, makeRepo, removeRepos, writeFiles } from '../affected-stories/git-repo.fixture.js'
import type { TestReport } from '../report/report-document.js'
import {
  cleanUpRuns,
  defaultRunSnapshot,
  fakeBrowser,
  headerOf,
  removeMarkerFolder,
  reportFolderIn,
  startStorybook,
  takeUnusedUrl,
} from './run-cli.fixture.js'
import { runCli } from './run-cli.js'

// Each test runs git several times, which a machine busy with the other test files can slow to seconds.
vi.setConfig({ testTimeout: 30_000 })

beforeEach(() => {
  isolateGit()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  removeRepos()
  await cleanUpRuns()
})

afterAll(removeMarkerFolder)

/**
 * The names of the project's Storybooks, in config order.
 */
type StorybookName = 'web' | 'docs' | 'admin'

/**
 * The names of the project's Storybooks, in config order.
 */
const names: StorybookName[] = ['web', 'docs', 'admin']

/**
 * The stories file of each story of each Storybook, as its `index.json` gives it.
 */
const importPaths: Record<StorybookName, Record<string, string>> = {
  web: { 'page--default': './src/page.stories.tsx', 'button--primary': '../../packages/ui/src/button.stories.tsx' },
  docs: { 'intro--page': './src/intro.stories.tsx' },
  admin: { 'table--default': './src/table.stories.tsx' },
}

/**
 * The project's import graph, as the files that import each file.
 */
const importers: Record<string, string[]> = {
  'packages/ui/src/button.tsx': ['packages/ui/src/button.stories.tsx'],
  'apps/docs/src/intro.tsx': ['apps/docs/src/intro.stories.tsx'],
}

/**
 * Builds a graph that walks back from the changed files through `importers`, the changed files included.
 */
const findReachedFiles: FindReachedFiles = async (_root, files) => {
  const reached = new Set<string>()
  const next = [...files]

  for (let file = next.pop(); file !== undefined; file = next.pop()) {
    if (!reached.has(file)) {
      reached.add(file)
      next.push(...(importers[file] ?? []))
    }
  }

  return { reached, reachedFromFolders: () => new Set<string>() }
}

/**
 * Builds a reader of the stories globs that records the name of each Storybook it reads: web reads its own stories
 * and `packages/ui`'s, docs its own stories and `.mdx` files, admin its own stories. `overrides` gives others, where
 * `undefined` means globs that can't be read.
 */
function fakeReader(overrides: Partial<Record<StorybookName, readonly RegExp[] | undefined>> = {}) {
  const matchers: Record<StorybookName, readonly RegExp[] | undefined> = {
    web: [/^\.\/src\/[^/]+\.stories\.tsx$/, /^\.\.\/\.\.\/packages\/ui\/src\/[^/]+\.stories\.tsx$/],
    docs: [/^\.\/src\/[^/]+\.(stories\.tsx|mdx)$/],
    admin: [/^\.\/src\/[^/]+\.stories\.tsx$/],
    ...overrides,
  }
  const reads: string[] = []
  const readStoriesMatchers: ReadStoriesMatchers = async ({ dir }) => {
    const name = basename(dir) as StorybookName

    reads.push(name)

    return matchers[name]
  }

  return { reads, readStoriesMatchers }
}

/**
 * Makes a committed git repository for a monorepo with the Storybooks `web`, `docs` and `admin` in `apps/`, a
 * `packages/ui` package whose stories web reads, and a baseline for each story. The Storybooks named in `served`
 * answer with their stories; nothing answers at the others' URLs. Returns the project and the commit's SHA.
 */
async function createRequiredRun(served: StorybookName[] = []): Promise<{ project: string; head: string }> {
  const urls = await Promise.all(
    names.map((name) =>
      served.includes(name) ? startStorybook(Object.keys(importPaths[name]), importPaths[name]) : takeUnusedUrl(),
    ),
  )
  const storybooks = names.map((name, index) => `${name}: { dir: 'apps/${name}', url: '${urls[index]}' }`)
  const project = makeRepo()

  writeFiles(project, {
    'package.json': '{}\n',
    'pnpm-lock.yaml': '\n',
    '.gitignore': '.visual-check/report/\n',
    'visual-check.config.mjs': `export default { storybooks: { ${storybooks.join(', ')} } }\n`,
    'packages/ui/package.json': '{}\n',
    'packages/ui/src/button.tsx': 'export const Button = 1\n',
    'packages/ui/src/button.stories.tsx': '',
    'apps/web/src/page.stories.tsx': '',
    'apps/docs/src/intro.tsx': 'export const Intro = 1\n',
    'apps/docs/src/intro.stories.tsx': '',
    'apps/admin/src/table.stories.tsx': '',
    ...Object.fromEntries(
      names.flatMap((name) => [
        [`apps/${name}/package.json`, '{}\n'],
        [`apps/${name}/.storybook/main.ts`, 'export default {}\n'],
        [`apps/${name}/.storybook/preview.ts`, 'export default {}\n'],
      ]),
    ),
  })

  for (const name of names) {
    for (const id of Object.keys(importPaths[name])) {
      writeBaseline(project, name, id)
    }
  }

  return { project, head: commit(project) }
}

/**
 * Writes the baseline of a story in a Storybook's baselines folder.
 */
function writeBaseline(project: string, name: StorybookName, stem: string): void {
  writeFiles(project, { [`apps/${name}/.visual-check/baselines/${stem}.png`]: '' })
  writeFileSync(baselineOf(project, name, stem), defaultRunSnapshot)
}

/**
 * Gives the path of a baseline in a Storybook's baselines folder.
 */
function baselineOf(project: string, name: StorybookName, stem: string): string {
  return join(project, 'apps', name, '.visual-check', 'baselines', `${stem}.png`)
}

/**
 * Reads the report a `test` wrote in the project.
 */
function readReport(project: string): TestReport {
  return JSON.parse(readFileSync(join(reportFolderIn(project), 'report.json'), 'utf8')) as TestReport
}

/**
 * Gives the names of the Storybooks where nothing answers, as the report's error gives them.
 */
function unreachableIn(project: string): string[] {
  return (readReport(project).error?.storybooks ?? []).map(({ name }) => name)
}

/**
 * Runs `test` in the project with the arguments, environment and reader given, the fake graph and a fake browser.
 */
async function runTest(
  project: string,
  reader: ReturnType<typeof fakeReader>,
  run: { arguments?: string[]; environment?: Record<string, string> } = {},
) {
  const browser = fakeBrowser()
  const result = await runCli(['test', ...(run.arguments ?? [])], run.environment ?? {}, project, {
    ...browser.options,
    findReachedFiles,
    readStoriesMatchers: reader.readStoriesMatchers,
  })

  return { result, record: browser.record }
}

describe('runCli requiring only the Storybooks a local affected run needs', () => {
  it('checks only the Storybook whose globs a changed file reaches, reading each Storybook globs once', async () => {
    const { project } = await createRequiredRun()
    const reader = fakeReader()

    writeFiles(project, { 'apps/docs/src/intro.tsx': 'export const Intro = 2\n' })

    const { result } = await runTest(project, reader)

    expect(result.exitCode).toBe(2)
    expect(unreachableIn(project)).toEqual(['docs'])
    expect(result.stderr).toContain("Storybook docs doesn't answer")
    expect(result.stderr).not.toMatch(/Storybook (web|admin)/)
    expect(reader.reads).toEqual(names)
  })

  it('captures in the required Storybook only, with a note naming the ones left out', async () => {
    const { project } = await createRequiredRun(['docs'])
    const reader = fakeReader()

    writeFiles(project, { 'apps/docs/src/intro.tsx': 'export const Intro = 2\n' })

    const { result, record } = await runTest(project, reader)
    const lines = result.stdout.split('\n')

    expect(result.exitCode).toBe(0)
    expect(lines.slice(0, 2)).toEqual([
      headerOf('test', 1),
      'Storybooks web and admin are left out, since no changed file reaches them.',
    ])
    expect([...new Set(record.captures.map(({ id }) => id))]).toEqual(['intro--page'])
    expect(readReport(project).storybooks.map(({ name }) => name)).toEqual(['docs'])
  })

  it.each([
    ['a change in another package that its globs reach', 'packages/ui/src/button.tsx', ['web']],
    ["a change to a Storybook's preview.ts", 'apps/admin/.storybook/preview.ts', ['admin']],
    ['a new .mdx file its globs match', 'apps/docs/src/guide.mdx', ['docs']],
    ['a changed baseline in its baselines folder', 'apps/web/.visual-check/baselines/page--default.png', ['web']],
  ])('requires the Storybook for %s', async (_name, file, required) => {
    const { project } = await createRequiredRun()

    writeFiles(project, { [file]: 'changed\n' })

    const { result } = await runTest(project, fakeReader())

    expect(result.exitCode).toBe(2)
    expect(unreachableIn(project)).toEqual(required)
  })

  it('requires the Storybook whose deleted stories file its globs match', async () => {
    const { project } = await createRequiredRun()

    rmSync(join(project, 'apps/admin/src/table.stories.tsx'))

    const { result } = await runTest(project, fakeReader())

    expect(result.exitCode).toBe(2)
    expect(unreachableIn(project)).toEqual(['admin'])
  })

  it("always requires a Storybook whose globs can't be read", async () => {
    const { project } = await createRequiredRun()

    writeFiles(project, { 'apps/docs/src/intro.tsx': 'export const Intro = 2\n' })

    const { result } = await runTest(project, fakeReader({ admin: undefined }))

    expect(result.exitCode).toBe(2)
    expect(unreachableIn(project)).toEqual(['docs', 'admin'])
  })

  it('requires every Storybook for a changed lockfile, reading no globs', async () => {
    const { project } = await createRequiredRun()
    const reader = fakeReader()

    writeFiles(project, { 'pnpm-lock.yaml': 'changed\n' })

    const { result } = await runTest(project, reader)

    expect(result.exitCode).toBe(2)
    expect(unreachableIn(project)).toEqual(names)
    expect(reader.reads).toEqual([])
  })

  it.each([
    ['in CI with --affected', { arguments: ['--affected'], environment: { CI: 'true' } }],
    ['with --all', { arguments: ['--all'] }],
    ['for test --consistency', { arguments: ['--consistency'] }],
  ])('requires every Storybook %s, reading no globs', async (_name, run) => {
    const { project } = await createRequiredRun()
    const reader = fakeReader()

    writeFiles(project, { 'apps/docs/src/intro.tsx': 'export const Intro = 2\n' })

    const { result } = await runTest(project, reader, run)

    expect(result.exitCode).toBe(2)
    expect(unreachableIn(project)).toEqual(names)
    expect(reader.reads).toEqual([])
  })

  it('reaches no Storybook when no file changed, naming them all in a note', async () => {
    const { project, head } = await createRequiredRun()
    const reader = fakeReader()
    const { result, record } = await runTest(project, reader)

    expect(result.exitCode).toBe(0)
    expect(result.stdout.split('\n').slice(0, 3)).toEqual([
      headerOf('test', 0),
      `No files changed since ${head.slice(0, 7)}, so no story is affected. Run with --all to cover every story.`,
      'Storybooks web, docs and admin are left out, since no changed file reaches them.',
    ])
    expect(record.launches).toEqual([])
    expect(reader.reads).toEqual([])
    expect(readReport(project).storybooks).toEqual([])
  })

  it("deletes the orphans of only the required Storybooks in update, leaving another's alone", async () => {
    const { project } = await createRequiredRun(['docs'])

    writeBaseline(project, 'docs', 'old--story')
    writeBaseline(project, 'web', 'old--story')
    commit(project)
    writeFiles(project, { 'apps/docs/src/intro.tsx': 'export const Intro = 2\n' })

    const browser = fakeBrowser()
    const result = await runCli(['update'], {}, project, {
      ...browser.options,
      findReachedFiles,
      readStoriesMatchers: fakeReader().readStoriesMatchers,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.split('\n')).toContain(
      'Storybooks web and admin are left out, since no changed file reaches them.',
    )
    expect(existsSync(baselineOf(project, 'docs', 'old--story'))).toBe(false)
    expect(existsSync(baselineOf(project, 'web', 'old--story'))).toBe(true)
  })
})
