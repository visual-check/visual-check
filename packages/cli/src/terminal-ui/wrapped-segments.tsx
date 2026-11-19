import { Text } from 'ink'
import { Fragment, type ReactNode } from 'react'
import { kindOf, type Segment, segmentTextOf } from '../init/segment.js'
import { ColouredText } from './coloured-text.js'
import { wrappedSegmentLinesOf } from './wrapped-lines.js'

/**
 * What `SegmentsText` takes.
 */
interface SegmentsTextProps {
  /**
   * The segments to draw, in order.
   */
  segments: readonly Segment[]
  /**
   * Whether the words are dim. A command, path, URL or folder keeps the accent colour either way.
   */
  dim: boolean
}

/**
 * What `SegmentText` takes.
 */
interface SegmentTextProps {
  /**
   * The segment to draw.
   */
  segment: Segment
  /**
   * Whether words are dim. A command, path, URL or folder keeps the accent colour either way.
   */
  dim: boolean
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
  /**
   * Whether the words are dim, as a hint's are. A command, path, URL or folder keeps the accent colour, not dim, which
   * a dim `<Text>` around it would make it. `false` by default.
   */
  dim?: boolean
}

/**
 * Draws one segment inside a `<Text>`: words as they are, or dim, a command, path, URL or folder in the accent colour,
 * and an aside dim.
 */
function SegmentText({ segment, dim }: SegmentTextProps): ReactNode {
  const words = segmentTextOf(segment)

  switch (kindOf(segment)) {
    case 'text':
      return dim ? <Text dimColor>{words}</Text> : words
    case 'code':
      return <ColouredText colour="accent">{words}</ColouredText>
    case 'aside':
      return <Text dimColor>{words}</Text>
  }
}

/**
 * Draws a line of segments inside a `<Text>`, each as `SegmentText` draws it.
 */
function SegmentsText({ segments, dim }: SegmentsTextProps): ReactNode {
  // The segments never change, so where each one is tells it apart.
  return Array.from(segments.entries(), ([position, segment]) => (
    <SegmentText dim={dim} key={position} segment={segment} />
  ))
}

/**
 * Draws a line of segments inside a `<Text>`, broken into lines that fit `width` columns, so Ink never wraps it itself
 * and no line starts with the space it broke at. Each segment keeps its style.
 */
export function WrappedSegments({ segments, width, dim = false }: WrappedSegmentsProps): ReactNode {
  // The lines never change, so where each one is tells it apart.
  return Array.from(wrappedSegmentLinesOf(segments, width).entries(), ([position, line]) => (
    <Fragment key={position}>
      {position === 0 ? '' : '\n'}
      <SegmentsText dim={dim} segments={line} />
    </Fragment>
  ))
}
