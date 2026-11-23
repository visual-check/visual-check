import { describe, expect, it } from 'vitest'
import type { StoryOutcome, VisualCheckState } from '../channel-events/events.js'
import {
  checkedWith,
  runWith,
  snapshotWith,
  stateWith,
  stoppedWith,
  updatedWith,
  updateSnapshotWith,
} from '../channel-events/state.fixture.js'
import { statusesOf } from './statuses.js'

const passed = snapshotWith()
const flaky = snapshotWith({ flaky: true })
const differs = snapshotWith({ status: 'differs', reason: 'pixels' })
const missing = snapshotWith({ status: 'missing' })
const broken = snapshotWith({ status: 'broken', reason: 'timeout' })
const written = updateSnapshotWith()
const kept = updateSnapshotWith({}, { status: 'kept', reason: null })
const unstable = updateSnapshotWith({}, { status: 'broken', reason: 'changed-after-capture' })

/**
 * Gives the story, the value without its prefix and the description of each status of a state.
 */
function briefOf(state: VisualCheckState): string[][] {
  return statusesOf(state).map(({ storyId, value, description }) => [
    storyId,
    value.replace('status-value:', ''),
    description,
  ])
}

describe('statusesOf', () => {
  it('lists nothing without a run or a result', () => {
    expect(statusesOf({ run: null, results: {} })).toEqual([])
  })

  it('gives whole statuses', () => {
    expect(statusesOf(stateWith(checkedWith([passed])))).toEqual([
      {
        value: 'status-value:success',
        typeId: 'visual-check',
        storyId: 'card--default',
        title: 'Visual check',
        description: 'Passed',
      },
    ])
  })

  it.each<[value: string, description: string, outcome: StoryOutcome]>([
    ['success', 'Passed', checkedWith([passed, flaky])],
    ['error', '1 visual diff', checkedWith([passed, differs])],
    ['error', '2 visual diffs, 1 missing baseline', checkedWith([missing, differs, differs])],
    ['error', '1 broken', checkedWith([broken])],
    ['error', '1 visual diff, 2 missing baselines, 2 broken', checkedWith([broken, missing, differs, missing, broken])],
    ['warning', '1 missing baseline', checkedWith([passed, missing])],
    ['unknown', 'Disabled', checkedWith([], { disabled: true })],
    ['unknown', 'Stopped', stoppedWith()],
    ['success', '2 written, 1 untouched', updatedWith([written, kept, written])],
    ['success', '1 untouched', updatedWith([kept])],
    ['error', '1 written, 1 broken', updatedWith([written, unstable])],
    ['unknown', 'Disabled', updatedWith([], { disabled: true })],
  ])('gives %s, "%s"', (value, description, outcome) => {
    expect(briefOf(stateWith(outcome))).toEqual([['card--default', value, description]])
  })

  it.each([checkedWith([passed]), checkedWith([differs]), stoppedWith()])('gives a stale result no icon', (outcome) => {
    expect(briefOf(stateWith(outcome, { stale: true }))).toEqual([['card--default', 'unknown', 'Stale']])
  })

  it('gives the story that is checked pending, whatever its earlier result', () => {
    const { results } = stateWith(checkedWith([differs]), { stale: true })

    expect(briefOf({ run: runWith(), results })).toEqual([['card--default', 'pending', 'Checking…']])
    expect(briefOf({ run: runWith(), results: {} })).toEqual([['card--default', 'pending', 'Checking…']])
  })

  it('gives the story whose baselines are updated pending', () => {
    expect(briefOf({ run: runWith({ kind: 'update' }), results: {} })).toEqual([
      ['card--default', 'pending', 'Updating…'],
    ])
  })

  it('lists every other story with a result beside it', () => {
    const { results } = stateWith(checkedWith([missing]), { storyId: 'button--primary' })

    expect(briefOf({ run: runWith(), results })).toEqual([
      ['button--primary', 'warning', '1 missing baseline'],
      ['card--default', 'pending', 'Checking…'],
    ])
  })
})
