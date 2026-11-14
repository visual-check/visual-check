import { PassThrough, type Readable, Writable } from 'node:stream'

/**
 * How a browser process ended.
 *
 * @public
 */
export interface ProcessExit {
  /**
   * The exit code, or null when a signal ended the process or it couldn't start.
   */
  code: number | null
  /**
   * The signal that ended the process, such as `SIGKILL`, or null when it exited on its own.
   */
  signal: string | null
  /**
   * Why the process couldn't start, such as `docker` missing from PATH, or undefined when it started.
   */
  error: Error | undefined
}

/**
 * A started browser process, wherever it runs.
 *
 * @public
 */
export interface BrowserProcess {
  /**
   * The stream that carries CDP messages to the browser.
   */
  toBrowser: Writable
  /**
   * The stream that carries CDP messages from the browser.
   */
  fromBrowser: Readable
  /**
   * The browser's own output: its stderr, with its stdout merged in. Its reader must keep reading it, because a full
   * pipe freezes the browser.
   */
  output: Readable
  /**
   * Settles once the process has gone, its streams have closed so its output is complete, and the starter's own
   * cleanup is done, the profile folder's removal included. It also settles when the process couldn't start, with
   * `error` set. It never rejects.
   */
  exited: Promise<ProcessExit>
  /**
   * Ends the browser at once and for good, whatever it ignores. In the container, that means `docker kill` on the
   * container, which the starter names at start, after which the `docker run` client exits. Ending the client alone
   * only closes the pipe, which a hung Chromium ignores.
   */
  kill: () => void
}

/**
 * Starts the browser executable with these arguments. Whoever provides it knows the executable and where it runs. It
 * never throws: a browser that couldn't start comes back as a process whose `exited` settles with `error` set.
 *
 * @public
 */
export type StartBrowser = (browserArguments: readonly string[]) => BrowserProcess

/**
 * A running browser that snapshots are captured in.
 *
 * @public
 */
export interface Driver {
  /**
   * The browser's exact version, read when it connected, such as `157.0.8103.78`.
   */
  readonly version: string
  /**
   * Settles when the browser exits other than through `close()`. It never settles once `close()` has been called.
   */
  readonly exited: Promise<BrowserExitedError>
  /**
   * Opens a page in a fresh browser context and sets it up once, as `setup` says. Rejects at once after `close()` has
   * started, when the page isn't open in time, and with a `BrowserExitedError` when the browser exits first.
   */
  newPage: (setup: PageSetup) => Promise<Page>
  /**
   * Closes the browser and resolves once it has gone, or 5 s after a kill that didn't work, leaving a browser that won't
   * die to the starter. Calling it again returns the same promise.
   */
  close: () => Promise<void>
}

/**
 * How a page is set up once, when it opens.
 *
 * @public
 */
export interface PageSetup {
  /**
   * What the page's user agent adds to the browser's own, such as ` StorybookTestRunner`, which puts Storybook on its
   * test path.
   */
  userAgentSuffix: string
  /**
   * The time zone the page runs in, such as `Europe/Warsaw`.
   */
  timezone: string
  /**
   * The locale the page runs in and asks for content in, such as `en-US`.
   */
  locale: string
  /**
   * The colour scheme the page's `prefers-color-scheme` media feature reports.
   */
  colorScheme: 'light' | 'dark'
  /**
   * A script that runs at the start of every document of the page, before the page's own scripts.
   */
  initScript: string
}

/**
 * The size a page lays out and renders at.
 *
 * @public
 */
export interface PageViewport {
  /**
   * The width, in CSS pixels.
   */
  width: number
  /**
   * The height, in CSS pixels.
   */
  height: number
  /**
   * How many device pixels make one CSS pixel.
   */
  deviceScaleFactor: number
}

