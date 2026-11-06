// PROTOTYPE, throwaway: the driver interface visual-check owns, for the Driver interface prototype ticket.
// Shaped by what one capture needs, not by Playwright's API. Readiness, the no-animation stylesheet and caret hiding
// live in one in-page script the engine sends through evaluate(), so every driver runs the same page code.

export type BrowserName = 'chromium' | 'webkit'

export interface Size {
  width: number
  height: number
}

export interface PageOptions {
  viewport: Size
  /** Appended to the browser's own user agent: ' StorybookTestRunner' puts Storybook on its test path. */
  userAgentSuffix: string
  locale: string
  timezoneId: string
  colorScheme: 'light' | 'dark'
  reducedMotion: 'reduce' | 'no-preference'
  /** Runs at document start of every navigation, before any page script. */
  initScript: string
  /** Hazards the driver handled on its own (dialogs, popups, downloads). None fails a story. Reporting only. */
  onHazard?: (kind: string, detail: string) => void
}

/** A fresh, isolated context with one page. One per worker, reopened after a page crash. */
export interface Page {
  /** Navigates the main frame and resolves on its load event. */
  goto(url: string, timeoutMs: number): Promise<void>
  setViewport(size: Size): Promise<void>
  /** Evaluates an expression in the main frame with a user gesture, awaits a promise, returns JSON. */
  evaluate<T>(expression: string, timeoutMs: number): Promise<T>
  /** PNG of the viewport, from the compositor surface, so iframes and popups don't matter. */
  screenshot(): Promise<Buffer>
  /** Main-frame navigations since the last goto() started, including goto's own. More than 1 means navigated away. */
  navigations(): number
  /** Disposes the context, closing any popups with it. */
  close(): Promise<void>
}

export interface Driver {
  readonly browser: BrowserName
  readonly version: string
  newPage(options: PageOptions): Promise<Page>
  /** Settles when the browser process is gone for any reason other than close(). */
  readonly exited: Promise<string>
  /** Kills the browser process, for the browser-exit check only. */
  killBrowser(): Promise<void>
  close(): Promise<void>
}

/** The renderer crashed. A broken story ("crashed"), never retried. The worker opens a fresh page. */
export class PageCrashed extends Error {
  name = 'PageCrashed'
}

/** The browser process exited. Every story in flight is a broken story ("browser exited"); the browser relaunches once. */
export class BrowserExited extends Error {
  name = 'BrowserExited'
}

export class TimeoutError extends Error {
  name = 'TimeoutError'
}

export const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> => {
  let t: NodeJS.Timeout
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      t = setTimeout(() => reject(new TimeoutError(`${what}: timed out after ${ms} ms`)), ms)
    }),
  ]).finally(() => clearTimeout(t))
}
