import { Box, Text, useWindowSize } from 'ink'
import { Fragment, type ReactNode } from 'react'
import {
  ciLineOf,
  commandColumnWidthOf,
  fitsCommandColumn,
  modesLineOf,
  type NextStepRow,
  type NextSteps,
  type Segment,
} from '../init/closing-message.js'
import type { InitResult } from '../init/run-init.js'
import { ColouredText } from './coloured-text.js'
import { MessageLine } from './message-line.js'
import { glyphs } from './theme.js'
import { wrappedSegmentLinesOf } from './wrapped-lines.js'
import { WrappedText } from './wrapped-text.js'

/**
 * How many columns a step's number takes, with the spaces around it.
 */
const numberColumnWidth = 5

/**
 * How far the line that names the replaced scripts is indented.
 */
const replacedLineIndent = 2

/**
 * The fewest columns a step's text needs beside the commands' column. In a terminal with less room, every command
 * takes a line of its own, with its text under it.
 */
const minimumTextWidth = 20

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
   * How many columns the commands take, the gap after the longest included, or 0 when every command takes a line of
   * its own.
   */
  commandWidth: number
  /**
   * How wide the terminal is.
   */
  columns: number
}

/**
 * What `StepNumber` takes.
 */
interface StepNumberProps {
  /**
   * What the number column shows: the step's number on the step's first row, nothing on the others.
   */
  label: string
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
 * What `WrappedSegments` takes.
 */
interface WrappedSegmentsProps {
  /**
   * The segments to draw, in order.
   */
  segments: readonly Segment[]
  /**
   * How many columns the lines may take.
   */
  width: number
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
 * Draws a line of segments inside a `<Text>`, broken into lines that fit `width` columns, so Ink never wraps it itself
 * and no line starts with the space it broke at. Each command, path or URL takes the accent colour.
 */
function WrappedSegments({ segments, width }: WrappedSegmentsProps): ReactNode {
  // The lines never change, so where each one is tells it apart.
  return Array.from(wrappedSegmentLinesOf(segments, width).entries(), ([position, line]) => (
    <Fragment key={position}>
      {position === 0 ? '' : '\n'}
      <SegmentsText segments={line} />
    </Fragment>
  ))
}

/**
 * Draws each of the result's messages: a warning or a hint as a note, and anything else as a problem.
 */
function MessageLines({ messages }: MessageLinesProps): ReactNode {
  // The messages never change, so where each one is tells it apart.
  return Array.from(messages.entries(), ([position, text]) => <MessageLine key={position} text={text} />)
}

/**
 * Draws the line that names the scripts `init` replaced, dim and indented, or nothing when it replaced none. A long
 * one wraps under its own first letter.
 */
function ReplacedLine({ text }: ReplacedLineProps): ReactNode {
  if (text === undefined) {
    return null
  }

  return (
    <Box marginLeft={replacedLineIndent}>
      <Text dimColor>
        <WrappedText indent={replacedLineIndent} text={text} />
      </Text>
    </Box>
  )
}

/**
 * Draws the number column of a step's row.
 */
function StepNumber({ label }: StepNumberProps): ReactNode {
  return (
    <Box flexShrink={0} width={numberColumnWidth}>
      <Text>{label}</Text>
    </Box>
  )
}

/**
 * Draws a row of a step: the step's number on its first row, the command in the accent colour, padded so every text
 * starts in the same column, then the text, which wraps under itself. A row without a command starts its text where
 * the commands start. A command too long for the column takes a line of its own, and its text starts on the next line
 * where the other rows' text starts.
 */
function StepRow({ row, numberLabel, commandWidth, columns }: StepRowProps): ReactNode {
  const { command } = row

  if (command !== undefined && !fitsCommandColumn(command, commandWidth)) {
    return (
      <Box flexDirection="column">
        <Box>
          <StepNumber label={numberLabel} />
          <Text>
            <WrappedSegments segments={[{ code: command }]} width={columns - numberColumnWidth} />
          </Text>
        </Box>
        <Box marginLeft={numberColumnWidth + commandWidth}>
          <Text>
            <WrappedSegments segments={row.text} width={columns - numberColumnWidth - commandWidth} />
          </Text>
        </Box>
      </Box>
    )
  }

  const textColumn = numberColumnWidth + (command === undefined ? 0 : commandWidth)

  return (
    <Box>
      <StepNumber label={numberLabel} />
      {command === undefined ? null : (
        <Box flexShrink={0} width={commandWidth}>
          <ColouredText colour="accent">{command}</ColouredText>
        </Box>
      )}
      <Text>
        <WrappedSegments segments={row.text} width={columns - textColumn} />
      </Text>
    </Box>
  )
}

/**
 * Draws what to do next: the numbered steps, each command in a column of its own, then, dim, where options for every
 * story go and the docs page for CI. Commands, paths and URLs take the accent colour. In a terminal too narrow for the
 * commands' column and 20 columns of text beside it, every command takes a line of its own, with its text under it.
 */
function NextStepsView({ nextSteps }: NextStepsViewProps): ReactNode {
  const { columns } = useWindowSize()
  const columnWidth = commandColumnWidthOf(nextSteps.steps)
  const commandWidth = numberColumnWidth + columnWidth + minimumTextWidth <= columns ? columnWidth : 0

  return (
    <>
      <Box marginTop={1}>
        <Text bold>Next</Text>
      </Box>
      {/* The steps and their rows never change, so where each one is tells it apart, and gives the step its number. */}
      {Array.from(nextSteps.steps.entries()).flatMap(([position, rows]) =>
        Array.from(rows.entries(), ([rowPosition, row]) => (
          <StepRow
            columns={columns}
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
            <WrappedSegments segments={modesLineOf(nextSteps.modesFiles)} width={columns} />
          </Text>
        )}
        <Text dimColor>
          <WrappedSegments segments={ciLineOf(nextSteps.ciUrl)} width={columns} />
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
