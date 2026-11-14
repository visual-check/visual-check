/**
 * Waits for a promise to settle, either way, or for `ms` to pass, whichever comes first. Resolves true when the
 * promise settled in time. Its timer is cleared either way.
 */
export async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })

  try {
    return await Promise.race([promise.then(settled, settled), timedOut])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Answers true, for a promise that has settled.
 */
function settled(): true {
  return true
}

/**
 * A time limit that several steps share: each step raced against it fails once the time has passed.
 */
export interface TimeLimit {
  /**
   * Settles as the promise does, unless the time passes first.
   */
  race: <T>(promise: Promise<T>) => Promise<T>
  /**
   * Clears the timer, so it keeps nothing alive. Call it once the steps are done, either way.
   */
  clear: () => void
}

/**
 * Starts a time limit of `ms`. Once it has passed, every step raced against it rejects with an error carrying
 * `message`.
 */
export function startTimeLimit(ms: number, message: string): TimeLimit {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })

  expired.catch(() => undefined)

  return {
    race: (promise) => Promise.race([promise, expired]),
    clear: () => clearTimeout(timer),
  }
}

/**
 * Settles as the promise does when it settles within `ms`, and otherwise rejects with an error carrying `message`. Its
 * timer is cleared either way.
 */
export async function withinTimeLimit<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  const limit = startTimeLimit(ms, message)

  try {
    return await limit.race(promise)
  } finally {
    limit.clear()
  }
}
