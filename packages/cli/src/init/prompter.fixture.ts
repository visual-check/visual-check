import type { Choice, Prompter } from './prompter.js'
import { textOf } from './segment.js'

/**
 * One thing a scripted prompter was asked or shown.
 */
export interface PromptRecord {
  /**
   * What happened: a text question, a yes or no question, a select question, a checklist question, a validation
   * message, or a note.
   */
  kind: 'text' | 'confirm' | 'select' | 'checklist' | 'invalid' | 'note'
  /**
   * The question, the validation message or the note, as plain text.
   */
  message: string
  /**
   * The default of a question. `undefined` for a validation message or a note.
   */
  defaultValue?: string | boolean | readonly string[]
  /**
   * The hint of a question that has one.
   */
  hint?: string
}

/**
 * One answer a scripted prompter gives: a string, a boolean or the values of the choices a checklist ticks.
 */
export type ScriptedAnswer = string | boolean | readonly string[]

/**
 * Gives the values a checklist answer ticks, in the order of the choices: the array's, or the defaults for `''`.
 *
 * @throws When the answer is not an array or `''`, or ticks a value no choice has.
 */
function tickedBy<T extends string>(
  message: string,
  answer: ScriptedAnswer,
  choices: readonly Choice<T>[],
  defaultValues: readonly T[],
): T[] {
  if (typeof answer === 'boolean' || (typeof answer === 'string' && answer !== '')) {
    throw new Error(`"${message}" is a checklist, and the answer is "${answer}".`)
  }

  const ticked: readonly string[] = answer === '' ? defaultValues : answer
  const offered: T[] = choices.map((choice) => choice.value)
  const unknown = ticked.find((value) => !offered.some((offer) => offer === value))

  if (unknown !== undefined) {
    throw new Error(`"${message}" offers no choice "${unknown}".`)
  }

  return offered.filter((value) => ticked.includes(value))
}

/**
 * Builds a prompter that answers in order: a string for a text or select question, a boolean for a yes or no
 * question, and for a checklist the array of values to tick, where `''` takes the default of any question. A text or a
 * checklist is validated like the terminal UI does, and a failed answer takes up the next one. A select answer
 * must be the value of one of its choices, and so must each value of a checklist's. It records every question,
 * validation message and note in `records`, and `unused()` lists the answers left.
 *
 * @throws When it runs out of answers, or an answer is of the wrong kind.
 *
 * @public
 */
export function scriptedPrompter(answers: readonly ScriptedAnswer[]): Prompter & {
  records: PromptRecord[]
  unused: () => ScriptedAnswer[]
} {
  const records: PromptRecord[] = []
  let next = 0

  /**
   * Takes the next answer.
   */
  function take(message: string): ScriptedAnswer {
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

      if (answer === '') {
        return Promise.resolve(defaultValue)
      }

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
    checklist(message, { choices, defaultValues, hint, validate }) {
      records.push({
        kind: 'checklist',
        message,
        defaultValue: defaultValues,
        ...(hint === undefined ? {} : { hint }),
      })

      for (;;) {
        const values = tickedBy(message, take(message), choices, defaultValues)
        const problem = validate?.(values)

        if (problem === undefined) {
          return Promise.resolve(values)
        }

        records.push({ kind: 'invalid', message: problem })
      }
    },
    note(text) {
      records.push({ kind: 'note', message: textOf(text) })
    },
  }
}
