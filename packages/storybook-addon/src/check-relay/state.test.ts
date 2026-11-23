import type { AddonOutcome } from '@visual-check/cli/internal/addon-protocol'
import { describe, expect, it } from 'vitest'
import type { StoryRun } from '../channel-events/events.js'
import { appendLog, emptyState, type RelayAction, type RelayState, reduce } from './state.js'

/**
 * How a check that finished ended.
 */
const checked: AddonOutcome = {
  result: 'checked',
  storybook: 'web',
  imagesFolder: '/project/.visual-check',
  snapshots: [],
  disabled: false,
  notices: ['A notice.'],
}

/**
 * What managers get of it.
 */
const checkedStory = { result: 'checked', storybook: 'web', snapshots: [], disabled: false, notices: ['A notice.'] }

/**
 * How an update that finished ended.
 */
const updated: AddonOutcome = {
  result: 'updated',
  storybook: 'web',
  snapshots: [],
  disabled: false,
  notices: ['A notice.'],
  warnings: [{ kind: 'real-requests', host: 'example.com', stories: [], message: 'A warning.' }],
}

/**
 * How a check that a problem stopped ended.
 */
const stopped: AddonOutcome = { result: 'stopped', cause: 'config', message: 'No config.', notices: [] }

/**
 * The run `1` of story `a` as it starts.
 */
const startedRun: StoryRun = {
  id: '1',
  kind: 'check',
  storyId: 'a',
  step: 'preparing',
  finished: 0,
  total: 0,
  log: [],
  cancelling: false,
}

/**
 * The state after actions, in order.
 */
function stateAfter(...actions: RelayAction[]): RelayState {
  return actions.reduce(reduce, emptyState)
}

/**
 * Asks for the check of a story.
 */
function requested(id: string, storyId = 'a'): RelayAction {
  return { type: 'requested', kind: 'check', id, storyId }
}

/**
 * Asks for the update of a story's baselines.
 */
function requestedUpdate(id: string, storyId = 'a'): RelayAction {
  return { type: 'requested', kind: 'update', id, storyId }
}

/**
 * Ends the run.
 */
function finished(id: string, outcome: AddonOutcome = checked): RelayAction {
  return { type: 'finished', id, outcome }
}

