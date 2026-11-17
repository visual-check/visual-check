import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Spinner, spinnerFrameOf } from './spinner.js'
import { advanceTimers, cleanupSettled, renderSettled } from './terminal.fixture.js'
import { ThemeContext } from './theme.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

describe('spinnerFrameOf', () => {
  it('starts on the first glyph in the cyan plate', () => {
    expect(spinnerFrameOf(0)).toEqual({ glyph: '⠋', colour: 'brandCyan' })
  })

  it('shows the next glyph each tick', () => {
    expect(spinnerFrameOf(1)).toEqual({ glyph: '⠙', colour: 'brandCyan' })
  })

  it('ends the first turn on the last glyph', () => {
    expect(spinnerFrameOf(9)).toEqual({ glyph: '⠏', colour: 'brandCyan' })
  })

  it('switches to the magenta plate for the second turn', () => {
    expect(spinnerFrameOf(10)).toEqual({ glyph: '⠋', colour: 'brandMagenta' })
  })

  it('switches back to the cyan plate for the third turn', () => {
    expect(spinnerFrameOf(21)).toEqual({ glyph: '⠙', colour: 'brandCyan' })
  })
})

describe('Spinner', () => {
  beforeEach(() => {
    // Only the spinner's own timer is faked: React and Ink keep their real ones to draw.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  })

  afterEach(async () => {
    await cleanupSettled()
    vi.useRealTimers()
  })

  it('starts on the first glyph in the cyan plate', async () => {
    const { lastFrame } = await renderSettled(<Spinner />)

    expect(lastFrame()).toBe('\u001b[38;2;0;180;216m⠋\u001b[39m')
  })

  it('shows the next glyph every 80 ms', async () => {
    const { lastFrame } = await renderSettled(<Spinner />)

    await advanceTimers(79)
    expect(lastFrame()).toBe('\u001b[38;2;0;180;216m⠋\u001b[39m')

    await advanceTimers(1)
    expect(lastFrame()).toBe('\u001b[38;2;0;180;216m⠙\u001b[39m')
  })

  it('turns in the magenta plate after a full turn', async () => {
    const { lastFrame } = await renderSettled(<Spinner />)

    await advanceTimers(800)

    expect(lastFrame()).toBe('\u001b[38;2;255;45;135m⠋\u001b[39m')
  })

  it('draws no colour when the theme has colour off', async () => {
    const { lastFrame } = await renderSettled(
      <ThemeContext value={{ colour: false }}>
        <Spinner />
      </ThemeContext>,
    )

    await advanceTimers(880)

    expect(lastFrame()).toBe('⠙')
  })

  it('clears its timer when it unmounts', async () => {
    await renderSettled(<Spinner />)

    expect(vi.getTimerCount()).toBe(1)

    await cleanupSettled()

    expect(vi.getTimerCount()).toBe(0)
  })
})
