import type { FailedLoad, PageError } from '../driver.js'
import { type CdpEvent, isRecord } from './cdp-connection.js'

/**
 * The text Blink logs for a load that failed at the network level, with the browser's error.
 */
const failedLoadText = /^Failed to load resource: (net::ERR_[A-Z0-9_]+)$/

/**
 * The text Blink logs for a load that got an HTTP status it counts as an error, with the status, then the status text
 * in brackets, which is empty when the response has none, as one a service worker built often doesn't.
 */
const errorStatusText = /^Failed to load resource: the server responded with a status of (\d+) \(/

/**
 * The lowest HTTP status a page error counts.
 */
const lowestErrorStatus = 400

/**
 * Reads the entry a `Log.entryAdded` event of the page's session carries when it is a network entry at the error level,
 * with its URL and text, or undefined for any other event or entry: another source or level, or an entry without a URL.
 */
function loadEntryOf(event: CdpEvent, sessionId: string): { url: string; text: string } | undefined {
  const { entry } = event.params

  if (
    event.sessionId !== sessionId ||
    event.method !== 'Log.entryAdded' ||
    !isRecord(entry) ||
    entry.source !== 'network' ||
    entry.level !== 'error' ||
    typeof entry.text !== 'string' ||
    typeof entry.url !== 'string'
  ) {
    return undefined
  }

  return { url: entry.url, text: entry.text }
}

/**
 * Reads the network error a load entry's text names, or undefined for a cancellation (`net::ERR_ABORTED`) and any
 * other text.
 */
function networkErrorOf(text: string): string | undefined {
  const error = failedLoadText.exec(text)?.[1]

  return error === 'net::ERR_ABORTED' ? undefined : error
}

/**
 * Reads the load a `Log.entryAdded` event of the page's session reports as failed at the network level, such as a
 * dropped or refused connection, or undefined for any other event or entry: a cancellation (`net::ERR_ABORTED`), an
 * HTTP error status, another source or level, or an entry without a URL.
 */
export function failedLoadOf(event: CdpEvent, sessionId: string): FailedLoad | undefined {
  const entry = loadEntryOf(event, sessionId)
  const error = entry === undefined ? undefined : networkErrorOf(entry.text)

  return entry === undefined || error === undefined ? undefined : { url: entry.url, error }
}

/**
 * Reads the page error a `Log.entryAdded` event of the page's session reports for a load: one that failed at the
 * network level, with its network error, or got an HTTP status of 400 or over, with `HTTP` and the status, such as
 * `HTTP 404`, whether the server or a service worker answered. Gives undefined for any other event or entry: a
 * cancellation (`net::ERR_ABORTED`), a status under 400, another source or level, or an entry without a URL.
 */
export function loadPageErrorOf(event: CdpEvent, sessionId: string): PageError | undefined {
  const entry = loadEntryOf(event, sessionId)

  if (entry === undefined) {
    return undefined
  }

  const networkError = networkErrorOf(entry.text)

  if (networkError !== undefined) {
    return { kind: 'load', text: entry.url, loadError: networkError }
  }

  const status = errorStatusText.exec(entry.text)?.[1]

  if (status === undefined || Number(status) < lowestErrorStatus) {
    return undefined
  }

  return { kind: 'load', text: entry.url, loadError: `HTTP ${status}` }
}
