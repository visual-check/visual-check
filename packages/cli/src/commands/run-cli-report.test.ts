import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
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
  takeUnusedUrl,
  usageHint,
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

  it('prints only the report document on stdout with --reporter json, the rest on stderr', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'retries: 0')
    const browser = fakeBrowser({ b: { snapshot: otherSnapshot } })
    const result = await runCli(['test', '--reporter', 'json'], {}, project, browser.options)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.endsWith('\n')).toBe(true)
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1)
    expect(JSON.parse(result.stdout)).toEqual(readReport(project))
    expect(result.stdout).toBe(readFileSync(join(reportFolderIn(project), 'report.json'), 'utf8'))
    expect(result.stdout).not.toContain('Report:')
    expect(lastLineOf(result.stderr)).toBe(reportLine)
  })

  it.each(['live', 'log'])('prints the same with --reporter %s as with no flag', async (reporter) => {
    const plain = await createRun(['a'], { a: defaultRunSnapshot })
    const flagged = await createRun(['a'], { a: defaultRunSnapshot })
    const expected = await runCli(['test'], {}, plain.project, fakeBrowser().options)
    const result = await runCli(['test', '--reporter', reporter], {}, flagged.project, fakeBrowser().options)

    expect(result).toEqual(expected)
  })
})

/**
 * The report of a `test` that exits 2 with the given error, as the run in the project's own folder writes it, for a
 * run whose config wasn't loaded.
 */
function errorReportOf(error: TestReport['error'], storybooks: TestReport['storybooks'] = []): TestReport {
  return {
    version: 1,
    visualCheck: version,
    command: 'test',
    consistencyOnly: false,
    exitCode: 2,
    shard: null,
    selection: { by: 'all', base: null, changedFiles: null, fallback: null },
    reportDir: '.visual-check/report',
    storybooks,
    counts: { passed: 0, flaky: 0, differs: 0, broken: 0, missing: 0, orphan: 0 },
    snapshots: [],
    warnings: [],
    error,
  }
}

/**
 * The fix a report folder that can't be written asks for.
 */
const writableFix = 'Check that its folder is writable and the disk has room.'

