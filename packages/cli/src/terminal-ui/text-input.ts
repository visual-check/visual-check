import type { Key } from 'ink'

/**
 * What a text question holds while the person types.
 */
export interface TextInputState {
  /**
   * What the person typed so far.
   */
  value: string
  /**
   * Where the next character goes, in characters from the start of `value`.
   */
  cursor: number
  /**
   * What is wrong with the answer the person tried to give. The next edit drops it.
   */
  error?: string
}

/**
 * A change to a text question's input, from a key press or a paste.
 */
export type TextInputEdit =
  | {
      /**
       * `insert` puts text in at the cursor and moves the cursor past it. `fill` replaces the input with text to edit,
       * such as the default, and puts the cursor at its end.
       */
      type: 'insert' | 'fill'
      /**
       * The text. Control characters, newlines among them, are dropped.
       */
      text: string
    }
  | {
      /**
       * `left` and `right` move the cursor one character, `backspace` and `delete` erase the character before or at
       * it, and `clear` empties the input, so the default shows again.
       */
      type: 'left' | 'right' | 'backspace' | 'delete' | 'clear'
    }
  | {
      /**
       * Keeps the input and shows what is wrong with it.
       */
      type: 'reject'
      /**
       * What is wrong.
       */
      message: string
    }

/**
 * An empty text input.
 */
export const emptyTextInput: TextInputState = { value: '', cursor: 0 }

/**
 * Drops control characters, newlines among them, from text a person typed or pasted.
 */
function printableOf(text: string): string {
  return [...text].filter((character) => character >= ' ' && character !== '\u007f').join('')
}

/**
 * The text input after a key press or a paste. Moving the cursor keeps the error; an edit drops it.
 */
export function textInputReducer(state: TextInputState, edit: TextInputEdit): TextInputState {
  const characters = [...state.value]
  const { cursor } = state

  switch (edit.type) {
    case 'insert': {
      const inserted = [...printableOf(edit.text)]

      if (inserted.length === 0) {
        return state
      }

      return { value: characters.toSpliced(cursor, 0, ...inserted).join(''), cursor: cursor + inserted.length }
    }
    case 'fill': {
      const value = printableOf(edit.text)

      return { value, cursor: [...value].length }
    }
    case 'left':
      return { ...state, cursor: Math.max(cursor - 1, 0) }
    case 'right':
      return { ...state, cursor: Math.min(cursor + 1, characters.length) }
    case 'backspace':
      return cursor === 0 ? state : { value: characters.toSpliced(cursor - 1, 1).join(''), cursor: cursor - 1 }
    case 'delete':
      return cursor === characters.length ? state : { value: characters.toSpliced(cursor, 1).join(''), cursor }
    case 'clear':
      return emptyTextInput
    case 'reject':
      return { ...state, error: edit.message }
  }
}

/**
 * The change a key press makes to a text question's input, or `undefined` for a key it ignores. Enter, Ctrl+C and
 * Ctrl+D are the question's own, not edits. Tab fills in `defaultValue` to edit.
 */
export function textInputEditOf(input: string, key: Key, defaultValue: string): TextInputEdit | undefined {
  if (key.leftArrow || key.rightArrow) {
    return { type: key.leftArrow ? 'left' : 'right' }
  }

  if (key.backspace || key.delete) {
    return { type: key.backspace ? 'backspace' : 'delete' }
  }

  if (key.escape || (key.ctrl && input === 'u')) {
    return { type: 'clear' }
  }

  if (key.tab) {
    return { type: 'fill', text: defaultValue }
  }

  if (key.ctrl || key.meta || input === '') {
    return undefined
  }

  return { type: 'insert', text: input }
}

/**
 * The answer a text question gives for its input: the input trimmed, or `defaultValue` when that leaves nothing.
 */
export function textAnswerOf(value: string, defaultValue: string): string {
  const trimmed = value.trim()

  return trimmed === '' ? defaultValue : trimmed
}
