import { describe, expect, it } from 'vitest'
import { keyOf } from './terminal.fixture.js'
import { emptyTextInput, textAnswerOf, textInputEditOf, textInputReducer } from './text-input.js'

describe('textInputReducer', () => {
  it('inserts typed text at the cursor and moves the cursor past it', () => {
    expect(textInputReducer({ value: 'ac', cursor: 1 }, { type: 'insert', text: 'b' })).toEqual({
      value: 'abc',
      cursor: 2,
    })
  })

  it('inserts pasted text whole', () => {
    expect(textInputReducer(emptyTextInput, { type: 'insert', text: 'stories' })).toEqual({
      value: 'stories',
      cursor: 7,
    })
  })

  it('drops newlines and other control characters from inserted text', () => {
    expect(textInputReducer(emptyTextInput, { type: 'insert', text: 'a\r\nb\tc\u007f' })).toEqual({
      value: 'abc',
      cursor: 3,
    })
  })

  it('leaves the input as it is when nothing printable is inserted', () => {
    const state = { value: 'a', cursor: 1, error: 'Wrong.' }

    expect(textInputReducer(state, { type: 'insert', text: '\n' })).toBe(state)
  })

  it('counts a character outside the basic plane as one', () => {
    expect(textInputReducer({ value: '𝒂', cursor: 1 }, { type: 'insert', text: 'b' })).toEqual({
      value: '𝒂b',
      cursor: 2,
    })
  })

  it('moves the cursor left and right', () => {
    expect(textInputReducer({ value: 'ab', cursor: 1 }, { type: 'left' })).toEqual({ value: 'ab', cursor: 0 })
    expect(textInputReducer({ value: 'ab', cursor: 1 }, { type: 'right' })).toEqual({ value: 'ab', cursor: 2 })
  })

  it('stops the cursor at the ends of the input', () => {
    expect(textInputReducer({ value: 'ab', cursor: 0 }, { type: 'left' })).toEqual({ value: 'ab', cursor: 0 })
    expect(textInputReducer({ value: 'ab', cursor: 2 }, { type: 'right' })).toEqual({ value: 'ab', cursor: 2 })
  })

  it('keeps the error when the cursor moves', () => {
    expect(textInputReducer({ value: 'ab', cursor: 1, error: 'Wrong.' }, { type: 'left' })).toEqual({
      value: 'ab',
      cursor: 0,
      error: 'Wrong.',
    })
  })

  it('erases the character before the cursor on backspace', () => {
    expect(textInputReducer({ value: 'abc', cursor: 2 }, { type: 'backspace' })).toEqual({ value: 'ac', cursor: 1 })
  })

  it('erases nothing on backspace at the start', () => {
    const state = { value: 'abc', cursor: 0 }

    expect(textInputReducer(state, { type: 'backspace' })).toBe(state)
  })

  it('erases the character at the cursor on delete', () => {
    expect(textInputReducer({ value: 'abc', cursor: 1 }, { type: 'delete' })).toEqual({ value: 'ac', cursor: 1 })
  })

  it('erases nothing on delete at the end', () => {
    const state = { value: 'abc', cursor: 3 }

    expect(textInputReducer(state, { type: 'delete' })).toBe(state)
  })

  it('empties the input on clear', () => {
    expect(textInputReducer({ value: 'abc', cursor: 2, error: 'Wrong.' }, { type: 'clear' })).toEqual(emptyTextInput)
  })

  it('fills the input with text to edit and puts the cursor at its end', () => {
    expect(textInputReducer({ value: 'x', cursor: 0 }, { type: 'fill', text: 'stories' })).toEqual({
      value: 'stories',
      cursor: 7,
    })
  })

  it('keeps the input and shows what is wrong on reject', () => {
    expect(textInputReducer({ value: 'a b', cursor: 3 }, { type: 'reject', message: 'No spaces.' })).toEqual({
      value: 'a b',
      cursor: 3,
      error: 'No spaces.',
    })
  })

  it('drops the error on an edit', () => {
    expect(textInputReducer({ value: 'a b', cursor: 3, error: 'No spaces.' }, { type: 'backspace' })).toEqual({
      value: 'a ',
      cursor: 2,
    })
  })
})

describe('textInputEditOf', () => {
  it('moves the cursor on the left and right arrows', () => {
    expect(textInputEditOf('', keyOf({ leftArrow: true }), 'd')).toEqual({ type: 'left' })
    expect(textInputEditOf('', keyOf({ rightArrow: true }), 'd')).toEqual({ type: 'right' })
  })

  it('erases on backspace and delete', () => {
    expect(textInputEditOf('', keyOf({ backspace: true }), 'd')).toEqual({ type: 'backspace' })
    expect(textInputEditOf('', keyOf({ delete: true }), 'd')).toEqual({ type: 'delete' })
  })

  it('clears on Esc and Ctrl+U', () => {
    expect(textInputEditOf('', keyOf({ escape: true }), 'd')).toEqual({ type: 'clear' })
    expect(textInputEditOf('u', keyOf({ ctrl: true }), 'd')).toEqual({ type: 'clear' })
  })

  it('fills in the default on Tab', () => {
    expect(textInputEditOf('', keyOf({ tab: true }), 'stories')).toEqual({ type: 'fill', text: 'stories' })
  })

  it('inserts what was typed', () => {
    expect(textInputEditOf('a', keyOf({}), 'd')).toEqual({ type: 'insert', text: 'a' })
  })

  it('inserts a capital typed with Shift', () => {
    expect(textInputEditOf('A', keyOf({ shift: true }), 'd')).toEqual({ type: 'insert', text: 'A' })
  })

  it('ignores other Ctrl and Meta keys', () => {
    expect(textInputEditOf('a', keyOf({ ctrl: true }), 'd')).toBeUndefined()
    expect(textInputEditOf('a', keyOf({ meta: true }), 'd')).toBeUndefined()
  })

  it('ignores keys with no text, such as the up arrow', () => {
    expect(textInputEditOf('', keyOf({ upArrow: true }), 'd')).toBeUndefined()
  })
})

describe('textAnswerOf', () => {
  it('trims the input', () => {
    expect(textAnswerOf('  stories ', 'd')).toBe('stories')
  })

  it('gives the default for an empty input', () => {
    expect(textAnswerOf('', 'stories')).toBe('stories')
  })

  it('gives the default for an input of only spaces', () => {
    expect(textAnswerOf('   ', 'stories')).toBe('stories')
  })
})