describe('reduce', () => {
  it('starts a run', () => {
    expect(stateAfter(requested('1'))).toEqual({ run: startedRun, results: {}, runStaled: false })
  })

  it('starts an update', () => {
    expect(stateAfter(requestedUpdate('1')).run).toEqual({ ...startedRun, kind: 'update' })
  })

  it('ignores a request while a run is in flight, whatever their kinds', () => {
    const state = stateAfter(requested('1'))
    const updating = stateAfter(requestedUpdate('1'))

    expect(reduce(state, requested('2', 'b'))).toBe(state)
    expect(reduce(state, requestedUpdate('2', 'b'))).toBe(state)
    expect(reduce(updating, requested('2', 'b'))).toBe(updating)
  })

  it("keeps an update's result as the story's, with the fields managers get", () => {
    const withMore = { ...updated, imagesFolder: '/project/.visual-check' } as AddonOutcome
    const state = stateAfter(requested('1'), finished('1'), requestedUpdate('2'), finished('2', withMore))

    expect(state.results).toEqual({ a: { id: '2', storyId: 'a', stale: false, outcome: updated } })
  })

  it("keeps the story's earlier result when an update was cancelled", () => {
    const before = stateAfter(requested('1'), finished('1'))
    const after = [requestedUpdate('2'), finished('2', { result: 'cancelled' })].reduce(reduce, before)

    expect(after).toEqual(before)
  })

  it('keeps how far the run is', () => {
    const state = stateAfter(
      requested('1'),
      { type: 'progress', id: '1', progress: { step: 'preparing' } },
      { type: 'progress', id: '1', progress: { step: 'browser', text: 'Pull' } },
      { type: 'progress', id: '1', progress: { step: 'browser', text: 'ing\nDone\n' } },
    )

    expect(state.run).toEqual({ ...startedRun, step: 'browser', log: ['Pulling', 'Done', ''] })
    expect(
      reduce(state, { type: 'progress', id: '1', progress: { step: 'capturing', finished: 1, total: 3 } }).run,
    ).toEqual({ ...startedRun, step: 'capturing', finished: 1, total: 3, log: ['Pulling', 'Done', ''] })
  })

  it('keeps that the run is being cancelled', () => {
    const state = stateAfter(requested('1'), { type: 'cancelling', id: '1' })

    expect(state.run).toEqual({ ...startedRun, cancelling: true })
    expect(reduce(state, { type: 'cancelling', id: '1' })).toBe(state)
  })

  it.each<RelayAction>([
    { type: 'progress', id: '2', progress: { step: 'browser', text: 'Pulling' } },
    { type: 'cancelling', id: '2' },
    finished('2'),
  ])('ignores $type of another run', (action) => {
    const state = stateAfter(requested('1'))

    expect(reduce(state, action)).toBe(state)
    expect(reduce(emptyState, action)).toBe(emptyState)
  })

  it.each([
    { outcome: checked, storyOutcome: checkedStory },
    { outcome: stopped, storyOutcome: stopped },
  ])('keeps the result of a run that ended $outcome.result, by story', ({ outcome, storyOutcome }) => {
    const state = stateAfter(requested('1'), finished('1', outcome), requested('2', 'b'), finished('2'))

    expect(state).toEqual({
      run: null,
      results: {
        a: { id: '1', storyId: 'a', stale: false, outcome: storyOutcome },
        b: { id: '2', storyId: 'b', stale: false, outcome: checkedStory },
      },
      runStaled: false,
    })
  })

  it("replaces the story's earlier result", () => {
    const { results } = stateAfter(requested('1'), finished('1'), requested('2'), finished('2', stopped))

    expect(results).toEqual({ a: { id: '2', storyId: 'a', stale: false, outcome: stopped } })
  })

  it('keeps the results of the last 200 stories', () => {
    const storyIds = Array.from({ length: 201 }, (_, index) => `story--${index}`)
    const all = storyIds.flatMap((storyId) => [requested(storyId, storyId), finished(storyId)])
    const full = stateAfter(...all.slice(0, 400))

    expect(Object.keys(full.results)).toEqual(storyIds.slice(0, 200))

    const again = [requested('again', 'story--0'), finished('again')].reduce(reduce, full)

    expect(Object.keys(again.results)).toEqual([...storyIds.slice(1, 200), 'story--0'])
    expect(Object.keys(all.slice(400).reduce(reduce, again).results)).toEqual([
      ...storyIds.slice(2, 200),
      'story--0',
      'story--200',
    ])
  })

  it('keeps the result of a story with the ID of a prototype key', () => {
    const storyIds = ['__proto__', 'constructor']
    const state = stateAfter(
      ...storyIds.flatMap((storyId) => [requested(storyId, storyId), finished(storyId)]),
      { type: 'staled' },
      requested('again', '__proto__'),
      finished('again'),
    )

    expect(Object.entries(state.results)).toEqual([
      ['constructor', { id: 'constructor', storyId: 'constructor', stale: true, outcome: checkedStory }],
      ['__proto__', { id: 'again', storyId: '__proto__', stale: false, outcome: checkedStory }],
    ])
    expect(Object.getPrototypeOf(state.results)).toBe(Object.prototype)
  })

  it("keeps the story's earlier result when the run was cancelled", () => {
    const before = stateAfter(requested('1'), finished('1'))
    const state = [requested('2'), { type: 'cancelling', id: '2' } as const, finished('2', { result: 'cancelled' })]

    expect(state.reduce(reduce, before)).toEqual(before)
  })

  it.each([
    { outcome: checked, storyOutcome: checkedStory },
    { outcome: stopped, storyOutcome: stopped },
  ])('keeps the $outcome.result result of a run that was cancelled too late', ({ outcome, storyOutcome }) => {
    const state = stateAfter(requested('1'), { type: 'cancelling', id: '1' }, finished('1', outcome))

    expect(state.results.a?.outcome).toEqual(storyOutcome)
  })

  it('marks every result stale', () => {
    const state = stateAfter(requested('1'), finished('1'), requested('2', 'b'), finished('2'), { type: 'staled' })

    expect(Object.values(state.results).map(({ stale }) => stale)).toEqual([true, true])
    expect(reduce(state, { type: 'staled' })).toBe(state)
    expect(reduce(emptyState, { type: 'staled' })).toBe(emptyState)
  })

  it('gives a run that was in flight a stale result, and the next one a fresh one', () => {
    const tainted = stateAfter(requested('1'), { type: 'staled' })

    expect(reduce(tainted, { type: 'staled' })).toBe(tainted)

    const ended = reduce(tainted, finished('1'))

    expect(ended.results.a?.stale).toBe(true)

    const next = [requested('2'), finished('2')].reduce(reduce, ended)

    expect(next.results.a).toMatchObject({ id: '2', stale: false })
  })

  it('gives the run after a cancelled stale one a fresh result', () => {
    const state = stateAfter(
      requested('1'),
      { type: 'staled' },
      finished('1', { result: 'cancelled' }),
      requested('2'),
      finished('2'),
    )

    expect(state.results.a?.stale).toBe(false)
  })

  it('clears the results and keeps the run', () => {
    const state = stateAfter(requested('1'), finished('1'), requested('2'), { type: 'cleared' })

    expect(state).toEqual({ run: { ...startedRun, id: '2' }, results: {}, runStaled: false })
    expect(reduce(state, { type: 'cleared' })).toBe(state)
  })
})

describe('appendLog', () => {
  it.each([
    { log: [], text: 'Pulling', expected: ['Pulling'] },
    { log: [], text: 'Pulling\n', expected: ['Pulling', ''] },
    { log: ['Pull'], text: 'ing\nDo', expected: ['Pulling', 'Do'] },
    { log: ['Pulling', ''], text: 'Done\r\n', expected: ['Pulling', 'Done', ''] },
  ])('adds $text to $log', ({ log, text, expected }) => {
    expect(appendLog(log, text)).toEqual(expected)
  })

  it('keeps the last 12 lines', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`)

    expect(appendLog([], lines.join('\n'))).toEqual(lines.slice(8))
    expect(appendLog([], `${lines.join('\n')}\n`)).toEqual([...lines.slice(8), ''])
  })

  it('keeps the last 16000 characters', () => {
    const line = 'a'.repeat(10_000)

    expect(appendLog([], `${line}${line}b`)).toEqual([`${'a'.repeat(15_999)}b`])
    expect(appendLog([line], `${line}\nb`)).toEqual(['a'.repeat(15_998), 'b'])
    expect(appendLog([line, ''], `${line}\nb`)).toEqual(['a'.repeat(5_997), line, 'b'])
  })
})
