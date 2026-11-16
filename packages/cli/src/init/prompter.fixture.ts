import type { Prompter } from './prompter.js'

/**
 * One thing a scripted prompter was asked or shown.
 */
export interface PromptRecord {
  /**
   * What happened: a text question, a yes or no question, a validation message, or a note.
   */
  kind: 'text' | 'confirm' | 'invalid' | 'note'
  /**
   * The question, the validation message or the note.
   */
  message: string
  /**
   * The default of a question. `undefined` for a validation message or a note.
   */
  defaultValue?: string | boolean
}

/**
 * Builds a prompter that answers in order: a string for a text question, where `''` takes the default, and a boolean
 * for a yes or no question. A text is validated like the terminal prompter does, and a failed answer takes up the next
 * one. It records every question, validation message and note in `records`, and `unused()` lists the answers left.
 *
 * @throws When it runs out of answers, or an answer is of the wrong kind.
 */
export function scriptedPrompter(answers: readonly (string | boolean)[]): Prompter & {
  records: PromptRecord[]
  unused: () => (string | boolean)[]
} {
  const records: PromptRecord[] = []
  let next = 0

  /**
   * Takes the next answer.
   */
  function take(message: string): string | boolean {
    const answer = answers[next]
    next += 1

    if (answer === undefined) {
      throw new Error(`The scripted prompter ran out of answers at "${message}".`)
    }

    return answer
  }

  return {
    records,
    unused: () => answers.slice(next),
    text(message, { defaultValue, validate }) {
      records.push({ kind: 'text', message, defaultValue })

      for (;;) {
        const answer = take(message)

        if (typeof answer !== 'string') {
          throw new Error(`"${message}" is a text question, and the answer is ${answer}.`)
        }

        const value = answer.trim() === '' ? defaultValue : answer.trim()
        const problem = validate?.(value)

        if (problem === undefined) {
          return Promise.resolve(value)
        }

        records.push({ kind: 'invalid', message: problem })
      }
    },
    confirm(message, defaultValue) {
      records.push({ kind: 'confirm', message, defaultValue })

      const answer = take(message)

      if (typeof answer !== 'boolean') {
        throw new Error(`"${message}" is a yes or no question, and the answer is "${answer}".`)
      }

      return Promise.resolve(answer)
    },
    note(text) {
      records.push({ kind: 'note', message: text })
    },
    close() {
      // Nothing was opened.
    },
  }
}
