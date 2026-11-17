import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveScreen } from './live-screen.js'
import type { LiveViewState } from './live-view-state.js'
import { cleanupSettled, plainFrameOf, renderSettled } from './terminal.fixture.js'

/**
 * A run of two snapshots on one worker, one of them failed.
 */
const state: LiveViewState = {
  printed: [
    { id: 0, mark: undefined, text: 'visual-check 1.0.0 · test · 2 snapshots · 1 worker' },
    { id: 1, mark: '✗', text: ' web  b  missing' },
  ],
  done: 1,
  total: 2,
  workers: 1,
  planned: true,
  closed: false,
}

beforeEach(() => {
  // Only the timers of the spinner and the progress line are faked: React and Ink keep their real ones to draw.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})

afterEach(async () => {
  await cleanupSettled()
  vi.useRealTimers()
})

describe('LiveScreen', () => {
  it('draws the printed lines, then the spinner and the progress line', async () => {
    const { lastFrame } = await renderSettled(<LiveScreen elapsedMs={() => 3000} state={state} />)

    expect(plainFrameOf(lastFrame())).toBe(
      'visual-check 1.0.0 · test · 2 snapshots · 1 worker\n✗ web  b  missing\n⠋ 1/2 snapshots · 1 worker · 3.0s',
    )
  })

  it('draws no progress line and runs no timer once closed', async () => {
    const { lastFrame } = await renderSettled(<LiveScreen elapsedMs={() => 3000} state={{ ...state, closed: true }} />)

    expect(plainFrameOf(lastFrame())).toBe('visual-check 1.0.0 · test · 2 snapshots · 1 worker\n✗ web  b  missing\n')
    expect(vi.getTimerCount()).toBe(0)
  })
})
