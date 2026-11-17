import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProgressBar, progressCellsOf } from './progress-bar.js'
import { cleanupSettled, plainFrameOf, renderSettled } from './terminal.fixture.js'
import { ThemeContext } from './theme.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(cleanupSettled)

describe('progressCellsOf', () => {
  it('fills no cells when nothing is done', () => {
    expect(progressCellsOf(0, 4, 20)).toEqual({ filled: 0, empty: 20 })
  })

  it('fills the share of the cells that is done', () => {
    expect(progressCellsOf(1, 4, 20)).toEqual({ filled: 5, empty: 15 })
  })

  it('rounds to the nearest cell', () => {
    expect(progressCellsOf(1, 3, 20)).toEqual({ filled: 7, empty: 13 })
    expect(progressCellsOf(2, 3, 20)).toEqual({ filled: 13, empty: 7 })
  })

  it('fills every cell when everything is done', () => {
    expect(progressCellsOf(4, 4, 20)).toEqual({ filled: 20, empty: 0 })
  })

  it('fills no cells when there are no steps', () => {
    expect(progressCellsOf(0, 0, 20)).toEqual({ filled: 0, empty: 20 })
  })

  it('clamps more done than there are steps to full', () => {
    expect(progressCellsOf(5, 4, 20)).toEqual({ filled: 20, empty: 0 })
  })

  it('clamps less than nothing done to empty', () => {
    expect(progressCellsOf(-1, 4, 20)).toEqual({ filled: 0, empty: 20 })
  })
})

describe('ProgressBar', () => {
  it('draws the filled cells, the empty cells and the count', async () => {
    const { lastFrame } = await renderSettled(<ProgressBar done={1} total={4} />)

    expect(plainFrameOf(lastFrame())).toBe('━━━━━─────────────── 1/4')
  })

  it('takes a width', async () => {
    const { lastFrame } = await renderSettled(<ProgressBar done={3} total={4} width={8} />)

    expect(plainFrameOf(lastFrame())).toBe('━━━━━━── 3/4')
  })

  it('draws the filled cells in the accent colour and the empty cells dim', async () => {
    const { lastFrame } = await renderSettled(<ProgressBar done={1} total={2} width={4} />)

    expect(lastFrame()).toBe('\u001b[36m━━\u001b[39m\u001b[2m──\u001b[22m 1/2')
  })

  it('draws the filled cells without colour when the theme has colour off', async () => {
    const { lastFrame } = await renderSettled(
      <ThemeContext value={{ colour: false }}>
        <ProgressBar done={1} total={2} width={4} />
      </ThemeContext>,
    )

    expect(lastFrame()).toBe('━━\u001b[2m──\u001b[22m 1/2')
  })
})
