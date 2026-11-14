/**
 * Docker couldn't do what visual-check needs of it: it isn't there, or it failed to pull the browser's image.
 *
 * @public
 */
export class ContainerError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `ContainerError`.
   */
  override name = 'ContainerError'
}
