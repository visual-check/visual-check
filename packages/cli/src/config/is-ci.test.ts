import { describe, expect, it } from 'vitest'
import { isCi } from './is-ci.js'

describe('isCi', () => {
  it.each([undefined, '', '0', 'false', 'FALSE', 'False'])('is false when CI is %j', (value) => {
    expect(isCi({ CI: value })).toBe(false)
  })

  it('is false when CI is absent', () => {
    expect(isCi({})).toBe(false)
  })

  it.each(['true', '1', 'yes', 'TRUE'])('is true when CI is %j', (value) => {
    expect(isCi({ CI: value })).toBe(true)
  })
})
