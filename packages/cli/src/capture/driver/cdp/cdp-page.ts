import { type Page, PageCrashedError, type PageSetup, PageTimeoutError, type PageViewport } from '../driver.js'
import { type CdpConnection, type CdpEvent, isRecord } from './cdp-connection.js'
import { linuxFontFamilies } from './font-families.js'
import { MainFrameNavigation } from './main-frame-navigation.js'
import { settlesWithin, startTimeLimit, type TimeLimit, withinTimeLimit } from './time-limit.js'

/**
 * How long opening a page, a viewport change or a capture may take, in ms. Generous, so only a browser that stopped
 * answering hits it.
 */
const commandTimeLimitMs = 30_000

/**
 * How long closing a page waits for the browser to dispose its context, in ms.
 */
const disposeTimeLimitMs = 5_000

/**
 * Reads a string field the browser's answer must carry. Throws, naming the method and the field, when it's missing.
 */
function readString(reply: Record<string, unknown>, field: string, method: string): string {
  const value = reply[field]

  if (typeof value !== 'string') {
    throw new Error(`The browser's answer to ${method} has no ${field}.`)
  }

  return value
}

/**
 * Reads the page's content size out of a `Page.getLayoutMetrics` answer, in whole CSS pixels rounded up, so a capture
 * of that size takes in the whole content.
 */
function readContentSize(reply: Record<string, unknown>): { width: number; height: number } {
  const size = reply.cssContentSize

  if (!isRecord(size) || typeof size.width !== 'number' || typeof size.height !== 'number') {
    throw new Error("The browser's answer to Page.getLayoutMetrics has no cssContentSize.")
  }

  return { width: Math.ceil(size.width), height: Math.ceil(size.height) }
}

/**
 * Says what a `Runtime.evaluate` exception was: the value of a thrown primitive as JSON, such as `"nope"` or `42`;
 * else the exception's description, such as `Error: boom` with its stack; else the exception's text, such as
 * `Uncaught (in promise)`.
 */
function describeException(details: Record<string, unknown>): string {
  const { exception, text } = details

  if (isRecord(exception) && 'value' in exception) {
    return JSON.stringify(exception.value)
  }

  if (isRecord(exception) && typeof exception.description === 'string') {
    return exception.description
  }

  return typeof text === 'string' ? text : 'an unknown exception'
}

/**
 * Reads the value out of a `Runtime.evaluate` answer. Throws, saying what was thrown, when the expression threw or its
 * promise rejected, and when the value is one JSON can't carry, such as `NaN`, `Infinity`, `-0` or a bigint.
 */
function readEvaluation(reply: Record<string, unknown>): unknown {
  const { exceptionDetails, result } = reply

  if (isRecord(exceptionDetails)) {
    throw new Error(`The expression evaluated in the page threw: ${describeException(exceptionDetails)}`)
  }

  if (!isRecord(result)) {
    return undefined
  }

  if (typeof result.unserializableValue === 'string') {
    throw new Error(`The expression evaluated in the page gave ${result.unserializableValue}, which JSON can't carry.`)
  }

  return result.value
}

/**
 * Says why an event means the page can no longer be used, or undefined when it doesn't: its renderer crashed, or the
 * browser closed it without a crash, which the page's session reports as `Inspector.detached` and the browser as
 * `Target.detachedFromTarget` for the session.
 */
function pageFailureOf(event: CdpEvent, sessionId: string): Error | undefined {
  if (event.sessionId === sessionId && event.method === 'Inspector.targetCrashed') {
    return new PageCrashedError()
  }

  const detached =
    event.sessionId === sessionId
      ? event.method === 'Inspector.detached'
      : event.sessionId === undefined &&
        event.method === 'Target.detachedFromTarget' &&
        event.params.sessionId === sessionId

  return detached ? new Error('The browser closed the page.') : undefined
}

