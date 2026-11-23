import { describe, expect, it } from 'vitest'
import { clipPathOf, valueTextOf } from './wipe.js'

describe('clipPathOf', () => {
  it.each([
    [0, 'inset(0 0 0 0%)'],
    [60, 'inset(0 0 0 60%)'],
    [100, 'inset(0 0 0 100%)'],
    [-1, 'inset(0 0 0 0%)'],
    [101, 'inset(0 0 0 100%)'],
  ])('cuts the left of the snapshot off at %s', (position, clipPath) => {
    expect(clipPathOf(position)).toBe(clipPath)
  })
})

describe('valueTextOf', () => {
  it.each([
    [0, 'Baseline 0%, snapshot 100%'],
    [60, 'Baseline 60%, snapshot 40%'],
    [100, 'Baseline 100%, snapshot 0%'],
  ])('says how much of each shows at %s', (position, text) => {
    expect(valueTextOf(position)).toBe(text)
  })
})
