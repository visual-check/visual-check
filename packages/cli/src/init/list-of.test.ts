import { describe, expect, it } from 'vitest'
import { listOf, nonEmptyOf } from './list-of.js'

describe('listOf', () => {
  it('gives nothing for no items', () => {
    expect(listOf([])).toBe('')
  })

  it('gives one item as it is', () => {
    expect(listOf(['a'])).toBe('a')
  })

  it('joins two items with and', () => {
    expect(listOf(['a', 'b'])).toBe('a and b')
  })

  it('separates the first items with commas and the last with and', () => {
    expect(listOf(['a', 'b', 'c'])).toBe('a, b and c')
  })
})

describe('nonEmptyOf', () => {
  it('gives undefined for no items', () => {
    expect(nonEmptyOf([])).toBeUndefined()
  })

  it('gives the items when there is one or more', () => {
    expect(nonEmptyOf(['a'])).toEqual(['a'])
    expect(nonEmptyOf(['a', 'b'])).toEqual(['a', 'b'])
  })
})
