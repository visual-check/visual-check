import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FindReachedFiles } from '../affected-stories/fallow-graph.js'
import { commit, git, isolateGit, makeRepo, removeRepos, writeFiles } from '../affected-stories/git-repo.fixture.js'
import type { TestReport, UpdateReport } from '../report/report-document.js'
import {
  cleanUpRuns,
  createRun,
  defaultRunSnapshot,
  fakeBrowser,
  missingLineOf,
  otherSnapshot,
  removeMarkerFolder,
  reportFolderIn,
  reportOnStderr,
  startStorybook,
} from './run-cli.fixture.js'
import { type RunCliOptions, runCli } from './run-cli.js'

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
 * The stories file of each story of the project's Storybook.
 */
const importPaths = {
  'button--primary': './src/button.stories.tsx',
  'card--primary': './src/card.stories.tsx',
  'badge--primary': './src/badge.stories.tsx',
}

/**
 * The project's import graph, as the files that import each file: the button's stories import the button directly,
 * and the card's stories import it through a helper.
 */
const importers: Record<string, string[]> = {
  'src/button.tsx': ['src/button.stories.tsx', 'src/helper.ts'],
  'src/helper.ts': ['src/card.stories.tsx'],
  'src/badge.tsx': ['src/badge.stories.tsx'],
}

/**
 * Builds a graph that walks back from the changed files through `importers`, the changed files included, and records
 * every call.
 */
function fakeGraph(): {
  findReachedFiles: FindReachedFiles
  calls: { root: string; changedFiles: readonly string[] }[]
} {
  const calls: { root: string; changedFiles: readonly string[] }[] = []
  const findReachedFiles: FindReachedFiles = async (root, changedFiles) => {
    calls.push({ root, changedFiles })

    const reached = new Set<string>()
    const next = [...changedFiles]

    for (let file = next.pop(); file !== undefined; file = next.pop()) {
      if (!reached.has(file)) {
        reached.add(file)
        next.push(...(importers[file] ?? []))
      }
    }

    return { reached }
  }

  return { findReachedFiles, calls }
}

/**
 * Makes a git repository for a project whose one Storybook, `web`, lists the button, card and badge stories, with the
 * files of `importers`, a Storybook config folder and a baseline for each story of `baselines` (each story when not
 * given), and `extra` files besides. Commits it all, so no file has changed yet, and returns the project and the
 * commit's SHA.
 */
async function createAffectedRun(
  options: { baselines?: string[]; extra?: Record<string, string> } = {},
): Promise<{ project: string; head: string }> {
  const url = await startStorybook(Object.keys(importPaths), importPaths)
  const project = makeRepo()

  writeFiles(project, {
    '.gitignore': '.visual-check/report/\n',
    'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
    '.storybook/main.ts': 'export default {}\n',
    '.storybook/preview.ts': 'export default {}\n',
    'src/button.tsx': 'export const Button = 1\n',
    'src/helper.ts': "import { Button } from './button.js'\n\nexport const Helper = Button\n",
    'src/badge.tsx': 'export const Badge = 1\n',
    'src/button.stories.tsx': '',
    'src/card.stories.tsx': '',
    'src/badge.stories.tsx': '',
    ...options.extra,
  })
  mkdirSync(join(project, '.visual-check', 'baselines'), { recursive: true })

  for (const id of options.baselines ?? Object.keys(importPaths)) {
    writeFileSync(join(project, '.visual-check', 'baselines', `${id}.png`), defaultRunSnapshot)
  }

  return { project, head: commit(project) }
}

/**
 * Gives the IDs of the stories the fake browser captured, sorted.
 */
function capturedIdsOf(record: { captures: readonly { id: string }[] }): string[] {
  return [...new Set(record.captures.map(({ id }) => id))].sort()
}

/**
 * Reads the report a `test` wrote in the project.
 */
function readReport(project: string): TestReport {
  return JSON.parse(readFileSync(join(reportFolderIn(project), 'report.json'), 'utf8')) as TestReport
}

/**
 * The warning of a run that fell back to every story, for the reason given.
 */
function fallbackWarningOf(reason: string): string {
  return `Warning: visual-check can't work out the affected stories, so it covers every story: ${reason}.\n`
}

