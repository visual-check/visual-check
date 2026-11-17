import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { TestReport, TestReportEntry, UpdateReport } from '../report/report-document.js'
import { greyPng } from '../visual-diff/images.fixture.js'
import {
  absentMarkerPath,
  browserPackage,
  ciStopLine,
  cleanUpRuns,
  createProject,
  createRun,
  defaultRunSnapshot,
  type FakeStory,
  fakeBrowser,
  fakeDriverOf,
  headerOf,
  hostOptions,
  installStorybook,
  newRecord,
  otherSnapshot,
  printed,
  removeMarkerFolder,
  reportFolderIn,
  reportOnStderr,
  reportOnStdout,
  startStorybook,
  takeUnusedUrl,
  usageHint,
  version,
  withoutTimes,
  writeStaleReport,
} from './run-cli.fixture.js'
import { type RunCliOptions, runCli } from './run-cli.js'

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

    const result = await runCli(['test', '--all'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(result.reportLine).toEqual(reportOnStdout)
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
    const result = await runCli(['test', '--all'], {}, project, fakeBrowser({ b: { snapshot: otherSnapshot } }).options)
    const report = readReport(project)
    const entry = onlyEntryOf(report)

    expect(result.exitCode).toBe(1)
    expect(result.reportLine).toEqual(reportOnStdout)
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
    const result = await runCli(['test', '--all'], {}, project, fakeBrowser({ a: { snapshot: taller } }).options)
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
    const result = await runCli(['test', '--all'], {}, project, fakeBrowser().options)

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
    const result = await runCli(['test', '--all'], {}, project, fakeBrowser().options)
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
      ['test', '--all'],
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
    const story = { broken: true, consoleMessages: [{ kind: 'console.error' as const, text: 'boom' }] }
    const result = await runCli(['test', '--all'], {}, project, fakeBrowser({ a: story }).options)
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
    const result = await runCli(['test', '--all'], {}, project, options)

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
    expect(result.reportLine).toEqual(reportOnStdout)
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
    const result = await runCli(['test', '--all'], {}, join(project, 'packages', 'web'), fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(result.reportLine).toEqual({ stream: 'stdout', text: 'Report: ../../.visual-check/report/report.json' })
    expect(readReport(project).reportDir).toBe('.visual-check/report')
  })

  it('leaves the report folder untouched in update', async () => {
    const { project } = await createRun(['a'])
    const image = writeStaleReport(project)
    const result = await runCli(['update', '--all'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(result.reportLine).toBeUndefined()
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
    expect(result.reportLine).toEqual(reportOnStdout)
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

  it('writes the findings of a CI test that stops before capturing, giving the report line for stdout', async () => {
    const { project } = await createRun(['a1', 'a2', 'b'], { b: defaultRunSnapshot }, '', importPaths)
    const result = await runCli(['test'], { CI: 'true' }, project, fakeBrowser({}, aFileFails).options)
    const report = readReport(project)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.endsWith(`\n${ciStopLine}\n`)).toBe(true)
    expect(result.reportLine).toEqual(reportOnStdout)
    expect(report).toMatchObject({ consistencyOnly: false, exitCode: 1 })
    expect(report.snapshots.map(({ id, status }) => [id, status])).toEqual([
      ['a1', 'broken'],
      ['a2', 'broken'],
    ])
  })

  it('prints the human lines on stderr with --reporter json, before what the run prints on stderr', async () => {
    const plainRun = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'retries: 0')
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'retries: 0')
    const bDiffers = { b: { snapshot: otherSnapshot } }

    installStorybook(plainRun.project, '12.0.0')
    installStorybook(project, '12.0.0')

    const plain = await runCli(['test', '--all'], {}, plainRun.project, fakeBrowser(bDiffers).options)
    const json = await runCli(['test', '--all', '--reporter', 'json'], {}, project, fakeBrowser(bDiffers).options)

    expect(plain.stderr).toMatch(/^Warning: Storybook web runs storybook 12\.0\.0/)
    expect(json.exitCode).toBe(1)
    expect(withoutTimes(json.stderr)).toBe(withoutTimes(`${plain.stdout}${plain.stderr}`))
    expect(json.reportLine).toEqual(reportOnStderr)
  })

  it('prints only the report document on stdout with --reporter json, the rest on stderr', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'retries: 0')
    const browser = fakeBrowser({ b: { snapshot: otherSnapshot } })
    const result = await runCli(['test', '--all', '--reporter', 'json'], {}, project, browser.options)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.endsWith('\n')).toBe(true)
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1)
    expect(JSON.parse(result.stdout)).toEqual(readReport(project))
    expect(result.stdout).toBe(readFileSync(join(reportFolderIn(project), 'report.json'), 'utf8'))
    expect(result.stdout).not.toContain('Report:')
    expect(result.reportLine).toEqual(reportOnStderr)
  })

  it('prints the JSON document alone on stdout with --reporter json even in a TTY', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const result = await runCli(['test', '--all', '--reporter', 'json'], {}, project, {
      ...fakeBrowser().options,
      tty: true,
    })

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(readReport(project))
    expect(result.reportLine).toEqual(reportOnStderr)
  })

  it('prints the same with --reporter log as with no flag and no terminal', async () => {
    const plain = await createRun(['a'], { a: defaultRunSnapshot })
    const flagged = await createRun(['a'], { a: defaultRunSnapshot })
    const expected = await runCli(['test', '--all'], {}, plain.project, fakeBrowser().options)
    const result = await runCli(['test', '--all', '--reporter', 'log'], {}, flagged.project, fakeBrowser().options)

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

/**
 * What Node's argument parser says about the unknown flag `--nope`.
 */
const unknownFlagMessage =
  "Unknown option '--nope'. To specify a positional argument starting with a '-', place it at the end of the command " +
  `after '--', as in '-- "--nope"`

/**
 * Builds options whose browser throws an error that is a bug, a plain `Error`, when the run reads its version.
 */
function buggyBrowserOptions(): RunCliOptions {
  const driver = fakeDriverOf({ stories: {}, record: newRecord(), version: browserPackage.chromium })

  Object.defineProperty(driver, 'version', {
    get: () => {
      throw new Error('A bug in the driver.')
    },
  })

  return { ...hostOptions, launchBrowser: async () => driver, imageMarkerPath: absentMarkerPath }
}

/**
 * Builds options for the fake browser whose stories answer as `stories` say, and whose browser, once relaunched after
 * an exit, throws an error that is a bug, a plain `Error`, when the run reads its version.
 */
function buggyRelaunchOptions(stories: Record<string, FakeStory>): RunCliOptions {
  const { options } = fakeBrowser(stories)
  const { launchBrowser } = options
  let launches = 0

  if (launchBrowser === undefined) {
    throw new Error('The fake browser gives no launch.')
  }

  return {
    ...options,
    launchBrowser: async (launch) => {
      const driver = await launchBrowser(launch)

      launches += 1

      if (launches > 1) {
        Object.defineProperty(driver, 'version', {
          get: () => {
            throw new Error('A bug in the relaunched driver.')
          },
        })
      }

      return driver
    },
  }
}

describe('runCli test report on exit 2', () => {
  it('replaces the report with the error report of an error that is a bug, printing its stack trace', async () => {
    const { project } = await createRun(['a'])

    writeStaleReport(project)

    const result = await runCli(['test', '--all'], {}, project, buggyBrowserOptions())

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: expect.stringMatching(/^Error: A bug in the driver\.\n {4}at /),
      reportLine: reportOnStderr,
    })
    expect(readdirSync(reportFolderIn(project))).toEqual(['report.json'])
    expect(readReport(project)).toEqual(
      errorReportOf({ message: 'A bug in the driver.', storybooks: [] }, [{ name: 'web', url: expect.any(String) }]),
    )
  })

  it('keeps the warnings and the lines printed before an error that is a bug mid-run', async () => {
    const { project } = await createRun(
      ['a', 'b', 'c'],
      { a: defaultRunSnapshot, b: defaultRunSnapshot, c: defaultRunSnapshot },
      'workers: 1',
    )

    installStorybook(project, '12.0.0')

    const result = await runCli(['test', '--all'], {}, project, buggyRelaunchOptions({ b: { browserExits: true } }))

    expect(result.exitCode).toBe(2)
    expect(withoutTimes(result.stdout)).toMatch(new RegExp(`^${headerOf('test', 3, 1)}\n✓ web  a  N ms\n`))
    expect(result.stderr).toMatch(/^Warning: Storybook web runs storybook 12\.0\.0[^\n]*\n/)
    expect(result.stderr).toMatch(/\nError: A bug in the relaunched driver\.\n {4}at /)
    expect(result.reportLine).toEqual(reportOnStderr)
    expect(readReport(project).error?.message).toBe('A bug in the relaunched driver.')
  })

  it('prints the error document of an error that is a bug with --reporter json', async () => {
    const { project } = await createRun(['a'])
    const result = await runCli(['test', '--all', '--reporter', 'json'], {}, project, buggyBrowserOptions())

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe(readFileSync(join(reportFolderIn(project), 'report.json'), 'utf8'))
    expect(result.stderr).toMatch(/^Error: A bug in the driver\.\n {4}at /)
    expect(result.reportLine).toEqual(reportOnStderr)
  })

  it("prints update's error document of an error that is a bug with --reporter json, writing no report", async () => {
    const { project } = await createRun(['a'])
    const result = await runCli(['update', '--all', '--reporter', 'json'], {}, project, buggyBrowserOptions())

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'update',
      exitCode: 2,
      error: { message: 'A bug in the driver.' },
    })
    expect(result.stderr).toMatch(/^Error: A bug in the driver\.\n {4}at /)
    expect(result.reportLine).toBeUndefined()
    expect(existsSync(reportFolderIn(project))).toBe(false)
  })

  it('replaces a stale report with one holding the config error, giving the report line for stderr', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, "colour: 'red'")

    writeStaleReport(project)

    const result = await runCli(['test', '--all'], {}, project, fakeBrowser().options)
    const message = result.stderr.slice(0, -1)

    expect(message).toMatch(/^visual-check\.config\.mjs is invalid:\n {2}- colour: unknown key\./)
    expect(result).toEqual({ exitCode: 2, stdout: '', stderr: `${message}\n`, reportLine: reportOnStderr })
    expect(readdirSync(reportFolderIn(project))).toEqual(['report.json'])
    expect(readReport(project)).toEqual(errorReportOf({ message, storybooks: [] }))
  })

  it('writes the usage error of a test beside the config the search finds, without the hint', async () => {
    const { project } = await createRun(['a'])
    const result = await runCli(['test', '--all', '--filter', 'a'], {}, project, fakeBrowser().options)
    const message = "--all, --affected and --filter can't be used together. Pick one."

    expect(result).toEqual({ exitCode: 2, stdout: '', stderr: `${message}\n${usageHint}`, reportLine: reportOnStderr })
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

    expect(result.reportLine).toEqual({ stream: 'stderr', text: 'Report: ../.visual-check/report/report.json' })
    expect(readReport(project).error?.message).toMatch(/^--shard takes k\/n/)
  })

  it('names the unreachable Storybook and its URL in the error', async () => {
    const url = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
    })
    const result = await runCli(['test', '--all'], {}, project, fakeBrowser().options)
    const report = readReport(project)

    expect(result.exitCode).toBe(2)
    expect(result.reportLine).toEqual(reportOnStderr)
    expect(report.storybooks).toEqual([{ name: 'web', url }])
    expect(report.error).toEqual({
      message: result.stderr.trim(),
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
    const result = await runCli(['test', '--all'], {}, project, options)
    const report = readReport(project)

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toContain('! web  a  broken: The browser exited')
    expect(result.reportLine).toEqual(reportOnStderr)
    expect(readdirSync(reportFolderIn(project))).toEqual(['report.json'])
    expect(report).toMatchObject({ exitCode: 2, snapshots: [], counts: { passed: 0, broken: 0, differs: 0 } })
    expect(report.error?.message).toMatch(/^The browser was killed by signal SIGKILL while in use\.\n/)
    expect(report.error?.message).not.toContain('relaunches')
  })

  it("holds the error of a baseline that can't be decoded, and no results", async () => {
    const { project } = await createRun(['a'], { a: new TextEncoder().encode('not a PNG file') })
    const result = await runCli(['test', '--all'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(2)
    expect(readReport(project).error).toEqual({
      message:
        "visual-check couldn't decode the baseline .visual-check/baselines/a.png: Input buffer contains unsupported " +
        'image format. Delete it or restore it from git, then run visual-check again.',
      storybooks: [],
    })
  })

  it('prints only the error document on stdout with --reporter json, the lines printed so far on stderr', async () => {
    const plainRun = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'workers: 1')
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'workers: 1')
    const browserExits = { a: { browserExits: true }, b: { browserExits: true } }
    const plain = await runCli(['test', '--all'], {}, plainRun.project, fakeBrowser(browserExits).options)
    const result = await runCli(['test', '--all', '--reporter', 'json'], {}, project, fakeBrowser(browserExits).options)

    expect(plain.stdout).toContain('! web  a  broken: The browser exited')
    expect(result.exitCode).toBe(2)
    expect(withoutTimes(result.stderr)).toBe(withoutTimes(`${plain.stdout}${plain.stderr}`))
    expect(result.stdout).toBe(readFileSync(join(reportFolderIn(project), 'report.json'), 'utf8'))
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1)
    expect(result.reportLine).toEqual(reportOnStderr)
  })

  it('writes nothing when no config is found, and prints the error document with no report folder for json', async () => {
    const project = createProject({})
    const result = await runCli(['test', '--all', '--reporter', 'json'], {}, project, fakeBrowser().options)
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

  it('replaces a stale report with the error report of an unknown flag, which stays plain text', async () => {
    const { project } = await createRun(['a'])

    writeStaleReport(project)

    const result = await runCli(['test', '--nope'], {}, project)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: `${unknownFlagMessage}\n${usageHint}`,
      reportLine: reportOnStderr,
    })
    expect(readdirSync(reportFolderIn(project))).toEqual(['report.json'])
    expect(readReport(project)).toEqual(errorReportOf({ message: unknownFlagMessage, storybooks: [] }))
  })

  it('reads --reporter json after a flag missing its value, printing the error document', async () => {
    const { project } = await createRun(['a'])
    const result = await runCli(['test', '--filter', '--reporter', 'json'], {}, project)

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe(readFileSync(join(reportFolderIn(project), 'report.json'), 'utf8'))
    expect(readReport(project).error?.message).toMatch(/^Option '--filter' argument is ambiguous\./)
    expect(result.reportLine).toEqual(reportOnStderr)
  })

  it('replaces the report with the error report of an unknown flag with --reporter json, printing its document', async () => {
    const { project } = await createRun(['a'])

    writeStaleReport(project)

    const result = await runCli(['test', '--nope', '--reporter=json'], {}, project)

    expect(result).toEqual({
      exitCode: 2,
      stdout: `${JSON.stringify(errorReportOf({ message: unknownFlagMessage, storybooks: [] }))}\n`,
      stderr: `${unknownFlagMessage}\n${usageHint}`,
      reportLine: reportOnStderr,
    })
    expect(readdirSync(reportFolderIn(project))).toEqual(['report.json'])
    expect(readReport(project)).toEqual(errorReportOf({ message: unknownFlagMessage, storybooks: [] }))
  })

  it('leaves the report folder untouched when update exits 2', async () => {
    const { project } = await createRun(['a'], {}, "colour: 'red'")
    const image = writeStaleReport(project)
    const result = await runCli(['update', '--all'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(2)
    expect(result.reportLine).toBeUndefined()
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
        const result = await runCli(['test', '--all', '--reporter', 'json'], {}, project, browser.options)

        expect(result).toEqual({
          exitCode: 2,
          stdout: `${JSON.stringify({ ...errorReportOf({ message: problem, storybooks: [] }, [{ name: 'web', url }]), reportDir: null })}\n`,
          stderr: printed(headerOf('test', 1), problem),
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
        const result = await runCli(['test', '--all', '--reporter', 'json'], {}, project, fakeBrowser().options)
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
        const result = await runCli(['test', '--all'], {}, project, fakeBrowser().options)
        const json = await runCli(['test', '--all', '--reporter', 'json'], {}, project, fakeBrowser().options)

        expect(result.exitCode).toBe(2)
        // No end block, since the run stops with exit 2 and the report it would be built from isn't written.
        expect(withoutTimes(result.stdout)).toBe(printed(headerOf('test', 1), '✓ web  a  N ms'))
        expect(result.reportLine).toBeUndefined()
        expect(result.stderr).toBe(`${problem}\n`)
        expect(json).toEqual({
          exitCode: 2,
          stdout: `${JSON.stringify({ ...errorReportOf({ message: problem, storybooks: [] }, [{ name: 'web', url }]), reportDir: null })}\n`,
          stderr: expect.any(String),
        })
        expect(withoutTimes(json.stderr)).toBe(withoutTimes(`${result.stdout}${problem}\n`))
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
        const result = await runCli(['test', '--all'], {}, project, fakeBrowser().options)

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

/**
 * Reads every file under a folder, by its path relative to it, so two reads tell whether anything changed.
 */
function filesIn(folder: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name)

        return [path.slice(folder.length), readFileSync(path, 'base64')]
      }),
  )
}

/**
 * The broken story's page that changed in the second after its capture, and the third load of an unstable story.
 */
const greySnapshot = new Uint8Array(await greyPng(10, 10, 128))

describe('runCli update --reporter json', () => {
  it("prints update's document alone, its lines and warnings on stderr, and never touches the report folder", async () => {
    const { project, url } = await createRun(
      ['a', 'b', 'c'],
      { b: defaultRunSnapshot, c: defaultRunSnapshot, gone: defaultRunSnapshot },
      "silenceHosts: ['*.silenced.test'],",
    )

    writeStaleReport(project)

    const before = filesIn(reportFolderIn(project))
    const { options } = fakeBrowser({
      a: {
        requestHosts: ['api.test', 'x.silenced.test'],
        remote: [{ host: 'cdn.test', x: 0, y: 0, width: 10, height: 10 }],
      },
      b: { snapshot: otherSnapshot },
      c: { captures: [{ snapshot: otherSnapshot }, {}] },
    })
    const result = await runCli(['update', '--all', '--reporter', 'json'], {}, project, options)
    const report = JSON.parse(result.stdout) as UpdateReport
    const warnings =
      'api.test: 1 story (a). This story makes real network requests and may be unreliable.\n' +
      'cdn.test: 1 story (a) shows remote content. A CDN can serve it differently on another machine, so CI may fail.\n'

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1)
    expect(result.stderr.startsWith(headerOf('update', 3))).toBe(true)
    expect(result.stderr.endsWith(`\n${warnings}`)).toBe(true)
    expect(filesIn(reportFolderIn(project))).toEqual(before)
    expect(report).toMatchObject({
      version: 1,
      visualCheck: version,
      command: 'update',
      consistencyOnly: false,
      exitCode: 0,
      shard: null,
      selection: { by: 'all', base: null, changedFiles: null, fallback: null },
      reportDir: null,
      storybooks: [{ name: 'web', url }],
      counts: { written: 2, deleted: 1, kept: 1, broken: 0, flaky: 1 },
      error: null,
    })
    expect(report.warnings).toEqual([
      {
        kind: 'real-requests',
        host: 'api.test',
        stories: [{ storybook: 'web', story: 'a' }],
        message: 'api.test: 1 story (a). This story makes real network requests and may be unreliable.',
      },
      {
        kind: 'remote-content',
        host: 'cdn.test',
        stories: [{ storybook: 'web', story: 'a' }],
        message:
          'cdn.test: 1 story (a) shows remote content. A CDN can serve it differently on another machine, so CI may ' +
          'fail.',
      },
    ])
    expect(report.snapshots.map(({ id, status, reason }) => [id, status, reason])).toEqual([
      ['a', 'written', 'missing'],
      ['b', 'written', 'differs'],
      ['gone', 'deleted', null],
    ])
    expect(report.snapshots[0]).toMatchObject({
      message: 'Written: missing',
      baseline: '.visual-check/baselines/a.png',
      images: noImages,
      realRequestHosts: ['api.test', 'x.silenced.test'],
      remoteContentHosts: ['cdn.test'],
    })
    expect(report.snapshots[1]).toMatchObject({
      message: 'Written: differs: 100 differ, 20 allowed',
      pixels: { differ: 100, allowed: 20, budget: 20, scale: 1 },
      realRequestHosts: [],
      remoteContentHosts: [],
    })
    expect(report.snapshots[2]).toMatchObject({
      story: null,
      importPath: null,
      message: 'Deleted: no story calls for it.',
      baseline: '.visual-check/baselines/gone.png',
    })
  })

  it('lists the broken stories with their reasons and details, exits 1, and never touches the report folder', async () => {
    const { project } = await createRun(['a', 'b'], { a: otherSnapshot })

    writeStaleReport(project)

    const before = filesIn(reportFolderIn(project))
    const { options } = fakeBrowser({
      a: { snapshotLater: greySnapshot },
      b: { captures: [{}, { snapshot: otherSnapshot }, { snapshot: greySnapshot }] },
    })
    const result = await runCli(['update', '--all', '--reporter', 'json'], {}, project, options)
    const report = JSON.parse(result.stdout) as UpdateReport

    expect(result.exitCode).toBe(1)
    expect(filesIn(reportFolderIn(project))).toEqual(before)
    expect(report).toMatchObject({ exitCode: 1, counts: { written: 0, deleted: 0, kept: 0, broken: 2, flaky: 0 } })
    expect(report.snapshots).toMatchObject([
      { id: 'a', status: 'broken', reason: 'changed-after-capture', attempts: 1 },
      {
        id: 'b',
        status: 'broken',
        reason: 'unstable',
        attempts: 3,
        message: "No two of the story's 3 loads agreed, so its baseline wasn't written.",
      },
    ])
    expect(report.snapshots.map(({ details }) => details)).toStrictEqual([{}, {}])
  })

  it('prints the human lines on stderr with --reporter json, before its warnings', async () => {
    const plainRun = await createRun(['a'], { gone: defaultRunSnapshot })
    const { project } = await createRun(['a'], { gone: defaultRunSnapshot })
    const requests = { a: { requestHosts: ['api.test'] } }
    const plain = await runCli(['update', '--all'], {}, plainRun.project, fakeBrowser(requests).options)
    const result = await runCli(['update', '--all', '--reporter', 'json'], {}, project, fakeBrowser(requests).options)

    expect(plain.stderr).toMatch(/^api\.test: 1 story \(a\)/)
    expect(result.exitCode).toBe(0)
    expect(withoutTimes(result.stderr)).toBe(withoutTimes(`${plain.stdout}${plain.stderr}`))
  })

  it('prints the same with --reporter log as with no flag', async () => {
    const plain = await createRun(['a'], { gone: defaultRunSnapshot })
    const flagged = await createRun(['a'], { gone: defaultRunSnapshot })
    const expected = await runCli(['update', '--all'], {}, plain.project, fakeBrowser().options)
    const result = await runCli(['update', '--all', '--reporter', 'log'], {}, flagged.project, fakeBrowser().options)

    expect(result).toEqual(expected)
  })

  it('prints the error document of an update in CI, writing nothing', async () => {
    const { project } = await createRun(['a'])
    const result = await runCli(['update', '--reporter', 'json'], { CI: 'true' }, project, fakeBrowser().options)
    const message =
      'visual-check update only runs locally, and the CI environment variable is set. ' +
      'Run it on your machine and commit the baselines, or unset CI.'

    expect(result).toEqual({
      exitCode: 2,
      stdout: `${JSON.stringify({
        version: 1,
        visualCheck: version,
        command: 'update',
        consistencyOnly: false,
        exitCode: 2,
        shard: null,
        selection: { by: 'all', base: null, changedFiles: null, fallback: null },
        reportDir: null,
        storybooks: [],
        counts: { written: 0, deleted: 0, kept: 0, broken: 0, flaky: 0 },
        snapshots: [],
        warnings: [],
        error: { message, storybooks: [] },
      })}\n`,
      stderr: `${message}\n`,
    })
    expect(existsSync(join(project, '.visual-check'))).toBe(false)
  })

  it('names the unreachable Storybook in the error document, writing nothing', async () => {
    const url = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
    })
    const result = await runCli(['update', '--all', '--reporter', 'json'], {}, project, fakeBrowser().options)
    const report = JSON.parse(result.stdout) as UpdateReport

    expect(result.exitCode).toBe(2)
    expect(report).toMatchObject({
      command: 'update',
      exitCode: 2,
      reportDir: null,
      storybooks: [{ name: 'web', url }],
      snapshots: [],
      error: { message: result.stderr.trim(), storybooks: [{ name: 'web', url }] },
    })
    expect(existsSync(join(project, '.visual-check'))).toBe(false)
  })

  it('prints the error document of an unknown flag, leaving the report folder untouched', async () => {
    const { project } = await createRun(['a'])

    writeStaleReport(project)

    const before = filesIn(reportFolderIn(project))
    const result = await runCli(['update', '--reporter', 'json', '--nope'], {}, project)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toBe(`${unknownFlagMessage}\n${usageHint}`)
    expect(result.reportLine).toBeUndefined()
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'update',
      exitCode: 2,
      reportDir: null,
      error: { message: unknownFlagMessage, storybooks: [] },
    })
    expect(filesIn(reportFolderIn(project))).toEqual(before)
  })

  it('prints the error document of an invalid config, leaving the report folder untouched', async () => {
    const { project } = await createRun(['a'], {}, "colour: 'red'")

    writeStaleReport(project)

    const before = filesIn(reportFolderIn(project))
    const result = await runCli(['update', '--all', '--reporter', 'json'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'update',
      reportDir: null,
      error: { message: result.stderr.trim() },
    })
    expect(filesIn(reportFolderIn(project))).toEqual(before)
  })
})