/**
 * Asks the browser to dispose a browser context, closing its pages. Resolves once the browser has answered, either way,
 * or after 5 s.
 */
async function disposeContext(connection: CdpConnection, browserContextId: string): Promise<void> {
  await settlesWithin(connection.send('Target.disposeBrowserContext', { browserContextId }), disposeTimeLimitMs)
}

/**
 * The ids of a page's browser context, target and session.
 */
interface PageIds {
  /**
   * The page's browser context, which closing the page disposes.
   */
  browserContextId: string
  /**
   * The page's target, which is also its main frame's id.
   */
  targetId: string
  /**
   * The page's flat CDP session.
   */
  sessionId: string
}

/**
 * A page over CDP: a target in a browser context of its own, attached in a flat session. Every command it sends goes
 * in its session, and it listens only to its session's events and to the browser's word that its session detached.
 */
class CdpPage implements Page {
  /**
   * The browser's CDP connection.
   */
  private readonly connection: CdpConnection

  /**
   * The page's browser context, target and session.
   */
  private readonly ids: PageIds

  /**
   * Aborted, with the reason, once the page can no longer be used: it crashed, the browser closed it or went, or it was
   * closed. Each call listens for the abort while it runs, and stops listening when it settles, so a page that lives
   * long keeps nothing of its calls.
   */
  private readonly usable = new AbortController()

  /**
   * Stops watching the page's session for a crash or a detach.
   */
  private readonly stopWatching: () => void

  /**
   * Stops listening for the connection's close.
   */
  private readonly stopListeningForClose: () => void

  /**
   * The closing `close()` started, or undefined before it is called.
   */
  private closing: Promise<void> | undefined

  /**
   * The loaders of the page's navigations since its main frame last committed the document a `goto` asked for, from
   * the answers to `Page.navigate`, failed ones and late answers included. A later `goto` ignores their commits, such
   * as a failed navigation's error page that commits late.
   */
  private readonly loaderIds = new Set<string>()

  /**
   * Watches the page's session for a crash or a detach, and the connection for its close.
   */
  constructor(connection: CdpConnection, ids: PageIds) {
    this.connection = connection
    this.ids = ids
    this.stopWatching = connection.onEvent((event: CdpEvent) => {
      const failure = pageFailureOf(event, ids.sessionId)

      if (failure !== undefined) {
        this.fail(failure)
      }
    })
    this.stopListeningForClose = connection.onClose((error: Error) => this.fail(error))
  }

  /**
   * Sets the page up once: the font table, the user agent, the emulated time zone, locale, colour scheme, motion and
   * focus, and the init script. The commands go in parallel.
   */
  async setUp(browserUserAgent: string, setup: PageSetup): Promise<void> {
    await this.unlessFailed(
      Promise.all([
        this.send('Page.enable'),
        this.send('Inspector.enable'),
        this.send('Page.setFontFamilies', { fontFamilies: linuxFontFamilies }),
        this.send('Emulation.setUserAgentOverride', {
          userAgent: `${browserUserAgent}${setup.userAgentSuffix}`,
          acceptLanguage: setup.locale,
        }),
        this.send('Emulation.setTimezoneOverride', { timezoneId: setup.timezone }),
        this.send('Emulation.setLocaleOverride', { locale: setup.locale }),
        this.send('Emulation.setEmulatedMedia', {
          features: [
            { name: 'prefers-color-scheme', value: setup.colorScheme },
            { name: 'prefers-reduced-motion', value: 'no-preference' },
          ],
        }),
        this.send('Emulation.setFocusEmulationEnabled', { enabled: true }),
        this.send('Page.addScriptToEvaluateOnNewDocument', { source: setup.initScript }),
      ]),
    )
  }

