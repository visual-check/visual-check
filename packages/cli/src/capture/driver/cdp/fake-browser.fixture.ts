import { PassThrough } from 'node:stream'
import { finished } from 'node:stream/promises'
import type { BrowserProcess, ProcessExit, StartBrowser } from '../driver.js'

/**
 * A CDP command the fake browser received.
 */
export interface ReceivedCommand {
  /**
   * The command's id, which its reply carries back.
   */
  id: number
  /**
   * The called method, such as `Browser.getVersion`.
   */
  method: string
  /**
   * The command's parameters.
   */
  params: Record<string, unknown>
  /**
   * The page session the command addresses, or undefined for a browser-level command.
   */
  sessionId: string | undefined
}

/**
 * Handles one command the fake browser received: replies, fails it, emits events, exits, or does nothing.
 */
export type CommandHandler = (command: ReceivedCommand, browser: FakeBrowser) => void

/**
 * What the fake browser can be told at creation.
 */
export interface FakeBrowserOptions {
  /**
   * Whether the browser exits with code 0 when its CDP input ends, as Chromium does. True by default.
   */
  exitsOnInputEnd?: boolean
  /**
   * Whether `kill()` ends the process. True by default; false stands for a kill that doesn't work.
   */
  exitsOnKill?: boolean
  /**
   * Why the browser couldn't start. When given, its process has exited with this error as soon as it is started.
   */
  startError?: Error
  /**
   * Handlers by method, replacing the default ones. A method with no handler fails as unknown.
   */
  handlers?: Record<string, CommandHandler>
}

/**
 * The `Browser.getVersion` reply the fake browser gives by default.
 */
export const defaultVersionReply = {
  product: 'HeadlessChrome/157.0.8103.78',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/157.0.8103.78',
  protocolVersion: '1.3',
  revision: '@0',
  jsVersion: '15.7.0',
}

/**
 * Answers the version call with the default reply.
 */
function answerVersion(command: ReceivedCommand, browser: FakeBrowser): void {
  browser.reply(command, defaultVersionReply)
}

/**
 * Replies to `Browser.close`, then exits with code 0, as Chromium does.
 */
function closeBrowser(command: ReceivedCommand, browser: FakeBrowser): void {
  browser.reply(command, {})
  browser.exit({ code: 0 })
}

/**
 * The handlers the fake browser starts with.
 */
const defaultHandlers: Record<string, CommandHandler> = {
  'Browser.getVersion': answerVersion,
  'Browser.close': closeBrowser,
}

/**
 * A browser process made of in-memory streams that speaks CDP over its pipe, for tests that need no Docker and no
 * Chromium. It records the arguments it was started with and every command it receives, and answers commands from its
 * handlers.
 */
export class FakeBrowser {
  /**
   * The arguments the browser was started with, or undefined before it started.
   */
  browserArguments: readonly string[] | undefined

  /**
   * Every command the browser received, in order.
   */
  readonly received: ReceivedCommand[] = []

  /**
   * Whether the process was killed.
   */
  killed = false

  /**
   * Whether the browser's CDP input has ended.
   */
  inputEnded = false

  /**
   * The process the browser runs as, which `start` hands out.
   */
  readonly process: BrowserProcess

  /**
   * Starts the browser: records the arguments and returns its process.
   */
  readonly start: StartBrowser = (browserArguments) => {
    this.browserArguments = browserArguments

    if (this.startError !== undefined) {
      this.exit({ error: this.startError })
    }

    return this.process
  }

  /**
   * The handlers by method.
   */
  private readonly handlers: Record<string, CommandHandler>

  /**
   * Whether the browser exits when its CDP input ends.
   */
  private readonly exitsOnInputEnd: boolean

  /**
   * Whether `kill()` ends the process.
   */
  private readonly exitsOnKill: boolean

  /**
   * Why the browser couldn't start, or undefined when it starts.
   */
  private readonly startError: Error | undefined

  /**
   * The CDP stream to the browser, which the fake reads.
   */
  private readonly toBrowser = new PassThrough()

