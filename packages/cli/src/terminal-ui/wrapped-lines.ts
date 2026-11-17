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
