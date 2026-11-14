import { connect, createServer, type Socket } from 'node:net'

/**
 * A SOCKS5 proxy in visual-check's own process. The browser in Docker connects through it to reach the Storybook, so
 * a name is resolved and a connection is made from the machine visual-check runs on, whatever the host file, VPN or
 * LAN there says. It speaks the CONNECT command with no authentication, which is all Chromium asks for.
 *
 * @public
 */
export interface SocksProxy {
  /**
   * The port it listens on, on 127.0.0.1.
   */
  readonly port: number
  /**
   * Stops listening and ends every connection through it. Resolves once it has stopped. Calling it again returns the
   * same promise.
   */
  close: () => Promise<void>
}

/**
 * What a request asks for, once it has been read in full.
 */
interface Target {
  /**
   * The host to connect to: a name, an IPv4 address in dotted form or an IPv6 address.
   */
  host: string
  /**
   * The port to connect to.
   */
  port: number
  /**
   * How many bytes of the buffer the request took.
   */
  length: number
}

/**
 * What reading a request gives: the target, a reply code to refuse it with, or `undefined` when more bytes are needed.
 */
type ParsedRequest = Target | { code: number } | undefined

/**
 * The reply code for success.
 */
const succeeded = 0x00

/**
 * The reply code for a failure with no better code.
 */
const generalFailure = 0x01

/**
 * The reply code for a network that can't be reached.
 */
const networkUnreachable = 0x03

/**
 * The reply code for a host that can't be reached.
 */
const hostUnreachable = 0x04

/**
 * The reply code for a refused connection.
 */
const connectionRefused = 0x05

/**
 * The reply code for a command the proxy doesn't speak.
 */
const commandNotSupported = 0x07

/**
 * The reply code for an address type the proxy doesn't speak.
 */
const addressTypeNotSupported = 0x08

/**
 * The reply code for each error code of a failed connection. Any other error gets `generalFailure`.
 */
const replyCodeOfError: Record<string, number> = {
  ECONNREFUSED: connectionRefused,
  ENETUNREACH: networkUnreachable,
  EHOSTUNREACH: hostUnreachable,
  ENOTFOUND: hostUnreachable,
  EAI_AGAIN: hostUnreachable,
  ETIMEDOUT: hostUnreachable,
}

/**
 * Builds a reply with this code and a zero IPv4 address and port.
 */
function replyOf(code: number): Buffer {
  return Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0])
}

/**
 * Gives the 16 bytes of an IPv6 address as eight hex groups joined by colons.
 */
function ipv6Of(bytes: Buffer): string {
  const groups: string[] = []

  for (let offset = 0; offset < 16; offset += 2) {
    groups.push(bytes.readUInt16BE(offset).toString(16))
  }

  return groups.join(':')
}

/**
 * Writes an address of this type as a host: dotted for IPv4, hex groups for IPv6, the name itself for a domain.
 */
function hostOf(addressType: number, address: Buffer): string {
  switch (addressType) {
    case 1:
      return [...address].join('.')
    case 4:
      return ipv6Of(address)
    default:
      return address.toString('latin1')
  }
}

/**
 * Finds where the address of a request starts and how long it is. Gives `'unsupported'` for an address type the proxy
 * doesn't speak, and `undefined` when a domain name's length hasn't arrived yet.
 */
function addressSpanOf(bytes: Buffer): { start: number; length: number } | 'unsupported' | undefined {
  switch (bytes[3]) {
    case 1:
      return { start: 4, length: 4 }
    case 4:
      return { start: 4, length: 16 }
    case 3:
      return bytes.length > 4 ? { start: 5, length: bytes[4] ?? 0 } : undefined
    default:
      return 'unsupported'
  }
}

/**
 * Reads a request from the start of the bytes. Gives `undefined` when the request isn't all there yet, and a reply
 * code when it asks for something the proxy doesn't speak.
 */
function parseRequest(bytes: Buffer): ParsedRequest {
  if (bytes.length < 4) {
    return undefined
  }

  if (bytes[1] !== 1) {
    return { code: commandNotSupported }
  }

  const span = addressSpanOf(bytes)

  if (span === 'unsupported') {
    return { code: addressTypeNotSupported }
  }

  if (span === undefined) {
    return undefined
  }

  const portStart = span.start + span.length

  if (bytes.length < portStart + 2) {
    return undefined
  }

  const host = hostOf(bytes[3] ?? 0, bytes.subarray(span.start, portStart))

  // Node cuts a name at a NUL byte before it looks it up, so `localhost\0evil` would reach localhost.
  if (host.includes('\0')) {
    return { code: hostUnreachable }
  }

  return { host, port: bytes.readUInt16BE(portStart), length: portStart + 2 }
}

/**
 * Reads the greeting from the start of the bytes. Gives the number of bytes it took and whether it offers the
 * no-authentication method, or `undefined` when the greeting isn't all there yet.
 */
