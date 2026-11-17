import { describe, expect, it } from 'vitest'
import { logReporterOf } from './log-reporter.js'
import type { RunReporter } from './run-event.js'

/**
 * Gives a `log` reporter with the writes it makes, in order.
 */
function recordingReporter(): { reporter: RunReporter; writes: string[] } {
  const writes: string[] = []

  return { reporter: logReporterOf((text) => writes.push(text)), writes }
}

describe('logReporterOf', () => {
  it('writes the header, then each note, each on its own line, at planned', () => {
    const { reporter, writes } = recordingReporter()

    reporter.event({
      kind: 'planned',
      header: 'visual-check 1.0.0 · test',
      notes: ['one', 'two'],
      total: 2,
      workers: 1,
    })

    expect(writes).toEqual(['visual-check 1.0.0 · test\n', 'one\n', 'two\n'])
  })

  it('writes nothing when a snapshot starts', () => {
    const { reporter, writes } = recordingReporter()

    reporter.event({ kind: 'started', index: 0 })

    expect(writes).toEqual([])
  })

  it('writes each finished line as it comes, whatever its place in planned order', () => {
    const { reporter, writes } = recordingReporter()

    reporter.event({ kind: 'finished', index: 1, mark: '✗', line: '✗ web  b  missing' })
    reporter.event({ kind: 'finished', index: 0, mark: '✓', line: '✓ web  a  1 ms' })

    expect(writes).toEqual(['✗ web  b  missing\n', '✓ web  a  1 ms\n'])
  })

  it('writes nothing more at finish', async () => {
    const { reporter, writes } = recordingReporter()

    await reporter.finish()

    expect(writes).toEqual([])
  })
})
