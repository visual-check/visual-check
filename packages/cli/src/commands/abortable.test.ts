import { getEventListeners } from 'node:events'
import { describe, expect, it } from 'vitest'
import { abortable } from './abortable.js'

/**
 * What every signal of the tests aborts with.
 */
const reason = new Error('The check was cancelled.')

/**
 * Collects the rejections nothing handled while the test runs `action` and the callbacks it queued.
 */
async function unhandledDuring(action: () => Promise<void>): Promise<unknown[]> {
  const unhandled: unknown[] = []
  const collect = (error: unknown): void => {
    unhandled.push(error)
  }
  const others = process.listeners('unhandledRejection')

  process.removeAllListeners('unhandledRejection')
  process.on('unhandledRejection', collect)

  try {
    await action()
    await new Promise((resolve) => setTimeout(resolve, 10))
  } finally {
    process.off('unhandledRejection', collect)

    for (const listener of others) {
      process.on('unhandledRejection', listener)
    }
  }

  return unhandled
}

describe('abortable', () => {
  it('settles as the promise does, and leaves no listener on the signal', async () => {
    const { signal } = new AbortController()
    const error = new Error('The launch failed.')

    expect(await abortable(Promise.resolve('driver'), signal)).toBe('driver')
    await expect(abortable(Promise.reject(error), signal)).rejects.toBe(error)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getEventListeners(signal, 'abort')).toEqual([])
  })

  it("rejects with the signal's reason at the abort, and leaves no listener on the signal", async () => {
    const controller = new AbortController()
    const waiting = abortable(new Promise(() => undefined), controller.signal)

    controller.abort(reason)

    await expect(waiting).rejects.toBe(reason)
    expect(getEventListeners(controller.signal, 'abort')).toEqual([])
  })

  it('rejects with the reason of a signal that has already aborted, even when the promise has settled', async () => {
    await expect(abortable(Promise.resolve('driver'), AbortSignal.abort(reason))).rejects.toBe(reason)
  })

  it('handles a rejection of the promise that comes after the abort', async () => {
    const unhandled = await unhandledDuring(async () => {
      const controller = new AbortController()
      let failLaunch: (error: Error) => void = () => undefined
      const launch = new Promise<never>((_resolve, reject) => {
        failLaunch = reject
      })
      const waiting = abortable(launch, controller.signal)

      controller.abort(reason)
      await expect(waiting).rejects.toBe(reason)
      failLaunch(new Error('The launch failed late.'))
    })

    expect(unhandled).toEqual([])
  })
})
