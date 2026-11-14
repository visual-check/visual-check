import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { CdpConnection, CdpError, type CdpEvent } from './cdp-connection.js'

/**
 * A connection wired to in-memory streams, with a fake browser on the other end of them.
 */
interface Fixture {
  /**
   * The connection under test.
   */
  connection: CdpConnection
  /**
   * Every message the connection has written to the browser so far, parsed.
   */
  written: Record<string, unknown>[]
  /**
   * Sends the browser's bytes to the connection.
   */
  receive: (data: string | Buffer) => void
}

/**
 * Wraps a message the way the browser frames it: JSON followed by a NUL byte.
 */
function frame(message: unknown): string {
  return `${JSON.stringify(message)}\0`
}

/**
 * Waits until the connection's writes have reached the fake browser.
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

/**
 * Builds a connection over two `PassThrough` streams and records what it writes.
 */
function createFixture(): Fixture {
  const toBrowser = new PassThrough()
  const fromBrowser = new PassThrough()
  const written: Record<string, unknown>[] = []
  let pending = ''

  toBrowser.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf8')

    const parts = pending.split('\0')

    pending = parts.pop() ?? ''
    for (const part of parts) {
      written.push(JSON.parse(part) as Record<string, unknown>)
    }
  })

  return {
    connection: new CdpConnection(toBrowser, fromBrowser),
    written,
    receive: (data) => {
      fromBrowser.write(data)
    },
  }
}

