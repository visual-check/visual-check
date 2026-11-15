import { systemReasonOf } from '../system-error/system-reason.js'

/**
 * What failed: reading a baseline, decoding it as a PNG file, writing it or deleting it, or listing the baselines
 * folder.
 */
type BaselineAction = 'read' | 'decode' | 'write' | 'delete' | 'list'

/**
 * A baseline that is there couldn't be read or decoded, a baseline couldn't be written or deleted, such as for a
 * folder that isn't writable or a full disk, or the baselines folder couldn't be listed.
 *
 * @public
 */
export class BaselineError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `BaselineError`.
   */
  override name = 'BaselineError'

  /**
   * What failed.
   */
  readonly action: BaselineAction

  /**
   * The baseline's path, or the baselines folder's when it couldn't be listed.
   */
  readonly path: string

  /**
   * The operating system's reason, such as `EACCES: permission denied`, or the decoder's.
   */
  readonly reason: string

  /**
   * What the path is, as a message names it: `the baselines folder` when it couldn't be listed, else `the baseline`.
   */
  readonly subject: string

  /**
   * Keeps what failed, the path and the reason the error that caused it gives.
   */
  constructor(action: BaselineAction, path: string, cause: unknown) {
    const reason = systemReasonOf(cause)
    const subject = action === 'list' ? 'the baselines folder' : 'the baseline'

    super(`Couldn't ${action} ${subject} ${path}: ${reason}.`, { cause })
    this.action = action
    this.path = path
    this.reason = reason
    this.subject = subject
  }
}