/**
 * A page in a browser context of its own, set up once, that stories are loaded and captured in. It emulates
 * `prefers-reduced-motion: no-preference` and keeps focus as if its window were focused.
 *
 * Handling the page's hazards is part of the contract every driver meets, each inside itself and the same way in every
 * driver, so none of them fails or hangs a capture: `alert()` and `beforeunload` dialogs are accepted, `confirm()` and
 * `prompt()` dialogs are dismissed, popups are closed as soon as they open, downloads and permission requests are
 * denied, and iframes, `srcdoc` ones included, are captured as part of the page.
 *
 * Once the page can no longer be used, every call in flight and every later call fails at once, with an error that
 * says why:
 *
 * - the page crashed: a `PageCrashedError`;
 * - the browser closed the page without a crash: a plain error, "The browser closed the page.";
 * - the browser exited: a `BrowserExitedError`;
 * - `close()` on the driver closed the browser: a plain error, "The browser was closed.";
 * - `close()` on the page: a plain error, "The page was closed.";
 * - the page navigated away from the document the last `goto` loaded: a `PageNavigatedAwayError`.
 *
 * A story that navigates its document away is retried by the engine, so the page reports it with a
 * `PageNavigatedAwayError` naming where it went. `goto` fails with it at once when another navigation of the main frame
 * overtakes it. Once a `goto` has loaded, the page can no longer be used from the moment its main frame commits a new
 * document, and a call the browser fails as that document comes, while a navigation of the main frame to a new
 * document is pending, such as a link the story follows or its `history.back()`, fails with it too. Only new documents
 * of the main frame count: not a same-document navigation, such as `history.replaceState`, `pushState` or a fragment
 * link, not an iframe's navigation, and not a navigation that ends without a new document, such as a download or a
 * `204 No Content` answer.
 *
 * After any call on a page fails, the page may still be in the middle of a navigation, or stuck, and a later call on it
 * can fail because of that. So the caller closes a page once a call on it fails, and opens a fresh page for its next
 * capture.
 *
 * @public
 */
export interface Page {
  /**
   * Sets the size the page lays out and renders at. Fails with a `PageTimeoutError` when the browser doesn't answer
   * within the driver's own fixed limit.
   */
  setViewport: (viewport: PageViewport) => Promise<void>
  /**
   * Loads `url` into the page's main frame and resolves on that document's load event. A server redirect is followed.
   * Fails at once with a `PageNavigatedAwayError` when another navigation of the main frame overtakes it, such as one
   * the page starts itself, with a plain error when the browser can't load the URL, and with a `PageTimeoutError` when
   * `timeoutMs` passes first.
   */
  goto: (url: string, timeoutMs: number) => Promise<void>
  /**
   * Evaluates a JavaScript expression in the page's main frame, as if from a user gesture. Awaits the promise the
   * expression gives, if it gives one, and resolves with the value passed through JSON. Fails with the exception the
   * expression throws or rejects with, and when the value is one JSON can't carry, such as `NaN`, `Infinity`, `-0` or
   * a bigint. Fails with a `PageTimeoutError` when `timeoutMs` passes first.
   */
  evaluate: (expression: string, timeoutMs: number) => Promise<unknown>
  /**
   * Captures the whole page, beyond the viewport too, without resizing the viewport. Resolves with the PNG bytes exactly
   * as the browser made them. Fails with a `PageTimeoutError` when the browser doesn't answer within the driver's own
   * fixed limit.
   */
  captureFullPage: () => Promise<Uint8Array>
  /**
   * Clears every cookie of the page's browser context, and `localStorage`, `sessionStorage` and IndexedDB of the origin
   * of the document the last `goto` loaded, wherever a server redirect took it. Only that origin's: a cross-origin
   * iframe's `localStorage` and IndexedDB stay. Clears only the cookies when no `goto` has loaded a document yet, or
   * its document's origin is opaque, such as that of `about:blank`, a `data:` URL or an error page. Keeps Cache Storage
   * and service workers.
   *
   * Like every call, fails at once with a `PageNavigatedAwayError`, clearing nothing, once the page has navigated away
   * from the document that `goto` loaded, because the storage the page left can then be in more than one origin: the
   * caller replaces the page, as after any failed call. Fails with a `PageTimeoutError` when the browser doesn't answer
   * within the driver's own fixed limit.
   */
  clearStorage: () => Promise<void>
  /**
   * Closes the page and its browser context. Every call in flight and every later call fails. Calling it again returns
   * the same promise.
   */
  close: () => Promise<void>
}

