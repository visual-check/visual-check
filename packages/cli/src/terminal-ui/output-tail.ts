import { stripVTControlCharacters } from 'node:util'

/**
 * The end of a command's output, as the init view keeps it while the command runs.
 */
export interface OutputTail {
  /**
   * The last finished lines that hold more than spaces, oldest first, without ANSI escapes.
   */
  lines: readonly string[]
  /**
   * The line still being written, as it has arrived since its last carriage return, ANSI escapes and all. An escape
   * can arrive in two chunks, so it is stripped only once the line is shown or finished.
   */
  unfinished: string
}

/**
 * The tail of a command that has written nothing yet.
 */
export const emptyOutputTail: OutputTail = { lines: [], unfinished: '' }

/**
 * The most lines of a command's output the init view shows.
 */
const shownLineCount = 5

/**
 * What ends a line of output: a line feed, after a carriage return on Windows.
 */
const lineEnd = /\r?\n/

/**
 * Whether a line holds more than spaces.
 */
function hasText(line: string): boolean {
  return line.trim() !== ''
}

/**
 * Gives what a terminal shows of a line: the text after its last carriage return, which sends the cursor back to
 * draw the line again, as a progress bar does. A carriage return at the end, such as the first half of a Windows line
 * end, draws nothing yet, so the text before it stays.
 */
function shownTextOf(line: string): string {
  const drawn = line.endsWith('\r') ? line.slice(0, -1) : line

  return drawn.slice(drawn.lastIndexOf('\r') + 1)
}

/**
 * Adds a chunk of a command's output to its tail. The chunk can end partway through a line, which the next chunk
 * finishes. Of a line drawn again after a carriage return, only the last drawing is kept.
 */
export function outputTailOf(tail: OutputTail, chunk: string): OutputTail {
  const parts = `${tail.unfinished}${chunk}`.split(lineEnd)
  const unfinished = parts.pop() ?? ''
  const finished = parts.map((line) => stripVTControlCharacters(shownTextOf(line))).filter(hasText)
  const pendingReturn = unfinished.endsWith('\r') ? '\r' : ''

  return {
    lines: [...tail.lines, ...finished].slice(-shownLineCount),
    unfinished: `${shownTextOf(unfinished)}${pendingReturn}`,
  }
}

/**
 * Gives the lines of a tail to show: the last five that hold more than spaces, the unfinished one included, without
 * ANSI escapes.
 */
export function shownLinesOf(tail: OutputTail): string[] {
  const unfinished = stripVTControlCharacters(shownTextOf(tail.unfinished))
  const lines = hasText(unfinished) ? [...tail.lines, unfinished] : tail.lines

  return lines.slice(-shownLineCount)
}
