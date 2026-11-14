import type { Readable, Writable } from 'node:stream'

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
   * Closes the browser and resolves once it has gone, or 5 s after a kill that didn't work, leaving a browser that won't
   * die to the starter. Calling it again returns the same promise.
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
