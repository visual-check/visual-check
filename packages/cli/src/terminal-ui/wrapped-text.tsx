import { useWindowSize } from 'ink'
import type { ReactNode } from 'react'
import { wrappedLinesOf } from './wrapped-lines.js'

/**
 * What `WrappedText` takes.
 */
interface WrappedTextProps {
  /**
   * The text to wrap.
   */
  text: string
  /**
   * How many columns come before the text on each of its lines, such as a margin or a glyph and a space.
   */
  indent: number
}

/**
 * Text broken into lines that fit the terminal after `indent` columns, so the terminal never wraps it itself. It wraps
 * again when the terminal is resized. It goes inside a `<Text>`, which styles it.
 */
export function WrappedText({ text, indent }: WrappedTextProps): ReactNode {
  const { columns } = useWindowSize()

  return wrappedLinesOf(text, columns - indent).join('\n')
}
