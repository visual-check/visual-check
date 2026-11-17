import type { Choice } from '../init/prompter.js'
import type { InitResult } from '../init/run-init.js'
import type { StepOutcome } from '../init/setup-progress.js'
import { emptyOutputTail, type OutputTail, outputTailOf } from './output-tail.js'

/**
 * Where a setup step is: not started yet, running, ended as it ended, or skipped, when the run finished after a step
 * before it failed.
 */
type StepState = 'pending' | 'running' | StepOutcome | 'skipped'

/**
 * A setup step, as the step list draws it.
 */
export interface SetupStep {
  /**
   * The step's key, unique within the view.
   */
  id: number
  /**
   * What the step does, such as `Write the files and scripts`.
   */
  title: string
  /**
   * Where the step is.
   */
  state: StepState
  /**
   * The end of its command's output.
   */
  output: OutputTail
  /**
   * The command line it runs, as shown, when it runs one.
   */
  command?: string
  /**
   * When it started, in milliseconds since the epoch.
   */
  startedAt?: number
  /**
   * When it ended, in milliseconds since the epoch.
   */
  endedAt?: number
}

/**
 * A line, or a block of them, the init view shows above the active question and the steps, which never changes once
 * shown.
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
       * The setup steps as they ended.
       */
      kind: 'steps'
      /**
       * The steps, in the order of the plan.
       */
      steps: readonly SetupStep[]
      /**
       * When the plan was given, in milliseconds since the epoch.
       */
      startedAt: number
    }
  | {
      /**
       * The end of the run: what it wrote and what to do next, or why it stopped.
       */
      kind: 'summary'
      /**
       * What the run gave.
       */
      result: InitResult
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
   * The setup steps, in the order of the plan, while they run. None before the plan, nor once the run is finished, when
   * they are among the lines.
   */
  steps: readonly SetupStep[]
  /**
   * When the plan was given, in milliseconds since the epoch, while the steps run.
   */
  plannedAt: number | undefined
  /**
   * The key the next line, question or step takes.
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
 * The state the view starts in: the header, and nothing else.
 */
export function initialViewState(version: string): ViewState {
  return {
    lines: [{ id: 0, kind: 'header', version }],
    question: undefined,
    steps: [],
    plannedAt: undefined,
    nextId: 1,
  }
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
 * Lists the setup steps that are coming, each pending, with the next keys, and starts the clock on them at `now`.
 */
export function planSteps(state: ViewState, titles: readonly string[], now: number): ViewState {
  return {
    ...state,
    steps: titles.map((title, index) => ({
      id: state.nextId + index,
      title,
      state: 'pending',
      output: emptyOutputTail,
    })),
    plannedAt: now,
    nextId: state.nextId + titles.length,
  }
}

/**
 * Changes the step at `index` with `change`, or nothing when `index` is -1.
 */
function withStep(state: ViewState, index: number, change: (step: SetupStep) => SetupStep): ViewState {
  if (index === -1) {
    return state
  }

  return { ...state, steps: state.steps.map((step, at) => (at === index ? change(step) : step)) }
}

/**
 * Gives where the running step is in the list, or -1 when none runs.
 */
function runningIndexOf(state: ViewState): number {
  return state.steps.findIndex((step) => step.state === 'running')
}

/**
 * Starts the next pending step at `now`, under `title`, with the command it runs, if any. Steps start in the order of
 * the plan, so it goes by position, not by title. Without a plan, or with every step started, nothing changes.
 */
export function startStep(state: ViewState, title: string, command: string | undefined, now: number): ViewState {
  return withStep(
    state,
    state.steps.findIndex((step) => step.state === 'pending'),
    (step) => ({ ...step, title, state: 'running', startedAt: now, ...(command === undefined ? {} : { command }) }),
  )
}

/**
 * Adds a chunk of the running step's command's output to its tail. With no step running, nothing changes.
 */
export function addOutput(state: ViewState, chunk: string): ViewState {
  return withStep(state, runningIndexOf(state), (step) => ({ ...step, output: outputTailOf(step.output, chunk) }))
}

/**
 * Ends the running step at `now` with its outcome. With no step running, nothing changes.
 */
export function endStep(state: ViewState, outcome: StepOutcome, now: number): ViewState {
  return withStep(state, runningIndexOf(state), (step) => ({ ...step, state: outcome, endedAt: now }))
}

/**
 * Gives the steps as the run left them. After a step failed, no step starts, so the ones still pending are skipped.
 */
function finishedStepsOf(steps: readonly SetupStep[]): readonly SetupStep[] {
  if (!steps.some((step) => step.state === 'failed')) {
    return steps
  }

  return steps.map((step) => (step.state === 'pending' ? { ...step, state: 'skipped' } : step))
}

/**
 * Ends the run: drops the question, and moves the steps, as they ended, and then the result into the lines, so each is
 * shown once and never drawn again. After a failed step, the steps that never started show as skipped.
 */
export function finishRun(state: ViewState, result: InitResult): ViewState {
  const { plannedAt } = state
  const steps = finishedStepsOf(state.steps)
  const stepLines: ShownLine[] = plannedAt === undefined ? [] : [{ kind: 'steps', steps, startedAt: plannedAt }]

  return {
    ...withLines(state, [...stepLines, { kind: 'summary', result }]),
    question: undefined,
    steps: [],
    plannedAt: undefined,
  }
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
