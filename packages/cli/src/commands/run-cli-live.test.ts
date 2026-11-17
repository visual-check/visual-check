import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanUpRuns, createRun, defaultRunSnapshot, fakeBrowser, removeMarkerFolder } from './run-cli.fixture.js'
import { runCli } from './run-cli.js'

/**
 * How many times the live view's module was loaded. Vitest calls a mock's factory only when the module is first
 * imported, so it counts loads. No run in this file may use the `live` reporter, which would load it.
 */
const loads = vi.hoisted(() => ({ count: 0 }))

vi.mock('../terminal-ui/live-view.js', async (importOriginal) => {
  loads.count += 1

  return await importOriginal()
})

afterEach(cleanUpRuns)
afterAll(removeMarkerFolder)

describe('runCli loading the live view', () => {
  it.each([
    ['log, with no terminal', ['test'], {}, false],
    ['--reporter log, with a terminal', ['test', '--reporter', 'log'], {}, true],
    ['--reporter json, with a terminal', ['test', '--reporter', 'json'], {}, true],
    ['log, with CI set and a terminal', ['test'], { CI: 'true' }, true],
  ])('never loads it under %s', async (_name, commandLine, environment, tty) => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const result = await runCli(commandLine, environment, project, { ...fakeBrowser().options, tty })

    expect(result.exitCode).toBe(0)
    expect(loads.count).toBe(0)
  })

  it('counts a load, so the runs above would have shown one', async () => {
    await import('../terminal-ui/live-view.js')

    expect(loads.count).toBe(1)
  })
})
