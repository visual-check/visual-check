import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settlesWithin, startTimeLimit, withinTimeLimit } from './time-limit.js'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('settlesWithin', () => {
  it('resolves true and clears its timer when the promise resolves in time', async () => {
    await expect(settlesWithin(Promise.resolve('done'), 1000)).resolves.toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resolves true when the promise rejects in time', async () => {
    await expect(settlesWithin(Promise.reject(new Error('failed')), 1000)).resolves.toBe(true)
  })

  it('resolves false once the time has passed', async () => {
    const waiting = settlesWithin(new Promise(() => undefined), 1000)

    await vi.advanceTimersByTimeAsync(1000)
    await expect(waiting).resolves.toBe(false)
  })
})

describe('withinTimeLimit', () => {
  it('resolves with the value and clears its timer when the promise resolves in time', async () => {
    await expect(withinTimeLimit(Promise.resolve('done'), 1000, 'too slow')).resolves.toBe('done')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects with the error and clears its timer when the promise rejects in time', async () => {
    const error = new Error('failed')

    await expect(withinTimeLimit(Promise.reject(error), 1000, 'too slow')).rejects.toBe(error)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects with the message once the time has passed', async () => {
    const waiting = withinTimeLimit(new Promise(() => undefined), 1000, 'too slow')
    const failure = expect(waiting).rejects.toThrow(new Error('too slow'))

    await vi.advanceTimersByTimeAsync(999)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await failure
  })
})

describe('startTimeLimit', () => {
  it('fails every step raced against it once the time has passed', async () => {
    const limit = startTimeLimit(1000, 'too slow')

    await expect(limit.race(Promise.resolve('first'))).resolves.toBe('first')

    const second = limit.race(new Promise(() => undefined))
    const failure = expect(second).rejects.toThrow(new Error('too slow'))

    await vi.advanceTimersByTimeAsync(1000)
    await failure
  })

  it('stops its timer when cleared', () => {
    const limit = startTimeLimit(1000, 'too slow')

    expect(vi.getTimerCount()).toBe(1)
    limit.clear()
    expect(vi.getTimerCount()).toBe(0)
  })
})
