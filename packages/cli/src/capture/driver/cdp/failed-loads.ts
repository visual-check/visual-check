import type { FailedLoad } from '../driver.js'
import { type CdpEvent, isRecord } from './cdp-connection.js'

/**
 * The text Blink logs for a load that failed at the network level, with the browser's error.
 */
const failedLoadText = /^Failed to load resource: (net::ERR_[A-Z0-9_]+)$/

/**
 * Reads the load a `Log.entryAdded` event of the page's session reports as failed at the network level, such as a
 * dropped or refused connection, or undefined for any other event or entry: a cancellation (`net::ERR_ABORTED`), an
 * HTTP error status, another source or level, or an entry without a URL.
 */
export function failedLoadOf(event: CdpEvent, sessionId: string): FailedLoad | undefined {
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

  const error = failedLoadText.exec(entry.text)?.[1]

  return error === undefined || error === 'net::ERR_ABORTED' ? undefined : { url: entry.url, error }
}
