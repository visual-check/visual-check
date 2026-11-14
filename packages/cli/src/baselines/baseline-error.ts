/**
 * Gives the operating system's reason for a failed file call, without the call's name and paths that Node adds, such
 * as `EACCES: permission denied`. Any other error gives its message.
 */
function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }

  const { syscall } = error as NodeJS.ErrnoException
  const callStart = syscall === undefined ? -1 : error.message.indexOf(`, ${syscall}`)

  return callStart > 0 ? error.message.slice(0, callStart) : error.message
}

/**
 * A baseline that is there couldn't be read, or a baseline couldn't be written, such as for a folder that isn't
 * writable or a full disk.
 *
 * @public
 */
export class BaselineError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `BaselineError`.
   */
  override name = 'BaselineError'

  /**
   * What failed: reading the baseline or writing it.
   */
  readonly action: 'read' | 'write'

  /**
   * The baseline's path.
   */
  readonly path: string

  /**
   * The operating system's reason, such as `EACCES: permission denied`.
   */
  readonly reason: string

  /**
   * Keeps what failed, the baseline's path and the reason the error that caused it gives.
   */
  constructor(action: 'read' | 'write', path: string, cause: unknown) {
    const reason = reasonOf(cause)

    super(`Couldn't ${action} the baseline ${path}: ${reason}.`, { cause })
    this.action = action
    this.path = path
    this.reason = reason
  }
}