/**
 * Says how the browser's process ended, and when: that it couldn't start and why, or its exit code, or the signal that
 * ended it, such as "The browser exited with code 1 while in use."
 */
export function describeExit(exit: ProcessExit, when: 'before it answered' | 'while in use'): string {
  if (exit.error !== undefined) {
    const reason = exit.error.message

    return `The browser couldn't start: ${reason}${reason.endsWith('.') ? '' : '.'}`
  }

  if (exit.code !== null) {
    return `The browser exited with code ${exit.code} ${when}.`
  }

  if (exit.signal !== null) {
    return `The browser was killed by signal ${exit.signal} ${when}.`
  }

  return `The browser exited ${when}.`
}

/**
 * Builds the process of a browser that couldn't start: empty streams, and `exited` settled with the error.
 *
 * @public
 */
export function browserThatFailedToStart(error: Error): BrowserProcess {
  return {
    toBrowser: new Writable({ write: (_chunk, _encoding, done) => done() }),
    fromBrowser: new PassThrough().end(),
    output: new PassThrough().end(),
    exited: Promise.resolve({ code: null, signal: null, error }),
    kill: () => undefined,
  }
}

/**
 * The browser exited while in use. Every call still waiting on it fails with this error.
 *
 * @public
 */
export class BrowserExitedError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `BrowserExitedError`.
   */
  override name = 'BrowserExitedError'

  /**
   * The browser's last output lines, oldest first, which may say why it exited.
   */
  readonly output: readonly string[]

  /**
   * Names the exit code or signal and keeps the browser's last output lines.
   */
  constructor(exit: ProcessExit, output: readonly string[]) {
    super(describeExit(exit, 'while in use'))
    this.output = output
  }
}

/**
 * The page crashed, as it does when its renderer runs out of memory. Every call in flight on that page and every later
 * one fails with this error. Other pages carry on.
 *
 * @public
 */
export class PageCrashedError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `PageCrashedError`.
   */
  override name = 'PageCrashedError'

  /**
   * Says that the page crashed.
   */
  constructor() {
    super('The page crashed.')
  }
}

/**
 * A call on a page didn't finish within its time limit: the `timeoutMs` the caller gave, or the driver's own fixed
 * limit for a call that takes none.
 *
 * @public
 */
export class PageTimeoutError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `PageTimeoutError`.
   */
  override name = 'PageTimeoutError'

  /**
   * The time limit that passed, in ms.
   */
  readonly timeoutMs: number

  /**
   * Keeps the time limit that passed, with the message saying which call it stopped.
   */
  constructor(message: string, timeoutMs: number) {
    super(message)
    this.timeoutMs = timeoutMs
  }
}

/**
 * The page's main frame went to another document than the one asked for, on the page's own initiative, such as a
 * story's script following a link: before that document loaded, or after.
 *
 * @public
 */
export class PageNavigatedAwayError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `PageNavigatedAwayError`.
   */
  override name = 'PageNavigatedAwayError'

  /**
   * The URL the main frame went to.
   */
  readonly url: string

  /**
   * Keeps the URL the main frame went to, with the message saying when it went there.
   */
  constructor(url: string, message: string) {
    super(message)
    this.url = url
  }
}

/**
 * The browser didn't connect: it exited before answering, didn't answer in time, or answered its first call with an
 * error.
 *
 * @public
 */
export class BrowserLaunchError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `BrowserLaunchError`.
   */
  override name = 'BrowserLaunchError'

  /**
   * The browser's last output lines, oldest first, which may say why it didn't connect.
   */
  readonly output: readonly string[]

  /**
   * Takes the message saying what went wrong and the browser's last output lines.
   */
  constructor(message: string, output: readonly string[]) {
    super(message)
    this.output = output
  }
}
