import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunReporter } from '../reporter/run-event.js'
import { cleanUpRuns, createRun, defaultRunSnapshot, fakeBrowser, removeMarkerFolder } from './run-cli.fixture.js'
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

beforeEach(() => {
  finishes.count = 0
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
