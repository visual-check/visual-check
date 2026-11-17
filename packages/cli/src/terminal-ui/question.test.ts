import { describe, expect, it } from 'vitest'
import { isCancelKey, keyPressesOf } from './question.js'
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

describe('keyPressesOf', () => {
  /**
   * Enter, as `keyPressesOf` gives it for a line break.
   */
  const enter = keyOf({ return: true })

  it('gives a chunk without a line break as one key press, as it came', () => {
    expect(keyPressesOf('ab', keyOf({}))).toEqual([['ab', keyOf({})]])
    expect(keyPressesOf('', keyOf({ return: true }))).toEqual([['', enter]])
  })

  it('gives the text before a line break, then Enter', () => {
    expect(keyPressesOf('ab\r', keyOf({}))).toEqual([
      ['ab', keyOf({})],
      ['', enter],
    ])
  })

  it('gives an Enter for each line break, a Windows line end counting once', () => {
    expect(keyPressesOf('\r\r', keyOf({}))).toEqual([
      ['', enter],
      ['', enter],
    ])
    expect(keyPressesOf('a\r\nb\nc', keyOf({}))).toEqual([
      ['a', keyOf({})],
      ['', enter],
      ['b', keyOf({})],
      ['', enter],
      ['c', keyOf({})],
    ])
  })
})
