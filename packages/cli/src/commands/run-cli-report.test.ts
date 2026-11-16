import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { TestReport, TestReportEntry } from '../report/report-document.js'
import { greyPng } from '../visual-diff/images.fixture.js'
import {
  ciStopLine,
  cleanUpRuns,
  createProject,
  createRun,
  defaultRunSnapshot,
  fakeBrowser,
  otherSnapshot,
  removeMarkerFolder,
  reportFolderIn,
  reportLine,
  startStorybook,
  version,
  writeStaleReport,
} from './run-cli.fixture.js'
import { runCli } from './run-cli.js'

afterEach(cleanUpRuns)
afterAll(removeMarkerFolder)

/**
 * Reads the `report.json` of the report folder beside the project's config.
 */
function readReport(project: string): TestReport {
  return JSON.parse(readFileSync(join(reportFolderIn(project), 'report.json'), 'utf8')) as TestReport
}

/**
 * Reads an image of the report, by its path relative to the report folder.
 */
function readImage(project: string, path: string | null): Uint8Array {
  if (path === null) {
    throw new Error('The report lists no such image.')
  }

  return new Uint8Array(readFileSync(join(reportFolderIn(project), path)))
}

/**
 * Gives the last line a stream holds.
 */
function lastLineOf(text: string): string | undefined {
  return text.trimEnd().split('\n').at(-1)
}

/**
 * Gives the one entry of a report.
 *
 * @throws {Error} When the report doesn't list exactly one snapshot.
 */
function onlyEntryOf(report: TestReport): TestReportEntry {
  const [entry, ...rest] = report.snapshots

  if (entry === undefined || rest.length > 0) {
    throw new Error(`The report lists ${report.snapshots.length} snapshots.`)
  }

  return entry
}

/**
 * The images of an entry that has none.
 */
const noImages = { baseline: null, snapshot: null, diff: null }

