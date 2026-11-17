import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunEvent, RunReporter } from '../reporter/run-event.js'
import {
  cleanUpRuns,
  countsOf,
  createRun,
  defaultRunSnapshot,
  fakeBrowser,
  headerOf,
  printed,
  removeMarkerFolder,
  reportOnStdout,
  withoutTimes,
} from './run-cli.fixture.js'
import { runCli } from './run-cli.js'

/**
 * How many times a run ended the `log` reporter it started.
 */
const finishes = vi.hoisted(() => ({ count: 0 }))

vi.mock('../reporter/log-reporter.js', async (importOriginal) => {
  const original: { logReporterOf: (write: (text: string) => void) => RunReporter } = await importOriginal()

  return {
    logReporterOf: (write: (text: string) => void): RunReporter => {
      const reporter = original.logReporterOf(write)

      return {
        event: (event) => {
          reporter.event(event)
        },
        finish: async () => {
          finishes.count += 1
          await reporter.finish()
        },
      }
    },
  }
})

/**
 * The live view's module, whose `startLiveView` each test gives a recording reporter.
 */
const liveViewModule = vi.hoisted(() => ({ startLiveView: vi.fn() }))

vi.mock('../terminal-ui/live-view.js', () => liveViewModule)

/**
 * A reporter that records the events it takes and how many times it was finished.
 */
function recordingReporter(): RunReporter & { events: RunEvent[]; finishes: number } {
  const reporter: RunReporter & { events: RunEvent[]; finishes: number } = {
    events: [],
    finishes: 0,
    event(event: RunEvent) {
      reporter.events.push(event)
    },
    async finish() {
      reporter.finishes += 1
    },
  }

  return reporter
}

beforeEach(() => {
  finishes.count = 0
  liveViewModule.startLiveView.mockReset()
})

afterEach(cleanUpRuns)
afterAll(removeMarkerFolder)

describe('runCli ending its reporter', () => {
  it('ends the reporter once when the run finishes', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot })
    const result = await runCli(['test'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(finishes.count).toBe(1)
  })

  it('ends the reporter once when the run stops with exit 2 mid-run', async () => {
    const { project } = await createRun(
      ['a', 'b', 'c'],
      { a: defaultRunSnapshot, b: defaultRunSnapshot, c: defaultRunSnapshot },
      'workers: 1',
    )
    const { options } = fakeBrowser({ b: { browserExits: true }, c: { browserExits: true } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(2)
    expect(finishes.count).toBe(1)
  })
})

describe('runCli with the live reporter', () => {
  it('starts the live view with a terminal and CI unset, gives it the progress stream and ends it once', async () => {
    const live = recordingReporter()

    liveViewModule.startLiveView.mockReturnValue(live)

    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot }, 'workers: 1')
    const result = await runCli(['test'], {}, project, { ...fakeBrowser().options, tty: true })

    expect(liveViewModule.startLiveView).toHaveBeenCalledExactlyOnceWith({
      environment: {},
      stdout: process.stdout,
      elapsedMs: expect.any(Function),
    })
    expect(
      live.events.map((event) => (event.kind === 'finished' ? { ...event, line: withoutTimes(event.line) } : event)),
    ).toEqual([
      { kind: 'planned', header: headerOf('test', 2, 1), notes: [], total: 2, workers: 1 },
      { kind: 'started', index: 0 },
      { kind: 'finished', index: 0, mark: '✓', line: '✓ web  a  N ms' },
      { kind: 'started', index: 1 },
      { kind: 'finished', index: 1, mark: '✗', line: expect.stringMatching(/^✗ web {2}b {2}missing: /) },
    ])
    expect(live.finishes).toBe(1)
    expect(finishes.count).toBe(0)
    expect(result.exitCode).toBe(1)
    // The live view drew the header and the lines, so stdout holds only the end block.
    expect(result.stdout).toMatch(/^── 1 failure ──\n/)
    expect(result.stdout).not.toContain(headerOf('test', 2, 1))
    expect(result.stdout).not.toContain('✗')
    expect(result.reportLine).toEqual(reportOnStdout)
  })

  it('starts the live view with --reporter live, even without a terminal', async () => {
    const live = recordingReporter()

    liveViewModule.startLiveView.mockReturnValue(live)

    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const result = await runCli(['test', '--reporter', 'live'], {}, project, fakeBrowser().options)

    expect(liveViewModule.startLiveView).toHaveBeenCalledOnce()
    expect(live.finishes).toBe(1)
    expect(result.stdout).toBe(printed(countsOf('1 passed')))
  })

  it('prints the log lines, not the live view, with CI set, even with a terminal', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const result = await runCli(['test'], { CI: 'true' }, project, { ...fakeBrowser().options, tty: true })

    expect(liveViewModule.startLiveView).not.toHaveBeenCalled()
    expect(withoutTimes(result.stdout)).toBe(printed(headerOf('test', 1), '✓ web  a  N ms', countsOf('1 passed')))
  })

  it('ends the live view once when the run stops with exit 2 mid-run', async () => {
    const live = recordingReporter()

    liveViewModule.startLiveView.mockReturnValue(live)

    const { project } = await createRun(
      ['a', 'b', 'c'],
      { a: defaultRunSnapshot, b: defaultRunSnapshot, c: defaultRunSnapshot },
      'workers: 1',
    )
    const { options } = fakeBrowser({ b: { browserExits: true }, c: { browserExits: true } })
    const result = await runCli(['test'], {}, project, { ...options, tty: true })

    expect(result.exitCode).toBe(2)
    expect(live.finishes).toBe(1)
  })
})