describe('runCli test report on exit 2', () => {
  it('replaces a stale report with one holding the config error, ending stderr with the report line', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, "colour: 'red'")

    writeStaleReport(project)

    const result = await runCli(['test'], {}, project, fakeBrowser().options)
    const message = result.stderr.slice(0, -`\n${reportLine}\n`.length)

    expect(message).toMatch(/^visual-check\.config\.mjs is invalid:\n {2}- colour: unknown key\./)
    expect(result).toEqual({ exitCode: 2, stdout: '', stderr: `${message}\n${reportLine}\n` })
    expect(readdirSync(reportFolderIn(project))).toEqual(['report.json'])
    expect(readReport(project)).toEqual(errorReportOf({ message, storybooks: [] }))
  })

  it('writes the usage error of a test beside the config the search finds, without the hint', async () => {
    const { project } = await createRun(['a'])
    const result = await runCli(['test', '--all', '--filter', 'a'], {}, project, fakeBrowser().options)
    const message = "--all and --filter can't be used together. Pick one."

    expect(result).toEqual({ exitCode: 2, stdout: '', stderr: `${message}\n${usageHint}${reportLine}\n` })
    expect(readReport(project)).toEqual(errorReportOf({ message, storybooks: [] }))
  })

  it('writes the usage error beside the config --config gives', async () => {
    const { project } = await createRun(['a'])
    const cwd = join(project, 'apps')

    mkdirSync(cwd)

    const result = await runCli(
      ['test', '--shard', '0/2', '--config', '../visual-check.config.mjs'],
      {},
      cwd,
      fakeBrowser().options,
    )

    expect(lastLineOf(result.stderr)).toBe('Report: ../.visual-check/report/report.json')
    expect(readReport(project).error?.message).toMatch(/^--shard takes k\/n/)
  })

  it('names the unreachable Storybook and its URL in the error', async () => {
    const url = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
    })
    const result = await runCli(['test'], {}, project, fakeBrowser().options)
    const report = readReport(project)

    expect(result.exitCode).toBe(2)
    expect(lastLineOf(result.stderr)).toBe(reportLine)
    expect(report.storybooks).toEqual([{ name: 'web', url }])
    expect(report.error).toEqual({
      message: result.stderr.slice(0, -`${reportLine}\n`.length).trim(),
      storybooks: [{ name: 'web', url }],
    })
    expect(report.error?.message).toContain(url)
  })

  it('wipes the images of a run the browser stops mid-run, keeping the lines it printed', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'workers: 1')
    const { options } = fakeBrowser({
      a: { browserExits: true },
      b: { captures: [{ snapshot: otherSnapshot }, { browserExits: true }] },
    })
    const result = await runCli(['test'], {}, project, options)
    const report = readReport(project)

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toContain('! web  a  broken: The browser exited')
    expect(lastLineOf(result.stderr)).toBe(reportLine)
    expect(readdirSync(reportFolderIn(project))).toEqual(['report.json'])
    expect(report).toMatchObject({ exitCode: 2, snapshots: [], counts: { passed: 0, broken: 0, differs: 0 } })
    expect(report.error?.message).toMatch(/^The browser was killed by signal SIGKILL while in use\.\n/)
    expect(report.error?.message).not.toContain('relaunches')
  })

  it("holds the error of a baseline that can't be decoded, and no results", async () => {
    const { project } = await createRun(['a'], { a: new TextEncoder().encode('not a PNG file') })
    const result = await runCli(['test'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(2)
    expect(readReport(project).error).toEqual({
      message:
        "visual-check couldn't decode the baseline .visual-check/baselines/a.png: Input buffer contains unsupported " +
        'image format. Delete it or restore it from git, then run visual-check again.',
      storybooks: [],
    })
  })

  it('prints only the error document on stdout with --reporter json, dropping the lines printed so far', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'workers: 1')
    const { options } = fakeBrowser({ a: { browserExits: true }, b: { browserExits: true } })
    const result = await runCli(['test', '--reporter', 'json'], {}, project, options)

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe(readFileSync(join(reportFolderIn(project), 'report.json'), 'utf8'))
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1)
    expect(lastLineOf(result.stderr)).toBe(reportLine)
  })

  it('writes nothing when no config is found, and prints the error document with no report folder for json', async () => {
    const project = createProject({})
    const result = await runCli(['test', '--reporter', 'json'], {}, project, fakeBrowser().options)
    const message =
      'No visual-check.config.ts (or .mts, .js, .mjs) found in the current folder or its parents. ' +
      'Run visual-check init to create one.'

    expect(result).toEqual({
      exitCode: 2,
      stdout: `${JSON.stringify({ ...errorReportOf({ message, storybooks: [] }), reportDir: null })}\n`,
      stderr: `${message}\n`,
    })
    expect(existsSync(join(project, '.visual-check'))).toBe(false)
  })

  it('writes nothing for a usage error when --config gives no config file', async () => {
    const { project } = await createRun(['a'])
    const result = await runCli(['test', '--all', '--filter', 'a', '--config', 'missing.mjs'], {}, project)

    expect(result.stderr.endsWith(usageHint)).toBe(true)
    expect(existsSync(reportFolderIn(project))).toBe(false)
  })

  it('writes nothing for an unknown flag, which stays plain text', async () => {
    const { project } = await createRun(['a'])
    const result = await runCli(['test', '--nope', '--reporter', 'json'], {}, project)

    expect(result.stdout).toBe('')
    expect(existsSync(reportFolderIn(project))).toBe(false)
  })

  it('leaves the report folder untouched when update exits 2', async () => {
    const { project } = await createRun(['a'], {}, "colour: 'red'")
    const image = writeStaleReport(project)
    const result = await runCli(['update'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).not.toContain('Report:')
    expect(existsSync(image)).toBe(true)
    expect(readdirSync(reportFolderIn(project))).toEqual(['images'])
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    "stops once, writing no error report, when a snapshot's images can't be written mid-run",
    async () => {
      const { project, url } = await createRun(['a'], { a: defaultRunSnapshot }, 'retries: 0')
      const visualCheckFolder = join(project, '.visual-check')
      const problem = `visual-check couldn't write .visual-check/report/images/web: EACCES: permission denied. ${writableFix}`
      const browser = fakeBrowser({ a: { snapshot: otherSnapshot } })

      chmodSync(visualCheckFolder, 0o555)

      try {
        const result = await runCli(['test', '--reporter', 'json'], {}, project, browser.options)

        expect(result).toEqual({
          exitCode: 2,
          stdout: `${JSON.stringify({ ...errorReportOf({ message: problem, storybooks: [] }, [{ name: 'web', url }]), reportDir: null })}\n`,
          stderr: `${problem}\n`,
        })
      } finally {
        chmodSync(visualCheckFolder, 0o755)
      }

      expect(existsSync(reportFolderIn(project))).toBe(false)
    },
  )

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    "keeps the error and adds the report's problem when the error report can't be written",
    async () => {
      const { project } = await createRun(['a'], { a: defaultRunSnapshot }, "colour: 'red'")
      const visualCheckFolder = join(project, '.visual-check')
      const problem = `visual-check couldn't write .visual-check/report: EACCES: permission denied. ${writableFix}`

      chmodSync(visualCheckFolder, 0o555)

      try {
        const result = await runCli(['test', '--reporter', 'json'], {}, project, fakeBrowser().options)
        const message = result.stderr.slice(0, -`\n${problem}\n`.length)

        expect(message).toMatch(/^visual-check\.config\.mjs is invalid:\n/)
        expect(result).toEqual({
          exitCode: 2,
          stdout: `${JSON.stringify({ ...errorReportOf({ message, storybooks: [] }), reportDir: null })}\n`,
          stderr: `${message}\n${problem}\n`,
        })
      } finally {
        chmodSync(visualCheckFolder, 0o755)
      }

      expect(existsSync(reportFolderIn(project))).toBe(false)
    },
  )

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    "exits 2 with the report's problem, and no error report, when report.json can't be written",
    async () => {
      const { project, url } = await createRun(['a'], { a: defaultRunSnapshot })
      const visualCheckFolder = join(project, '.visual-check')
      const problem = `visual-check couldn't write .visual-check/report: EACCES: permission denied. ${writableFix}`

      chmodSync(visualCheckFolder, 0o555)

      try {
        const result = await runCli(['test'], {}, project, fakeBrowser().options)
        const json = await runCli(['test', '--reporter', 'json'], {}, project, fakeBrowser().options)

        expect(result.exitCode).toBe(2)
        expect(result.stdout).toContain('1 passed')
        expect(result.stdout).not.toContain('Report:')
        expect(result.stderr).toBe(`${problem}\n`)
        expect(json).toEqual({
          exitCode: 2,
          stdout: `${JSON.stringify({ ...errorReportOf({ message: problem, storybooks: [] }, [{ name: 'web', url }]), reportDir: null })}\n`,
          stderr: `${problem}\n`,
        })
      } finally {
        chmodSync(visualCheckFolder, 0o755)
      }

      expect(existsSync(reportFolderIn(project))).toBe(false)
    },
  )

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    "exits 2 with the report's problem, and no error report, when an orphan's baseline can't be copied",
    async () => {
      const { project, folder } = await createRun(['a'], { a: defaultRunSnapshot, gone: defaultRunSnapshot })
      const orphan = join(folder, 'gone.png')

      chmodSync(orphan, 0o000)

      try {
        const result = await runCli(['test'], {}, project, fakeBrowser().options)

        expect(result.exitCode).toBe(2)
        expect(result.stderr).toBe(
          "visual-check couldn't copy .visual-check/baselines/gone.png: EACCES: permission denied. " +
            "Check that it's a file visual-check can read.\n",
        )
      } finally {
        chmodSync(orphan, 0o644)
      }

      expect(existsSync(join(reportFolderIn(project), 'report.json'))).toBe(false)
    },
  )
})
