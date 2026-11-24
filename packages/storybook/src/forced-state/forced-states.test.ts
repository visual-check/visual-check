import { describe, expect, it } from 'vitest'
import { forcedStateClassOf, forcedStates } from './forced-states.js'

describe('forcedStates', () => {
  it('lists the five states in the order the docs list them', () => {
    expect(forcedStates).toEqual(['hover', 'active', 'focus-visible', 'focus-within', 'focus'])
  })
})

describe('forcedStateClassOf', () => {
  it.each([
    ['hover', 'visual-check-hover'],
    ['active', 'visual-check-active'],
    ['focus-visible', 'visual-check-focus-visible'],
    ['focus-within', 'visual-check-focus-within'],
    ['focus', 'visual-check-focus'],
  ] as const)('names the class that forces %s: %s', (state, className) => {
    expect(forcedStateClassOf(state)).toBe(className)
  })
})
