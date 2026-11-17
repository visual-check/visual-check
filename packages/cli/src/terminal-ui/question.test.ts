import { describe, expect, it } from 'vitest'
import { isCancelKey } from './question.js'
import { keyOf } from './terminal.fixture.js'

describe('isCancelKey', () => {
  it('cancels on Ctrl+C and Ctrl+D', () => {
    expect(isCancelKey('c', keyOf({ ctrl: true }))).toBe(true)
    expect(isCancelKey('d', keyOf({ ctrl: true }))).toBe(true)
  })

  it('does not cancel on c or d without Ctrl', () => {
    expect(isCancelKey('c', keyOf({}))).toBe(false)
    expect(isCancelKey('d', keyOf({}))).toBe(false)
  })

  it('does not cancel on another Ctrl key', () => {
    expect(isCancelKey('u', keyOf({ ctrl: true }))).toBe(false)
  })
})
