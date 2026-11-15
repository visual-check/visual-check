/**
 * Gives the operating system's reason for a failed file call, without the call's name and paths that Node adds, such
 * as `EACCES: permission denied`. Any other error gives its message.
 *
 * @public
 */
export function systemReasonOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }

  const { syscall } = error as NodeJS.ErrnoException
  const callStart = syscall === undefined ? -1 : error.message.indexOf(`, ${syscall}`)

  return callStart > 0 ? error.message.slice(0, callStart) : error.message
}
