import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { ColouredText } from './coloured-text.js'

/**
 * What `QuestionHeader` takes.
 */
interface QuestionHeaderProps {
  /**
   * The question.
   */
  message: string
  /**
   * A line that helps answer it.
   */
  hint?: string | undefined
}

/**
 * The top of every question: `?` in the accent colour and the question bold, then the hint dim, under the question,
 * when there is one.
 */
export function QuestionHeader({ message, hint }: QuestionHeaderProps): ReactNode {
  return (
    <>
      <Text>
        <ColouredText colour="accent">?</ColouredText> <Text bold>{message}</Text>
      </Text>
      {hint === undefined ? null : (
        <Box marginLeft={2}>
          <Text dimColor>{hint}</Text>
        </Box>
      )}
    </>
  )
}
