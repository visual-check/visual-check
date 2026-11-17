/**
 * How a run reports: `live` and `log` print the human output, `json` prints the report's JSON document on stdout.
 *
 * @public
 */
export type Reporter = 'live' | 'log' | 'json'

/**
 * What picks the reporter when `--reporter` isn't given.
 */
interface ReporterSetting {
  /**
   * Whether the `CI` environment variable says the run is in CI.
   */
  ci: boolean
  /**
   * Whether standard output is a TTY.
   */
  tty: boolean
}

/**
 * Gives the reporter: the flag's, else `log` with `CI` set or no TTY, else `live`.
 *
 * @public
 */
export function reporterOf(flag: Reporter | undefined, setting: ReporterSetting): Reporter {
  if (flag !== undefined) {
    return flag
  }

  return setting.ci || !setting.tty ? 'log' : 'live'
}
