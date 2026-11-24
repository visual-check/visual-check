import { describe, expect, it } from 'vitest'
import { checkedStatesOf, forcedStateClassOf, forcedStates } from './forced-states.js'

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

describe('checkedStatesOf', () => {
  it('returns the states as given', () => {
    expect(checkedStatesOf(['focus', 'hover'], 'forceStates')).toEqual(['focus', 'hover'])
  })

  it.each([
    [
      ['visited'],
      'visual-check: forceStates can\'t force "visited". The states it forces are hover, active, focus-visible, focus-within and focus.',
    ],
    [
      [':hover'],
      'visual-check: forceStates can\'t force ":hover". The states it forces are hover, active, focus-visible, focus-within and focus.',
    ],
    [
      [1],
      'visual-check: forceStates can\'t force "1". The states it forces are hover, active, focus-visible, focus-within and focus.',
    ],
    [['hover', 'focus', 'hover'], 'visual-check: forceStates lists "hover" twice.'],
  ])('throws for %j', (states, message) => {
    expect(() => checkedStatesOf(states, 'forceStates')).toThrow(new Error(message))
  })
})
