import type { Status } from 'storybook/internal/types'
import { describe, expect, it, type Mock, vi } from 'vitest'
import type { VisualCheckState } from '../channel-events/events.js'
import { checkedWith, runWith, snapshotWith, stateWith } from '../channel-events/state.fixture.js'
import { startStatusSync } from './status-sync.js'
import { statusesOf } from './statuses.js'

/**
 * The status another addon gives a story.
 */
const otherStatus: Status = {
  value: 'status-value:error',
  typeId: 'other-addon',
  storyId: 'other--story',
  title: 'Other',
  description: '',
}

/**
 * Starts the sync with a status store that holds another addon's status and those given.
 */
function start(statuses: Status[]): {
  set: Mock
  unset: Mock
  change: (state: VisualCheckState) => void
  changeStore: () => void
} {
  let state: VisualCheckState = { run: null, results: {} }
  const listeners: (() => void)[] = []
  const storeListeners: (() => void)[] = []
  const set = vi.fn()
  const unset = vi.fn()

  startStatusSync(
    {
      subscribe: (listener) => {
        listeners.push(listener)

        return () => undefined
      },
      getState: () => state,
    },
    {
      getAll: () => ({
        [otherStatus.storyId]: { [otherStatus.typeId]: otherStatus },
        ...Object.fromEntries(statuses.map((status) => [status.storyId, { [status.typeId]: status }])),
      }),
      set,
      unset,
      onAllStatusChange: (listener) => {
        storeListeners.push(() => listener({}, {}))

        return () => undefined
      },
    },
  )

  return {
    set,
    unset,
    change: (next) => {
      state = next

      for (const listener of listeners) {
        listener()
      }
    },
    changeStore: () => {
      for (const listener of storeListeners) {
        listener()
      }
    },
  }
}

describe('startStatusSync', () => {
  const passed = stateWith(checkedWith([snapshotWith()]))

  it('leaves the store alone until the state changes', () => {
    const { set, unset } = start(statusesOf(passed))

    expect(set).not.toHaveBeenCalled()
    expect(unset).not.toHaveBeenCalled()
  })

  it('sets the listed stories', () => {
    const { set, unset, change } = start([])

    change(passed)

    expect(set.mock.calls).toEqual([[statusesOf(passed)]])
    expect(unset).not.toHaveBeenCalled()
  })

  it('sets none that is there as it is', () => {
    const { set, unset, change } = start(statusesOf(passed))

    change(passed)

    expect(set).not.toHaveBeenCalled()

    change({ ...passed, run: runWith({ storyId: 'button--primary' }) })

    expect(set.mock.calls).toMatchObject([[[{ storyId: 'button--primary', value: 'status-value:pending' }]]])
    expect(unset).not.toHaveBeenCalled()
  })

  it('sets one whose description alone changed', () => {
    const { set, change } = start(statusesOf(stateWith(checkedWith([snapshotWith()]), { stale: true })))

    change(stateWith(checkedWith([], { disabled: true })))

    expect(set.mock.calls).toMatchObject([[[{ value: 'status-value:unknown', description: 'Disabled' }]]])
  })

  it('writes what it could not once the store is ready, and no sooner than something changes', () => {
    const { set, change, changeStore } = start([])

    set.mockImplementationOnce(() => {
      throw new TypeError('Cannot set state before store is ready')
    })
    change(passed)

    expect(set).toHaveBeenCalledTimes(1)

    changeStore()

    expect(set.mock.calls).toEqual([[statusesOf(passed)], [statusesOf(passed)]])

    changeStore()

    expect(set).toHaveBeenCalledTimes(2)
  })

  it('tries again at the next change of the state', () => {
    const { set, unset, change } = start(statusesOf(passed))
    const other = stateWith(checkedWith([snapshotWith()]), { storyId: 'button--primary' })

    unset.mockImplementation(() => {
      throw new TypeError('Cannot set state before store is ready')
    })

    expect(() => change(other)).not.toThrow()
    expect(set).not.toHaveBeenCalled()

    unset.mockReset()
    change({ ...other, run: null })

    expect(unset.mock.calls).toEqual([[['card--default']]])
    expect(set.mock.calls).toEqual([[statusesOf(other)]])
  })

  it('logs any other error and does not wait for the store', () => {
    const { set, change, changeStore } = start([])
    const error = new Error('Another one')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    set.mockImplementationOnce(() => {
      throw error
    })
    change(passed)
    changeStore()

    expect(logged.mock.calls).toEqual([[error]])
    expect(set).toHaveBeenCalledTimes(1)

    logged.mockRestore()
  })

  it('leaves what others change in the store alone when it could write', () => {
    const { set, unset, change, changeStore } = start([])

    change(passed)
    set.mockClear()
    changeStore()

    expect(set).not.toHaveBeenCalled()
    expect(unset).not.toHaveBeenCalled()
  })

  it('unsets the stories no longer listed, its own alone', () => {
    const { set, unset, change } = start(statusesOf(passed))

    change({ run: null, results: {} })

    expect(unset.mock.calls).toEqual([[['card--default']]])
    expect(set).not.toHaveBeenCalled()
  })
})