  /**
   * Overrides the device metrics with the viewport, which also serves as the screen size.
   */
  async setViewport(viewport: PageViewport): Promise<void> {
    this.throwIfFailed()

    const { width, height, deviceScaleFactor } = viewport

    await this.guarded(
      this.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor,
        mobile: false,
        screenWidth: width,
        screenHeight: height,
      }),
      commandTimeLimitMs,
      `The page didn't set its viewport within ${commandTimeLimitMs / 1000} s.`,
    )
  }

  /**
   * Navigates the main frame to `url` and resolves on the new document's load event. Listens before it navigates, and
   * stops listening once it settles.
   */
  async goto(url: string, timeoutMs: number): Promise<void> {
    this.throwIfFailed()

    const navigation = new MainFrameNavigation(url, this.ids.targetId, this.loaderIds)
    const stopListening = this.onSessionEvent((event: CdpEvent) => navigation.observe(event))

    try {
      this.send('Page.navigate', { url }).then(
        (result: Record<string, unknown>) => {
          this.rememberLoader(result)
          navigation.answer(result)
        },
        (error: unknown) => navigation.fail(error),
      )
      await this.guarded(navigation.done, timeoutMs, `The page didn't load ${url} within ${timeoutMs / 1000} s.`)
    } finally {
      stopListening()

      if (navigation.committed) {
        this.loaderIds.clear()
      }
    }
  }

  /**
   * Evaluates the expression in the main frame with a user gesture, awaiting its promise, and resolves with its value
   * passed through JSON.
   */
  async evaluate(expression: string, timeoutMs: number): Promise<unknown> {
    this.throwIfFailed()

    const reply = await this.guarded(
      this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }),
      timeoutMs,
      `The expression evaluated in the page didn't finish within ${timeoutMs / 1000} s.`,
    )

    return readEvaluation(reply)
  }

  /**
   * Captures the page's whole content as PNG, beyond the viewport, and resolves with the bytes as the browser sent
   * them.
   */
  async captureFullPage(): Promise<Uint8Array> {
    this.throwIfFailed()

    return this.guarded(
      this.capture(),
      commandTimeLimitMs,
      `The page wasn't captured within ${commandTimeLimitMs / 1000} s.`,
    )
  }

  /**
   * Closes the page: fails every call in flight and every later one, stops listening, and disposes the page's browser
   * context. Resolves once the browser has answered, either way, or after 5 s. Calling it again returns the same
   * promise.
   */
  close(): Promise<void> {
    this.closing ??= this.shutDown()

    return this.closing
  }

  /**
   * Reads the content size, then captures that much of the page.
   */
  private async capture(): Promise<Uint8Array> {
    const { width, height } = readContentSize(await this.send('Page.getLayoutMetrics'))

    this.throwIfFailed()

    const reply = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    })

    return Buffer.from(readString(reply, 'data', 'Page.captureScreenshot'), 'base64')
  }

  /**
   * Fails the page's calls, stops watching it, and disposes its context.
   */
  private async shutDown(): Promise<void> {
    this.fail(new Error('The page was closed.'))
    this.stopWatching()
    this.stopListeningForClose()
    await disposeContext(this.connection, this.ids.browserContextId)
  }

  /**
   * Remembers the loader a `Page.navigate` answer names, if it names one.
   */
  private rememberLoader(result: Record<string, unknown>): void {
    if (typeof result.loaderId === 'string') {
      this.loaderIds.add(result.loaderId)
    }
  }

  /**
   * Calls a CDP method in the page's session.
   */
  private send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.connection.send(method, params, this.ids.sessionId)
  }

  /**
   * Calls `listener` for every event of the page's session. Returns the function that stops listening.
   */
  private onSessionEvent(listener: (event: CdpEvent) => void): () => void {
    return this.connection.onEvent((event: CdpEvent) => {
      if (event.sessionId === this.ids.sessionId) {
        listener(event)
      }
    })
  }

  /**
   * Marks the page as no longer usable, and fails every call in flight with `error`. The first reason is kept.
   */
  private fail(error: Error): void {
    this.usable.abort(error)
  }

  /**
   * Throws the reason the page can no longer be used, so a later call fails at once and sends nothing.
   */
  private throwIfFailed(): void {
    this.usable.signal.throwIfAborted()
  }

  /**
   * Settles as `operation` does, unless the page can no longer be used first, which includes a failure that came while
   * the operation's command was being sent. It listens for that only while it waits, so nothing keeps `operation`'s
   * result once it has settled. It always takes in `operation`'s outcome, so a rejection after a failure never goes
   * unhandled.
   */
  private async unlessFailed<T>(operation: Promise<T>): Promise<T> {
    const { signal } = this.usable
    let onAbort: () => void = () => undefined
    const failed = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason)

      if (signal.aborted) {
        onAbort()
      }
    })

    signal.addEventListener('abort', onAbort, { once: true })

    try {
      return await Promise.race([operation, failed])
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  /**
   * Settles as `operation` does, unless the page can no longer be used first, or `timeLimitMs` passes first, which
   * fails it with a `PageTimeoutError` carrying `timeoutMessage`.
   */
  private guarded<T>(operation: Promise<T>, timeLimitMs: number, timeoutMessage: string): Promise<T> {
    return withinTimeLimit(
      this.unlessFailed(operation),
      timeLimitMs,
      () => new PageTimeoutError(timeoutMessage, timeLimitMs),
    )
  }
}

