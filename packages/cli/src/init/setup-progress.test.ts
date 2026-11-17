import { describe, expect, it } from 'vitest'
import { recordingProgress } from './init-tools.fixture.js'
import { plainSetupProgress, runStep } from './setup-progress.js'

describe('plainSetupProgress', () => {
  it('writes Running and the command when a step with a command starts', () => {
    const written: string[] = []

    plainSetupProgress((text) => written.push(text)).start('Install a', 'pnpm add a')

    expect(written).toEqual(['Running pnpm add a\n'])
  })

  it('writes the output as it is', () => {
    const written: string[] = []

    plainSetupProgress((text) => written.push(text)).output('Progress: 1\r')

    expect(written).toEqual(['Progress: 1\r'])
  })

  it('writes nothing for the plan, a step without a command, or an end', () => {
    const written: string[] = []
    const progress = plainSetupProgress((text) => written.push(text))

    progress.plan(['a', 'b'])
    progress.start('a')
    progress.end('done')
    progress.end('warned')
    progress.end('failed')

    expect(written).toEqual([])
  })
})

describe('runStep', () => {
  it('starts the step, runs it and ends it with the outcome for the result', async () => {
    const { progress, calls } = recordingProgress()

    const result = await runStep(
      progress,
      { title: 'Install a', command: 'pnpm add a' },
      () => 0,
      () => 'done',
    )

    expect(result).toBe(0)
    expect(calls).toEqual([
      ['start', 'Install a', 'pnpm add a'],
      ['end', 'done'],
    ])
  })

  it('ends with the outcome it is given for a result, such as warned', async () => {
    const { progress, calls } = recordingProgress()

    await runStep(
      progress,
      { title: 'Check' },
      () => Promise.resolve(['warning']),
      (warnings) => (warnings.length > 0 ? 'warned' : 'done'),
    )

    expect(calls).toEqual([
      ['start', 'Check'],
      ['end', 'warned'],
    ])
  })

  it('ends failed and rethrows when the step throws', async () => {
    const { progress, calls } = recordingProgress()
    const failure = new Error('boom')

    await expect(
      runStep(
        progress,
        { title: 'Check' },
        () => {
          throw failure
        },
        () => 'done',
      ),
    ).rejects.toBe(failure)
    expect(calls).toEqual([
      ['start', 'Check'],
      ['end', 'failed'],
    ])
  })

  it('ends failed and rethrows when the step rejects', async () => {
    const { progress, calls } = recordingProgress()
    const failure = new Error('boom')

    await expect(
      runStep(
        progress,
        { title: 'Check' },
        () => Promise.reject(failure),
        () => 'done',
      ),
    ).rejects.toBe(failure)
    expect(calls).toEqual([
      ['start', 'Check'],
      ['end', 'failed'],
    ])
  })
})
