/**
 * A config that can't be found, loaded or used. Commands exit with code 2 on it.
 *
 * @public
 */
export class ConfigError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `ConfigError`.
   */
  override name = 'ConfigError'

  /**
   * The absolute path of the config the error is about, or `undefined` when no config was found.
   */
  readonly configPath: string | undefined

  /**
   * Keeps the message, the error that caused it, and the config's path when one was found.
   */
  constructor(message: string, options: { cause?: unknown; configPath?: string } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.configPath = options.configPath
  }
}
