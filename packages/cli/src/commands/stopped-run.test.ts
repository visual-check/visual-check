import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { reportJsonOf, type TestReport, type UpdateReport } from '../report/report-document.js'
import { UsageError } from './parse-command-line.js'
import {
  type RunStop,
  type StoppedTest,
  stoppedBy,
  stoppedTestOf,
  stoppedUpdateOf,
  usageFailureOf,
} from './stopped-run.js'

/**
 * The folders the tests made, removed after each test.
 */
const folders: string[] = []

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

/**
 * Makes a project folder holding a `.git` folder, which ends the config search there, and a config file. Returns the
 * folder's real path.
 */
function createProject(): string {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-stopped-run-')))

  folders.push(project)
  mkdirSync(join(project, '.git'))
  writeFileSync(join(project, 'visual-check.config.mjs'), 'export default {}\n')

  return project
}

/**
 * Reads the `report.json` beside the project's config.
 */
function readReport(project: string): TestReport {
  return JSON.parse(readFileSync(join(project, '.visual-check', 'report', 'report.json'), 'utf8')) as TestReport
}

/**
 * The report line of the report beside the project's config, which ends stderr once it is written.
 */
const reportLine = { stream: 'stderr', text: 'Report: .visual-check/report/report.json' } as const

/**
 * The stop of a run whose browser exited twice after one snapshot finished.
 */
function stopIn(project: string): RunStop {
  return {
    stdout: '✓ web  a  12 ms\n',
    stderr: 'Warning.\nThe browser exited.\n',
    message: 'The browser exited.\n',
    configPath: join(project, 'visual-check.config.mjs'),
    storybooks: [{ name: 'web', url: 'http://web.test' }],
    unreachable: [],
  }
}

/**
 * What ending the run needs besides the stop, for a run in `project`.
 */
function testIn(project: string, reporter: StoppedTest['options']['reporter'] = undefined): StoppedTest {
  return {
    version: '1.2.3',
    cwd: project,
    options: { consistency: false, shard: undefined, selection: { kind: 'default' }, reporter },
  }
}

describe('stoppedBy', () => {
  it('prints the problem on stderr alone, as the message too', () => {
    expect(stoppedBy('Boom.\n', { configPath: '/c.mjs', storybooks: [] })).toEqual({
      stopped: {
        stdout: '',
        stderr: 'Boom.\n',
        message: 'Boom.\n',
        configPath: '/c.mjs',
        storybooks: [],
        unreachable: [],
      },
    })
  })
})

describe('stoppedTestOf', () => {
  it('replaces the report folder with the error report, keeping both streams and giving the report line for stderr', async () => {
    const project = createProject()

    mkdirSync(join(project, '.visual-check', 'report', 'images'), { recursive: true })

    const output = await stoppedTestOf(stopIn(project), testIn(project))

    expect(output).toEqual({
      exitCode: 2,
      stdout: '✓ web  a  12 ms\n',
      stderr: 'Warning.\nThe browser exited.\n',
      reportLine,
    })
    expect(readdirSync(join(project, '.visual-check', 'report'))).toEqual(['report.json'])
    expect(readReport(project)).toMatchObject({
      visualCheck: '1.2.3',
      exitCode: 2,
      reportDir: '.visual-check/report',
      storybooks: [{ name: 'web', url: 'http://web.test' }],
      snapshots: [],
      error: { message: 'The browser exited.', storybooks: [] },
    })
  })

  it('prints the error document alone on stdout with --reporter json', async () => {
    const project = createProject()
    const output = await stoppedTestOf(stopIn(project), testIn(project, 'json'))

    expect(output).toEqual({
      exitCode: 2,
      stdout: `${reportJsonOf(readReport(project))}\n`,
      stderr: 'Warning.\nThe browser exited.\n',
      reportLine,
    })
  })

  it('writes nothing for a stop that names no config, and gives no report folder', async () => {
    const project = createProject()
    const output = await stoppedTestOf({ ...stopIn(project), configPath: undefined }, testIn(project, 'json'))

    expect(output.stderr).toBe('Warning.\nThe browser exited.\n')
    expect(output.reportLine).toBeUndefined()
    expect(JSON.parse(output.stdout)).toMatchObject({ reportDir: null, error: { message: 'The browser exited.' } })
    expect(readdirSync(project).sort()).toEqual(['.git', 'visual-check.config.mjs'])
  })

  it("adds the report's problem, and gives no report folder, when the error report can't be written", async () => {
    const project = createProject()

    writeFileSync(join(project, '.visual-check'), '')

    const output = await stoppedTestOf(stopIn(project), testIn(project, 'json'))

    expect(output.stderr).toBe(
      'Warning.\nThe browser exited.\n' +
        "visual-check couldn't clear .visual-check/report: ENOTDIR: not a directory. " +
        'Check that visual-check can remove it.\n',
    )
    expect(output.reportLine).toBeUndefined()
    expect(JSON.parse(output.stdout)).toMatchObject({ reportDir: null })
  })
})

