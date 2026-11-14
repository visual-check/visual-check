import { type Page, PageCrashedError, type PageSetup, PageTimeoutError, type PageViewport } from '../driver.js'
import { type CdpConnection, type CdpEvent, isRecord } from './cdp-connection.js'
import { linuxFontFamilies } from './font-families.js'
import { LoadedDocument } from './loaded-document.js'
import { MainFrameNavigation } from './main-frame-navigation.js'
import { settlesWithin, startTimeLimit, type TimeLimit, withinTimeLimit } from './time-limit.js'

/**
 * How long opening a page, a viewport change, a capture or clearing storage may take, in ms. Generous, so only a
 * browser that stopped answering hits it.
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
 * Gives the frame that a `Page.frameNavigated` event of the page's session commits in the main frame, whose id is the
 * page's target id, or undefined for any other event, a subframe's commit included.
 */
function mainFrameCommitOf(event: CdpEvent, mainFrameId: string): Record<string, unknown> | undefined {
  const { frame } = event.params

  return event.method === 'Page.frameNavigated' && isRecord(frame) && frame.id === mainFrameId ? frame : undefined
}

/**
 * Reads a frame's security origin, such as `http://127.0.0.1:6006`, or undefined when it is opaque, which Chromium
 * reports as `://`, as for `about:blank`, a `data:` URL or an error page.
 */
function tupleOriginOf(securityOrigin: unknown): string | undefined {
  if (typeof securityOrigin !== 'string' || !URL.canParse(securityOrigin)) {
    return undefined
  }

  const { origin } = new URL(securityOrigin)

  return origin === 'null' ? undefined : origin
}

/**
 * Says whether a `Page.javascriptDialogOpening` event's dialog is accepted: an `alert` and a `beforeunload` are, a
 * `confirm` and a `prompt` are dismissed.
 */
function acceptsDialog(type: unknown): boolean {
  return type === 'alert' || type === 'beforeunload'
}

/**
 * Gives the id of the popup a `Target.targetCreated` event reports, or undefined when the target isn't one: a `page`
 * target of the page's own browser context other than the page itself. The browser reports it at the browser level.
 */
