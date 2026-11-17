import { Box, Text } from 'ink'
import { Fragment, type ReactNode } from 'react'
import { ciLineOf, type NextSteps, previewIntroOf, type Segment, type WrittenList } from '../init/closing-message.js'
import type { InitResult } from '../init/run-init.js'
import { ColouredText } from './coloured-text.js'
import { MessageLine } from './message-line.js'
import { glyphs } from './theme.js'

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
 * What `WrittenLines` takes.
 */
interface WrittenLinesProps {
  /**
   * What `init` wrote, worded for the person.
   */
  written: WrittenList
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
 * Draws what `init` wrote, a check each, indented: the path of each file, then each change to the scripts.
 */
function WrittenLines({ written }: WrittenLinesProps): ReactNode {
  return [...written.files, ...written.scripts].map((line) => (
    <Box key={line} marginLeft={2}>
      <Box flexShrink={0} marginRight={1}>
        <ColouredText colour="accent">{glyphs.passed}</ColouredText>
      </Box>
      <Text>{line}</Text>
    </Box>
  ))
}

/**
 * Draws what to do next: the numbered steps, the snippet for each preview file in a dim box, then the docs page for CI.
 * Commands, paths and URLs take the accent colour.
 */
function NextStepsView({ nextSteps }: NextStepsViewProps): ReactNode {
  return (
    <>
      <Box marginTop={1}>
        <Text bold>Next</Text>
      </Box>
      {/* The steps never change, so where each one is tells it apart, and gives its number. */}
      {Array.from(nextSteps.steps.entries(), ([position, step]) => (
        <Box key={position}>
          <Box flexShrink={0}>
            <Text>{`  ${position + 1}  `}</Text>
          </Box>
          <Text>
            <SegmentsText segments={step} />
          </Text>
        </Box>
      ))}
      {nextSteps.previews.map(({ file, lines }) => (
        <Box flexDirection="column" key={file} marginTop={1}>
          <Text>
            <SegmentsText segments={previewIntroOf(file)} />
          </Text>
          <Box borderDimColor alignSelf="flex-start" borderStyle="round" paddingX={1}>
            <Text>{lines.join('\n')}</Text>
          </Box>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text>
          <SegmentsText segments={ciLineOf(nextSteps.ciUrl)} />
        </Text>
      </Box>
    </>
  )
}

/**
 * The end of a run. One that got to the end says visual-check is set up, lists what it wrote and the warnings, then
 * what to do next. One whose install failed lists what it wrote, then why it stopped. One that stopped before it wrote
 * shows its warnings and hints as notes, and why it stopped after `✕`.
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
      <WrittenLines written={summary.written} />
      <MessageLines messages={result.messages} />
      {summary.nextSteps === undefined ? null : <NextStepsView nextSteps={summary.nextSteps} />}
    </Box>
  )
}
