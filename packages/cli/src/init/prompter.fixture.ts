import type { Prompter } from './prompter.js'

/**
 * One thing a scripted prompter was asked or shown.
 */
export interface PromptRecord {
  /**
   * What happened: a text question, a yes or no question, a select question, a validation message, or a note.
   */
  kind: 'text' | 'confirm' | 'select' | 'invalid' | 'note'
  /**
   * The question, the validation message or the note.
   */
  message: string
  /**
   * The default of a question. `undefined` for a validation message or a note.
   */
  defaultValue?: string | boolean
  /**
   * The hint of a question that has one.
   */
  hint?: string
}

/**
 * Builds a prompter that answers in order: a string for a text or select question, where `''` takes the default, and
 * a boolean for a yes or no question. A text is validated like the terminal UI does, and a failed answer takes up the
 * next one. A select answer must be the value of one of its choices. It records every question, validation message
 * and note in `records`, and `unused()` lists the answers left.
 *
 * @throws When it runs out of answers, or an answer is of the wrong kind.
 *
 * @public
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

  /**
   * Takes the next answer, which must be a string.
   */
  function takeString(message: string): string {
    const answer = take(message)

    if (typeof answer !== 'string') {
      throw new Error(`"${message}" takes a string, and the answer is ${answer}.`)
    }

    return answer
  }

  return {
    records,
    unused: () => answers.slice(next),
    text(message, { defaultValue, hint, validate }) {
      records.push({ kind: 'text', message, defaultValue, ...(hint === undefined ? {} : { hint }) })

      for (;;) {
        const answer = takeString(message).trim()
        const value = answer === '' ? defaultValue : answer
        const problem = validate?.(value)

        if (problem === undefined) {
          return Promise.resolve(value)
        }

        records.push({ kind: 'invalid', message: problem })
      }
    },
    confirm(message, { defaultValue, hint }) {
      records.push({ kind: 'confirm', message, defaultValue, ...(hint === undefined ? {} : { hint }) })

      const answer = take(message)

      if (typeof answer !== 'boolean') {
        throw new Error(`"${message}" is a yes or no question, and the answer is "${answer}".`)
      }

      return Promise.resolve(answer)
    },
    select(message, { choices, defaultValue, hint }) {
      records.push({ kind: 'select', message, defaultValue, ...(hint === undefined ? {} : { hint }) })

      const answer = takeString(message)
      const chosen = choices.find(({ value }) => value === (answer === '' ? defaultValue : answer))

      if (chosen === undefined) {
        throw new Error(`"${message}" offers no choice "${answer}".`)
      }

      return Promise.resolve(chosen.value)
    },
    note(text) {
      records.push({ kind: 'note', message: text })
    },
  }
}
