import { afterAll, afterEach, describe, expect, it } from 'vitest'
import {
  absentMarkerPath,
  browserPackage,
  cleanUpRuns,
  countsOf,
  createRun,
  defaultRunSnapshot,
  fakeBrowser,
  fakeDriverOf,
  headerOf,
  hostOptions,
  newRecord,
  printed,
  recordingWrite,
  removeMarkerFolder,
  reportOnStderr,
  reportOnStdout,
  type StoryGates,
} from './run-cli.fixture.js'
import { runCli } from './run-cli.js'

afterEach(cleanUpRuns)
afterAll(removeMarkerFolder)

/**
 * Holds every story that `waitsFor` `name` until the function it gives back is called, which opens the gate.
 */
function holdGate(gates: StoryGates, name: string): () => void {
  let open = (): void => undefined
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })

  gates.set(`settled ${name}`, { promise, resolve: open })

  return () => open()
}

describe('runCli streaming the progress', () => {
  it('prints the lines in the order the snapshots finish, not in planned order', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'workers: 2')
    const record = newRecord()
    const gates: StoryGates = new Map()
    const openHold = holdGate(gates, 'hold')
    const { write, writes } = recordingWrite()
    const result = await runCli(['test', '--all'], {}, project, {
      ...hostOptions,
      imageMarkerPath: absentMarkerPath,
      launchBrowser: async (launch) => {
        record.launches.push(launch)

        return fakeDriverOf({ stories: { a: { waitsFor: 'hold' } }, record, version: browserPackage.chromium, gates })
      },
      // a's capture, planned first, is held until b's line is written, so b finishes first.
      write: (stream, text) => {
        write(stream, text)

        if (text.startsWith('✓ web  b')) {
          openHold()
        }
      },
    })

    expect(result.exitCode).toBe(0)
    expect(writes).toEqual([
      ['stdout', `${headerOf('test', 2, 2)}\n`],
      ['stdout', '✓ web  b  N ms\n'],
      ['stdout', '✓ web  a  N ms\n'],
    ])
  })

  it('writes the header and each line through write as its snapshot finishes, and gives only the rest', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'workers: 2')
    const record = newRecord()
    const gates: StoryGates = new Map()
    const openHold = holdGate(gates, 'hold')
    const { write, writes } = recordingWrite()
    const result = await runCli(['test', '--all'], {}, project, {
      ...hostOptions,
      imageMarkerPath: absentMarkerPath,
      launchBrowser: async (launch) => {
        record.launches.push(launch)

        return fakeDriverOf({ stories: { b: { waitsFor: 'hold' } }, record, version: browserPackage.chromium, gates })
      },
      // b's capture is held until a's line is written, so the run ends only if that line is written as a finishes.
      write: (stream, text) => {
        write(stream, text)

        if (text.startsWith('✓ web  a')) {
          openHold()
        }
      },
    })

    expect(writes).toEqual([
      ['stdout', `${headerOf('test', 2, 2)}\n`],
      ['stdout', '✓ web  a  N ms\n'],
      ['stdout', '✓ web  b  N ms\n'],
    ])
    expect(result).toEqual({
      exitCode: 0,
      stdout: printed(countsOf('2 passed')),
      stderr: '',
      reportLine: reportOnStdout,
    })
  })

  it('writes the header and the lines on stderr with --reporter json, so stdout holds the document alone', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const { write, writes } = recordingWrite()
    const result = await runCli(['test', '--all', '--reporter', 'json'], {}, project, {
      ...fakeBrowser().options,
      write,
    })

    expect(writes).toEqual([
      ['stderr', `${headerOf('test', 1)}\n`],
      ['stderr', '✓ web  a  N ms\n'],
    ])
    expect(JSON.parse(result.stdout)).toMatchObject({ command: 'test', exitCode: 0 })
    expect(result.stdout.split('\n')).toEqual([expect.any(String), ''])
    expect(result.stderr).toBe(printed(countsOf('1 passed')))
    expect(result.reportLine).toEqual(reportOnStderr)
  })

  it("writes update's lines as they finish and gives its end lines", async () => {
    const { project } = await createRun(['a'])
    const { write, writes } = recordingWrite()
    const result = await runCli(['update', '--all'], {}, project, { ...fakeBrowser().options, write })

    expect(writes).toEqual([
      ['stdout', `${headerOf('update', 1)}\n`],
      ['stdout', '✓ web  a  written: missing\n'],
    ])
    expect(result).toEqual({
      exitCode: 0,
      stdout: printed('1 written', 'written .visual-check/baselines/a.png'),
      stderr: '',
      reportLine: reportOnStdout,
    })
  })
})