function popupIdOf(event: CdpEvent, ids: PageIds): string | undefined {
  const { targetInfo } = event.params

  if (event.sessionId !== undefined || event.method !== 'Target.targetCreated' || !isRecord(targetInfo)) {
    return undefined
  }

  const isPopup =
    targetInfo.type === 'page' &&
    targetInfo.browserContextId === ids.browserContextId &&
    targetInfo.targetId !== ids.targetId

  return isPopup && typeof targetInfo.targetId === 'string' ? targetInfo.targetId : undefined
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
 * in its session, but for those about its whole browser context, which go at the browser level. It listens only to its
 * session's events and to the browser's word that its session detached or that a target of its context opened. It
 * handles the page's hazards itself: it accepts `alert()` and `beforeunload` dialogs and dismisses `confirm()` and
 * `prompt()`, closes every popup, and denies downloads and permission requests.
 *
 * It follows the document each `goto` loads, and fails with a `PageNavigatedAwayError` once its main frame commits a
 * new document. A call the browser fails as that document comes, while a navigation of the main frame to a new
 * document is pending, such as a link the page follows or its `history.back()`, fails with one too.
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
   * Aborted, with the reason, once the page can no longer be used: it crashed, the browser closed it or went, it
   * navigated away from the document its last `goto` loaded, or it was closed. Each call listens for the abort while it
   * runs, and stops listening when it settles, so a page that lives long keeps nothing of its calls.
   */
  private readonly usable = new AbortController()

  /**
   * Stops watching the page's session for a crash, a detach, its main frame's navigations and its dialogs, and the
   * browser for its popups.
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
   * The origin of the document the main frame last committed since the last `goto` started, such as
   * `http://127.0.0.1:6006`. Once that `goto` has loaded, it is the `goto`'s own document's, wherever a server redirect
   * took it: an earlier navigation's late commit, which the `goto` ignores, such as a failed navigation's error page,
   * comes before the `goto`'s own commit, and a commit with any other loader fails the `goto`, or the page once the
   * `goto` has loaded. Undefined before that commit, and when the origin is opaque. Reset when a `goto` starts, so a
   * commit before it, such as the first `about:blank`, doesn't count.
   */
  private gotoOrigin: string | undefined

  /**
   * The document the last `goto` loaded, followed from its load event on: set the moment the `goto` takes that event in,
   * before the `goto` resolves. Undefined before any `goto` has loaded, from the start of a `goto` until its load event,
   * and after a `goto` failed, so the main frame's commits and navigations count for nothing here then: a running
   * `goto` follows them itself.
   */
  private loadedDocument: LoadedDocument | undefined

  /**
   * The loaders of the page's navigations since its main frame last committed the document a `goto` asked for, from
   * the answers to `Page.navigate`, failed ones and late answers included. A later `goto` ignores their commits, such
   * as a failed navigation's error page that commits late.
   */
  private readonly loaderIds = new Set<string>()

  /**
   * Watches the page's session for a crash, a detach, its main frame's navigations and its dialogs, the browser for its
   * popups, and the connection for its close.
   */
  constructor(connection: CdpConnection, ids: PageIds) {
    this.connection = connection
    this.ids = ids
    this.stopWatching = connection.onEvent((event: CdpEvent) => this.watch(event))
    this.stopListeningForClose = connection.onClose((error: Error) => this.fail(error))
  }

  /**
   * Sets the page up once: the font table, the user agent, the emulated time zone, locale, colour scheme, motion and
   * focus, and the init script, and denies downloads and every permission in the page's browser context. The commands
   * go in parallel.
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
        this.connection.send('Browser.setDownloadBehavior', {
          behavior: 'deny',
          browserContextId: this.ids.browserContextId,
        }),
        // Deprecated in the protocol in favour of `Browser.setPermission`, but only this denies every permission at once,
        // by granting an empty set. Check it again on a Chromium bump.
        this.connection.send('Browser.grantPermissions', {
          permissions: [],
          browserContextId: this.ids.browserContextId,
        }),
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
   * stops listening once it settles. Forgets the document the last `goto` loaded at once, and follows the new one from
   * the moment its load event is taken in, so a commit right behind that event already counts. Once it has settled, it
   * stops the navigation, so a load that a late answer to `Page.navigate` reveals after the `goto` failed doesn't count.
   */
  async goto(url: string, timeoutMs: number): Promise<void> {
    this.throwIfFailed()
    this.loadedDocument = undefined
    this.gotoOrigin = undefined

    const navigation = new MainFrameNavigation(url, this.ids.targetId, this.loaderIds, (later: readonly CdpEvent[]) =>
      this.followLoadedDocument(url, later),
    )
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
      navigation.stop()
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
   * Clears every cookie of the page's browser context, at the browser level, and the storage of the origin of the
   * document the last `goto` loaded, if it isn't opaque. The commands go in parallel, and none turns a domain on. Like
   * every call, it fails at once with a `PageNavigatedAwayError`, sending nothing, once the page has navigated away from
   * that document: the storage that document and the next one left may then be in origins the page no longer shows.
   */
  async clearStorage(): Promise<void> {
    this.throwIfFailed()

    const origin = this.gotoOrigin

    await this.guarded(
      Promise.all([
        this.connection.send('Storage.clearCookies', { browserContextId: this.ids.browserContextId }),
        ...(origin === undefined ? [] : this.clearOrigin(origin)),
      ]),
      commandTimeLimitMs,
      `The page didn't clear its storage within ${commandTimeLimitMs / 1000} s.`,
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
   * Starts clearing the origin's storage, in the page's session, which reaches the storage of the page's own context:
   * `localStorage` and IndexedDB through `Storage.clearDataForOrigin`, and `sessionStorage` through `DOMStorage.clear`,
   * which needs the main frame to show a document of the origin. In Chromium 157, `local_storage` clears
   * `sessionStorage` too, but the protocol doesn't say so, so `DOMStorage.clear` stays: it is the documented way. When
   * it fails, the clearing fails, which costs nothing: the caller replaces a page once a call on it fails.
   */
  private clearOrigin(origin: string): Promise<Record<string, unknown>>[] {
    return [
      this.send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage,indexeddb' }),
      this.send('DOMStorage.clear', { storageId: { securityOrigin: origin, isLocalStorage: false } }),
    ]
  }

  /**
   * Fails the page when an event says it can no longer be used or that it navigated away from the document its last
   * `goto` loaded, and handles its dialogs and popups.
   */
  private watch(event: CdpEvent): void {
    const failure = pageFailureOf(event, this.ids.sessionId)

    if (failure !== undefined) {
      this.fail(failure)
    }

    if (event.sessionId === this.ids.sessionId) {
      this.followMainFrame(event)
    }

    this.handleHazards(event)
  }

  /**
   * Starts following the document a `goto` to `url` loaded, and tells it about the events that came after its load
   * event while the `goto` held them, which `watch` saw before that document loaded.
   */
  private followLoadedDocument(url: string, later: readonly CdpEvent[]): void {
    this.loadedDocument = new LoadedDocument(url, this.ids.targetId)
    for (const event of later) {
      this.tellLoadedDocument(event)
    }
  }

  /**
   * Keeps the origin of each document the main frame commits, and tells the document the last `goto` loaded about an
   * event of the page's session.
   */
  private followMainFrame(event: CdpEvent): void {
    const frame = mainFrameCommitOf(event, this.ids.targetId)

    if (frame !== undefined) {
      this.gotoOrigin = tupleOriginOf(frame.securityOrigin)
    }

    this.tellLoadedDocument(event)
  }

  /**
   * Tells the document the last `goto` loaded, if one did, about an event of the page's session, and fails the page
   * when the event says the page left that document.
   */
  private tellLoadedDocument(event: CdpEvent): void {
    const left = this.loadedDocument?.observe(event)

    if (left !== undefined) {
      this.fail(left)
    }
  }

  /**
   * Answers a dialog the page's session reports, accepting an `alert` and a `beforeunload` and dismissing a `confirm`
   * and a `prompt`, and closes a popup the browser reports in the page's browser context. The replies are not awaited,
   * and a failed one changes nothing: the dialog or popup may have gone already.
   */
  private handleHazards(event: CdpEvent): void {
    if (event.sessionId === this.ids.sessionId && event.method === 'Page.javascriptDialogOpening') {
      this.send('Page.handleJavaScriptDialog', { accept: acceptsDialog(event.params.type) }).catch(() => undefined)
    }

    const popupId = popupIdOf(event, this.ids)

    if (popupId !== undefined) {
      this.connection.send('Target.closeTarget', { targetId: popupId }).catch(() => undefined)
    }
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
   * fails it with a `PageTimeoutError` carrying `timeoutMessage`. A `CdpError` that comes as the page navigates away
   * from the document its last `goto` loaded, once it has requested or started that navigation, fails it with a
   * `PageNavigatedAwayError` instead.
   */
  private async guarded<T>(operation: Promise<T>, timeLimitMs: number, timeoutMessage: string): Promise<T> {
    try {
      return await withinTimeLimit(
        this.unlessFailed(operation),
        timeLimitMs,
        () => new PageTimeoutError(timeoutMessage, timeLimitMs),
      )
    } catch (error) {
      throw this.loadedDocument?.explain(error) ?? error
    }
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
 * once. From then on the page handles its hazards itself. Its user agent is the browser's own with the setup's suffix.
 * When a step fails, or the page isn't open within 30 s, it disposes the context and rethrows.
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
