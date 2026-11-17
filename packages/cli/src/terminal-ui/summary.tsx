import { Box, Text } from 'ink'
import { Fragment, type ReactNode } from 'react'
import {
  ciLineOf,
  commandColumnWidthOf,
  modesLineOf,
  type NextStepRow,
  type NextSteps,
  type Segment,
} from '../init/closing-message.js'
import type { InitResult } from '../init/run-init.js'
import { ColouredText } from './coloured-text.js'
import { MessageLine } from './message-line.js'
import { glyphs } from './theme.js'

/**
 * How many columns a step's number takes, with the spaces around it.
 */
const numberColumnWidth = 5

/**
 * What `Summary` takes.
 */
interface SummaryProps {
  /**
   * What the run gave.
   */
  result: InitResult
}

/**
 * What `MessageLines` takes.
 */
interface MessageLinesProps {
  /**
   * The result's messages, in order.
   */
  messages: readonly string[]
}

/**
 * What `ReplacedLine` takes.
 */
interface ReplacedLineProps {
  /**
   * The line that names the scripts `init` replaced, when it replaced any.
   */
  text: string | undefined
}

/**
 * What `NextStepsView` takes.
 */
interface NextStepsViewProps {
  /**
   * What to do next.
   */
  nextSteps: NextSteps
}

/**
 * What `StepRow` takes.
 */
interface StepRowProps {
  /**
   * The row to draw.
   */
  row: NextStepRow
  /**
   * What the number column shows: the step's number on the step's first row, nothing on the others.
   */
  numberLabel: string
  /**
   * How many columns the commands take, the gap after the longest included.
   */
  commandWidth: number
}

/**
 * What `SegmentsText` takes.
 */
interface SegmentsTextProps {
  /**
   * The segments to draw, in order.
   */
  segments: readonly Segment[]
}

/**
 * Draws a line of segments inside a `<Text>`: the words as they are, and each command, path or URL in the accent
 * colour.
 */
function SegmentsText({ segments }: SegmentsTextProps): ReactNode {
  // The segments never change, so where each one is tells it apart.
  return Array.from(segments.entries(), ([position, segment]) =>
    typeof segment === 'string' ? (
      <Fragment key={position}>{segment}</Fragment>
    ) : (
      <ColouredText colour="accent" key={position}>
        {segment.code}
      </ColouredText>
    ),
  )
}

/**
 * Draws each of the result's messages: a warning or a hint as a note, and anything else as a problem.
 */
function MessageLines({ messages }: MessageLinesProps): ReactNode {
  // The messages never change, so where each one is tells it apart.
  return Array.from(messages.entries(), ([position, text]) => <MessageLine key={position} text={text} />)
}

/**
 * Draws the line that names the scripts `init` replaced, dim and indented, or nothing when it replaced none.
 */
function ReplacedLine({ text }: ReplacedLineProps): ReactNode {
  if (text === undefined) {
    return null
  }

  return (
    <Box marginLeft={2}>
      <Text dimColor>{text}</Text>
    </Box>
  )
}

/**
 * Draws a row of a step: the step's number on its first row, the command in the accent colour, padded so every text
 * starts in the same column, then the text, which wraps under itself. A row without a command starts its text where
 * the commands start.
 */
function StepRow({ row, numberLabel, commandWidth }: StepRowProps): ReactNode {
  return (
    <Box>
      <Box flexShrink={0} width={numberColumnWidth}>
        <Text>{numberLabel}</Text>
      </Box>
      {row.command === undefined ? null : (
        <Box flexShrink={0} width={commandWidth}>
          <ColouredText colour="accent">{row.command}</ColouredText>
        </Box>
      )}
      <Text>
        <SegmentsText segments={row.text} />
      </Text>
    </Box>
  )
}

/**
 * Draws what to do next: the numbered steps, each command in a column of its own, then, dim, where options for every
 * story go and the docs page for CI. Commands, paths and URLs take the accent colour.
 */
function NextStepsView({ nextSteps }: NextStepsViewProps): ReactNode {
  const commandWidth = commandColumnWidthOf(nextSteps.steps)

  return (
    <>
      <Box marginTop={1}>
        <Text bold>Next</Text>
      </Box>
      {/* The steps and their rows never change, so where each one is tells it apart, and gives the step its number. */}
      {Array.from(nextSteps.steps.entries()).flatMap(([position, rows]) =>
        Array.from(rows.entries(), ([rowPosition, row]) => (
          <StepRow
            commandWidth={commandWidth}
            key={`${position}-${rowPosition}`}
            numberLabel={rowPosition === 0 ? `  ${position + 1}` : ''}
            row={row}
          />
        )),
      )}
      <Box flexDirection="column" marginTop={1}>
        {nextSteps.modesFiles.length === 0 ? null : (
          <Text dimColor>
            <SegmentsText segments={modesLineOf(nextSteps.modesFiles)} />
          </Text>
        )}
        <Text dimColor>
          <SegmentsText segments={ciLineOf(nextSteps.ciUrl)} />
        </Text>
      </Box>
    </>
  )
}

/**
 * The end of a run. One that got to the end says visual-check is set up, names the scripts it replaced, shows the
 * warnings, then what to do next. One whose install failed names the scripts it replaced, then why it stopped. One
 * that stopped before it wrote shows its warnings and hints as notes, and why it stopped after `✕`.
 */
export function Summary({ result }: SummaryProps): ReactNode {
  const { summary } = result

  if (summary === undefined) {
    return (
      <Box flexDirection="column">
        <MessageLines messages={result.messages} />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {summary.nextSteps === undefined ? null : (
        <ColouredText bold colour="accent">{`${glyphs.passed} visual-check is set up`}</ColouredText>
      )}
      <ReplacedLine text={summary.replacedLine} />
      <MessageLines messages={result.messages} />
      {summary.nextSteps === undefined ? null : <NextStepsView nextSteps={summary.nextSteps} />}
    </Box>
  )
}
