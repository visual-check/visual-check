import { Box, Text, useWindowSize } from 'ink'
import type { ReactNode } from 'react'
import { type Message, segmentsOfMessage } from '../init/segment.js'
import { ColouredText } from './coloured-text.js'
import { WrappedSegments } from './wrapped-segments.js'
import { WrappedText } from './wrapped-text.js'

/**
 * What `QuestionHeader` takes.
 */
interface QuestionHeaderProps {
  /**
   * The question: plain text, or segments, where a folder or name shows in the accent colour.
   */
  message: Message
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
 * How many columns `? ` takes before the question.
 */
const markerWidth = 2

/**
 * The top of every question: `?` in the accent colour and the question bold, with the folders and names in it in the
 * accent colour, then the hint dim, under the question, when there is one. A long question wraps to the terminal's
 * width, and a long hint too, each of its lines indented to match.
 */
export function QuestionHeader({ message, hint }: QuestionHeaderProps): ReactNode {
  const { columns } = useWindowSize()

  return (
    <>
      <Text>
        <ColouredText colour="accent">?</ColouredText>{' '}
        <Text bold>
          <WrappedSegments segments={segmentsOfMessage(message)} width={columns - markerWidth} />
        </Text>
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
