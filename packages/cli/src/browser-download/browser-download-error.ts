/**
 * The headless shell couldn't be downloaded or installed: the proxy or mirror setting is wrong, the server or the
 * proxy refused, the network failed or the download stalled, the download has the wrong SHA-256 or can't be unzipped,
 * or the cache folder can't be written. The message is the whole text the user reads.
 *
 * @public
 */
export class BrowserDownloadError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `BrowserDownloadError`.
   */
  override name = 'BrowserDownloadError'
}

/**
 * What went wrong, as a message gives it after a colon: the error's message without the full stop some end with, so
 * the message can add its own.
 */
export function reasonOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\.+$/, '')
}
