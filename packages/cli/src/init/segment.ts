/**
 * A piece of a line `init` shows: plain words, a command, path, URL or folder, which the terminal UI picks out in the
 * accent colour, or an aside, which it draws dim. Plain text joins them as they are.
 *
 * @public
 */
export type Segment =
  | string
  | {
      /**
       * The command, path, URL or folder.
       */
      code: string
    }
  | {
      /**
       * The words that matter less than the ones around them, such as a path after the folder it names.
       */
      aside: string
    }

/**
 * A note or a problem `init` shows: plain text, or a line of segments, which plain text joins.
 *
 * @public
 */
export type Message = string | readonly Segment[]

/**
 * What kind of segment one is: plain words, a code segment or an aside.
 *
 * @public
 */
export type SegmentKind = 'text' | 'code' | 'aside'

/**
 * Gives the kind of a segment.
 *
 * @public
 */
export function kindOf(segment: Segment): SegmentKind {
  if (typeof segment === 'string') {
    return 'text'
  }

  return 'code' in segment ? 'code' : 'aside'
}

/**
 * Builds a segment of `kind` with `words`.
 *
 * @public
 */
export function segmentOf(kind: SegmentKind, words: string): Segment {
  switch (kind) {
    case 'text':
      return words
    case 'code':
      return { code: words }
    case 'aside':
      return { aside: words }
  }
}

/**
 * Gives the words of a segment.
 *
 * @public
 */
export function segmentTextOf(segment: Segment): string {
  if (typeof segment === 'string') {
    return segment
  }

  return 'code' in segment ? segment.code : segment.aside
}

/**
 * Gives the segments of a message: plain text as one segment.
 *
 * @public
 */
export function segmentsOfMessage(message: Message): readonly Segment[] {
  return typeof message === 'string' ? [message] : message
}

/**
 * Joins a message into plain text.
 *
 * @public
 */
export function textOf(message: Message): string {
  return segmentsOfMessage(message).map(segmentTextOf).join('')
}
