import { describe, expect, it } from 'vitest'
import { colourEnabledOf } from './theme.js'

describe('colourEnabledOf', () => {
  it('enables colour when neither NO_COLOR nor FORCE_COLOR is set', () => {
    expect(colourEnabledOf({})).toBe(true)
  })

  it('disables colour when NO_COLOR is set', () => {
    expect(colourEnabledOf({ NO_COLOR: '1' })).toBe(false)
  })

  it('enables colour when NO_COLOR is set to an empty string', () => {
    expect(colourEnabledOf({ NO_COLOR: '' })).toBe(true)
  })

  it('disables colour when FORCE_COLOR is 0, even with an empty NO_COLOR', () => {
    expect(colourEnabledOf({ NO_COLOR: '', FORCE_COLOR: '0' })).toBe(false)
  })

  it('disables colour when FORCE_COLOR is 0', () => {
    expect(colourEnabledOf({ FORCE_COLOR: '0' })).toBe(false)
  })

  it('enables colour when FORCE_COLOR names a level', () => {
    expect(colourEnabledOf({ FORCE_COLOR: '1' })).toBe(true)
  })

  it('disables colour when NO_COLOR is set, even with FORCE_COLOR', () => {
    expect(colourEnabledOf({ NO_COLOR: '1', FORCE_COLOR: '3' })).toBe(false)
  })
})
