import { Text } from 'ink'
import type { ReactNode } from 'react'
import { ColouredText } from './coloured-text.js'
import { glyphs } from './theme.js'

/**
 * What `ChoiceLine` takes.
 */
interface ChoiceLineProps {
  /**
   * What the person sees.
   */
  label: string
  /**
   * Whether the choice is the highlighted one.
   */
  highlighted: boolean
  /**
   * A glyph that comes before the label, such as a checklist's tick.
   */
  mark?: string | undefined
  /**
   * A few words after the label that help pick it.
   */
  hint?: string | undefined
}

/**
 * One choice of a list: `❯` and the line in the accent colour when highlighted, indented to match when not. The mark,
 * if any, comes before the label, and the hint, dim, after it.
 */
export function ChoiceLine({ label, highlighted, mark, hint }: ChoiceLineProps): ReactNode {
  const line = mark === undefined ? label : `${mark} ${label}`

  return (
    <Text>
      {highlighted ? <ColouredText colour="accent">{`${glyphs.selected} ${line}`}</ColouredText> : `  ${line}`}
      {hint === undefined ? null : <Text dimColor>{` ${glyphs.hint} ${hint}`}</Text>}
    </Text>
  )
}
