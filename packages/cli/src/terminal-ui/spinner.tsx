import { type ReactNode, useEffect, useState } from 'react'
import { ColouredText } from './coloured-text.js'
import type { Colour } from './theme.js'

/**
 * The spinner's frames, one full turn.
 */
const spinnerGlyphs = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * How long each frame shows.
 */
const frameMilliseconds = 80

/**
 * One frame of the spinner.
 */
interface SpinnerFrame {
  /**
   * The glyph the frame shows.
   */
  glyph: string
  /**
   * The plate the frame is drawn in.
   */
  colour: Colour
}

/**
 * The frame the spinner shows after `tick` ticks. Each full turn switches plate: cyan first, then magenta.
 */
export function spinnerFrameOf(tick: number): SpinnerFrame {
  const turn = Math.floor(tick / spinnerGlyphs.length)

  return {
    glyph: spinnerGlyphs[tick % spinnerGlyphs.length] ?? '',
    colour: turn % 2 === 0 ? 'brandCyan' : 'brandMagenta',
  }
}

/**
 * The one thing that moves: a spinner that turns while work runs, a frame every 80 ms, and swaps between the cyan and
 * magenta plates each full turn.
 */
export function Spinner(): ReactNode {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((previous) => previous + 1)
    }, frameMilliseconds)

    return () => {
      clearInterval(timer)
    }
  }, [])

  const frame = spinnerFrameOf(tick)

  return <ColouredText colour={frame.colour}>{frame.glyph}</ColouredText>
}