describe('CdpConnection', () => {
  it('resolves a call with the result of its reply', async () => {
    const { connection, written, receive } = createFixture()
    const call = connection.send('Page.navigate', { url: 'http://a' })

    await flush()
    expect(written).toEqual([{ id: 1, method: 'Page.navigate', params: { url: 'http://a' } }])
    receive(frame({ id: 1, result: { frameId: 'f' } }))
    await expect(call).resolves.toEqual({ frameId: 'f' })
  })

  it('numbers calls up from 1 and matches each reply to its call', async () => {
    const { connection, written, receive } = createFixture()
    const first = connection.send('A')
    const second = connection.send('B')

    await flush()
    expect(written.map((message) => message.id)).toEqual([1, 2])
    receive(frame({ id: 2, result: { n: 2 } }) + frame({ id: 1, result: { n: 1 } }))
    await expect(first).resolves.toEqual({ n: 1 })
    await expect(second).resolves.toEqual({ n: 2 })
  })

  it('rejects with a CdpError naming the method and the browser message on an error reply', async () => {
    const { connection, receive } = createFixture()
    const call = connection.send('Page.navigate')

    receive(frame({ id: 1, error: { code: -32000, message: 'Cannot navigate' } }))

    const error = await call.catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CdpError)
    expect((error as CdpError).message).toContain('Page.navigate')
    expect((error as CdpError).message).toContain('Cannot navigate')
    expect((error as CdpError).code).toBe(-32000)
    expect((error as CdpError).browserMessage).toBe('Cannot navigate')
  })

  it('sends empty params when none are given', async () => {
    const { connection, written } = createFixture()

    connection.send('Browser.getVersion').catch(() => undefined)
    await flush()
    expect(written[0]).toEqual({ id: 1, method: 'Browser.getVersion', params: {} })
  })

  it('includes sessionId only when given', async () => {
    const { connection, written } = createFixture()

    connection.send('A').catch(() => undefined)
    connection.send('B', {}, 'session-1').catch(() => undefined)
    await flush()
    expect('sessionId' in (written[0] ?? {})).toBe(false)
    expect(written[1]).toEqual({ id: 2, method: 'B', params: {}, sessionId: 'session-1' })
  })

  it('tells listeners about events, with and without a session', async () => {
    const { connection, receive } = createFixture()
    const events: CdpEvent[] = []

    connection.onEvent((event) => events.push(event))
    receive(frame({ method: 'Target.created', params: { a: 1 } }))
    receive(frame({ method: 'Page.loadEventFired', params: { b: 2 }, sessionId: 's1' }))
    await flush()
    expect(events).toEqual([
      { method: 'Target.created', params: { a: 1 }, sessionId: undefined },
      { method: 'Page.loadEventFired', params: { b: 2 }, sessionId: 's1' },
    ])
  })

  it('stops telling a listener once it stops listening', async () => {
    const { connection, receive } = createFixture()
    const events: CdpEvent[] = []
    const stop = connection.onEvent((event) => events.push(event))

    receive(frame({ method: 'One', params: {} }))
    await flush()
    stop()
    receive(frame({ method: 'Two', params: {} }))
    await flush()
    expect(events.map((event) => event.method)).toEqual(['One'])
  })

  it('reads several messages from one chunk', async () => {
    const { connection, receive } = createFixture()
    const events: CdpEvent[] = []

    connection.onEvent((event) => events.push(event))

    const call = connection.send('A')

    receive(
      frame({ method: 'E1', params: {} }) +
        frame({ id: 1, result: { ok: true } }) +
        frame({ method: 'E2', params: {} }),
    )
    await expect(call).resolves.toEqual({ ok: true })
    expect(events.map((event) => event.method)).toEqual(['E1', 'E2'])
  })

  it('reads a message split across chunks', async () => {
    const { connection, receive } = createFixture()
    const call = connection.send('A')
    const text = frame({ id: 1, result: { value: 'hello' } })

    receive(text.slice(0, 7))
    await flush()
    receive(text.slice(7, -1))
    await flush()
    receive(text.slice(-1))
    await expect(call).resolves.toEqual({ value: 'hello' })
  })

  it('reads a multi-byte character split across chunks', async () => {
    const { connection, receive } = createFixture()
    const call = connection.send('A')
    const bytes = Buffer.from(frame({ id: 1, result: { value: 'zażółć 😀' } }), 'utf8')
    const split = bytes.indexOf(Buffer.from('😀')) + 2

    receive(bytes.subarray(0, split))
    await flush()
    receive(bytes.subarray(split))
    await expect(call).resolves.toEqual({ value: 'zażółć 😀' })
  })

  it('rejects pending calls and later sends with the error it is closed with', async () => {
    const { connection } = createFixture()
    const pending = connection.send('A')
    const reason = new Error('Chromium exited with code 1')

    connection.close(reason)
    await expect(pending).rejects.toBe(reason)
    await expect(connection.send('B')).rejects.toBe(reason)
  })

  it('keeps the first error when closed twice', async () => {
    const { connection } = createFixture()
    const first = new Error('first')

    connection.close(first)
    connection.close(new Error('second'))
    await expect(connection.send('A')).rejects.toBe(first)
  })

  it('ignores a reply with an unknown id', async () => {
    const { connection, receive } = createFixture()
    const call = connection.send('A')

    receive(frame({ id: 99, result: {} }))
    receive(frame({ id: 1, result: { ok: 1 } }))
    await expect(call).resolves.toEqual({ ok: 1 })
  })

  it('skips a message that is not valid JSON and reads the ones after it', async () => {
    const { connection, receive } = createFixture()
    const call = connection.send('A')

    receive(`not json\0${frame({ id: 1, result: { ok: 1 } })}`)
    await expect(call).resolves.toEqual({ ok: 1 })
  })

  it('isolates a throwing listener from other listeners and later messages', async () => {
    const { connection, receive } = createFixture()
    const seen: string[] = []

    connection.onEvent(() => {
      throw new Error('listener bug')
    })
    connection.onEvent((event) => seen.push(event.method))

    const call = connection.send('A')
    const uncaught = new Promise((resolve) => process.once('uncaughtException', resolve))

    receive(frame({ method: 'E1', params: {} }) + frame({ id: 1, result: { ok: 1 } }))
    await expect(call).resolves.toEqual({ ok: 1 })
    expect(seen).toEqual(['E1'])
    expect(await uncaught).toEqual(new Error('listener bug'))
  })

  it('reads a large message split across many chunks, with NULs at chunk edges', async () => {
    const { connection, receive } = createFixture()
    const events: CdpEvent[] = []

    connection.onEvent((event) => events.push(event))

    const call = connection.send('A')
    const bytes = Buffer.from(frame({ id: 1, result: { data: 'x'.repeat(1000) } }) + frame({ method: 'E', params: {} }))
    const nul = bytes.indexOf(0)

    receive(bytes.subarray(0, 1))
    receive(bytes.subarray(1, nul))
    for (let offset = nul; offset < bytes.length; offset += 7) {
      receive(bytes.subarray(offset, offset + 7))
    }

    await expect(call).resolves.toEqual({ data: 'x'.repeat(1000) })
    await flush()
    expect(events.map((event) => event.method)).toEqual(['E'])
  })

  it('reads a message whose NUL arrives alone in its chunk', async () => {
    const { connection, receive } = createFixture()
    const call = connection.send('A')

    receive(JSON.stringify({ id: 1, result: { ok: 1 } }))
    receive('\0')
    await expect(call).resolves.toEqual({ ok: 1 })
  })

  it('stops dispatching events once closed', async () => {
    const { connection, receive } = createFixture()
    const events: CdpEvent[] = []

    connection.onEvent((event) => events.push(event))
    connection.close(new Error('gone'))
    receive(frame({ method: 'Late', params: {} }))
    await flush()
    expect(events).toEqual([])
  })

  it('rejects a call whose params cannot be stringified', async () => {
    const { connection } = createFixture()

    await expect(connection.send('A', { n: 1n })).rejects.toBeInstanceOf(TypeError)
  })

  it('calls each close listener once, with the first error it is closed with', () => {
    const { connection } = createFixture()
    const first = new Error('first')
    const closedWith: Error[] = []

    connection.onClose((error) => closedWith.push(error))
    expect(closedWith).toEqual([])
    connection.close(first)
    connection.close(new Error('second'))
    expect(closedWith).toEqual([first])
  })

  it('calls a close listener at once when the connection is already closed', () => {
    const { connection } = createFixture()
    const reason = new Error('gone')
    const closedWith: Error[] = []

    connection.close(reason)
    connection.onClose((error) => closedWith.push(error))
    expect(closedWith).toEqual([reason])
  })

  it('stops calling a close listener once it stops listening', () => {
    const { connection } = createFixture()
    const closedWith: Error[] = []
    const stop = connection.onClose((error) => closedWith.push(error))

    stop()
    connection.close(new Error('gone'))
    expect(closedWith).toEqual([])
  })

  it('calls the other close listeners when one throws, and rethrows its error on a microtask', async () => {
    const { connection } = createFixture()
    const closedWith: Error[] = []

    connection.onClose(() => {
      throw new Error('listener bug')
    })
    connection.onClose((error) => closedWith.push(error))

    const uncaught = new Promise((resolve) => process.once('uncaughtException', resolve))

    connection.close(new Error('gone'))
    expect(closedWith).toEqual([new Error('gone')])
    expect(await uncaught).toEqual(new Error('listener bug'))
  })

  it('does not close itself when the browser stream ends', async () => {
    const fromBrowser = new PassThrough()
    const connection = new CdpConnection(new PassThrough(), fromBrowser)
    let settled = false
    const call = connection.send('A').finally(() => {
      settled = true
    })

    fromBrowser.end()
    await flush()
    expect(settled).toBe(false)

    const reason = new Error('exited')

    connection.close(reason)
    await expect(call).rejects.toBe(reason)
  })

  it('falls back when an error reply has no code or message', async () => {
    const { connection, receive } = createFixture()
    const call = connection.send('A')

    receive(frame({ id: 1, error: {} }))

    const error = (await call.catch((caught: unknown) => caught)) as CdpError

    expect(error).toBeInstanceOf(CdpError)
    expect(error.code).toBe(0)
    expect(error.browserMessage).toBe('unknown error')
    expect(error.message).toContain('unknown error')
  })

  it('gives an event with no params empty params', async () => {
    const { connection, receive } = createFixture()
    const events: CdpEvent[] = []

    connection.onEvent((event) => events.push(event))
    receive(frame({ method: 'Bare' }))
    await flush()
    expect(events[0]?.params).toEqual({})
  })

  it('skips a JSON message that is not an object', async () => {
    const { connection, receive } = createFixture()
    const call = connection.send('A')

    receive(`42\0[1]\0null\0${frame({ id: 1, result: { ok: 1 } })}`)
    await expect(call).resolves.toEqual({ ok: 1 })
  })

  it('does not throw when the browser input stream fails to write', async () => {
    const toBrowser = new PassThrough()
    const fromBrowser = new PassThrough()
    const connection = new CdpConnection(toBrowser, fromBrowser)

    toBrowser.destroy()

    const call = connection.send('A')
    const reason = new Error('browser exited')

    await flush()
    connection.close(reason)
    await expect(call).rejects.toBe(reason)
  })
})
