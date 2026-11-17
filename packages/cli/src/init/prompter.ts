/**
 * One answer a select question offers.
 *
 * @public
 */
export interface Choice<T extends string> {
  /**
   * What the question answers with when this choice is picked.
   */
  value: T
  /**
   * What the person sees.
   */
  label: string
  /**
   * A few words after the label that help pick it.
   */
  hint?: string
}

/**
 * Asks the person running `init` questions, one at a time. Each question can carry a hint: a line that helps answer
 * it.
 *
 * @public
 */
export interface Prompter {
  /**
   * Asks for a line of text. An empty answer takes `options.defaultValue`. The answer is trimmed. When
   * `options.validate` returns a message, the prompter shows it and asks again.
   */
  text(
    message: string,
    options: {
      /**
       * What an empty answer takes.
       */
      defaultValue: string
      /**
       * A line that helps answer the question.
       */
      hint?: string
      /**
       * Returns what is wrong with an answer, or `undefined` when it is fine.
       */
      validate?: (value: string) => string | undefined
    },
  ): Promise<string>
  /**
   * Asks a yes or no question, which starts on `options.defaultValue`.
   */
  confirm(
    message: string,
    options: {
      /**
       * The side the question starts on.
       */
      defaultValue: boolean
      /**
       * A line that helps answer the question.
       */
      hint?: string
    },
  ): Promise<boolean>
  /**
   * Asks the person to pick one of `options.choices`, starting on the one whose value is `options.defaultValue`. Gives
   * the value of the choice picked.
   */
  select<T extends string>(
    message: string,
    options: {
      /**
       * The answers, in the order they show. There is at least one.
       */
      choices: readonly [Choice<T>, ...Choice<T>[]]
      /**
       * The value of the choice the question starts on.
       */
      defaultValue: T
      /**
       * A line that helps answer the question.
       */
      hint?: string
    },
  ): Promise<T>
  /**
   * Shows a line before or between the questions, such as a hint or a warning. The defaults prompter collects it
   * instead.
   */
  note(text: string): void
}

/**
 * The person gave up on a question, with Ctrl+C or Ctrl+D, before every answer was in. `init` stops with its message.
 *
 * @public
 */
export class InputEndedError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `InputEndedError`.
   */
  override name = 'InputEndedError'

  /**
   * Builds the error with its one message.
   */
  constructor() {
    super('visual-check init stopped before every answer was in. It wrote nothing.')
  }
}

/**
 * Builds a prompter for `--yes`: every question gets its default, a text isn't validated, hints are ignored, and the
 * notes are collected in `notes`. It never reads the input.
 *
 * @public
 */
export function defaultsPrompter(): Prompter & { notes: string[] } {
  const notes: string[] = []

  return {
    notes,
    text: (_message, { defaultValue }) => Promise.resolve(defaultValue),
    confirm: (_message, { defaultValue }) => Promise.resolve(defaultValue),
    select: (_message, { defaultValue }) => Promise.resolve(defaultValue),
    note(text) {
      notes.push(text)
    },
  }
}
