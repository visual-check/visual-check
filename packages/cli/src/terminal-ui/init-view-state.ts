import type { Choice } from '../init/prompter.js'
import type { InitResult } from '../init/run-init.js'
import { emptyOutputTail, type OutputTail, outputTailOf } from './output-tail.js'

/**
 * A line the init view shows above the active question, which never changes once shown.
 */
export type ShownLine =
  | {
      /**
       * The brand header, with a blank line after it.
       */
      kind: 'header'
      /**
       * The CLI's version.
       */
      version: string
    }
  | {
      /**
       * A note: a warning, a hint or plain text.
       */
      kind: 'note'
      /**
       * The note.
       */
      text: string
    }
  | {
      /**
       * A question, answered.
       */
      kind: 'answered'
      /**
       * The question.
       */
      message: string
      /**
       * The answer, as the person sees it.
       */
      answer: string
    }
  | {
      /**
       * A setup step's command, starting.
       */
      kind: 'command'
      /**
       * The command line.
       */
      command: string
    }
  | {
      /**
       * The result's stdout, plain.
       */
      kind: 'printed'
      /**
       * The text, its lines kept.
       */
      text: string
    }
  | {
      /**
       * A line of the result's stderr that is neither a warning nor a hint: why `init` stopped.
       */
      kind: 'failed'
      /**
       * The line.
       */
      text: string
    }

/**
 * A shown line with the key React tells it apart by.
 */
type KeyedLine = ShownLine & {
  /**
   * The line's key, unique within the view.
   */
  id: number
}

/**
 * What every question waiting for its answer has.
 */
interface QuestionBase<T> {
  /**
   * The question.
   */
  message: string
  /**
   * The answer the question starts on.
   */
  defaultValue: T
  /**
   * A line that helps answer it.
   */
  hint: string | undefined
  /**
   * Takes the answer.
   */
  onSubmit: (value: T) => void
  /**
   * Gives up on the question.
   */
  onCancel: () => void
}

/**
 * A question to ask, before it has its key.
 */
export type NewQuestion =
  | (QuestionBase<string> & {
      /**
       * A line of text.
       */
      kind: 'text'
      /**
       * Returns what is wrong with an answer, or `undefined` when it is fine.
       */
      validate: ((value: string) => string | undefined) | undefined
    })
  | (QuestionBase<boolean> & {
      /**
       * A yes or no question.
       */
      kind: 'confirm'
    })
  | (QuestionBase<string> & {
      /**
       * One of a list.
       */
      kind: 'select'
      /**
       * The answers, in the order they show.
       */
      choices: readonly [Choice<string>, ...Choice<string>[]]
    })

/**
 * The question waiting for its answer.
 */
export type ActiveQuestion = NewQuestion & {
  /**
   * The question's key, unique within the view, so a question never takes over the state of the one before.
   */
  id: number
}

/**
 * What the init view draws.
 */
export interface ViewState {
  /**
   * The lines that never change again, in the order they came. Never changed in place: a change makes a new array.
   */
  lines: KeyedLine[]
  /**
   * The question waiting for its answer, if any.
   */
  question: ActiveQuestion | undefined
  /**
   * The end of the running step's command's output.
   */
  output: OutputTail
  /**
   * The key the next line or question takes.
   */
  nextId: number
}

/**
 * Holds what the view draws, outside React, so the view's methods can change it and the screen can follow.
 */
export interface ViewStore {
  /**
   * Gives the state as it is now.
   */
  get: () => ViewState
  /**
   * Calls `listener` after every change, until the returned function is called.
   */
  subscribe: (listener: () => void) => () => void
  /**
   * Replaces the state with what `change` makes of it, and tells the listeners. When `change` throws, nothing changes.
   */
  update: (change: (state: ViewState) => ViewState) => void
}

/**
 * What the result's stderr lines that are notes start with.
 */
const notePrefixes = ['Warning: ', 'hint: ']

/**
 * The state the view starts in: the header, and nothing else.
 */
export function initialViewState(version: string): ViewState {
  return { lines: [{ id: 0, kind: 'header', version }], question: undefined, output: emptyOutputTail, nextId: 1 }
}

/**
 * Adds lines that never change again, each with the next key.
 */
function withLines(state: ViewState, added: readonly ShownLine[]): ViewState {
  const keyed = added.map((line, index) => ({ ...line, id: state.nextId + index }))

  return { ...state, lines: [...state.lines, ...keyed], nextId: state.nextId + added.length }
}

/**
 * Adds a note.
 */
export function addNote(state: ViewState, text: string): ViewState {
  return withLines(state, [{ kind: 'note', text }])
}

/**
 * Makes `question` the one waiting for its answer, with the next key.
 *
 * @throws When another question is still waiting: the view asks one at a time.
 */
export function askQuestion(state: ViewState, question: NewQuestion): ViewState {
  if (state.question !== undefined) {
    throw new Error(`"${question.message}" can't be asked while "${state.question.message}" waits for its answer.`)
  }

  return { ...state, question: { ...question, id: state.nextId }, nextId: state.nextId + 1 }
}

/**
 * Drops the question waiting for its answer, if any, and shows `line` in its place: what it was answered, when it was.
 */
export function settleQuestion(state: ViewState, line?: ShownLine): ViewState {
  return withLines({ ...state, question: undefined }, line === undefined ? [] : [line])
}

/**
 * Starts a setup step: shows its command, when it runs one, and drops the output of the step before.
 */
export function startStep(state: ViewState, command: string | undefined): ViewState {
  return { ...withLines(state, command === undefined ? [] : [{ kind: 'command', command }]), output: emptyOutputTail }
}

/**
 * Adds a chunk of the running step's command's output.
 */
export function addOutput(state: ViewState, chunk: string): ViewState {
  return { ...state, output: outputTailOf(state.output, chunk) }
}

/**
 * Gives the lines that show the end of a run: the stdout as it is, then each stderr line, a warning or a hint as a
 * note and anything else as a failure.
 */
export function resultLinesOf({ stdout, stderr }: InitResult): ShownLine[] {
  const printed: ShownLine[] = stdout === '' ? [] : [{ kind: 'printed', text: stdout.replace(/\n$/, '') }]
  const stderrLines = stderr === '' ? [] : stderr.replace(/\n$/, '').split('\n')

  return [
    ...printed,
    ...stderrLines.map(
      (text): ShownLine =>
        notePrefixes.some((prefix) => text.startsWith(prefix)) ? { kind: 'note', text } : { kind: 'failed', text },
    ),
  ]
}

/**
 * Ends the run: shows its result, and drops the question and the output.
 */
export function finishRun(state: ViewState, result: InitResult): ViewState {
  return { ...withLines(state, resultLinesOf(result)), question: undefined, output: emptyOutputTail }
}

/**
 * Makes a store that starts with `initial`.
 */
export function createViewStore(initial: ViewState): ViewStore {
  let state = initial
  const listeners = new Set<() => void>()

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    update(change) {
      state = change(state)

      for (const listener of listeners) {
        listener()
      }
    },
  }
}
