import { connect, createServer, type Server, type Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { type SocksProxy, startSocksProxy } from './socks-proxy.js'

/**
 * The servers and sockets a test opened, closed after it.
 */
const opened: { servers: Server[]; sockets: Socket[]; proxies: SocksProxy[] } = {
  servers: [],
  sockets: [],
  proxies: [],
}

/**
 * Starts a proxy that is closed after the test.
 */
async function startProxy(): Promise<SocksProxy> {
  const proxy = await startSocksProxy()

  opened.proxies.push(proxy)

  return proxy
}

/**
 * Starts a server on a random port of 127.0.0.1 that echoes what it receives and then ends the connection, and gives
 * its port. It is closed after the test.
 */
async function startEchoOnceServer(): Promise<number> {
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    opened.sockets.push(socket)
    socket.on('error', () => {})
    socket.on('end', () => socket.end())
    socket.pipe(socket)
  })

  opened.servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return (server.address() as { port: number }).port
}

/**
 * Starts a server on a random port of the host that echoes what it receives, and gives its port. It is closed after
 * the test.
 */
async function startEchoServer(host: string): Promise<number> {
  const server = createServer((socket) => {
    opened.sockets.push(socket)
    socket.on('error', () => {})
    socket.pipe(socket)
  })

  opened.servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, host, resolve))

  return (server.address() as { port: number }).port
}

/**
 * Opens a raw connection to the proxy, closed after the test.
 */
async function connectToProxy(proxy: SocksProxy): Promise<Socket> {
  const socket = connect({ host: '127.0.0.1', port: proxy.port })

  opened.sockets.push(socket)
  socket.on('error', () => {})
  await new Promise<void>((resolve) => socket.once('connect', resolve))

  return socket
}

/**
 * Collects what a socket receives, and lets a test wait until a number of bytes have arrived.
 */
interface Reader {
  /**
   * Resolves with the first `count` bytes received that haven't been taken yet.
   */
  take: (count: number) => Promise<Buffer>
}

/**
 * Starts collecting what the socket receives.
 */
function readerOf(socket: Socket): Reader {
  let received = Buffer.alloc(0)
  let waiting: (() => void) | undefined

  socket.on('data', (chunk: Buffer) => {
    received = Buffer.concat([received, chunk])
    waiting?.()
  })

  return {
    async take(count) {
      while (received.length < count) {
        await new Promise<void>((resolve) => {
          const stop = (): void => {
            socket.removeListener('close', stop)
            waiting = undefined
            resolve()
          }

          waiting = stop
          socket.once('close', stop)
        })

        if (socket.destroyed && received.length < count) {
          break
        }
      }

      const taken = received.subarray(0, count)

      received = received.subarray(count)

      return Buffer.from(taken)
    },
  }
}

/**
 * Builds a CONNECT request for an address type and its address bytes.
 */
function requestOf(command: number, addressType: number, address: Buffer, port: number): Buffer {
  return Buffer.concat([Buffer.from([5, command, 0, addressType]), address, Buffer.from([port >> 8, port & 0xff])])
}

/**
 * The greeting of a client that offers only the no-authentication method.
 */
const greeting = Buffer.from([5, 1, 0])

/**
 * Builds a reply the way the proxy answers: the code, then a zero IPv4 address and port.
 */
function replyOf(code: number): Buffer {
  return Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0])
}

/**
 * Builds the address bytes of a domain name: its length, then the name.
 */
function domainOf(name: string): Buffer {
  return Buffer.concat([Buffer.from([name.length]), Buffer.from(name)])
}

/**
 * Greets the proxy and sends a request, then gives the socket, its reader and the proxy's reply to the request.
 */
async function negotiate(
  proxy: SocksProxy,
  request: Buffer,
): Promise<{ socket: Socket; reader: Reader; reply: Buffer }> {
  const socket = await connectToProxy(proxy)
  const reader = readerOf(socket)

  socket.write(greeting)
  expect(await reader.take(2)).toEqual(Buffer.from([5, 0]))
  socket.write(request)

  return { socket, reader, reply: await reader.take(10) }
}

