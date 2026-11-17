import type { Segment } from '../init/closing-message.js'

/**
 * A character of a line of segments, with whether it belongs to a command, path or URL.
 */
interface SegmentCharacter {
  /**
   * The character.
   */
  character: string
  /**
   * Whether it belongs to a code segment.
   */
  code: boolean
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
 * Lists the characters of segments in order, each with whether it belongs to a code segment.
 */
function charactersOf(segments: readonly Segment[]): SegmentCharacter[] {
  return segments.flatMap((segment): SegmentCharacter[] =>
    typeof segment === 'string'
      ? [...segment].map((character) => ({ character, code: false }))
      : [...segment.code].map((character) => ({ character, code: true })),
  )
}

/**
 * Joins characters into segments: each run of plain characters into words, and each run of code characters into a
 * code segment.
 */
function segmentsOf(characters: readonly SegmentCharacter[]): Segment[] {
  const segments: Segment[] = []

  for (const { character, code } of characters) {
    const last = segments.at(-1)

    if (code && typeof last === 'object') {
      segments[segments.length - 1] = { code: last.code + character }
    } else if (!code && typeof last === 'string') {
      segments[segments.length - 1] = last + character
    } else {
      segments.push(code ? { code: character } : character)
    }
  }

  return segments
}

/**
 * Breaks a line of segments into lines at most `width` columns wide, as `wrappedLinesOf` breaks text, so a terminal
 * never wraps them itself. Each line keeps the commands, paths and URLs on it as code segments, a piece each when one
 * is broken across lines.
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

      lineCharacters.push({ character, code: original?.code ?? false })
    }

    lines.push(segmentsOf(lineCharacters))
  }

  return lines
}
