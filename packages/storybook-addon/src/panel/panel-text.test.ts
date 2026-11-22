import { describe, expect, it } from 'vitest'
import type { StoryRun } from '../channel-events/events.js'
import { checkedWith, runWith, snapshotWith, stateWith, stoppedWith } from '../channel-events/state.fixture.js'
import { logTextOf, otherStoryLineOf, runLineOf, statusLineOf } from './panel-text.js'

describe('runLineOf', () => {
  it.each<[line: string, fields: Partial<StoryRun>]>([
    ['Starting…', { step: 'preparing' }],
    ['Getting the browser…', { step: 'browser', log: ['Pulling'] }],
    ['Capturing 1 of 3…', { step: 'capturing', finished: 0, total: 3 }],
    ['Capturing 3 of 3…', { step: 'capturing', finished: 2, total: 3 }],
    ['Capturing 3 of 3…', { step: 'capturing', finished: 3, total: 3 }],
    ['Cancelling…', { step: 'capturing', finished: 1, total: 3, cancelling: true }],
    ['Cancelling…', { step: 'preparing', cancelling: true }],
  ])('gives "%s"', (line, fields) => {
    expect(runLineOf(runWith(fields))).toBe(line)
  })
})

describe('otherStoryLineOf', () => {
  it('names the story', () => {
    expect(otherStoryLineOf('button--primary')).toBe('Another story is being checked: button--primary.')
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
  })

  it('says how far the run is while there is one', () => {
    const result = stateWith(differing).results[story]

    expect(statusLineOf(runWith(), story, result)).toBe('Starting…')
    expect(statusLineOf(runWith({ storyId: 'a--b' }), story, result)).toBe(
      'Another story is being checked: a--b. Starting…',
    )
    expect(statusLineOf(runWith(), null, undefined)).toBe(`Another story is being checked: ${story}. Starting…`)
  })

  it('is empty without either', () => {
    expect(statusLineOf(null, story, undefined)).toBe('')
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
