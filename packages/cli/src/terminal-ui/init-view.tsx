import { render } from 'ink'
import { InputEndedError, type Prompter } from '../init/prompter.js'
import type { InitResult } from '../init/run-init.js'
import type { SetupProgress } from '../init/setup-progress.js'
import { InitScreen } from './init-screen.js'
import {
  addNote,
  addOutput,
  askQuestion,
  createViewStore,
  endStep,
  finishRun,
  initialViewState,
  type NewQuestion,
  planSteps,
  settleQuestion,
  startStep,
} from './init-view-state.js'
import { colourEnabledOf, ThemeContext } from './theme.js'

/**
 * `init` in the terminal: it asks the questions, shows the notes and the setup steps as they come, and shows the end of
 * the run.
 */
export interface InitView extends Prompter {
  /**
   * Shows the setup steps after the questions, from the plan on: a progress bar with the time taken, then each step
   * pending, running with its command and the last three lines of its output, or ended with how long it took.
   */
  progress: SetupProgress
  /**
   * Gives up on a question still waiting, which rejects with an `InputEndedError`. Then shows the end of the run, once:
   * the steps as they ended, then the summary, which tells what was written and what to do next, or why `init`
   * stopped. Then it stops drawing and hands the terminal back. Resolves once the last frame is written.
   */
  finish(result: InitResult): Promise<void>
}

/**
 * What `startInitView` takes.
 */
interface InitViewOptions {
  /**
   * The CLI's version, which the header shows.
   */
  version: string
  /**
   * Whether `--yes` was passed: every question takes its default straight away and shows only as answered, and no
   * input is read.
   */
  yes: boolean
  /**
   * The environment, which turns colour off with `NO_COLOR` or `FORCE_COLOR=0`.
   */
  environment: NodeJS.ProcessEnv
  /**
   * Where the answers are read from: a TTY.
   */
  stdin: NodeJS.ReadableStream
  /**
   * Where the view is drawn: a TTY.
   */
  stdout: NodeJS.WritableStream
  /**
   * Whether every frame is written in full after the one before, instead of drawn over it, so a test can read each.
   * `false` by default.
   */
  debug?: boolean
  /**
   * Tells the time now, in milliseconds since the epoch, which the steps' durations count with. `Date.now` by default.
   */
  clock?: () => number
}

/**
 * The callbacks that settle a question.
 */
interface Settling<T> {
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
 * Starts drawing `init` in the terminal, with the brand header first, and gives the view that asks its questions and
 * shows its progress. One Ink app draws the whole run, until `finish`. It asks one question at a time: asking another
 * while one waits rejects. Ctrl+C and Ctrl+D during a question reject it with an `InputEndedError`.
 *
 * @public
 */
export function startInitView(options: InitViewOptions): InitView {
  const clock = options.clock ?? Date.now
  const store = createViewStore(initialViewState(options.version))
  const instance = render(
    <ThemeContext value={{ colour: colourEnabledOf(options.environment) }}>
      <InitScreen clock={clock} store={store} />
    </ThemeContext>,
    {
      stdin: options.stdin,
      stdout: options.stdout,
      // Ink would take Ctrl+C before the question sees it, and exit.
      exitOnCtrlC: false,
      patchConsole: false,
      // The caller decided there's a terminal. Ink's own guess also looks for CI variables, and would draw nothing
      // until the end.
      interactive: true,
      debug: options.debug ?? false,
    },
  )

  /**
   * Asks a question and gives its answer. The answered question collapses to one line, which shows the answer as
   * `answerOf` words it. With `--yes`, the default is the answer straight away. Giving up rejects with an
   * `InputEndedError`, and the question goes.
   */
  function ask<T>(
    message: string,
    defaultValue: T,
    answerOf: (value: T) => string,
    questionOf: (settling: Settling<T>) => NewQuestion,
  ): Promise<T> {
    if (options.yes) {
      store.update((state) => settleQuestion(state, { kind: 'answered', message, answer: answerOf(defaultValue) }))

      return Promise.resolve(defaultValue)
    }

    return new Promise((resolve, reject) => {
      const question = questionOf({
        onSubmit(value) {
          store.update((state) => settleQuestion(state, { kind: 'answered', message, answer: answerOf(value) }))
          resolve(value)
        },
        onCancel() {
          store.update((state) => settleQuestion(state))
          reject(new InputEndedError())
        },
      })

      store.update((state) => askQuestion(state, question))
    })
  }

  return {
    text(message, { defaultValue, hint, validate }) {
      return ask(
        message,
        defaultValue,
        (value) => value,
        (settling) => ({ kind: 'text', message, defaultValue, hint, validate, ...settling }),
      )
    },
    confirm(message, { defaultValue, hint }) {
      return ask(
        message,
        defaultValue,
        (value) => (value ? 'yes' : 'no'),
        (settling) => ({ kind: 'confirm', message, defaultValue, hint, ...settling }),
      )
    },
    async select(message, { choices, defaultValue, hint }) {
      /**
       * Gives the choice with `value`, or the first choice for a value none of them has, such as a default that
       * `--yes` takes without asking.
       */
      const choiceOf = (value: string): (typeof choices)[number] =>
        choices.find((choice) => choice.value === value) ?? choices[0]
      const value = await ask<string>(
        message,
        defaultValue,
        (picked) => choiceOf(picked).label,
        (settling) => ({ kind: 'select', message, defaultValue, hint, choices, ...settling }),
      )

      return choiceOf(value).value
    },
    note(text) {
      store.update((state) => addNote(state, text))
    },
    progress: {
      plan(titles) {
        store.update((state) => planSteps(state, titles, clock()))
      },
      start(title, command) {
        store.update((state) => startStep(state, title, command, clock()))
      },
      output(text) {
        store.update((state) => addOutput(state, text))
      },
      end(outcome) {
        store.update((state) => endStep(state, outcome, clock()))
      },
    },
    async finish(result) {
      store.get().question?.onCancel()
      store.update((state) => finishRun(state, result))
      await instance.waitUntilRenderFlush()
      instance.unmount()
      await instance.waitUntilExit()
    },
  }
}