function parseGreeting(bytes: Buffer): { length: number; offersNoAuthentication: boolean } | undefined {
  if (bytes.length < 2) {
    return undefined
  }

  const length = 2 + (bytes[1] ?? 0)

  if (bytes.length < length) {
    return undefined
  }

  return { length, offersNoAuthentication: bytes.subarray(2, length).includes(0) }
}

/**
 * Serves one client: reads its greeting and request, connects to the target and relays both ways until either side
 * closes. Every socket it opens is added to `sockets` while it lives.
 */
function serveClient(client: Socket, sockets: Set<Socket>): void {
  let pending: Buffer = Buffer.alloc(0)
  let stage: 'greeting' | 'request' | 'connecting' | 'relaying' = 'greeting'
  let upstream: Socket | undefined

  /**
   * Writes the last bytes the client gets, and closes the connection.
   */
  const endWith = (bytes: Buffer): void => {
    client.removeListener('data', onData)
    client.end(bytes, () => {
      client.destroy()
    })
  }

  /**
   * Connects to the target, and relays once connected. A `connect` that throws, as Node does for a name or port it
   * can't take, is answered like any other failure.
   */
  const open = (target: Target): void => {
    let connection: Socket

    try {
      connection = connect({ host: target.host, port: target.port, noDelay: true, allowHalfOpen: true })
    } catch {
      endWith(replyOf(generalFailure))

      return
    }

    upstream = connection
    sockets.add(connection)
    connection.on('close', () => {
      sockets.delete(connection)
    })
    connection.on('error', (error: NodeJS.ErrnoException) => {
      if (stage === 'connecting') {
        endWith(replyOf(replyCodeOfError[error.code ?? ''] ?? generalFailure))
      } else {
        client.resetAndDestroy()
      }

      connection.destroy()
    })
    connection.once('connect', () => {
      client.write(replyOf(succeeded))
      client.removeListener('data', onData)
      stage = 'relaying'

      if (pending.length > 0) {
        connection.write(pending)
      }

      client.pipe(connection)
      connection.pipe(client)
    })
  }

  /**
   * Destroys the client when the first byte it sent isn't the version 5, and tells whether it did.
   */
  const dropWrongVersion = (): boolean => {
    const wrong = pending.length > 0 && pending[0] !== 5

    if (wrong) {
      client.destroy()
    }

    return wrong
  }

  /**
   * Reads the greeting, and answers it.
   */
  const greet = (): void => {
    const parsed = dropWrongVersion() ? undefined : parseGreeting(pending)

    if (parsed === undefined) {
      return
    }

    pending = pending.subarray(parsed.length)

    if (parsed.offersNoAuthentication) {
      client.write(Buffer.from([5, 0]))
      stage = 'request'
    } else {
      endWith(Buffer.from([5, 0xff]))
    }
  }

  /**
   * Reads the request, and connects to its target or refuses it. The client is paused while connecting, so what it
   * sends next waits in its socket.
   */
  const readRequest = (): void => {
    const parsed = dropWrongVersion() ? undefined : parseRequest(pending)

    if (parsed !== undefined && 'code' in parsed) {
      endWith(replyOf(parsed.code))
    } else if (parsed !== undefined) {
      pending = pending.subarray(parsed.length)
      stage = 'connecting'
      client.pause()
      open(parsed)
    }
  }

  /**
   * Reads what the client has sent so far as far as the stage allows.
   */
  const advance = (): void => {
    if (stage === 'greeting') {
      greet()
    }

    if (stage === 'request') {
      readRequest()
    }
  }

  /**
   * Adds a chunk to what is pending, and reads it.
   */
  function onData(chunk: Buffer): void {
    pending = Buffer.concat([pending, chunk])

    if (stage === 'greeting' || stage === 'request') {
      advance()
    }
  }

  sockets.add(client)
  client.setNoDelay(true)
  client.on('data', onData)
  client.on('end', () => {
    if (stage === 'greeting' || stage === 'request') {
      client.destroy()
    }
  })
  client.on('error', () => {
    client.destroy()
  })
  client.on('close', (hadError) => {
    sockets.delete(client)

    if (hadError || stage !== 'relaying') {
      upstream?.destroy()
    }
  })
}

/**
 * Starts the proxy on 127.0.0.1 on a random port. It serves every client until `close` is called, and never logs or
 * throws out of a connection.
 *
 * @public
 */
export async function startSocksProxy(): Promise<SocksProxy> {
  const sockets = new Set<Socket>()
  const server = createServer({ allowHalfOpen: true }, (client) => {
    serveClient(client, sockets)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      server.on('error', () => {})
      resolve()
    })
  })

  const address = server.address()
  let closing: Promise<void> | undefined

  return {
    port: typeof address === 'object' && address !== null ? address.port : 0,
    close() {
      closing ??= new Promise<void>((resolve) => {
        server.once('close', resolve)
        server.close()

        for (const socket of sockets) {
          socket.destroy()
        }
      })

      return closing
    },
  }
}