/**
 * Creates a target in the browser context, attaches to it in a flat session, and sets it up, each step raced against
 * `limit`. When a step fails, it disposes the context and rethrows.
 */
async function openInContext(
  connection: CdpConnection,
  browserContextId: string,
  browserUserAgent: string,
  setup: PageSetup,
  limit: TimeLimit,
): Promise<Page> {
  let page: CdpPage | undefined

  try {
    const targetReply = await limit.race(
      connection.send('Target.createTarget', { url: 'about:blank', browserContextId }),
    )
    const targetId = readString(targetReply, 'targetId', 'Target.createTarget')
    const attachReply = await limit.race(connection.send('Target.attachToTarget', { targetId, flatten: true }))
    const sessionId = readString(attachReply, 'sessionId', 'Target.attachToTarget')

    page = new CdpPage(connection, { browserContextId, targetId, sessionId })
    await limit.race(page.setUp(browserUserAgent, setup))

    return page
  } catch (error) {
    await (page?.close() ?? disposeContext(connection, browserContextId))

    throw error
  }
}

/**
 * Creates a fresh browser context, raced against `limit`. When the limit runs out first, it disposes the context if the
 * browser creates it after all.
 */
async function createContext(connection: CdpConnection, limit: TimeLimit): Promise<string> {
  const creating = connection.send('Target.createBrowserContext', { disposeOnDetach: true })
  let reply: Record<string, unknown>

  try {
    reply = await limit.race(creating)
  } catch (error) {
    creating.then(
      (late: Record<string, unknown>) =>
        typeof late.browserContextId === 'string' ? disposeContext(connection, late.browserContextId) : undefined,
      () => undefined,
    )

    throw error
  }

  return readString(reply, 'browserContextId', 'Target.createBrowserContext')
}

/**
 * Opens a page over CDP: creates a target in a fresh browser context, attaches to it in a flat session, and sets it up
 * once. Its user agent is the browser's own with the setup's suffix. When a step fails, or the page isn't open within
 * 30 s, it disposes the context and rethrows.
 */
export async function openCdpPage(
  connection: CdpConnection,
  browserUserAgent: string,
  setup: PageSetup,
): Promise<Page> {
  const limit = startTimeLimit(
    commandTimeLimitMs,
    () => new Error(`The browser didn't open a page within ${commandTimeLimitMs / 1000} s.`),
  )

  try {
    const browserContextId = await createContext(connection, limit)

    return await openInContext(connection, browserContextId, browserUserAgent, setup, limit)
  } finally {
    limit.clear()
  }
}
