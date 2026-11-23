/**
 * Waits for `promise`, but no longer than until the signal aborts. Settles as `promise` does, or rejects with the
 * signal's reason when it aborts first. What `promise` waits for isn't stopped, and its rejection after the abort is
 * ignored.
 *
 * @throws {unknown} The signal's reason, when it aborts first.
 */
export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return await new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason)

    if (signal.aborted) {
      abort()
    }

    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
