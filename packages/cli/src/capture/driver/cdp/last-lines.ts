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
 * Returns the function that gives the kept lines, oldest first, a partial last line included.
 */
export function keepLastLines(stream: Readable, limit: number): () => string[] {
  const lines: string[] = []
  let partial = ''

  stream.setEncoding('utf8')
  stream.on('error', () => undefined)
  stream.on('data', (chunk: string) => {
    const parts = `${partial}${chunk}`.split('\n')

    partial = (parts.pop() ?? '').slice(-lineLengthLimit)
    lines.push(...parts.slice(-limit).map((line) => withoutCarriageReturn(line).slice(-lineLengthLimit)))
    lines.splice(0, lines.length - limit)
  })

  return () => (partial === '' ? lines : [...lines, withoutCarriageReturn(partial)]).slice(-limit)
}
