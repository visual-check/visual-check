/**
 * The headless shell couldn't be downloaded: the proxy setting is wrong, the server or the proxy refused, the network
 * failed or the download stalled. The message is the whole text the user reads.
 *
 * @public
 */
export class BrowserDownloadError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `BrowserDownloadError`.
   */
  override name = 'BrowserDownloadError'
}
