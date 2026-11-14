import type { Readable, Writable } from 'node:stream'

/**
 * A CDP error reply: the browser refused or failed a command.
 */
export class CdpError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `CdpError`.
   */
  override name = 'CdpError'

  /**
   * The error code in the browser's reply, such as `-32000`.
   */
  readonly code: number

  /**
   * Names the failed method and carries the browser's message and code.
   */
  constructor(method: string, code: number, browserMessage: string) {
    super(`CDP ${method} failed: ${browserMessage}`)
    this.code = code
  }
}

/**
 * One CDP event: a message the browser sends on its own, with no call behind it.
 */
export interface CdpEvent {
  /**
   * The event's name, such as `Page.loadEventFired`.
   */
  method: string
  /**
   * The event's parameters.
   */
  params: Record<string, unknown>
  /**
   * The page session the event belongs to, or undefined for a browser-level event.
   */
  sessionId: string | undefined
}

/**
 * A call that has been sent and waits for its reply.
 */
interface PendingCall {
  /**
   * The called method, for the error message.
   */
  method: string
  /**
   * Settles the call with the reply's result.
   */
  resolve: (result: Record<string, unknown>) => void
  /**
   * Fails the call.
   */
  reject: (error: Error) => void
}

/**
 * Whether a value is a non-null object that isn't an array.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The NUL byte that ends every message of the CDP pipe protocol, in both directions.
 */
const terminator = 0

/**
 * The NUL byte as text, appended to every message written to the browser.
 */
const terminatorText = String.fromCharCode(terminator)

/**
 * A CDP connection over the browser's pipe: JSON messages, each ended by a NUL byte, written to one stream and read
 * from another. The owner closes it, with the reason the browser went; the connection never closes itself, not even
 * when the readable stream ends.
 *
 * It never throws out of a stream event handler. An error a listener throws is rethrown on a microtask, so it surfaces
 * as an uncaught exception without disturbing the other messages. A write error is ignored, because the owner learns
 * of the browser's exit from its process. A reply with an unknown id is ignored. A message that isn't valid JSON, or
 * isn't a reply or an event, is skipped, and the messages after it are still read.
 */
export class CdpConnection {
  /**
   * The stream that carries commands to the browser.
   */
  private readonly toBrowser: Writable

  /**
   * The id the next command gets.
   */
  private nextId = 1

  /**
   * The calls waiting for a reply, by command id.
   */
  private readonly pending = new Map<number, PendingCall>()

  /**
   * The event listeners.
   */
  private readonly listeners = new Set<(event: CdpEvent) => void>()

  /**
   * The chunks of a message that has begun but whose NUL byte hasn't arrived yet. Bytes, not text, so a multi-byte
   * character split across chunks decodes whole. Each chunk is searched once and a message is joined once, when it
   * ends, so a large reply split into many chunks costs linear time.
   */
  private partial: Buffer[] = []

  /**
   * The error the connection was closed with, or undefined while it is open.
   */
  private closedWith: Error | undefined

  /**
   * Starts reading the browser's messages from `fromBrowser`. Commands are written to `toBrowser`.
   */
  constructor(toBrowser: Writable, fromBrowser: Readable) {
    this.toBrowser = toBrowser
    toBrowser.on('error', () => undefined)
    fromBrowser.on('error', () => undefined)
    fromBrowser.on('data', (chunk: Buffer | string) =>
      this.read(typeof chunk === 'string' ? Buffer.from(chunk) : chunk),
    )
  }

  /**
   * Calls a CDP method and resolves with the reply's result. Pass `sessionId` to address a page session. Rejects with
   * a `CdpError` when the browser answers with an error, and with the closing error once the connection is closed.
   */
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    if (this.closedWith !== undefined) {
      return Promise.reject(this.closedWith)
    }

    const id = this.nextId++
    const message = sessionId === undefined ? { id, method, params } : { id, method, params, sessionId }

    let text: string

    try {
      text = `${JSON.stringify(message)}${terminatorText}`
    } catch (error) {
      return Promise.reject(error)
    }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject })
      this.toBrowser.write(text, () => undefined)
    })
  }

  /**
   * Calls `listener` for every event the browser sends. Returns the function that stops listening.
   */
  onEvent(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Closes the connection: every pending call and every later `send` rejects with `error`. Closing again keeps the
   * first error.
   */
  close(error: Error): void {
    if (this.closedWith !== undefined) {
      return
    }

    this.closedWith = error

    const calls = [...this.pending.values()]

    this.pending.clear()
    for (const call of calls) {
      call.reject(error)
    }
  }

  /**
   * Takes in a chunk of the browser's bytes and handles each message it completes.
   */
  private read(chunk: Buffer): void {
    let start = 0
    let end = chunk.indexOf(terminator, start)

    while (end !== -1) {
      this.partial.push(chunk.subarray(start, end))

      const text = Buffer.concat(this.partial).toString('utf8')

      this.partial = []
      this.handle(text)
      start = end + 1
      end = chunk.indexOf(terminator, start)
    }

    if (start < chunk.length) {
      this.partial.push(chunk.subarray(start))
    }
  }

  /**
   * Handles one complete message: settles the call a reply answers, or tells the listeners about an event.
   */
  private handle(text: string): void {
    let message: unknown

    try {
      message = JSON.parse(text)
    } catch {
      return
    }

    if (!isRecord(message)) {
      return
    }

    if (typeof message.id === 'number') {
      this.settle(message.id, message)
    } else if (typeof message.method === 'string') {
      this.dispatch({
        method: message.method,
        params: isRecord(message.params) ? message.params : {},
        sessionId: typeof message.sessionId === 'string' ? message.sessionId : undefined,
      })
    }
  }

  /**
   * Tells every listener about an event, unless the connection is closed. An error a listener throws is rethrown on a
   * microtask: one listener's bug neither loses the messages after it nor stays hidden.
   */
  private dispatch(event: CdpEvent): void {
    if (this.closedWith !== undefined) {
      return
    }

    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (error) {
        queueMicrotask(() => {
          throw error
        })
      }
    }
  }

  /**
   * Settles the pending call with this id from its reply. A reply with no call behind it is ignored.
   */
  private settle(id: number, reply: Record<string, unknown>): void {
    const call = this.pending.get(id)

    if (call === undefined) {
      return
    }

    this.pending.delete(id)

    const { error, result } = reply

    if (isRecord(error)) {
      call.reject(
        new CdpError(
          call.method,
          typeof error.code === 'number' ? error.code : 0,
          typeof error.message === 'string' ? error.message : 'unknown error',
        ),
      )
    } else {
      call.resolve(isRecord(result) ? result : {})
    }
  }
}
