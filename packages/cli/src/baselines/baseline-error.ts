import { systemReasonOf } from '../system-error/system-reason.js'

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
    const reason = systemReasonOf(cause)

    super(`Couldn't ${action} the baseline ${path}: ${reason}.`, { cause })
    this.action = action
    this.path = path
    this.reason = reason
  }
}