/**
 * Gives the options with the fake browser's driver throwing an error that is a bug, a plain `Error`, when the run
 * closes it, once every snapshot is taken.
 */
function closingBugOf(options: RunCliOptions): RunCliOptions {
  const { launchBrowser } = options

  if (launchBrowser === undefined) {
    throw new Error('The fake browser gives no launch.')
  }

  return {
    ...options,
    launchBrowser: async (launch) =>
      Object.assign(await launchBrowser(launch), {
        close: () => Promise.reject(new Error('A bug in closing the browser.')),
      }),
  }
}

/**
 * Gives a clock that reads 0 when the run starts, then throws an error that is a bug, a plain `Error`, when the run
 * reads how long it took, as `test` does once its report is written.
 */
function clockBug(): () => number {
  let reads = 0

  return () => {
    reads += 1

    if (reads > 1) {
      throw new Error('A bug in the clock.')
    }

    return 0
  }
}

describe('runCli covering the affected stories', () => {
  it('captures only the stories files the changed component reaches, directly or through a helper', async () => {
    const { project, head } = await createAffectedRun()
    const graph = fakeGraph()
    const { options, record } = fakeBrowser()

    writeFiles(project, { 'src/button.tsx': 'export const Button = 2\n' })

    const result = await runCli(['test'], {}, project, { ...options, findReachedFiles: graph.findReachedFiles })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(capturedIdsOf(record)).toEqual(['button--primary', 'card--primary'])
    expect(graph.calls).toEqual([{ root: project, changedFiles: ['src/button.tsx'] }])
    expect(readReport(project).selection).toEqual({ by: 'affected', base: head, changedFiles: 1, fallback: null })
  })

  it('measures the changes from the merge base, so a committed change counts', async () => {
    const { project, head } = await createAffectedRun()
    const graph = fakeGraph()
    const { options, record } = fakeBrowser()

    git(project, 'checkout', '-q', '-b', 'feature')
    commit(project, { 'src/badge.tsx': 'export const Badge = 2\n' })

    const result = await runCli(['test'], {}, project, { ...options, findReachedFiles: graph.findReachedFiles })

    expect(result.exitCode).toBe(0)
    expect(capturedIdsOf(record)).toEqual(['badge--primary'])
    expect(graph.calls).toEqual([{ root: project, changedFiles: ['src/badge.tsx'] }])
    expect(readReport(project).selection).toEqual({ by: 'affected', base: head, changedFiles: 1, fallback: null })
  })

  it('captures every story of the Storybook when its preview changes, whatever the graph reaches', async () => {
    const { project } = await createAffectedRun()
    const graph = fakeGraph()
    const { options, record } = fakeBrowser()

    writeFiles(project, { '.storybook/preview.ts': 'export default { tags: [] }\n' })

    const result = await runCli(['test'], {}, project, { ...options, findReachedFiles: graph.findReachedFiles })

    expect(result.exitCode).toBe(0)
    expect(capturedIdsOf(record)).toEqual(['badge--primary', 'button--primary', 'card--primary'])
    expect(graph.calls).toEqual([{ root: project, changedFiles: ['.storybook/preview.ts'] }])
  })

  it("covers every story with a warning when the graph can't answer, and the report says why", async () => {
    const { project, head } = await createAffectedRun()
    const { options, record } = fakeBrowser()

    writeFiles(project, { 'src/button.tsx': 'export const Button = 2\n' })

    const result = await runCli(['test'], {}, project, {
      ...options,
      findReachedFiles: async () => ({ cantAnswer: 'Fallow ran out of memory' }),
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe(fallbackWarningOf('Fallow ran out of memory'))
    expect(capturedIdsOf(record)).toEqual(['badge--primary', 'button--primary', 'card--primary'])
    expect(readReport(project).selection).toEqual({
      by: 'affected',
      base: head,
      changedFiles: 1,
      fallback: 'Fallow ran out of memory',
    })
  })

  it("covers every story with a warning, never asking the graph, when the folder isn't in a git repository", async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const graph = fakeGraph()
    const { options, record } = fakeBrowser()
    const result = await runCli(['test', '--reporter', 'json'], {}, project, {
      ...options,
      findReachedFiles: graph.findReachedFiles,
    })
    const reason = "the folder isn't in a git repository"

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain(fallbackWarningOf(reason))
    expect(capturedIdsOf(record)).toEqual(['a'])
    expect(graph.calls).toEqual([])
    expect((JSON.parse(result.stdout) as TestReport).selection).toEqual({
      by: 'affected',
      base: null,
      changedFiles: null,
      fallback: reason,
    })
  })

  it('covers every story with a warning when no base branch resolves', async () => {
    const { project } = await createAffectedRun()
    const graph = fakeGraph()
    const { options, record } = fakeBrowser()

    git(project, 'branch', '-q', '-m', 'feature')

    const result = await runCli(['update', '--reporter', 'json'], {}, project, {
      ...options,
      findReachedFiles: graph.findReachedFiles,
    })
    const reason = 'no base branch found (tried origin/HEAD, origin/main, origin/master, main and master)'

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain(fallbackWarningOf(reason))
    expect(capturedIdsOf(record)).toEqual(['badge--primary', 'button--primary', 'card--primary'])
    expect(graph.calls).toEqual([])
    expect((JSON.parse(result.stdout) as UpdateReport).selection).toEqual({
      by: 'affected',
      base: null,
      changedFiles: null,
      fallback: reason,
    })
  })

  it('covers every story with a warning when the base branch shares no history with HEAD', async () => {
    const { project } = await createAffectedRun()
    const graph = fakeGraph()
    const { options, record } = fakeBrowser()

    git(project, 'checkout', '-q', '-b', 'feature')
    git(project, 'branch', '-f', 'main', git(project, 'commit-tree', 'HEAD^{tree}', '-m', 'unrelated'))

    const result = await runCli(['test', '--reporter', 'json'], {}, project, {
      ...options,
      findReachedFiles: graph.findReachedFiles,
    })
    const reason = "there's no merge base with main, as in a shallow clone or with unrelated history"

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain(fallbackWarningOf(reason))
    expect(capturedIdsOf(record)).toEqual(['badge--primary', 'button--primary', 'card--primary'])
    expect(graph.calls).toEqual([])
    expect((JSON.parse(result.stdout) as TestReport).selection).toEqual({
      by: 'affected',
      base: null,
      changedFiles: null,
      fallback: reason,
    })
  })

  it('captures nothing when no file changed, hints at --all, and still exits 1 on a missing baseline', async () => {
    const { project, head } = await createAffectedRun({ baselines: ['button--primary', 'card--primary'] })
    const graph = fakeGraph()
    const { options, record } = fakeBrowser()
    const result = await runCli(['test'], {}, project, { ...options, findReachedFiles: graph.findReachedFiles })
    const lines = result.stdout.split('\n')

    expect(result.exitCode).toBe(1)
    expect(lines[1]).toBe(
      `No files changed since ${head.slice(0, 7)}, so no story is affected. Run with --all to cover every story.`,
    )
    expect(lines).toContain(missingLineOf('web', 'badge--primary'))
    expect(record.captures).toEqual([])
    expect(graph.calls).toEqual([])
    expect(readReport(project).selection).toEqual({ by: 'affected', base: head, changedFiles: 0, fallback: null })
  })

  it('says how many changed files affect no story', async () => {
    const { project } = await createAffectedRun()
    const { options, record } = fakeBrowser()

    writeFiles(project, { 'README.md': 'Read me.\n', 'notes.txt': 'Notes.\n' })

    const result = await runCli(['test'], {}, project, { ...options, findReachedFiles: fakeGraph().findReachedFiles })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.split('\n')[1]).toBe(
      'None of the 2 changed files affects a story. Run with --all to cover every story.',
    )
    expect(record.captures).toEqual([])
  })

  it('writes every missing baseline and deletes every orphan in update when no file changed, rewriting nothing', async () => {
    const { project, head } = await createAffectedRun({
      baselines: ['button--primary', 'card--primary', 'old--story'],
    })
    const folder = join(project, '.visual-check', 'baselines')
    // The button now renders differently, which update would write, were it selected.
    const { options, record } = fakeBrowser({ 'button--primary': { snapshot: otherSnapshot } })
    const result = await runCli(['update', '--reporter', 'json'], {}, project, {
      ...options,
      findReachedFiles: fakeGraph().findReachedFiles,
    })
    const document = JSON.parse(result.stdout) as UpdateReport

    expect(result.exitCode).toBe(0)
    expect(result.stderr.split('\n')[1]).toBe(
      `No files changed since ${head.slice(0, 7)}, so no story is affected. Run with --all to cover every story.`,
    )
    expect(capturedIdsOf(record)).toEqual(['badge--primary'])
    expect(document.counts).toEqual({ written: 1, deleted: 1, kept: 0, broken: 0, flaky: 0 })
    expect(new Uint8Array(readFileSync(join(folder, 'button--primary.png')))).toEqual(defaultRunSnapshot)
    expect(document.selection).toEqual({ by: 'affected', base: head, changedFiles: 0, fallback: null })
  })

  it('exits 2 with the problem, writing the error report, for a --base that names no commit', async () => {
    const { project } = await createAffectedRun()
    const { options, record } = fakeBrowser()
    const result = await runCli(['test', '--base', 'nope'], {}, project, {
      ...options,
      findReachedFiles: fakeGraph().findReachedFiles,
    })
    const message = "--base names nope, which isn't a commit in this repository."

    expect(result).toEqual({ exitCode: 2, stdout: '', stderr: `${message}\n`, reportLine: reportOnStderr })
    expect(record.captures).toEqual([])
    expect(readReport(project)).toMatchObject({
      exitCode: 2,
      selection: { by: 'affected', base: null, changedFiles: null, fallback: null },
      error: { message },
    })
  })

  it('measures the changes from the merge base with --base', async () => {
    const { project } = await createAffectedRun()
    const graph = fakeGraph()
    const { options, record } = fakeBrowser()

    git(project, 'checkout', '-q', '-b', 'feature')

    const forked = commit(project, { 'src/badge.tsx': 'export const Badge = 2\n' })

    commit(project, { 'src/button.tsx': 'export const Button = 2\n' })

    const result = await runCli(['test', '--base', forked], {}, project, {
      ...options,
      findReachedFiles: graph.findReachedFiles,
    })

    expect(result.exitCode).toBe(0)
    expect(graph.calls).toEqual([{ root: project, changedFiles: ['src/button.tsx'] }])
    expect(capturedIdsOf(record)).toEqual(['button--primary', 'card--primary'])
    expect(readReport(project).selection).toMatchObject({ by: 'affected', base: forked, changedFiles: 1 })
  })

  it('covers every story in CI without reading git or the graph', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const graph = fakeGraph()
    const { options, record } = fakeBrowser()
    const result = await runCli(['test'], { CI: 'true' }, project, {
      ...options,
      findReachedFiles: graph.findReachedFiles,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(capturedIdsOf(record)).toEqual(['a'])
    expect(graph.calls).toEqual([])
    expect(readReport(project).selection).toEqual({ by: 'all', base: null, changedFiles: null, fallback: null })
  })

  it('covers the affected stories in CI with --affected', async () => {
    const { project, head } = await createAffectedRun()
    const graph = fakeGraph()
    const { options, record } = fakeBrowser()

    writeFiles(project, { 'src/badge.tsx': 'export const Badge = 2\n' })

    const result = await runCli(['test', '--affected'], { CI: 'true' }, project, {
      ...options,
      findReachedFiles: graph.findReachedFiles,
    })

    expect(result.exitCode).toBe(0)
    expect(capturedIdsOf(record)).toEqual(['badge--primary'])
    expect(readReport(project).selection).toEqual({ by: 'affected', base: head, changedFiles: 1, fallback: null })
  })

  it('covers every story of a shard run locally, without reading git or the graph', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const graph = fakeGraph()
    const { options, record } = fakeBrowser()
    const result = await runCli(['test', '--shard', '1/1'], {}, project, {
      ...options,
      findReachedFiles: graph.findReachedFiles,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(capturedIdsOf(record)).toEqual(['a'])
    expect(graph.calls).toEqual([])
    expect(readReport(project).selection).toEqual({ by: 'all', base: null, changedFiles: null, fallback: null })
  })

  it('narrows the affected stories to the Storybook --storybook names', async () => {
    const docsUrl = await startStorybook(['intro--page'], { 'intro--page': './intro.stories.tsx' })
    const { project } = await createAffectedRun({ extra: { 'docs/intro.stories.tsx': '' } })

    writeFiles(project, {
      'visual-check.config.mjs': readFileSync(join(project, 'visual-check.config.mjs'), 'utf8').replace(
        '} } }',
        `}, docs: { url: '${docsUrl}', dir: 'docs' } } }`,
      ),
    })
    commit(project)
    writeFiles(project, { 'src/button.tsx': 'export const Button = 2\n' })

    const web = fakeBrowser()
    const webResult = await runCli(['test', '--storybook', 'web'], {}, project, {
      ...web.options,
      findReachedFiles: fakeGraph().findReachedFiles,
    })
    const docs = fakeBrowser()
    const docsResult = await runCli(['test', '--storybook', 'docs'], {}, project, {
      ...docs.options,
      findReachedFiles: fakeGraph().findReachedFiles,
    })

    expect(webResult.exitCode).toBe(0)
    expect(capturedIdsOf(web.record)).toEqual(['button--primary', 'card--primary'])
    // The docs Storybook's one story has no baseline, so its consistency check fails the run.
    expect(docsResult.exitCode).toBe(1)
    expect(docsResult.stdout.split('\n')).toContain(missingLineOf('docs', 'intro--page'))
    expect(docsResult.stdout.split('\n')[1]).toBe(
      'The changed file affects no story. Run with --all to cover every story.',
    )
    expect(docs.record.captures).toEqual([])
  })

  it('covers every story of test --consistency locally, without reading git or the graph', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const graph = fakeGraph()
    const { options, record } = fakeBrowser()
    const result = await runCli(['test', '--consistency'], {}, project, {
      ...options,
      findReachedFiles: graph.findReachedFiles,
    })

    expect(result.exitCode).toBe(0)
    // Working out the affected stories here would warn that the folder isn't in a git repository.
    expect(result.stderr).toBe('')
    expect(record.captures).toEqual([])
    expect(graph.calls).toEqual([])
    expect(readReport(project).selection).toEqual({ by: 'all', base: null, changedFiles: null, fallback: null })
  })
})

describe('runCli stopping once it covers the affected stories', () => {
  it.each([
    ['taking the snapshots', 'A bug in closing the browser.', (options: RunCliOptions) => closingBugOf(options)],
    ['writing the report', 'A bug in the clock.', (options: RunCliOptions) => ({ ...options, now: clockBug() })],
  ])(
    'keeps how the run picked its stories in the error report of an error that is a bug %s',
    async (_name, message, withBug) => {
      const { project, head } = await createAffectedRun()

      writeFiles(project, { 'src/button.tsx': 'export const Button = 2\n' })

      const result = await runCli(['test'], {}, project, {
        ...withBug(fakeBrowser().options),
        findReachedFiles: fakeGraph().findReachedFiles,
      })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain(`Error: ${message}\n    at `)
      expect(readReport(project)).toMatchObject({
        exitCode: 2,
        selection: { by: 'affected', base: head, changedFiles: 1, fallback: null },
        error: { message },
      })
    },
  )

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    "keeps how the run picked its stories in the error document when report.json can't be written",
    async () => {
      const { project, head } = await createAffectedRun()
      const visualCheckFolder = join(project, '.visual-check')

      writeFiles(project, { 'src/button.tsx': 'export const Button = 2\n' })
      chmodSync(visualCheckFolder, 0o555)

      try {
        const result = await runCli(['test', '--reporter', 'json'], {}, project, {
          ...fakeBrowser().options,
          findReachedFiles: fakeGraph().findReachedFiles,
        })
        const document = JSON.parse(result.stdout) as TestReport

        expect(result.exitCode).toBe(2)
        expect(document.error?.message).toMatch(/^visual-check couldn't write \.visual-check\/report: EACCES/)
        expect(document.selection).toEqual({ by: 'affected', base: head, changedFiles: 1, fallback: null })
      } finally {
        chmodSync(visualCheckFolder, 0o755)
      }
    },
  )
})
