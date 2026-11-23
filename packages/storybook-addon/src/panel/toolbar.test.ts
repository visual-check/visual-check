import { describe, expect, it, vi } from 'vitest'
import { runWith } from '../channel-events/state.fixture.js'
import { cancelFromPanel, checkFromPanel, runButtonOf, updateFromPanel } from './toolbar.js'

describe('checkFromPanel', () => {
  it('asks for a check of the story', () => {
    const actions = { check: vi.fn(), update: vi.fn(), cancel: vi.fn() }

    checkFromPanel({ storyId: 'card--default', run: null, actions })

    expect(actions.check.mock.calls).toEqual([['card--default']])
  })

  it('does nothing without a story or while a run is in flight', () => {
    const actions = { check: vi.fn(), update: vi.fn(), cancel: vi.fn() }

    checkFromPanel({ storyId: null, run: null, actions })
    checkFromPanel({ storyId: 'card--default', run: runWith({ storyId: 'button--primary' }), actions })

    expect(actions.check).not.toHaveBeenCalled()
  })
})

describe('updateFromPanel', () => {
  it("asks for an update of the story's baselines", () => {
    const actions = { check: vi.fn(), update: vi.fn(), cancel: vi.fn() }

    updateFromPanel({ storyId: 'card--default', run: null, actions })

    expect(actions.update.mock.calls).toEqual([['card--default']])
    expect(actions.check).not.toHaveBeenCalled()
  })

  it('does nothing without a story or while a run is in flight', () => {
    const actions = { check: vi.fn(), update: vi.fn(), cancel: vi.fn() }

    updateFromPanel({ storyId: null, run: null, actions })
    updateFromPanel({ storyId: 'card--default', run: runWith({ kind: 'update' }), actions })

    expect(actions.update).not.toHaveBeenCalled()
  })
})

describe('runButtonOf', () => {
  it("hands the focus to the button of the run's kind", () => {
    const buttons = { check: 'Check', update: 'Update' }

    expect(runButtonOf('check', buttons)).toBe('Check')
    expect(runButtonOf('update', buttons)).toBe('Update')
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
