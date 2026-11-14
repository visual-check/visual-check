import { PageNavigatedAwayError } from '../driver.js'
import { CdpError, type CdpEvent, isRecord } from './cdp-connection.js'
import { frameUrl } from './main-frame-navigation.js'

/**
 * The kinds of navigation `Page.frameStartedNavigating` reports that keep the document: a fragment or `history`-API
 * navigation, and a history traversal to an entry of the same document.
 */
const sameDocumentNavigationTypes: ReadonlySet<unknown> = new Set(['sameDocument', 'historySameDocument'])

/**
 * The document a `goto` loaded in the page's main frame, followed from its load event until the page leaves it for a
 * new document. Only a new document of the main frame counts: a same-document navigation, such as
 * `history.replaceState` or a fragment link, doesn't, and neither does an iframe's navigation.
 *
 * The page has left once its main frame commits a new document. Before that commit, Chromium already fails a call in
 * flight, such as a `Runtime.evaluate` awaiting a promise, with "Inspected target navigated or closed", so a `CdpError`
 * while a navigation of the main frame to a new document is pending counts as leaving too. A navigation is pending
 * from the page's request for it, such as following a link, or from its start, which is the first word of a history
 * traversal such as `history.back()`. A navigation that ends without a new document, such as one answered
 * `204 No Content` or turned into a download, stops the main frame's loading, which forgets it. So does a same-document
 * history traversal, which cancels it. `history.replaceState`, `pushState` and fragment navigations leave it going, so
 * they forget nothing.
 */
export class LoadedDocument {
  /**
   * The URL the `goto` asked for.
   */
  private readonly url: string

  /**
   * The main frame's id, which in Chromium is the page's target id.
   */
  private readonly mainFrameId: string

  /**
   * The URL of the navigation of the main frame to a new document that the page last requested or started, or
   * undefined when none is pending.
   */
  private pendingUrl: string | undefined

  /**
   * The error the page left the document with, from the first new document its main frame committed, or undefined
   * while it shows the document.
   */
  private left: PageNavigatedAwayError | undefined

  /**
   * Starts following the document a `goto` to `url` loaded in the main frame `mainFrameId`.
   */
  constructor(url: string, mainFrameId: string) {
    this.url = url
    this.mainFrameId = mainFrameId
  }

  /**
   * Takes in an event of the page's session. Gives the `PageNavigatedAwayError` when the event commits a new document
   * in the main frame, naming its URL, or the URL an error page stands for, and undefined for any other event.
   */
  observe(event: CdpEvent): PageNavigatedAwayError | undefined {
    const { method, params } = event

    if (method === 'Page.frameNavigated') {
      return this.frameNavigated(params.frame)
    }

    if (params.frameId !== this.mainFrameId) {
      return undefined
    }

    if (method === 'Page.frameRequestedNavigation' && params.disposition === 'currentTab') {
      this.pendingUrl = String(params.url)
    } else if (method === 'Page.frameStartedNavigating' && !sameDocumentNavigationTypes.has(params.navigationType)) {
      this.pendingUrl = String(params.url)
    } else if (method === 'Page.frameStoppedLoading') {
      this.pendingUrl = undefined
    }

    return undefined
  }

  /**
   * Gives the error a call failed with as the page's own: for a `CdpError`, the `PageNavigatedAwayError` once the page
   * has left the document, or one naming the pending navigation's URL while one is pending. Any other error, a
   * `PageTimeoutError` included, stays as it is.
   */
  explain(error: unknown): unknown {
    if (!(error instanceof CdpError)) {
      return error
    }

    if (this.left !== undefined) {
      return this.left
    }

    return this.pendingUrl === undefined ? error : this.navigatedTo(this.pendingUrl)
  }

  /**
   * Leaves the document when the main frame commits, and gives the error it left with. Another frame's commit doesn't
   * count.
   */
  private frameNavigated(frame: unknown): PageNavigatedAwayError | undefined {
    if (!isRecord(frame) || frame.id !== this.mainFrameId) {
      return undefined
    }

    this.left ??= this.navigatedTo(frameUrl(frame))

    return this.left
  }

  /**
   * The error the page fails with because it navigated to `url` after the `goto` loaded.
   */
  private navigatedTo(url: string): PageNavigatedAwayError {
    return new PageNavigatedAwayError(url, `The page navigated to ${url} after ${this.url} loaded.`)
  }
}
