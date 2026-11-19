import { Box, Text, useWindowSize } from 'ink'
import type { ReactNode } from 'react'
import { type Message, type Segment, segmentsOfMessage } from '../init/segment.js'
import { ColouredText } from './coloured-text.js'
import { glyphs } from './theme.js'
import { WrappedSegments } from './wrapped-segments.js'

/**
 * What a note that is a warning starts with.
 */
const warningPrefix = 'Warning: '

/**
 * What a note that is a hint starts with.
 */
const hintPrefix = 'hint: '

/**
 * How far a note's text starts after its glyph: the glyph and a space.
 */
const glyphIndent = 2

/**
 * What `NoteLine` takes.
 */
interface NoteLineProps {
  /**
   * The note, such as `Warning: …`, `hint: …` or plain text, or a line of segments that starts so.
   */
  text: Message
}

/**
 * What `MessageLine` takes.
 */
interface MessageLineProps {
  /**
   * The message, its lines kept.
   */
  text: Message
}

/**
 * A message told apart by its prefix: a warning, a hint, or plain, with the segments after the prefix.
 */
interface ParsedMessage {
  /**
   * Whether it is a warning, a hint or neither.
   */
  kind: 'warning' | 'hint' | 'plain'
  /**
   * Its segments, after the prefix.
   */
  segments: readonly Segment[]
}

/**
 * What `ParsedNote` and `ProblemLine` take.
 */
interface ParsedProps {
  /**
   * The message, told apart by its prefix.
   */
  message: ParsedMessage
}

/**
 * What `GlyphNote` takes.
 */
interface GlyphNoteProps {
  /**
   * The glyph before the note, already styled.
   */
  glyph: ReactNode
  /**
   * The note after its glyph, already styled.
   */
  children: ReactNode
}

/**
 * Tells a message apart by its prefix, `Warning: ` or `hint: `, which is plain words, so it starts the first segment.
 */
function parsedOf(message: Message): ParsedMessage {
  const [first, ...others] = segmentsOfMessage(message)

  for (const [kind, prefix] of [
    ['warning', warningPrefix],
    ['hint', hintPrefix],
  ] as const) {
    if (typeof first === 'string' && first.startsWith(prefix)) {
      return { kind, segments: [first.slice(prefix.length), ...others] }
    }
  }

  return { kind: 'plain', segments: segmentsOfMessage(message) }
}

/**
 * A note after its glyph. A long note wraps under its own first letter, not under the glyph.
 */
function GlyphNote({ glyph, children }: GlyphNoteProps): ReactNode {
  return (
    <Box>
      <Box flexShrink={0} marginRight={1}>
        {glyph}
      </Box>
      {children}
    </Box>
  )
}

/**
 * Draws a note told apart by its prefix. A warning takes `▲` and the caution colour, a hint takes `·` and is dim, and
 * any other note is plain. A folder or path it names takes the accent colour, in a dim hint too. A long note wraps to
 * the terminal's width: a warning or a hint under its own first letter, not under the glyph.
 */
function ParsedNote({ message: { kind, segments } }: ParsedProps): ReactNode {
  const { columns } = useWindowSize()

  switch (kind) {
    case 'warning':
      return (
        <GlyphNote glyph={<ColouredText colour="caution">{glyphs.caution}</ColouredText>}>
          <ColouredText colour="caution">
            <WrappedSegments segments={segments} width={columns - glyphIndent} />
          </ColouredText>
        </GlyphNote>
      )
    case 'hint':
      return (
        <GlyphNote glyph={<Text dimColor>{glyphs.hint}</Text>}>
          <Text>
            <WrappedSegments dim segments={segments} width={columns - glyphIndent} />
          </Text>
        </GlyphNote>
      )
    case 'plain':
      return (
        <Text>
          <WrappedSegments segments={segments} width={columns} />
        </Text>
      )
  }
}

/**
 * A line of text that `init` shows between its questions, drawn as `ParsedNote` draws it.
 */
export function NoteLine({ text }: NoteLineProps): ReactNode {
  return <ParsedNote message={parsedOf(text)} />
}

/**
 * A problem that stopped `init`, after `✕`, all in the danger colour but what it names, which takes the accent colour.
 * A long one wraps to the terminal's width under its own first letter, not under the glyph, and so does each line
 * after its first.
 */
function ProblemLine({ message }: ParsedProps): ReactNode {
  const { columns } = useWindowSize()

  return (
    <GlyphNote glyph={<ColouredText colour="danger">{glyphs.failed}</ColouredText>}>
      <ColouredText colour="danger">
        <WrappedSegments segments={message.segments} width={columns - glyphIndent} />
      </ColouredText>
    </GlyphNote>
  )
}

/**
 * One of the messages a run of `init` ends with: a warning or a hint as a note, and anything else as a problem that
 * stopped it. A message that spans lines stays one note or problem.
 */
export function MessageLine({ text }: MessageLineProps): ReactNode {
  const message = parsedOf(text)

  return message.kind === 'plain' ? <ProblemLine message={message} /> : <ParsedNote message={message} />
}
