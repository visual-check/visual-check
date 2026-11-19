import { kindOf, type Segment, type SegmentKind, segmentOf, segmentTextOf } from '../init/segment.js'

/**
 * A character of a line of segments, with the kind of segment it belongs to.
 */
interface SegmentCharacter {
  /**
   * The character.
   */
  character: string
  /**
   * The kind of segment it belongs to.
   */
  kind: SegmentKind
}

/**
 * Gives how many columns text takes, counted in code points. The CLI doesn't depend on `string-width`, so a wide
 * character, such as a CJK one or an emoji, counts as one column: close enough for the text `init` shows.
 */
function widthOf(text: string): number {
  return [...text].length
}

/**
 * Cuts a word into pieces `width` columns wide, the last one shorter.
 */
function piecesOf(word: string, width: number): string[] {
  const characters = [...word]
  const pieces: string[] = []

  for (let start = 0; start < characters.length; start += width) {
    pieces.push(characters.slice(start, start + width).join(''))
  }

  return pieces
}

/**
 * Breaks text with no line break into lines at most `width` columns wide.
 */
function wordsWrappedOf(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''

  for (const word of text.split(' ').filter((part) => part !== '')) {
    const joined = line === '' ? word : `${line} ${word}`

    if (widthOf(joined) <= width) {
      line = joined
    } else {
      const pieces = piecesOf(word, width)

      lines.push(...(line === '' ? [] : [line]), ...pieces.slice(0, -1))
      line = pieces.at(-1) ?? ''
    }
  }

  return [...lines, line]
}

/**
 * Breaks one line of text into lines at most `width` columns wide, each starting with the spaces the line starts with.
 */
function wrappedLineOf(line: string, width: number): string[] {
  const text = line.replace(/^ +/, '')
  const indent = line.slice(0, line.length - text.length)

  return wordsWrappedOf(text, Math.max(1, width - widthOf(indent))).map((wrapped) => `${indent}${wrapped}`)
}

/**
 * Breaks text into lines at most `width` columns wide, so a terminal never wraps them itself, which keeps the space it
 * broke at. It breaks at spaces and drops them, and breaks a word wider than the room left where it reaches the edge.
 * A line break in the text starts a new line, and the spaces a line starts with start each line it wraps to, so an
 * indented list stays indented. A width below 1 counts as 1.
 */
export function wrappedLinesOf(text: string, width: number): string[] {
  const limit = Math.max(1, Math.floor(width))

  return text.split('\n').flatMap((line) => wrappedLineOf(line, limit))
}

/**
 * Lists the characters of segments in order, each with the kind of segment it belongs to.
 */
function charactersOf(segments: readonly Segment[]): SegmentCharacter[] {
  return segments.flatMap((segment) =>
    [...segmentTextOf(segment)].map((character) => ({ character, kind: kindOf(segment) })),
  )
}

/**
 * Joins characters into segments, each run of characters of one kind into one segment of that kind.
 */
function segmentsOf(characters: readonly SegmentCharacter[]): Segment[] {
  const segments: Segment[] = []

  for (const { character, kind } of characters) {
    const last = segments.at(-1)

    if (last !== undefined && kindOf(last) === kind) {
      segments[segments.length - 1] = segmentOf(kind, segmentTextOf(last) + character)
    } else {
      segments.push(segmentOf(kind, character))
    }
  }

  return segments
}

/**
 * Breaks a line of segments into lines at most `width` columns wide, as `wrappedLinesOf` breaks text, so a terminal
 * never wraps them itself. Each line keeps the segments on it as they were, a piece each when one is broken across
 * lines.
 */
export function wrappedSegmentLinesOf(segments: readonly Segment[], width: number): Segment[][] {
  const characters = charactersOf(segments)
  const lines: Segment[][] = []
  let cursor = 0

  for (const line of wrappedLinesOf(characters.map(({ character }) => character).join(''), width)) {
    const lineCharacters: SegmentCharacter[] = []

    for (const character of line) {
      // A wrapped line leaves out the spaces and line breaks it broke at, so they are skipped.
      while (character !== ' ' && (characters[cursor]?.character === ' ' || characters[cursor]?.character === '\n')) {
        cursor += 1
      }

      const original = characters[cursor]

      if (original?.character === character) {
        cursor += 1
      }

      lineCharacters.push({ character, kind: original?.kind ?? 'text' })
    }

    lines.push(segmentsOf(lineCharacters))
  }

  return lines
}
