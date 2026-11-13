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
}
