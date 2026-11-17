import { createContext } from 'react'

/**
 * The colours the terminal UI draws with. The brand plates are fixed hex, for the mark and fills only, never body text.
 * The semantic colours are ANSI names, so they follow the person's terminal theme.
 */
export const colours = {
  /**
   * The cyan plate: the baseline.
   */
  brandCyan: '#00b4d8',
  /**
   * The magenta plate: the snapshot.
   */
  brandMagenta: '#ff2d87',
  /**
   * What is selected, passed or a link.
   */
  accent: 'cyan',
  /**
   * What changed.
   */
  change: 'magenta',
  /**
   * What needs a look but did not fail.
   */
  caution: 'yellow',
  /**
   * What failed or is wrong.
   */
  danger: 'red',
} as const

/**
 * The name of a colour in the theme.
 */
export type Colour = keyof typeof colours

/**
 * The glyphs the terminal UI draws with. A status glyph always comes with a word.
 */
export const glyphs = {
  /**
   * Passed, done or answered.
   */
  passed: '✓',
  /**
   * Failed or wrong.
   */
  failed: '✕',
  /**
   * A warning.
   */
  caution: '▲',
  /**
   * Not started yet.
   */
  pending: '○',
  /**
   * Where the answer goes.
   */
  pointer: '›',
  /**
   * The highlighted choice.
   */
  selected: '❯',
  /**
   * The side of a yes or no question that is chosen.
   */
  chosen: '●',
  /**
   * The side of a yes or no question that is not chosen.
   */
  unchosen: '○',
  /**
   * A hint, or what separates a label from its hint.
   */
  hint: '·',
} as const

/**
 * How the terminal UI draws.
 */
export interface Theme {
  /**
   * Whether text and glyphs take colours. Without colour, glyphs and words still carry the meaning.
   */
  colour: boolean
}

/**
 * The theme every component draws with. Colour is on unless a provider turns it off.
 */
export const ThemeContext = createContext<Theme>({ colour: true })

/**
 * Whether the terminal UI may use colour in an environment: not when `NO_COLOR` is set and not empty, as no-color.org
 * asks, nor when `FORCE_COLOR` is `0`.
 */
export function colourEnabledOf(environment: NodeJS.ProcessEnv): boolean {
  const noColour = environment.NO_COLOR !== undefined && environment.NO_COLOR !== ''

  return !noColour && environment.FORCE_COLOR !== '0'
}