describe('stoppedUpdateOf', () => {
  it('prints what the run printed, writing no report', () => {
    const project = createProject()
    const output = stoppedUpdateOf(stopIn(project), {
      version: '1.2.3',
      options: { selection: { kind: 'default' }, reporter: undefined },
    })

    expect(output).toEqual({ exitCode: 2, stdout: '✓ web  a  12 ms\n', stderr: 'Warning.\nThe browser exited.\n' })
    expect(readdirSync(project).sort()).toEqual(['.git', 'visual-check.config.mjs'])
  })

  it("prints update's error document alone on stdout with --reporter json, with no report folder", () => {
    const project = createProject()
    const output = stoppedUpdateOf(stopIn(project), {
      version: '1.2.3',
      options: { selection: { kind: 'all' }, reporter: 'json' },
    })
    const report = JSON.parse(output.stdout) as UpdateReport

    expect(output.stderr).toBe('Warning.\nThe browser exited.\n')
    expect(output.stdout.trimEnd().split('\n')).toHaveLength(1)
    expect(report).toMatchObject({
      command: 'update',
      visualCheck: '1.2.3',
      exitCode: 2,
      reportDir: null,
      storybooks: [{ name: 'web', url: 'http://web.test' }],
      snapshots: [],
      error: { message: 'The browser exited.', storybooks: [] },
    })
    expect(readdirSync(project).sort()).toEqual(['.git', 'visual-check.config.mjs'])
  })
})

describe('usageFailureOf', () => {
  it('prints the message and the hint, writing no report, for update', async () => {
    const project = createProject()
    const error = new UsageError('--shard applies only to test.', {
      command: 'update',
      config: undefined,
      reporter: undefined,
    })

    expect(await usageFailureOf(error, project, '1.2.3')).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: '--shard applies only to test.\nRun visual-check --help to see the commands and options.\n',
    })
    expect(readdirSync(project).sort()).toEqual(['.git', 'visual-check.config.mjs'])
  })

  it("prints update's error document with --reporter json, without the hint, writing no report", async () => {
    const project = createProject()
    const error = new UsageError('--shard applies only to test.', {
      command: 'update',
      config: undefined,
      reporter: 'json',
    })
    const output = await usageFailureOf(error, project, '1.2.3')

    expect(output.stderr).toBe(
      '--shard applies only to test.\nRun visual-check --help to see the commands and options.\n',
    )
    expect(JSON.parse(output.stdout)).toMatchObject({
      command: 'update',
      exitCode: 2,
      reportDir: null,
      error: { message: '--shard applies only to test.', storybooks: [] },
    })
    expect(readdirSync(project).sort()).toEqual(['.git', 'visual-check.config.mjs'])
  })

  it('writes the error report of test beside the config the search finds, without the hint', async () => {
    const project = createProject()
    const error = new UsageError("--all and --filter can't be used together. Pick one.", {
      command: 'test',
      config: undefined,
      reporter: undefined,
    })
    const output = await usageFailureOf(error, project, '1.2.3')

    expect(output.stderr).toBe(
      "--all and --filter can't be used together. Pick one.\nRun visual-check --help to see the commands and options.\n",
    )
    expect(output.reportLine).toEqual(reportLine)
    expect(readReport(project).error).toEqual({
      message: "--all and --filter can't be used together. Pick one.",
      storybooks: [],
    })
  })
})
