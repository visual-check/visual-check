/**
 * Which fix a `ContainerError`'s message needs said after it: `docker` for a Docker that is missing, stopped or
 * can't pull, whose fix is to start or install it or to set `platform: 'host'`, and `linux-containers` for Docker in
 * Windows-containers mode, whose message holds its own fix.
 *
 * @public
 */
export type ContainerFix = 'docker' | 'linux-containers'

/**
 * Docker couldn't do what visual-check needs of it: it isn't there, isn't running, runs Windows containers, or failed
 * to pull the browser's image.
 *
 * @public
 */
export class ContainerError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `ContainerError`.
   */
  override name = 'ContainerError'

  /**
   * Which fix the message needs said after it.
   */
  readonly fix: ContainerFix

  /**
   * Builds the error from its message and the fix that message needs. The fix is `docker` unless given.
   */
  constructor(message: string, fix: ContainerFix = 'docker') {
    super(message)
    this.fix = fix
  }
}
