import { describe, expect, it } from 'vitest'
import type { StoryRun } from '../channel-events/events.js'
import {
  checkedWith,
  runWith,
  snapshotWith,
  stateWith,
  stoppedWith,
  updatedWith,
  updateSnapshotWith,
} from '../channel-events/state.fixture.js'
import { isCancelled, logTextOf, otherStoryLineOf, runLineOf, type StatusSubject, statusLineOf } from './panel-text.js'

describe('runLineOf', () => {
  it.each<[line: string, fields: Partial<StoryRun>]>([
    ['Starting…', { step: 'preparing' }],
    ['Getting the browser…', { step: 'browser', log: ['Pulling'] }],
    ['Capturing 1 of 3…', { step: 'capturing', finished: 0, total: 3 }],
    ['Capturing 3 of 3…', { step: 'capturing', finished: 2, total: 3 }],
    ['Capturing 3 of 3…', { step: 'capturing', finished: 3, total: 3 }],
    ['Cancelling…', { step: 'capturing', finished: 1, total: 3, cancelling: true }],
    ['Cancelling…', { step: 'preparing', cancelling: true }],
    ['Updating 2 of 3…', { kind: 'update', step: 'capturing', finished: 1, total: 3 }],
    ['Starting…', { kind: 'update', step: 'preparing' }],
  ])('gives "%s"', (line, fields) => {
    expect(runLineOf(runWith(fields))).toBe(line)
  })
})

describe('otherStoryLineOf', () => {
  it('names the story and what the run does', () => {
    expect(otherStoryLineOf(runWith({ storyId: 'button--primary' }))).toBe(
      'Another story is being checked: button--primary.',
    )
    expect(otherStoryLineOf(runWith({ kind: 'update', storyId: 'button--primary' }))).toBe(
      "Another story's baselines are being updated: button--primary.",
    )
  })
})

describe('statusLineOf', () => {
  const story = 'card--default'
  const differing = checkedWith([snapshotWith(), snapshotWith({ status: 'differs', reason: 'size' })])

  /**
   * Gives the line of a story with a result and no run.
   */
  function lineOf(...result: Parameters<typeof stateWith>): string {
    return statusLineOf(null, story, stateWith(...result).results[story])
  }

  it('says what the latest result came to', () => {
    expect(lineOf(checkedWith([snapshotWith()]))).toBe('Passed')
    expect(lineOf(differing)).toBe('1 visual diff')
    expect(lineOf(stoppedWith())).toBe('Stopped')
    expect(lineOf(differing, { stale: true })).toBe('Stale: 1 visual diff')
    expect(lineOf(updatedWith([updateSnapshotWith(), updateSnapshotWith({}, { status: 'kept', reason: null })]))).toBe(
      '1 written, 1 untouched',
    )
  })

  it('says how far the run is while there is one', () => {
    const result = stateWith(differing).results[story]

    expect(statusLineOf(runWith(), story, result)).toBe('Starting…')
    expect(statusLineOf(runWith({ storyId: 'a--b' }), story, result)).toBe(
      'Another story is being checked: a--b. Starting…',
    )
    expect(statusLineOf(runWith(), null, undefined)).toBe(`Another story is being checked: ${story}. Starting…`)
    expect(statusLineOf(runWith({ kind: 'update', storyId: 'a--b' }), story, result)).toBe(
      "Another story's baselines are being updated: a--b. Starting…",
    )
  })

  it('is empty without either', () => {
    expect(statusLineOf(null, story, undefined)).toBe('')
  })
})

describe('isCancelled', () => {
  const storyId = 'card--default'
  const result = stateWith(checkedWith([snapshotWith()])).results[storyId]
  const cancelling = runWith({ cancelling: true })
  const during: StatusSubject = { run: cancelling, storyId, result, cancelled: false }
  const after: StatusSubject = { run: null, storyId, result, cancelled: true }

  it.each<[name: string, last: StatusSubject]>([
    ['once a run that was being cancelled is over', during],
    ['with nothing changed since', after],
  ])('is so %s', (_name, last) => {
    expect(isCancelled(last, { run: null, storyId, result })).toBe(true)
    expect(isCancelled({ ...last, result: undefined }, { run: null, storyId, result: undefined })).toBe(true)
  })

  it.each<[name: string, last: StatusSubject, next: Partial<StatusSubject>]>([
    ['while it is being cancelled', during, { run: cancelling }],
    ['when the run completed after all', during, { result: result && { ...result, id: 'click-2' } }],
    ['when nobody cancelled the run', { ...during, run: runWith() }, {}],
    ["when it was another story's run", { ...during, run: runWith({ storyId: 'a--b', cancelling: true }) }, {}],
    ['when another story is selected', after, { storyId: 'a--b' }],
    ['when the next run starts', after, { run: runWith() }],
    ['when the result gets stale', after, { result: result && { ...result, stale: true } }],
    ['when the results are cleared', after, { result: undefined }],
  ])('is not so %s', (_name, last, next) => {
    expect(isCancelled(last, { run: null, storyId, result, ...next })).toBe(false)
  })
})

describe('logTextOf', () => {
  it('drops the empty line after a complete one, and no other', () => {
    expect(logTextOf(['Pulling', '', 'done', ''])).toBe('Pulling\n\ndone')
    expect(logTextOf(['Pulling', 'half a li'])).toBe('Pulling\nhalf a li')
    expect(logTextOf([''])).toBe('')
    expect(logTextOf([])).toBe('')
  })
})
