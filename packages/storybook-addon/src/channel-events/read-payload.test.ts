import { describe, expect, it } from 'vitest'
import { readCancelPayload, readCheckPayload } from './read-payload.js'

/**
 * Payloads neither reader takes.
 */
const junk = [{ value: undefined }, { value: null }, { value: 'a' }, { value: 1 }, { value: [] }, { value: {} }]

describe('readCheckPayload', () => {
  it('reads the story ID alone', () => {
    expect(readCheckPayload({ storyId: 'button--primary', id: 'x' })).toEqual({ storyId: 'button--primary' })
    expect(readCheckPayload({ storyId: 'a'.repeat(1000) })).toEqual({ storyId: 'a'.repeat(1000) })
  })

  it.each([
    ...junk,
    { value: { id: 'a' } },
    { value: { storyId: '' } },
    { value: { storyId: 1 } },
    { value: { storyId: ['a'] } },
    { value: { storyId: 'a'.repeat(1001) } },
  ])('takes no junk: $value', ({ value }) => {
    expect(readCheckPayload(value)).toBeUndefined()
  })
})

describe('readCancelPayload', () => {
  it('reads the ID alone', () => {
    expect(readCancelPayload({ id: 'click-1', storyId: 'a' })).toEqual({ id: 'click-1' })
  })

  it.each([
    ...junk,
    { value: { storyId: 'a' } },
    { value: { id: '' } },
    { value: { id: {} } },
    { value: { id: 'a'.repeat(1001) } },
  ])('takes no junk: $value', ({ value }) => {
    expect(readCancelPayload(value)).toBeUndefined()
  })
})
