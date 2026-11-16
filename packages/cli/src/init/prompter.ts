import { createInterface, type Interface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

/**
 * Asks the person running `init` questions, one at a time.
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
   * Shows a line before or between the questions, such as a hint or a warning. The defaults prompter collects it
   * instead.
   */
  note(text: string): void
  /**
   * Stops reading the input.
   */
  close(): void
}

/**
 * The input ended while a terminal prompter waited for an answer, such as when the person pressed Ctrl+D. `init` stops
 * with its message.
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
    super('visual-check init needs an answer, and the input ended.')
  }
}

/**
 * The reader of a terminal prompter's input, and the lines it reads.
 */
interface InputReader {
  /**
   * The interface that reads the input.
   */
  reader: Interface
  /**
   * The lines of the input, one at a time.
   */
  lines: AsyncIterator<string>
}

/**
 * Starts reading `input` a line at a time.
 */
function readerOf(input: Readable): InputReader {
  const reader = createInterface({ input, terminal: false })

  return { reader, lines: reader[Symbol.asyncIterator]() }
}

/**
 * Builds a prompter that writes the questions and notes to `output` and reads the answers from `input`, a line at a
 * time. It starts reading `input` at the first question, so a run that asks nothing leaves it alone.
 *
 * @public
 */
export function createTerminalPrompter(input: Readable, output: Writable): Prompter {
  let inputReader: InputReader | undefined

  /**
   * Writes the question, then returns the next line of the input. When the input has ended, it moves the cursor to a
   * new line, so the error that follows starts on its own, and rejects with an `InputEndedError`.
   */
  async function ask(question: string): Promise<string> {
    output.write(question)
    inputReader ??= readerOf(input)

    const next = await inputReader.lines.next()

    if (next.done === true) {
      output.write('\n')

      throw new InputEndedError()
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
      inputReader?.reader.close()
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
