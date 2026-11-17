import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { ColouredText } from './coloured-text.js'
import { glyphs } from './theme.js'
import { WrappedText } from './wrapped-text.js'

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
   * The note, such as `Warning: …`, `hint: …` or plain text.
   */
  text: string
}

/**
 * What `ProblemLine` takes.
 */
interface ProblemLineProps {
  /**
   * The problem, its lines kept.
   */
  text: string
}

/**
 * What `MessageLine` takes.
 */
interface MessageLineProps {
  /**
   * The message, its lines kept.
   */
  text: string
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
 * A line of text that `init` shows between its questions. A warning takes `▲` and the caution colour, a hint takes
 * `·` and is dim, and any other note is plain. A long note wraps to the terminal's width: a warning or a hint under
 * its own first letter, not under the glyph.
 */
export function NoteLine({ text }: NoteLineProps): ReactNode {
  if (text.startsWith(warningPrefix)) {
    return (
      <GlyphNote glyph={<ColouredText colour="caution">{glyphs.caution}</ColouredText>}>
        <ColouredText colour="caution">
          <WrappedText indent={glyphIndent} text={text.slice(warningPrefix.length)} />
        </ColouredText>
      </GlyphNote>
    )
  }

  if (text.startsWith(hintPrefix)) {
    return (
      <GlyphNote glyph={<Text dimColor>{glyphs.hint}</Text>}>
        <Text dimColor>
          <WrappedText indent={glyphIndent} text={text.slice(hintPrefix.length)} />
        </Text>
      </GlyphNote>
    )
  }

  return (
    <Text>
      <WrappedText indent={0} text={text} />
    </Text>
  )
}

/**
 * A problem that stopped `init`, after `✕`, all in the danger colour. A long one wraps to the terminal's width under
 * its own first letter, not under the glyph, and so does each line after its first.
 */
function ProblemLine({ text }: ProblemLineProps): ReactNode {
  return (
    <GlyphNote glyph={<ColouredText colour="danger">{glyphs.failed}</ColouredText>}>
      <ColouredText colour="danger">
        <WrappedText indent={glyphIndent} text={text} />
      </ColouredText>
    </GlyphNote>
  )
}

/**
 * One of the messages a run of `init` ends with: a warning or a hint as a note, and anything else as a problem that
 * stopped it. A message that spans lines stays one note or problem.
 */
export function MessageLine({ text }: MessageLineProps): ReactNode {
  if (text.startsWith(warningPrefix) || text.startsWith(hintPrefix)) {
    return <NoteLine text={text} />
  }

  return <ProblemLine text={text} />
}
