import { describe, expect, it } from 'vitest'
import type { RunEvent } from '../reporter/run-event.js'
import { initialLiveViewState, type LiveViewState, liveViewStateOf, progressLineOf } from './live-view-state.js'

/**
 * The state after a run of three snapshots on two workers was planned, with a shard's note.
 */
const planned = liveViewStateOf(initialLiveViewState, {
  kind: 'planned',
  header: 'visual-check 1.0.0 · test · 3 snapshots · 2 workers',
  notes: ['Shard 1/2 takes 1 stories file.'],
  total: 3,
  workers: 2,
})

describe('initialLiveViewState', () => {
  it('starts unplanned, open, with nothing printed', () => {
    expect(initialLiveViewState).toEqual({
      printed: [],
      done: 0,
      total: 0,
      workers: 0,
      planned: false,
      closed: false,
    })
  })
})

describe('liveViewStateOf', () => {
  it('prints the header and the notes, unmarked, and takes the total and workers at planned', () => {
    expect(planned).toEqual({
      printed: [
        { id: 0, mark: undefined, text: 'visual-check 1.0.0 · test · 3 snapshots · 2 workers' },
        { id: 1, mark: undefined, text: 'Shard 1/2 takes 1 stories file.' },
      ],
      done: 0,
      total: 3,
      workers: 2,
      planned: true,
      closed: false,
    })
  })

  it('changes nothing when a snapshot starts', () => {
    expect(liveViewStateOf(planned, { kind: 'started', index: 1 })).toBe(planned)
  })

  it('counts a pass as done and prints nothing for it', () => {
    const state = liveViewStateOf(planned, { kind: 'finished', index: 0, mark: '✓', line: '✓ web  a  142 ms' })

    expect(state).toEqual({ ...planned, done: 1 })
  })

  it.each([
    ['✗', '✗ web  b  missing: no baseline yet; run visual-check update to write it'],
    ['!', '! web  c  broken: The story threw.'],
  ] as const)('counts a %s as done and prints its line, its mark apart, with the next key', (mark, line) => {
    const state = liveViewStateOf(planned, { kind: 'finished', index: 2, mark, line })

    expect(state.done).toBe(1)
    expect(state.printed.slice(2)).toEqual([{ id: 2, mark, text: line.slice(1) }])
  })

  it('counts each finished snapshot, whatever order they finish in', () => {
    const events: RunEvent[] = [
      { kind: 'finished', index: 2, mark: '✓', line: '✓ web  c  1 ms' },
      { kind: 'finished', index: 0, mark: '✗', line: '✗ web  a  differs: 1 differs' },
    ]
    const state = events.reduce(liveViewStateOf, planned)

    expect(state.done).toBe(2)
    expect(state.printed.map(({ text }) => text)).toEqual([
      'visual-check 1.0.0 · test · 3 snapshots · 2 workers',
      'Shard 1/2 takes 1 stories file.',
      ' web  a  differs: 1 differs',
    ])
  })
})

describe('progressLineOf', () => {
  it('gives done of total, the workers and the time taken', () => {
    expect(progressLineOf(planned, 0)).toBe('0/3 snapshots · 2 workers · 0 ms')
  })

  it('names one snapshot and one worker in the singular', () => {
    const state: LiveViewState = { ...initialLiveViewState, done: 1, total: 1, workers: 1, planned: true }

    expect(progressLineOf(state, 192_000)).toBe('1/1 snapshot · 1 worker · 3m 12s')
  })
})
