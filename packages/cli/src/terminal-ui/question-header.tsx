import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { ColouredText } from './coloured-text.js'
import { WrappedText } from './wrapped-text.js'

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
 * How far the hint is indented, so it starts under the question.
 */
const hintIndent = 2

/**
 * The top of every question: `?` in the accent colour and the question bold, then the hint dim, under the question,
 * when there is one. A long hint wraps to the terminal's width, each line indented to match.
 */
export function QuestionHeader({ message, hint }: QuestionHeaderProps): ReactNode {
  return (
    <>
      <Text>
        <ColouredText colour="accent">?</ColouredText> <Text bold>{message}</Text>
      </Text>
      {hint === undefined ? null : (
        <Box marginLeft={hintIndent}>
          <Text dimColor>
            <WrappedText indent={hintIndent} text={hint} />
          </Text>
        </Box>
      )}
    </>
  )
}
