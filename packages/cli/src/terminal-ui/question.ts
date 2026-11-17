import { type Key, useInput } from 'ink'
import { useRef, useState } from 'react'

/**
 * What every question takes.
 */
export interface QuestionProps<T> {
  /**
   * The question.
   */
  message: string
  /**
   * The answer the question starts on: what an empty text input gives, the side a yes or no question starts on, or the
   * choice a select question highlights first.
   */
  defaultValue: T
  /**
   * A line that helps answer the question.
   */
  hint?: string | undefined
  /**
   * Takes the answer.
   */
  onSubmit: (value: T) => void
  /**
   * Gives up on the question, on Ctrl+C or Ctrl+D.
   */
  onCancel: () => void
}

/**
 * How `useQuestionInput` hands on key presses.
 */
interface QuestionInputOptions {
  /**
   * Whether the handler also gets keys pressed with Ctrl or Meta, other than Ctrl+C and Ctrl+D. The text question
   * takes them, for Ctrl+U.
   */
  modifiedKeys?: boolean
}

/**
 * A question's state, as the last render drew it and as its key handler last left it.
 */
interface LatestState<T> {
  /**
   * The state the last render drew.
   */
  value: T
  /**
   * Gives the state the last `set` left, before React draws it.
   */
  latest: () => T
  /**
   * Replaces the state.
   */
  set: (next: T) => void
}

/**
 * What ends a line in a chunk of input.
 */
const lineBreak = /\r\n|\r|\n/

/**
 * Whether a key press gives up on the question: Ctrl+C or Ctrl+D.
 */
export function isCancelKey(input: string, key: Key): boolean {
  return key.ctrl && (input === 'c' || input === 'd')
}

/**
 * Splits a chunk of input into the key presses it holds: the text between its line breaks, as typed, and Enter for each
 * line break. Ink hands on text and the line breaks in it as one chunk when they arrive together, as when Enter follows
 * typing at once, and would drop the Enter. A chunk without a line break is one key press, as it came.
 */
export function keyPressesOf(input: string, key: Key): [string, Key][] {
  const lines = input.split(lineBreak)

  if (lines.length === 1) {
    return [[input, key]]
  }

  const enter: Key = { ...key, return: true }

  return lines.flatMap((text, index): [string, Key][] => [
    ...(text === '' ? [] : [[text, key] as [string, Key]]),
    ...(index < lines.length - 1 ? [['', enter] as [string, Key]] : []),
  ])
}

/**
 * Hands a question's key presses to `handler`, after the keys every question shares: Ctrl+C and Ctrl+D call
 * `onCancel`, and other keys pressed with Ctrl or Meta do nothing unless `options.modifiedKeys` lets them through. A
 * chunk of input that holds line breaks reaches `handler` as its text and an Enter for each break. A bracketed paste
 * arrives through Ink's paste events instead, whole.
 */
export function useQuestionInput(
  onCancel: () => void,
  handler: (input: string, key: Key) => void,
  options: QuestionInputOptions = {},
): void {
  useInput((input, key) => {
    if (isCancelKey(input, key)) {
      onCancel()
    } else if (options.modifiedKeys === true || !(key.ctrl || key.meta)) {
      for (const [typed, pressed] of keyPressesOf(input, key)) {
        handler(typed, pressed)
      }
    }
  })
}

/**
 * State a question's key handler reads back with `latest`. Ink runs the handler for every key in one chunk of input,
 * such as `↓` and Enter sent together, before React draws again. A handler that read the drawn state would miss the
 * keys before it in the chunk.
 */
export function useLatestState<T>(initial: T): LatestState<T> {
  const [value, setValue] = useState(initial)
  const latest = useRef(initial)

  return {
    value,
    latest: () => latest.current,
    set: (next) => {
      latest.current = next
      setValue(next)
    },
  }
}