  /**
   * The CDP stream from the browser, which the fake writes.
   */
  private readonly fromBrowser = new PassThrough()

  /**
   * The browser's own output, which the fake writes.
   */
  private readonly output = new PassThrough()

  /**
   * Text read from the CDP input whose NUL byte hasn't arrived yet.
   */
  private partial = ''

  /**
   * Whether the process has begun to exit.
   */
  private exiting = false

  /**
   * Settles the process's `exited` promise.
   */
  private settleExit: (exit: ProcessExit) => void = () => undefined

  /**
   * Builds the browser's process and starts reading its CDP input.
   */
  constructor(options: FakeBrowserOptions = {}) {
    this.handlers = { ...defaultHandlers, ...options.handlers }
    this.exitsOnInputEnd = options.exitsOnInputEnd ?? true
    this.exitsOnKill = options.exitsOnKill ?? true
    this.startError = options.startError
    this.process = {
      toBrowser: this.toBrowser,
      fromBrowser: this.fromBrowser,
      output: this.output,
      exited: new Promise((resolve) => {
        this.settleExit = resolve
      }),
      kill: () => {
        this.killed = true

        if (this.exitsOnKill) {
          this.exit({ signal: 'SIGKILL' })
        }
      },
    }
    this.toBrowser.setEncoding('utf8')
    this.toBrowser.on('data', (chunk: string) => this.read(chunk))
    this.toBrowser.on('end', () => {
      this.inputEnded = true

      if (this.exitsOnInputEnd) {
        this.exit({ code: 0 })
      }
    })
  }

  /**
   * Replies to a command with its result.
   */
  reply(command: ReceivedCommand, result: Record<string, unknown>): void {
    this.send({ id: command.id, result })
  }

  /**
   * Fails a command with a CDP error.
   */
  fail(command: ReceivedCommand, code: number, message: string): void {
    this.send({ id: command.id, error: { code, message } })
  }

  /**
   * Sends an event, for a page session when `sessionId` is given.
   */
  emit(method: string, params: Record<string, unknown> = {}, sessionId?: string): void {
    this.send(sessionId === undefined ? { method, params } : { method, params, sessionId })
  }

  /**
   * Writes to the browser's own output and resolves once the write has been taken in.
   */
  writeOutput(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.output.write(text, (error) => (error ? reject(error) : resolve()))
    })
  }

  /**
   * Ends the process the way a real one goes: its streams end, and `exited` settles once they have been read to the
   * end. What isn't given of the exit is null, or undefined for `error`. Exiting again does nothing.
   */
  exit(how: Partial<ProcessExit>): void {
    if (this.exiting) {
      return
    }

    const exit: ProcessExit = { code: null, signal: null, error: undefined, ...how }

    this.exiting = true
    this.fromBrowser.end()
    this.output.end()
    Promise.all([finished(this.fromBrowser), finished(this.output)]).then(
      () => this.settleExit(exit),
      () => this.settleExit(exit),
    )
  }

  /**
   * Writes one message to the CDP output, unless the process is exiting.
   */
  private send(message: Record<string, unknown>): void {
    if (!this.exiting) {
      this.fromBrowser.write(`${JSON.stringify(message)}\0`)
    }
  }

  /**
   * Takes in CDP input and handles each command it completes.
   */
  private read(chunk: string): void {
    const parts = `${this.partial}${chunk}`.split('\0')

    this.partial = parts.pop() ?? ''
    for (const part of parts) {
      this.handle(JSON.parse(part) as Omit<ReceivedCommand, 'sessionId'> & { sessionId?: string })
    }
  }

  /**
   * Records a command and runs its handler, or fails it as unknown when it has none.
   */
  private handle(message: Omit<ReceivedCommand, 'sessionId'> & { sessionId?: string }): void {
    const command: ReceivedCommand = {
      id: message.id,
      method: message.method,
      params: message.params,
      sessionId: message.sessionId,
    }
    const handler = this.handlers[command.method]

    this.received.push(command)

    if (handler === undefined) {
      this.fail(command, -32601, `'${command.method}' wasn't found`)
    } else {
      handler(command, this)
    }
  }
}
