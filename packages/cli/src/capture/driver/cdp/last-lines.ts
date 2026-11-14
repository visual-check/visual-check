import type { Readable } from 'node:stream'

/**
 * How many characters a line keeps, from its end, so a line that never ends can't grow without limit.
 */
const lineLengthLimit = 64 * 1024

/**
 * Drops one carriage return from the end of a line, so CRLF output reads like LF output.
 */
function withoutCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/**
 * Reads a text stream to its end from now on and keeps only its last `limit` lines, each cut to its last 64 Ki
 * characters. Reading it all keeps the writer from stalling on a full pipe. A read error ends the reading and keeps
 * the lines read so far.
 *
 * When `keepLine` is given, the last complete line it accepts is kept even after it scrolls out of the last lines: the
 * lines then start with it, followed by the last `limit - 1` lines, so there are still at most `limit`.
 *
 * Returns the function that gives the kept lines, oldest first, a partial last line included.
 */
export function keepLastLines(stream: Readable, limit: number, keepLine?: (line: string) => boolean): () => string[] {
  const lines: string[] = []
  let partial = ''
  let completed = 0
  let kept: { line: string; index: number } | undefined

  stream.setEncoding('utf8')
  stream.on('error', () => undefined)
  stream.on('data', (chunk: string) => {
    const parts = `${partial}${chunk}`.split('\n')

    partial = (parts.pop() ?? '').slice(-lineLengthLimit)

    const complete = parts.map((line) => withoutCarriageReturn(line).slice(-lineLengthLimit))

    complete.forEach((line, offset) => {
      if (keepLine?.(line) === true) {
        kept = { line, index: completed + offset }
      }
    })
    completed += complete.length
    lines.push(...complete.slice(-limit))
    lines.splice(0, lines.length - limit)
  })

  return () => {
    const window = (partial === '' ? lines : [...lines, withoutCarriageReturn(partial)]).slice(-limit)
    const windowStart = completed + (partial === '' ? 0 : 1) - window.length

    return kept === undefined || kept.index >= windowStart
      ? window
      : [kept.line, ...window.slice(window.length - Math.min(window.length, limit - 1))]
  }
}
