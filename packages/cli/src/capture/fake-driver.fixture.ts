import type { BrowserExitedError, Driver, Page, PageSetup, PageViewport } from './driver/driver.js'
import type { StoryReadiness } from './page-script.js'

/**
 * How one fake page answers each call. A call left out succeeds, as on a story that finished well: the readiness
 * wait gives `finished` with `success`, and the capture gives `defaultSnapshot`.
 */
export interface FakePageBehaviour {
  /**
   * Answers `setViewport`.
   */
  setViewport?: (viewport: PageViewport) => Promise<void>
  /**
   * Answers `goto`.
   */
  goto?: (url: string, timeoutMs: number) => Promise<void>
  /**
   * Answers `evaluate`.
   */
  evaluate?: (expression: string, timeoutMs: number) => Promise<unknown>
  /**
   * Answers `captureFullPage`.
   */
  captureFullPage?: () => Promise<Uint8Array>
  /**
   * Answers `close`.
   */
  close?: () => Promise<void>
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
  method: keyof FakePageBehaviour
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
 * The readiness a fake page's wait gives when its behaviour gives none: the story finished well.
 */
const finishedWell: StoryReadiness = { outcome: 'finished', status: 'success' }

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
    const record = (method: keyof FakePageBehaviour, args: unknown[]): void => {
      this.calls.push({ page: number, method, args })
    }

    return {
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

        return answers.evaluate === undefined ? finishedWell : await answers.evaluate(expression, timeoutMs)
      },
      captureFullPage: async () => {
        record('captureFullPage', [])

        return answers.captureFullPage === undefined ? defaultSnapshot : await answers.captureFullPage()
      },
      close: async () => {
        record('close', [])
        await answers.close?.()
      },
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
