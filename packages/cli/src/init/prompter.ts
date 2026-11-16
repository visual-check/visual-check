import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

/**
 * Asks the person running `init` questions, one at a time.
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
       * Returns what is wrong with an answer, or `undefined` when it is fine.
       */
      validate?: (value: string) => string | undefined
    },
  ): Promise<string>
  /**
   * Asks a yes or no question. An empty answer takes `defaultValue`.
   */
  confirm(message: string, defaultValue: boolean): Promise<boolean>
  /**
   * Shows a line between the questions, such as a hint. The defaults prompter collects it instead.
   */
  note(text: string): void
  /**
   * Stops reading the input.
   */
  close(): void
}

/**
 * The error a terminal prompter rejects with when the input ends while it waits for an answer.
 */
const inputEndedMessage = 'visual-check init needs an answer, and the input ended.'

/**
 * Builds a prompter that writes the questions to `output` and reads the answers from `input`, a line at a time.
 *
 * @public
 */
export function createTerminalPrompter(input: Readable, output: Writable): Prompter {
  const reader = createInterface({ input, terminal: false })
  const lines = reader[Symbol.asyncIterator]()

  /**
   * Writes the question, then returns the next line of the input. When the input has ended, it moves the cursor to a
   * new line, so the error that follows starts on its own, and rejects.
   */
  async function ask(question: string): Promise<string> {
    output.write(question)

    const next = await lines.next()

    if (next.done === true) {
      output.write('\n')

      throw new Error(inputEndedMessage)
    }

    return next.value
  }

  return {
    async text(message, { defaultValue, validate }) {
      for (;;) {
        const answer = (await ask(`? ${message} (${defaultValue}) `)).trim()
        const value = answer === '' ? defaultValue : answer
        const problem = validate?.(value)

        if (problem === undefined) {
          return value
        }

        output.write(`  ${problem}\n`)
      }
    },
    async confirm(message, defaultValue) {
      for (;;) {
        const answer = (await ask(`? ${message} (${defaultValue ? 'Y/n' : 'y/N'}) `)).trim().toLowerCase()

        if (answer === '') {
          return defaultValue
        }

        if (answer === 'y' || answer === 'yes') {
          return true
        }

        if (answer === 'n' || answer === 'no') {
          return false
        }

        output.write('  Answer y or n.\n')
      }
    },
    note(text) {
      output.write(`${text}\n`)
    },
    close() {
      reader.close()
    },
  }
}

/**
 * Builds a prompter for `--yes`: every question gets its default, a text isn't validated, and the notes are collected
 * in `notes`. It never reads the input.
 *
 * @public
 */
export function defaultsPrompter(): Prompter & { notes: string[] } {
  const notes: string[] = []

  return {
    notes,
    text: (_message, { defaultValue }) => Promise.resolve(defaultValue),
    confirm: (_message, defaultValue) => Promise.resolve(defaultValue),
    note(text) {
      notes.push(text)
    },
    close() {
      // Nothing was opened.
    },
  }
}