/**
 * The empty page the proxy answers a request to its check host with.
 */
const checkPage = Buffer.from(
  'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
)

/**
 * Builds the request a browser sends for the root of this host.
 */
function httpRequestOf(host: string): Buffer {
  return Buffer.from(`GET / HTTP/1.1\r\nHost: ${host}\r\n\r\n`)
}

/**
 * Gives the host of the proxy's check URL.
 */
function checkHostOf(proxy: SocksProxy): string {
  return new URL(proxy.checkUrl).hostname
}

/**
 * Waits until the socket is closed.
 */
async function closed(socket: Socket): Promise<void> {
  if (!socket.destroyed) {
    await new Promise<void>((resolve) => socket.once('close', resolve))
  }
}

/**
 * An IPv4 address of this machine that isn't loopback, or `undefined` when it has none.
 */
const otherAddress = Object.values(networkInterfaces())
  .flat()
  .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address

afterEach(async () => {
  for (const socket of opened.sockets) {
    socket.destroy()
  }

  await Promise.all(opened.proxies.map((proxy) => proxy.close()))
  await Promise.all(opened.servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  opened.servers.length = 0
  opened.sockets.length = 0
  opened.proxies.length = 0
})

describe('startSocksProxy', () => {
  it('listens on a port above zero', async () => {
    const proxy = await startProxy()

    expect(proxy.port).toBeGreaterThan(0)
    await connectToProxy(proxy)
  })

  it.skipIf(otherAddress === undefined)('refuses connections that come in on another interface', async () => {
    const proxy = await startProxy()
    const error = await new Promise<NodeJS.ErrnoException>((resolve) => {
      const attempt = connect({ host: otherAddress as string, port: proxy.port })

      opened.sockets.push(attempt)
      attempt.once('error', resolve)
    })

    expect(error.code).toBe('ECONNREFUSED')
  })

  it('relays both ways to an IPv4 address', async () => {
    const proxy = await startProxy()
    const echoPort = await startEchoServer('127.0.0.1')
    const { socket, reader, reply } = await negotiate(proxy, requestOf(1, 1, Buffer.from([127, 0, 0, 1]), echoPort))

    expect(reply).toEqual(replyOf(0))
    socket.write('ping')
    expect((await reader.take(4)).toString()).toBe('ping')
    socket.write('pong')
    expect((await reader.take(4)).toString()).toBe('pong')
  })

  it('connects to a domain name', async () => {
    const proxy = await startProxy()
    const echoPort = await startEchoServer('127.0.0.1')
    const { socket, reader, reply } = await negotiate(proxy, requestOf(1, 3, domainOf('localhost'), echoPort))

    expect(reply).toEqual(replyOf(0))
    socket.write('named')
    expect((await reader.take(5)).toString()).toBe('named')
  })

  it('connects to an IPv6 address', async () => {
    const proxy = await startProxy()
    const echoPort = await startEchoServer('::1')
    const loopback = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    const { socket, reader, reply } = await negotiate(proxy, requestOf(1, 4, loopback, echoPort))

    expect(reply).toEqual(replyOf(0))
    socket.write('six')
    expect((await reader.take(3)).toString()).toBe('six')
  })

  it('handles the greeting, the request and a payload written together', async () => {
    const proxy = await startProxy()
    const echoPort = await startEchoServer('127.0.0.1')
    const socket = await connectToProxy(proxy)
    const reader = readerOf(socket)

    socket.write(
      Buffer.concat([greeting, requestOf(1, 1, Buffer.from([127, 0, 0, 1]), echoPort), Buffer.from('early')]),
    )

    expect(await reader.take(2)).toEqual(Buffer.from([5, 0]))
    expect(await reader.take(10)).toEqual(replyOf(0))
    expect((await reader.take(5)).toString()).toBe('early')
  })

  it('relays the answer to a client that sends its payload and half-closes at once', async () => {
    const proxy = await startProxy()
    const echoPort = await startEchoOnceServer()
    const socket = connect({ host: '127.0.0.1', port: proxy.port, allowHalfOpen: true })

    opened.sockets.push(socket)
    socket.on('error', () => {})

    const received: Buffer[] = []

    socket.on('data', (chunk: Buffer) => received.push(chunk))
    socket.end(Buffer.concat([greeting, requestOf(1, 1, Buffer.from([127, 0, 0, 1]), echoPort), Buffer.from('bye')]))
    await new Promise<void>((resolve) => socket.once('end', resolve))

    expect(Buffer.concat(received)).toEqual(Buffer.concat([Buffer.from([5, 0]), replyOf(0), Buffer.from('bye')]))
  })

  it('handles a greeting and a request written one byte at a time', async () => {
    const proxy = await startProxy()
    const echoPort = await startEchoServer('127.0.0.1')
    const socket = await connectToProxy(proxy)
    const reader = readerOf(socket)
    const bytes = Buffer.concat([greeting, requestOf(1, 3, domainOf('localhost'), echoPort)])

    socket.setNoDelay(true)

    for (const byte of bytes) {
      socket.write(Buffer.from([byte]))
      await new Promise<void>((resolve) => setImmediate(resolve))
    }

    expect(await reader.take(2)).toEqual(Buffer.from([5, 0]))
    expect(await reader.take(10)).toEqual(replyOf(0))
    socket.write('slow')
    expect((await reader.take(4)).toString()).toBe('slow')
  })

  it('answers 0x05 when the port refuses the connection', async () => {
    const proxy = await startProxy()
    const server = createServer()

    opened.servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

    const refusedPort = (server.address() as { port: number }).port

    await new Promise<void>((resolve) => server.close(() => resolve()))

    const { socket, reply } = await negotiate(proxy, requestOf(1, 1, Buffer.from([127, 0, 0, 1]), refusedPort))

    expect(reply).toEqual(replyOf(5))
    await closed(socket)
  })

  it('answers 0x07 to a command other than CONNECT', async () => {
    const proxy = await startProxy()
    const { socket, reply } = await negotiate(proxy, requestOf(2, 1, Buffer.from([127, 0, 0, 1]), 80))

    expect(reply).toEqual(replyOf(7))
    await closed(socket)
  })

  it('answers 0x08 to an unknown address type', async () => {
    const proxy = await startProxy()
    const { socket, reply } = await negotiate(proxy, requestOf(1, 5, Buffer.from([127, 0, 0, 1]), 80))

    expect(reply).toEqual(replyOf(8))
    await closed(socket)
  })

  it('refuses a client that offers no no-authentication method', async () => {
    const proxy = await startProxy()
    const socket = await connectToProxy(proxy)
    const reader = readerOf(socket)

    socket.write(Buffer.from([5, 1, 2]))

    expect(await reader.take(2)).toEqual(Buffer.from([5, 0xff]))
    await closed(socket)
  })

  it('ends a relayed connection and stops listening when closed', async () => {
    const proxy = await startProxy()
    const echoPort = await startEchoServer('127.0.0.1')
    const { socket, reader } = await negotiate(proxy, requestOf(1, 1, Buffer.from([127, 0, 0, 1]), echoPort))

    socket.write('up')
    expect((await reader.take(2)).toString()).toBe('up')

    await proxy.close()
    await closed(socket)

    const error = await new Promise<NodeJS.ErrnoException>((resolve) => {
      const attempt = connect({ host: '127.0.0.1', port: proxy.port })

      opened.sockets.push(attempt)
      attempt.once('error', resolve)
    })

    expect(error.code).toBe('ECONNREFUSED')
  })

  it('gives the same promise when closed twice', async () => {
    const proxy = await startProxy()
    const first = proxy.close()

    expect(proxy.close()).toBe(first)
    await first
  })

  it('refuses a domain name with a NUL byte with 0x04, and keeps serving', async () => {
    const proxy = await startProxy()
    const echoPort = await startEchoServer('127.0.0.1')
    const refused = await negotiate(proxy, requestOf(1, 3, domainOf('bad\0name'), 80))

    expect(refused.reply).toEqual(replyOf(4))
    await closed(refused.socket)

    const served = await negotiate(proxy, requestOf(1, 1, Buffer.from([127, 0, 0, 1]), echoPort))

    expect(served.reply).toEqual(replyOf(0))
  })

  it('answers 0x04 to a name that does not exist', async () => {
    const proxy = await startProxy()
    const { socket, reply } = await negotiate(proxy, requestOf(1, 3, domainOf('nothing.invalid'), 80))

    expect(reply).toEqual(replyOf(4))
    await closed(socket)
  })

  it('drops a client whose greeting is not version 5', async () => {
    const proxy = await startProxy()
    const socket = await connectToProxy(proxy)

    socket.write(Buffer.from([4]))
    await closed(socket)
  })

  it('drops a client whose request is not version 5', async () => {
    const proxy = await startProxy()
    const socket = await connectToProxy(proxy)
    const reader = readerOf(socket)

    socket.write(greeting)
    expect(await reader.take(2)).toEqual(Buffer.from([5, 0]))
    socket.write(Buffer.from([4, 1, 0, 1]))
    await closed(socket)
  })

  it('ends a client that is mid-handshake when closed', async () => {
    const proxy = await startProxy()
    const socket = await connectToProxy(proxy)
    const reader = readerOf(socket)

    socket.write(greeting)
    expect(await reader.take(2)).toEqual(Buffer.from([5, 0]))
    socket.write(Buffer.from([5, 1, 0]))

    await proxy.close()
    await closed(socket)
  })

  it('delivers every byte of a large answer to a slow client that half-closed', async () => {
    const proxy = await startProxy()
    const size = 4 * 1024 * 1024
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      opened.sockets.push(socket)
      socket.on('error', () => {})
      socket.on('end', () => {
        const pieceSizes = [1000, 65_536, 300_000, 7]
        let sent = 0

        for (let index = 0; sent < size; index += 1) {
          const piece = Math.min(pieceSizes[index % pieceSizes.length] ?? 1, size - sent)

          socket.write(Buffer.alloc(piece, 7))
          sent += piece
        }

        socket.end()
      })
      socket.resume()
    })

    opened.servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

    const socket = connect({ host: '127.0.0.1', port: proxy.port, allowHalfOpen: true })
    let total = 0

    opened.sockets.push(socket)
    socket.on('error', () => {})
    socket.write(
      Buffer.concat([
        greeting,
        requestOf(1, 1, Buffer.from([127, 0, 0, 1]), (server.address() as { port: number }).port),
      ]),
    )
    socket.end()
    socket.on('data', (chunk: Buffer) => {
      total += chunk.length
      socket.pause()
      setTimeout(() => socket.resume(), 1)
    })
    await new Promise<void>((resolve) => socket.once('end', resolve))

    expect(total).toBe(2 + 10 + size)
  })

  it('gives each proxy a check URL of its own, on a random host under visual-check.invalid', async () => {
    const first = await startProxy()
    const second = await startProxy()

    expect(first.checkUrl).toMatch(/^http:\/\/[0-9a-f]{16}\.visual-check\.invalid\/$/)
    expect(second.checkUrl).toMatch(/^http:\/\/[0-9a-f]{16}\.visual-check\.invalid\/$/)
    expect(second.checkUrl).not.toBe(first.checkUrl)
  })

  it('answers its check host itself with an empty page, though the name resolves nowhere, then ends', async () => {
    const proxy = await startProxy()
    const host = checkHostOf(proxy)
    const { socket, reader, reply } = await negotiate(proxy, requestOf(1, 3, domainOf(host), 80))

    expect(reply).toEqual(replyOf(0))
    socket.write(httpRequestOf(host))
    expect(await reader.take(checkPage.length + 1)).toEqual(checkPage)
    await closed(socket)
  })

  it('answers its check host on any port and in upper case', async () => {
    const proxy = await startProxy()
    const host = checkHostOf(proxy).toUpperCase()
    const { socket, reader, reply } = await negotiate(proxy, requestOf(1, 3, domainOf(host), 8080))

    expect(reply).toEqual(replyOf(0))
    socket.write(httpRequestOf(host))
    expect(await reader.take(checkPage.length + 1)).toEqual(checkPage)
  })

  it('answers its check host when the request comes with the greeting', async () => {
    const proxy = await startProxy()
    const host = checkHostOf(proxy)
    const socket = await connectToProxy(proxy)
    const reader = readerOf(socket)

    socket.write(Buffer.concat([greeting, requestOf(1, 3, domainOf(host), 80), httpRequestOf(host)]))

    expect(await reader.take(2 + 10 + checkPage.length + 1)).toEqual(
      Buffer.concat([Buffer.from([5, 0]), replyOf(0), checkPage]),
    )
    await closed(socket)
  })

  it('answers its check host only once the request has ended, and ends the connection without a reset', async () => {
    const proxy = await startProxy()
    const host = checkHostOf(proxy)
    const { socket, reader } = await negotiate(proxy, requestOf(1, 3, domainOf(host), 80))
    const request = httpRequestOf(host)
    const errors: Error[] = []
    let received = 0
    let ended = false

    socket.on('error', (error: Error) => errors.push(error))
    socket.on('end', () => {
      ended = true
    })
    socket.on('data', (chunk: Buffer) => {
      received += chunk.length
    })
    socket.write(request.subarray(0, request.length - 2))
    await new Promise<void>((resolve) => setTimeout(resolve, 50))

    expect(received).toBe(0)
    expect(socket.destroyed).toBe(false)

    socket.write(request.subarray(request.length - 2))

    expect(await reader.take(checkPage.length + 1)).toEqual(checkPage)
    expect(ended).toBe(true)
    expect(errors).toEqual([])
  })

  it('answers its check host once 8 KiB of a request with no end of headers have come', async () => {
    const proxy = await startProxy()
    const { socket, reader } = await negotiate(proxy, requestOf(1, 3, domainOf(checkHostOf(proxy)), 80))

    socket.write(Buffer.alloc(8 * 1024, 'a'))

    expect(await reader.take(checkPage.length + 1)).toEqual(checkPage)
  })

  it('ends a client waiting on its check host when closed', async () => {
    const proxy = await startProxy()
    const { socket } = await negotiate(proxy, requestOf(1, 3, domainOf(checkHostOf(proxy)), 80))

    await proxy.close()
    await closed(socket)
  })

  it('drops a client that half-closes before it asks its check host for anything', async () => {
    const proxy = await startProxy()
    const { socket } = await negotiate(proxy, requestOf(1, 3, domainOf(checkHostOf(proxy)), 80))

    socket.end()
    await closed(socket)
  })

  it('resets the client when the target resets the connection', async () => {
    const proxy = await startProxy()
    const server = createServer((socket) => {
      socket.on('error', () => {})
      socket.once('data', () => socket.resetAndDestroy())
    })

    opened.servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

    const { socket } = await negotiate(
      proxy,
      requestOf(1, 1, Buffer.from([127, 0, 0, 1]), (server.address() as { port: number }).port),
    )

    socket.write('x')

    const error = await new Promise<NodeJS.ErrnoException | undefined>((resolve) => {
      socket.once('error', resolve)
      socket.once('end', () => resolve(undefined))
    })

    expect(error?.code).toBe('ECONNRESET')
  })
})
