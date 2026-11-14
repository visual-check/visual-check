/**
 * A Storybook that can't be used for the run: it doesn't answer, its index fails, its stories files are missing, or its
 * installed `storybook` is older than 9.1. Commands exit with code 2 on it.
 *
 * @public
 */
export class StorybookError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `StorybookError`.
   */
  override name = 'StorybookError'
}

/**
 * A Storybook where nothing answers at its URL, or that stops answering mid-response.
 *
 * @public
 */
export class StorybookUnreachableError extends StorybookError {
  /**
   * The class's name, so a stack trace or a log line reads `StorybookUnreachableError`.
   */
  override name = 'StorybookUnreachableError'
}
