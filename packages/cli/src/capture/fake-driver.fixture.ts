import { answerOptionsReadExpression } from '../storybook/options-read.fixture.js'
import { finishedAnswer } from '../storybook/preview-script.fixture.js'
import type {
  BrowserExitedError,
  CaptureArea,
  Driver,
  Page,
  PageMessage,
  PageSetup,
  PageViewport,
} from './driver/driver.js'
import { settledAnswer } from './end-state.fixture.js'
import { readyAnswer } from './page-script.fixture.js'

/**
 * How a fake page answers the waits, the end state, the capture preparation and the options read evaluated in it. One
 * left out answers as on a story that's ready: the story wait gives `finishedAnswer()`, the wait for images and fonts
 * gives `readyAnswer()`, the wait hook finds none to run, the end state gives `settledAnswer()`, changing nothing, the
 * capture preparation is ready for the full page, and the options read finds every file loaded and no story with
 * options.
 */
interface FakeEvaluation {
  /**
   * Answers the story wait, given the driver's time limit for it.
   */
  storyWait?: (timeoutMs: number) => Promise<unknown>
  /**
   * Answers the wait for images and fonts, given the driver's time limit for it.
   */
  assetsWait?: (timeoutMs: number) => Promise<unknown>
  /**
   * Answers the run of the story's wait hook, given the driver's time limit for it.
   */
  waitHook?: (timeoutMs: number) => Promise<unknown>
  /**
   * Answers the end state, given the driver's time limit for it.
   */
  endStateWait?: (timeoutMs: number) => Promise<unknown>
  /**
   * Answers the capture preparation, given the driver's time limit for it.
   */
  capturePrep?: (timeoutMs: number) => Promise<unknown>
  /**
   * Answers the options read, given the driver's time limit for it.
   */
  optionsRead?: (timeoutMs: number) => Promise<unknown>
}

/**
 * How a fake page tells each evaluation apart and answers it: the call the expression makes in the page, the answer of
 * `FakeEvaluation` that answers it, and what it answers when the test gives none, from the expression.
 */
const evaluationAnswers: [string, keyof FakeEvaluation, (expression: string) => unknown][] = [
  ['.waitForStory(', 'storyWait', () => finishedAnswer()],
  ['.waitForAssets(', 'assetsWait', () => readyAnswer()],
  ['.runWait(', 'waitHook', () => ({ outcome: 'none' })],
  ['.bringToEndState(', 'endStateWait', () => settledAnswer()],
  ['.prepareCapture(', 'capturePrep', () => ({ outcome: 'ready', box: null })],
  ['.readOptions(', 'optionsRead', answerOptionsReadExpression],
]

/**
 * Answers an expression evaluated in a fake page as `evaluation` says. It tells the waits apart by the function each
 * calls in the page: `waitForStory` for the story wait, `waitForAssets` for the wait for images and fonts, `runWait`
 * for the wait hook, `bringToEndState` for the end state, `prepareCapture` for the capture preparation and
 * `readOptions` for the options read. Throws on any other expression, so one the fake doesn't know, such as a wait
 * whose function was renamed, fails clearly.
 *
 * @public
 */
export async function answerEvaluate(
  evaluation: FakeEvaluation,
  expression: string,
  timeoutMs: number,
): Promise<unknown> {
  for (const [call, answer, unscripted] of evaluationAnswers) {
    if (expression.includes(call)) {
      const scripted = evaluation[answer]

      return scripted === undefined ? await unscripted(expression) : await scripted(timeoutMs)
    }
  }

  throw new Error(`The fake page doesn't know this expression: ${expression}`)
}

/**
 * How one fake page answers each call. A call left out succeeds, as on a story that's ready: the waits answer as
 * `answerEvaluate` says, and the capture gives `defaultSnapshot`.
 */
