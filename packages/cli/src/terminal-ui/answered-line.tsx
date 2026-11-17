import { Text } from 'ink'
import type { ReactNode } from 'react'
import { ColouredText } from './coloured-text.js'
import { glyphs } from './theme.js'

/**
 * What `AnsweredLine` takes.
 */
interface AnsweredLineProps {
  /**
   * The question that was asked.
   */
  message: string
  /**
   * The answer, as the person sees it.
   */
  answer: string
}

/**
 * What a question collapses to once it is answered: a check, the question dim and the answer in the accent colour.
 */
export function AnsweredLine({ message, answer }: AnsweredLineProps): ReactNode {
  return (
    <Text>
      <ColouredText colour="accent">{glyphs.passed}</ColouredText> <Text dimColor>{message}</Text>{' '}
      <ColouredText colour="accent">{answer}</ColouredText>
    </Text>
  )
}
