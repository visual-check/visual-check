import { PREVIEW_INITIALIZED } from 'storybook/internal/core-events'
import { describe, expect, it, type Mock, vi } from 'vitest'
import { channelEvents } from '../channel-events/events.js'
import { checkedWith, runWith, stateWith } from '../channel-events/state.fixture.js'
import { createManagerState, type ManagerState } from './manager-state.js'

/**
 * Creates the state on a channel that keeps what it emits. `receive` is what comes in on it.
 */
function start(): { state: ManagerState; emit: Mock; receive: (event: string, payload?: unknown) => void } {
  const listeners = new Map<string, (payload: unknown) => void>()
  const emit = vi.fn()
  const state = createManagerState({ on: (event, listener) => listeners.set(event, listener), emit })

  return { state, emit, receive: (event, payload) => listeners.get(event)?.(payload) }
}

describe('createManagerState', () => {
  it('asks for the state, and is empty until it comes', () => {
    const { state, emit } = start()

    expect(emit.mock.calls).toEqual([[channelEvents.getState]])
    expect(state.getState()).toEqual({ run: null, results: {} })
    expect(state.getState()).toBe(state.getState())
  })

  it('takes the state, the same object until the next one', () => {
    const { state, receive } = start()
    const received = stateWith(checkedWith([]))

    receive(channelEvents.state, received)

    expect(state.getState()).toEqual(received)
    expect(state.getState()).toBe(state.getState())
  })

  it("takes no run before the state, whose results it doesn't know", () => {
    const { state, receive } = start()
    const listener = vi.fn()

    state.subscribe(listener)
    receive(channelEvents.run, runWith())

    expect(state.getState()).toEqual({ run: null, results: {} })
    expect(listener).not.toHaveBeenCalled()
  })

  it("takes the run's progress and its end, and keeps the results", () => {
    const { state, receive } = start()
    const { results } = stateWith(checkedWith([]))
    const run = runWith({ step: 'capturing', finished: 1, total: 3 })

    receive(channelEvents.state, { run: runWith(), results })
    receive(channelEvents.run, run)

    expect(state.getState()).toEqual({ run, results })

    receive(channelEvents.run, null)

    expect(state.getState()).toEqual({ run: null, results })
  })

  it('tells its subscribers of each change until they leave', () => {
    const { state, receive } = start()
    const [first, second] = [vi.fn(), vi.fn()]
    const leave = state.subscribe(first)

    state.subscribe(second)
    receive(channelEvents.state, { run: null, results: {} })
    leave()
    receive(channelEvents.run, runWith())

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('tells the others when one throws', () => {
    const { state, receive } = start()
    const error = new Error('This listener throws')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const other = vi.fn()

    state.subscribe(() => {
      throw error
    })
    state.subscribe(other)
    receive(channelEvents.state, { run: null, results: {} })

    expect(other).toHaveBeenCalledTimes(1)
    expect(logged.mock.calls).toEqual([[error]])

    logged.mockRestore()
  })

  it('asks for a check and for the results to be cleared', () => {
    const { state, emit } = start()

    emit.mockClear()
    state.check('card--default')
    state.clear()

    expect(emit.mock.calls).toEqual([[channelEvents.check, { storyId: 'card--default' }], [channelEvents.clear]])
  })

  it('cancels the run in flight, and nothing without one', () => {
    const { state, emit, receive } = start()

    emit.mockClear()
    state.cancel()

    expect(emit).not.toHaveBeenCalled()

    receive(channelEvents.state, { run: runWith({ id: 'click-7' }), results: {} })
    state.cancel()

    expect(emit.mock.calls).toEqual([[channelEvents.cancel, { id: 'click-7' }]])
  })

  it('says the results are stale each time the preview loads again', () => {
    const { emit, receive } = start()

    emit.mockClear()
    receive(PREVIEW_INITIALIZED)

    expect(emit).not.toHaveBeenCalled()

    receive(PREVIEW_INITIALIZED)
    receive(PREVIEW_INITIALIZED)

    expect(emit.mock.calls).toEqual([[channelEvents.stale], [channelEvents.stale]])
  })
})
