/**
 * Which fix a `ContainerError`'s message needs said after it: `docker` for a Docker that is missing, stopped or
 * can't pull, whose fix is to start or install it or to set `platform: 'host'`; `linux-containers` for Docker in
 * Windows-containers mode, whose message holds its own fix; and `tested-runtimes` for a runtime that gives containers
 * no name for the machine, whose message lists the tested runtimes.
 *
 * @public
 */
export type ContainerFix = 'docker' | 'linux-containers' | 'tested-runtimes'

/**
 * Docker couldn't do what visual-check needs of it: it isn't there, isn't running, runs Windows containers, failed to
 * pull the browser's image, or gives its containers no name for the machine, so the browser can't reach
 * visual-check's proxy.
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

/**
 * There is no `docker` command on PATH. It is a `ContainerError` with the `docker` fix, in its own class so `init` can
 * tell a Docker that isn't installed from one that is stopped, and say how to find it from inside WSL.
 *
 * @public
 */
export class DockerMissingError extends ContainerError {
  /**
   * The class's name, so a stack trace or a log line reads `DockerMissingError`.
   */
  override name = 'DockerMissingError'

  /**
   * Builds the error from its message. The fix is always `docker`.
   */
  constructor(message: string) {
    super(message, 'docker')
  }
}