describe('runCli test report', () => {
  it('replaces a stale report with report.json alone when every snapshot passes, counting them', async () => {
    const { project, url } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot })

    writeStaleReport(project)

    const result = await runCli(['test'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(lastLineOf(result.stdout)).toBe(reportLine)
    expect(readdirSync(reportFolderIn(project))).toEqual(['report.json'])
    expect(readReport(project)).toEqual({
      version: 1,
      visualCheck: version,
      command: 'test',
      consistencyOnly: false,
      exitCode: 0,
      shard: null,
      selection: { by: 'all', base: null, changedFiles: null, fallback: null },
      reportDir: '.visual-check/report',
      storybooks: [{ name: 'web', url }],
      counts: { passed: 2, flaky: 0, differs: 0, broken: 0, missing: 0, orphan: 0 },
      snapshots: [],
      warnings: [],
      error: null,
    })
  })

  it('lists a snapshot that differs by pixels, with its images', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'retries: 0')
    const result = await runCli(['test'], {}, project, fakeBrowser({ b: { snapshot: otherSnapshot } }).options)
    const report = readReport(project)
    const entry = onlyEntryOf(report)

    expect(result.exitCode).toBe(1)
    expect(lastLineOf(result.stdout)).toBe(reportLine)
    expect(report.exitCode).toBe(1)
    expect(report.counts).toEqual({ passed: 1, flaky: 0, differs: 1, broken: 0, missing: 0, orphan: 0 })
    expect(entry).toEqual({
      storybook: 'web',
      id: 'b',
      kind: 'story',
      story: 'b',
      importPath: './button.stories.tsx',
      mode: null,
      status: 'differs',
      reason: 'pixels',
      message: '100 differ, 20 allowed',
      flaky: false,
      attempts: 1,
      pixels: { differ: 100, allowed: 20, budget: 20, scale: 1 },
      size: null,
      details: null,
      hints: [],
      console: [],
      baseline: '.visual-check/baselines/b.png',
      images: {
        baseline: 'images/web/b.baseline.png',
        snapshot: 'images/web/b.snapshot.png',
        diff: 'images/web/b.diff.png',
      },
    })
    expect(readImage(project, entry.images.baseline)).toEqual(defaultRunSnapshot)
    expect(readImage(project, entry.images.snapshot)).toEqual(otherSnapshot)
    expect([...readImage(project, entry.images.diff).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('lists a size difference with both sizes', async () => {
    const taller = new Uint8Array(await greyPng(10, 12, 0))
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, 'retries: 0')
    const result = await runCli(['test'], {}, project, fakeBrowser({ a: { snapshot: taller } }).options)
    const entry = onlyEntryOf(readReport(project))

    expect(result.exitCode).toBe(1)
    expect(entry).toMatchObject({
      status: 'differs',
      reason: 'size',
      size: { baseline: [10, 10], snapshot: [10, 12] },
    })
    expect(readImage(project, entry.images.snapshot)).toEqual(taller)
  })

  it('lists a missing baseline with no image and no attempt', async () => {
    const { project } = await createRun(['a'])
    const result = await runCli(['test'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(1)
    expect(onlyEntryOf(readReport(project))).toMatchObject({
      id: 'a',
      status: 'missing',
      reason: null,
      attempts: 0,
      images: noImages,
    })
    expect(readdirSync(reportFolderIn(project))).toEqual(['report.json'])
  })

  it('lists an orphan with its baseline copied into the report', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot, gone: otherSnapshot })
    const result = await runCli(['test'], {}, project, fakeBrowser().options)
    const report = readReport(project)
    const entry = onlyEntryOf(report)

    expect(result.exitCode).toBe(1)
    expect(report.counts).toEqual({ passed: 1, flaky: 0, differs: 0, broken: 0, missing: 0, orphan: 1 })
    expect(entry).toMatchObject({
      id: 'gone',
      status: 'orphan',
      story: null,
      importPath: null,
      baseline: '.visual-check/baselines/gone.png',
      images: { baseline: 'images/web/gone.baseline.png', snapshot: null, diff: null },
    })
    expect(readImage(project, entry.images.baseline)).toEqual(otherSnapshot)
  })

  it("lists a flaky pass with its first attempt's images", async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const result = await runCli(
      ['test'],
      {},
      project,
      fakeBrowser({ a: { captures: [{ snapshot: otherSnapshot }, {}] } }).options,
    )
    const report = readReport(project)
    const entry = onlyEntryOf(report)

    expect(result.exitCode).toBe(0)
    expect(report.counts).toEqual({ passed: 1, flaky: 1, differs: 0, broken: 0, missing: 0, orphan: 0 })
    expect(entry).toMatchObject({ status: 'passed', reason: null, flaky: true, attempts: 2 })
    expect(readImage(project, entry.images.snapshot)).toEqual(otherSnapshot)
  })

  it('lists a broken story with the image of its page, its details and its console', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const story = { broken: true, messages: [{ kind: 'console.error' as const, text: 'boom' }] }
    const result = await runCli(['test'], {}, project, fakeBrowser({ a: story }).options)
    const entry = onlyEntryOf(readReport(project))

    expect(result.exitCode).toBe(1)
    expect(entry).toMatchObject({
      status: 'broken',
      reason: 'error',
      attempts: 1,
      details: {},
      console: [{ level: 'error', text: 'boom' }],
      images: { baseline: null, snapshot: 'images/web/a.snapshot.png', diff: null },
    })
    expect(existsSync(join(reportFolderIn(project), 'images', 'web', 'a.snapshot.png'))).toBe(true)
  })

  it("lists a mode's snapshot by its key and mode", async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const { options } = fakeBrowser(
      {},
      { read: { options: { a: { modes: { dark: { globals: { theme: 'dark' } } } } } } },
    )
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(onlyEntryOf(readReport(project))).toMatchObject({
      id: 'a.dark',
      story: 'a',
      mode: 'dark',
      status: 'missing',
      baseline: '.visual-check/baselines/a.dark.png',
    })
  })

  it('names the selection --filter makes', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot })
    const result = await runCli(['test', '--filter', '^a$'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(readReport(project).selection).toEqual({ by: 'filter', base: null, changedFiles: null, fallback: null })
  })

  it('writes a shard its own report', async () => {
    const { project } = await createRun(['a', 'b', 'c'], {}, '', {
      a: './a.stories.tsx',
      b: './b.stories.tsx',
      c: './c.stories.tsx',
    })
    const result = await runCli(['test', '--shard', '2/3'], {}, project, fakeBrowser().options)
    const report = readReport(project)

    expect(result.exitCode).toBe(1)
    expect(lastLineOf(result.stdout)).toBe(reportLine)
    expect(report.shard).toEqual({ index: 2, total: 3 })
    expect(report.snapshots.map(({ id, status }) => [id, status])).toEqual([['b', 'missing']])
  })

  it('puts the report beside the config, and its path relative to the folder the CLI runs in', async () => {
    const url = await startStorybook(['a'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'packages/web', url: '${url}' } } }\n`,
      'packages/web/button.stories.tsx': '',
      'packages/web/.visual-check/baselines/a.png': defaultRunSnapshot,
    })
    const result = await runCli(['test'], {}, join(project, 'packages', 'web'), fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(lastLineOf(result.stdout)).toBe('Report: ../../.visual-check/report/report.json')
    expect(readReport(project).reportDir).toBe('.visual-check/report')
  })

  it('leaves the report folder untouched in update', async () => {
    const { project } = await createRun(['a'])
    const image = writeStaleReport(project)
    const result = await runCli(['update'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).not.toContain('Report:')
    expect(readdirSync(reportFolderIn(project))).toEqual(['images'])
    expect(existsSync(image)).toBe(true)
  })
})

describe('runCli test report after the consistency check', () => {
  /**
   * The stories `./a.stories.tsx` holds, which fails to load, and the story `./b.stories.tsx` holds.
   */
  const importPaths = { a1: './a.stories.tsx', a2: './a.stories.tsx', b: './b.stories.tsx' }

  /**
   * Fake browser options whose read finds `./a.stories.tsx` failing to load.
   */
  const aFileFails = { read: { failed: { './a.stories.tsx': 'SyntaxError: boom' } } }

  it('lists each story of a stories file that failed to load as broken, load-failed, for --consistency', async () => {
    const { project } = await createRun(['a1', 'a2', 'b'], { gone: defaultRunSnapshot }, '', importPaths)
    const result = await runCli(['test', '--consistency'], {}, project, fakeBrowser({}, aFileFails).options)
    const report = readReport(project)

    expect(result.exitCode).toBe(1)
    expect(lastLineOf(result.stdout)).toBe(reportLine)
    expect(report).toMatchObject({ consistencyOnly: true, exitCode: 1 })
    expect(report.counts).toEqual({ passed: 0, flaky: 0, differs: 0, broken: 2, missing: 1, orphan: 1 })
    expect(report.snapshots.map(({ id, status, reason }) => [id, status, reason])).toEqual([
      ['a1', 'broken', 'load-failed'],
      ['a2', 'broken', 'load-failed'],
      ['b', 'missing', null],
      ['gone', 'orphan', null],
    ])
    expect(report.snapshots[0]).toMatchObject({ attempts: 0, details: { loadError: 'SyntaxError: boom' } })
    expect(readdirSync(join(reportFolderIn(project), 'images', 'web'))).toEqual(['gone.baseline.png'])
  })

  it('writes the findings of a CI test that stops before capturing, ending stdout with the report line', async () => {
    const { project } = await createRun(['a1', 'a2', 'b'], { b: defaultRunSnapshot }, '', importPaths)
    const result = await runCli(['test'], { CI: 'true' }, project, fakeBrowser({}, aFileFails).options)
    const report = readReport(project)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.endsWith(`\n${ciStopLine}\n${reportLine}\n`)).toBe(true)
    expect(report).toMatchObject({ consistencyOnly: false, exitCode: 1 })
    expect(report.snapshots.map(({ id, status }) => [id, status])).toEqual([
      ['a1', 'broken'],
      ['a2', 'broken'],
    ])
  })
})
