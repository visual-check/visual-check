import { describe, expect, it } from 'vitest'
import { durationOf } from './duration.js'

describe('durationOf', () => {
  it.each([
    [0, '0 ms'],
    [142, '142 ms'],
    [999.4, '999 ms'],
    [999.6, '1.0s'],
    [12_345, '12.3s'],
    [59_999, '59.9s'],
    [60_000, '1m 0s'],
    [192_000, '3m 12s'],
    [3_725_000, '62m 5s'],
    [-5, '0 ms'],
  ])('writes %d ms as %s', (ms, expected) => {
    expect(durationOf(ms)).toBe(expected)
  })
})
