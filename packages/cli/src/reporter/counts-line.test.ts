import { describe, expect, it } from 'vitest'
import { countsLineOf, orphanLabelOf } from './counts-line.js'

describe('countsLineOf', () => {
  it('writes each label with its count, in the order given, leaving out zero counts except the first', () => {
    expect(
      countsLineOf([
        ['written', 2],
        ['deleted', 0],
        ['kept', 1],
      ]),
    ).toBe('2 written · 1 kept')
  })

  it('keeps the first count when it is zero', () => {
    expect(
      countsLineOf([
        ['passed', 0],
        ['differs', 0],
      ]),
    ).toBe('0 passed')
  })
})

describe('orphanLabelOf', () => {
  it('says orphan for 1 and orphans otherwise', () => {
    expect([0, 1, 2].map(orphanLabelOf)).toEqual(['orphans', 'orphan', 'orphans'])
  })
})
