import { PageLoadError, PageNavigatedAwayError } from '../driver.js'
import { type CdpEvent, isRecord } from './cdp-connection.js'

/**
 * The URL a frame from `Page.frameNavigated` committed, its fragment included. For an error page, the URL that
 * couldn't be loaded.
 */
function frameUrl(frame: Record<string, unknown>): string {
  const url = typeof frame.unreachableUrl === 'string' ? frame.unreachableUrl : String(frame.url)
  const fragment = typeof frame.urlFragment === 'string' ? frame.urlFragment : ''

  return `${url}${fragment}`
}

/**
 * One `goto`: follows what the browser says about the main frame, and settles `done` once its document has loaded,
 * the navigation has failed, or another navigation of the main frame has overtaken it.
 *
 * Its document is the one committed with the loader `Page.navigate` answers with. A server redirect keeps that loader,
 * so it commits another URL and still counts. A late commit with an earlier navigation's loader, such as a failed
 * navigation's error page, is ignored. A commit with any other loader, or a navigation the page itself starts in its
 * main frame, overtakes it with a `PageNavigatedAwayError`.
 *
 * Events that come before the answer to `Page.navigate` are held, and judged in order once the answer names the
 * loader.
 */
export class MainFrameNavigation {
  /**
   * Settles once the document has loaded, and fails when the navigation fails or is overtaken.
   */
  readonly done: Promise<void>

  /**
   * The URL asked for.
   */
  private readonly url: string

  /**
   * The main frame's id, which in Chromium is the page's target id.
   */
  private readonly mainFrameId: string

  /**
   * The loaders of the page's earlier navigations, whose late commits don't count.
   */
  private readonly earlierLoaderIds: ReadonlySet<string>

  /**
   * Resolves `done`.
   */
  private resolve: () => void = () => undefined

  /**
   * Fails `done`.
   */
  private reject: (error: unknown) => void = () => undefined

  /**
   * The loader of the navigation's document, from the answer to `Page.navigate`, or undefined before the answer.
   */
  private loaderId: string | undefined

  /**
   * The events that came before the answer to `Page.navigate`, in order.
   */
  private held: CdpEvent[] = []

  /**
   * Whether the navigation's document has committed.
   */
  private hasCommitted = false

  /**
   * Starts following a navigation of the main frame `mainFrameId` to `url`, ignoring late commits with
   * `earlierLoaderIds`.
   */
  constructor(url: string, mainFrameId: string, earlierLoaderIds: ReadonlySet<string>) {
    this.url = url
    this.mainFrameId = mainFrameId
    this.earlierLoaderIds = earlierLoaderIds
    this.done = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }

  /**
   * Whether the navigation's document has committed. A load event before that belongs to the old document.
   */
  get committed(): boolean {
    return this.hasCommitted
  }

  /**
   * Takes in the answer to `Page.navigate`. Fails with a `PageLoadError` on its error text, such as
   * `net::ERR_CONNECTION_REFUSED`. Otherwise keeps the loader it names and judges the events held until now.
   */
  answer(result: Record<string, unknown>): void {
    const { errorText, loaderId } = result

    if (typeof errorText === 'string' && errorText !== '') {
      this.reject(new PageLoadError(this.url, errorText))
    } else if (typeof loaderId !== 'string') {
      this.reject(new Error("The browser's answer to Page.navigate has no loaderId."))
    } else {
      this.loaderId = loaderId

      const held = this.held

      this.held = []
      for (const event of held) {
        this.judge(event)
      }
    }
  }

  /**
   * Fails the navigation because `Page.navigate` failed.
   */
  fail(error: unknown): void {
    this.reject(error)
  }

  /**
   * Takes in an event of the page's session. A navigation the page starts counts at once; the rest wait for the
   * answer to `Page.navigate`.
   */
  observe(event: CdpEvent): void {
    if (event.method === 'Page.frameRequestedNavigation') {
      this.navigationRequested(event.params)
    } else if (this.loaderId === undefined) {
      this.held.push(event)
    } else {
      this.judge(event)
    }
  }

  /**
   * Fails when the page starts a navigation that replaces its main frame's document. Other frames, new tabs and
   * downloads don't count.
   */
  private navigationRequested(params: Record<string, unknown>): void {
    if (params.frameId === this.mainFrameId && params.disposition === 'currentTab') {
      this.overtaken(String(params.url))
    }
  }

  /**
   * Judges a commit or a load event once the loader is known: resolves on the load event after the document has
   * committed.
   */
  private judge(event: CdpEvent): void {
    if (event.method === 'Page.frameNavigated') {
      this.frameNavigated(event.params.frame)
    } else if (event.method === 'Page.loadEventFired' && this.hasCommitted) {
      this.resolve()
    }
  }

  /**
   * Marks the document committed when the main frame commits with the navigation's loader, and fails when it commits
   * with a loader that is neither this navigation's nor an earlier one's. Another frame's commit doesn't count.
   */
  private frameNavigated(frame: unknown): void {
    if (!isRecord(frame) || frame.id !== this.mainFrameId) {
      return
    }

    if (frame.loaderId === this.loaderId) {
      this.hasCommitted = true
    } else if (!this.earlierLoaderIds.has(String(frame.loaderId))) {
      this.overtaken(frameUrl(frame))
    }
  }

  /**
   * Fails because a navigation to `url` overtook this one.
   */
  private overtaken(url: string): void {
    this.reject(new PageNavigatedAwayError(url, `The page navigated to ${url} before ${this.url} loaded.`))
  }
}