export interface FakePageBehaviour extends FakeEvaluation {
  /**
   * Answers `clearStorage`.
   */
  clearStorage?: () => Promise<void>
  /**
   * Answers `setViewport`.
   */
  setViewport?: (viewport: PageViewport) => Promise<void>
  /**
   * Answers `goto`.
   */
  goto?: (url: string, timeoutMs: number) => Promise<void>
  /**
   * Answers `capture`.
   */
  capture?: (area: CaptureArea) => Promise<Uint8Array>
  /**
   * Answers `close`.
   */
  close?: () => Promise<void>
  /**
   * Answers `requestHosts`. The page made no real network request when it is left out.
   */
  requestHosts?: () => string[]
  /**
   * Answers `messages`. The page sent no console message or error when it is left out.
   */
  messages?: () => PageMessage[]
}

/**
 * What the fake driver does.
 */
export interface FakeDriverBehaviour {
  /**
   * How each page answers, in the order the pages are opened. Pages beyond the list answer as a page with no
   * behaviour given.
   */
  pages?: FakePageBehaviour[]
  /**
   * Answers `newPage` before a page is opened: a rejection fails the opening. Every opening succeeds by default.
   */
  newPage?: (setup: PageSetup) => Promise<void>
}

/**
 * A call the fake driver's pages received.
 */
export interface PageCall {
  /**
   * Which page received it, counting from 1 in the order the pages were opened.
   */
  page: number
  /**
   * The called method.
   */
  method: keyof Page
  /**
   * The call's arguments.
   */
  args: unknown[]
}

/**
 * The snapshot a fake page captures when its behaviour gives none.
 */
export const defaultSnapshot = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

/**
 * A driver whose pages answer as told, recording each page's setup and every call they receive.
 */
export class FakeDriver implements Driver {
  /**
   * The browser's version.
   */
  readonly version = '157.0.8103.78'

  /**
   * Never settles: the fake browser never exits.
   */
  readonly exited = new Promise<BrowserExitedError>(() => undefined)

  /**
   * The setup of each page opened, in order.
   */
  readonly setups: PageSetup[] = []

  /**
   * Every call the pages received, in order.
   */
  readonly calls: PageCall[] = []

  /**
   * What the driver does.
   */
  private readonly behaviour: FakeDriverBehaviour

  /**
   * Takes what the driver does.
   */
  constructor(behaviour: FakeDriverBehaviour = {}) {
    this.behaviour = behaviour
  }

  /**
   * Opens the next fake page, after the behaviour's `newPage` lets it.
   */
  newPage = async (setup: PageSetup): Promise<Page> => {
    await this.behaviour.newPage?.(setup)
    this.setups.push(setup)

    const number = this.setups.length
    const answers = this.behaviour.pages?.[number - 1] ?? {}
    const record = (method: keyof Page, args: unknown[]): void => {
      this.calls.push({ page: number, method, args })
    }

    return {
      clearStorage: async () => {
        record('clearStorage', [])
        await answers.clearStorage?.()
      },
      setViewport: async (viewport) => {
        record('setViewport', [viewport])
        await answers.setViewport?.(viewport)
      },
      goto: async (url, timeoutMs) => {
        record('goto', [url, timeoutMs])
        await answers.goto?.(url, timeoutMs)
      },
      evaluate: async (expression, timeoutMs) => {
        record('evaluate', [expression, timeoutMs])

        return await answerEvaluate(answers, expression, timeoutMs)
      },
      capture: async (area) => {
        record('capture', [area])

        return answers.capture === undefined ? defaultSnapshot : await answers.capture(area)
      },
      close: async () => {
        record('close', [])
        await answers.close?.()
      },
      requestHosts: () => answers.requestHosts?.() ?? [],
      messages: () => answers.messages?.() ?? [],
    }
  }

  /**
   * Does nothing: the fake browser has nothing to close.
   */
  close = async (): Promise<void> => undefined

  /**
   * The methods called on the pages, each as `<page>:<method>`, such as `1:goto`, in order.
   */
  methods(): string[] {
    return this.calls.map((call) => `${call.page}:${call.method}`)
  }
}
