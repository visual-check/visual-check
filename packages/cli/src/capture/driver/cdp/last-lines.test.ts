import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { keepLastLines } from './last-lines.js'

/**
 * Waits until the stream's writes have reached its reader.
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('keepLastLines', () => {
  it('splits on newlines and drops a carriage return before one', async () => {
    const stream = new PassThrough()
    const lastLines = keepLastLines(stream, 10)

    stream.write('one\r\ntwo\nthree\n')
    await flush()
    expect(lastLines()).toEqual(['one', 'two', 'three'])
  })

  it('keeps a partial last line, and joins it with the rest once it arrives', async () => {
    const stream = new PassThrough()
    const lastLines = keepLastLines(stream, 10)

    stream.write('one\ntw')
    await flush()
    expect(lastLines()).toEqual(['one', 'tw'])
    stream.write('o\r')
    await flush()
    expect(lastLines()).toEqual(['one', 'two'])
    stream.write('\n')
    await flush()
    expect(lastLines()).toEqual(['one', 'two'])
  })

  it('keeps only the last lines, counting a partial last line', async () => {
    const stream = new PassThrough()
    const lastLines = keepLastLines(stream, 3)

    stream.write('1\n2\n3\n4\n5\n')
    await flush()
    expect(lastLines()).toEqual(['3', '4', '5'])
    stream.write('6')
    await flush()
    expect(lastLines()).toEqual(['4', '5', '6'])
  })

  it('decodes a multi-byte character split across chunks', async () => {
    const stream = new PassThrough()
    const lastLines = keepLastLines(stream, 10)
    const bytes = Buffer.from('zażółć 😀\n')
    const split = bytes.indexOf(Buffer.from('😀')) + 2

    stream.write(bytes.subarray(0, split))
    stream.write(bytes.subarray(split))
    await flush()
    expect(lastLines()).toEqual(['zażółć 😀'])
  })

  it('keeps only the last 64 Ki characters of a line that never ends, and of the line it becomes', async () => {
    const stream = new PassThrough()
    const lastLines = keepLastLines(stream, 10)
    const chunk = 'abcdefgh'.repeat(2048)

    for (let index = 0; index < 13; index++) {
      stream.write(chunk)
    }

    await flush()
    expect(lastLines()).toEqual([chunk.repeat(13).slice(-65_536)])
    stream.write('end\n')
    await flush()
    expect(lastLines()).toEqual([`${chunk.repeat(13)}end`.slice(-65_536)])
  })

  it('keeps no lines for no output', () => {
    expect(keepLastLines(new PassThrough(), 10)()).toEqual([])
  })

  it('keeps the lines read before the stream failed', async () => {
    const stream = new PassThrough()
    const lastLines = keepLastLines(stream, 10)

    stream.write('one\n')
    await flush()
    stream.destroy(new Error('broken pipe'))
    await flush()
    expect(lastLines()).toEqual(['one'])
  })
})
