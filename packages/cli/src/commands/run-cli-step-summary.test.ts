import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunReporter } from '../reporter/run-event.js'
import {
  cleanUpRuns,
  createProject,
  createRun,
  defaultRunSnapshot,
  fakeBrowser,
  hostOptions,
  otherSnapshot,
  removeMarkerFolder,
  reportOnStdout,
  takeUnusedUrl,
  version,
} from './run-cli.fixture.js'
import { type RunCliOptions, runCli } from './run-cli.js'

/**
 * The live view's module, whose `startLiveView` gives a reporter that shows nothing.
 */
const liveViewModule = vi.hoisted(() => ({ startLiveView: vi.fn() }))

vi.mock('../terminal-ui/live-view.js', () => liveViewModule)

beforeEach(() => {
  liveViewModule.startLiveView.mockReset()
  liveViewModule.startLiveView.mockReturnValue({
    event: () => undefined,
    finish: async () => undefined,
  } satisfies RunReporter)
})

afterEach(cleanUpRuns)
afterAll(removeMarkerFolder)

/**
 * The summary of a `test` of `a`, which passes, and `b`, which differs.
 */
const differingSummary = [
  `### visual-check ${version} · test`,
  '',
  '1 passed · 1 differs',
  '',
  '**Failures**',
  '',
  '| Storybook | Story | Mode | Status | Message |',
  '| --- | --- | --- | --- | --- |',
  '| web | b |  | differs | 100 differ, 20 allowed |',
  '',
].join('\n')

/**
 * Makes a run of `a`, which passes, and `b`, which differs. Returns the project, the options of its fake browser, and
 * the path of a step summary file in the project, which doesn't exist yet.
 */
async function differingRun(): Promise<{ project: string; options: RunCliOptions; summary: string }> {
  const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'retries: 0')

  return {
    project,
    options: fakeBrowser({ b: { snapshot: otherSnapshot } }).options,
    summary: join(project, 'summary.md'),
  }
}

describe('runCli writing the GitHub step summary', () => {
  it.each([
    ['log', [], false],
    ['json', ['--reporter', 'json'], false],
    ['live', [], true],
  ] as const)('writes the summary of a test under the %s reporter', async (reporter, flags, tty) => {
    const { project, options, summary } = await differingRun()
    const result = await runCli(['test', '--all', ...flags], { GITHUB_STEP_SUMMARY: summary }, project, {
      ...options,
      tty,
    })

    expect(result.exitCode).toBe(1)
    expect(readFileSync(summary, 'utf8')).toBe(differingSummary)
    expect(result).not.toHaveProperty('report')
    expect(liveViewModule.startLiveView).toHaveBeenCalledTimes(reporter === 'live' ? 1 : 0)
  })

  it('reads a relative path from the folder the CLI runs in', async () => {
    const { project, options, summary } = await differingRun()

    await runCli(['test', '--all'], { GITHUB_STEP_SUMMARY: 'summary.md' }, project, options)

    expect(readFileSync(summary, 'utf8')).toBe(differingSummary)
  })

  it('writes the error of a test whose Storybook is down', async () => {
    const url = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
    })
    const summary = join(project, 'summary.md')
    const result = await runCli(['test', '--all'], { GITHUB_STEP_SUMMARY: summary }, project, fakeBrowser().options)
    const text = readFileSync(summary, 'utf8')

    expect(result.exitCode).toBe(2)
    expect(text).toMatch(
      new RegExp(`^### visual-check ${version} · test\\n\\nThe run stopped with exit code 2:\\n\\n {4}`),
    )
    expect(text).toContain(url)
  })

  it('writes the error of a usage error that names a test run', async () => {
    const project = createProject({ 'visual-check.config.mjs': 'export default {}\n' })
    const summary = join(project, 'summary.md')
    const result = await runCli(['test', '--bogus'], { GITHUB_STEP_SUMMARY: summary }, project)

    expect(result.exitCode).toBe(2)
    expect(readFileSync(summary, 'utf8')).toMatch(
      new RegExp(
        `^### visual-check ${version} · test\\n\\nThe run stopped with exit code 2:\\n\\n {4}Unknown option '--bogus'`,
      ),
    )
  })

  it('writes the error of an update in CI', async () => {
    const { project } = await createRun(['a'])
    const summary = join(project, 'summary.md')
    const result = await runCli(
      ['update'],
      { CI: 'true', GITHUB_STEP_SUMMARY: summary },
      project,
      fakeBrowser().options,
    )

    expect(result.exitCode).toBe(2)
    expect(readFileSync(summary, 'utf8')).toBe(
      `### visual-check ${version} · update\n\nThe run stopped with exit code 2:\n\n` +
        '    visual-check update only runs locally, and the CI environment variable is set. ' +
        'Run it on your machine and commit the baselines, or unset CI.\n',
    )
  })

  it('writes the counts of an update that finishes', async () => {
    const { project } = await createRun(['a'])
    const summary = join(project, 'summary.md')
    const result = await runCli(['update', '--all'], { GITHUB_STEP_SUMMARY: summary }, project, fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(readFileSync(summary, 'utf8')).toBe(`### visual-check ${version} · update\n\n1 written\n`)
  })

  it.each([
    ['--version', ['--version']],
    ['--help', ['--help']],
    ['a usage error that names no run', ['deploy']],
  ])('writes nothing for %s', async (_, commandLine) => {
    const project = createProject({})
    const summary = join(project, 'summary.md')

    await runCli(commandLine, { GITHUB_STEP_SUMMARY: summary }, project)

    expect(existsSync(summary)).toBe(false)
  })

  it('writes nothing for init', async () => {
    const project = createProject({ 'package.json': JSON.stringify({ name: 'web-app' }) })
    const summary = join(project, 'summary.md')
    const result = await runCli(['init'], { GITHUB_STEP_SUMMARY: summary }, project, {
      os: 'linux',
      nodeVersion: '22.23.1',
      probeDocker: hostOptions.probeDocker,
      listFiles: async () => [],
      runCommand: async () => 0,
      findUnlistedDependencies: async () => [],
      interactive: false,
    })

    expect(result.exitCode).toBe(2)
    expect(existsSync(summary)).toBe(false)
  })

  it("adds a warning to stderr and keeps the exit code when the summary can't be written", async () => {
    const { project, options } = await differingRun()
    const result = await runCli(['test', '--all'], { GITHUB_STEP_SUMMARY: project }, project, options)

    expect(result.exitCode).toBe(1)
    expect(result.reportLine).toEqual(reportOnStdout)
    expect(result.stderr).toBe(
      `Warning: visual-check couldn't write the GitHub step summary to ${project}: ` +
        "EISDIR: illegal operation on a directory. The run's result is unchanged.\n",
    )
  })
})
