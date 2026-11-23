import { describe, expect, it, vi } from 'vitest'
import { runWith } from '../channel-events/state.fixture.js'
import { cancelFromPanel, checkFromPanel } from './toolbar.js'

describe('checkFromPanel', () => {
  it('asks for a check of the story', () => {
    const actions = { check: vi.fn(), cancel: vi.fn() }

    checkFromPanel({ storyId: 'card--default', run: null, actions })

    expect(actions.check.mock.calls).toEqual([['card--default']])
  })

  it('does nothing without a story or while a run is in flight', () => {
    const actions = { check: vi.fn(), cancel: vi.fn() }

    checkFromPanel({ storyId: null, run: null, actions })
    checkFromPanel({ storyId: 'card--default', run: runWith({ storyId: 'button--primary' }), actions })

    expect(actions.check).not.toHaveBeenCalled()
  })
})

describe('cancelFromPanel', () => {
  it('cancels the run, once', () => {
    const actions = { cancel: vi.fn() }

    cancelFromPanel({ run: runWith(), actions })
    cancelFromPanel({ run: runWith({ cancelling: true }), actions })

    expect(actions.cancel).toHaveBeenCalledTimes(1)
  })
})
