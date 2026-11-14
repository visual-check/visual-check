import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type RequestListener, type Server } from 'node:http'
import { type AddressInfo, connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrowserDownloadError } from './browser-download-error.js'
import { downloadFile } from './download-file.js'

/**
 * What the tests download, as progress and errors name it.
 */
const label = 'Chromium 157.0.8103.78 (mac-arm64)'

/**
 * The servers the tests started, closed after each test.
 */
const servers: Server[] = []

/**
 * The sockets the test proxies opened, which a server's own close doesn't reach, destroyed after each test.
 */
const proxySockets: Socket[] = []

/**
 * The folder each test downloads into, removed after it.
 */
let folder = ''

/**
 * The file each test downloads to.
 */
let destination = ''

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'visual-check-download-'))
  destination = join(folder, 'chrome-headless-shell.zip')
})

afterEach(async () => {
  rmSync(folder, { recursive: true, force: true })

  for (const socket of proxySockets.splice(0)) {
    socket.destroy()
  }

  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => {
            resolve()
          })
        }),
    ),
  )
})

/**
 * Starts the server on a free port of 127.0.0.1, to be closed after the test. Returns its port.
 */
async function listen(server: Server): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  return (server.address() as AddressInfo).port
}

/**
 * Starts a server that answers with the listener. Returns its base URL.
 */
async function serve(listener: RequestListener): Promise<string> {
  return `http://127.0.0.1:${await listen(createServer(listener))}`
}

/**
 * Takes a port nothing listens on: listens on a free port of 127.0.0.1, reads it and closes that server.
 */
async function takeUnusedPort(): Promise<number> {
  const server = createServer()
  const port = await listen(server)

  servers.pop()
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })

  return port
}

/**
 * The bytes `count` bytes long that the tests serve, varied so a hash of the wrong bytes differs.
 */
function bytesOf(count: number): Buffer {
  const bytes = Buffer.alloc(count)

  for (let index = 0; index < count; index += 1) {
    bytes[index] = index % 251
  }

  return bytes
}

/**
 * The SHA-256 of the bytes as lowercase hex.
 */
function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * What a test proxy saw of each CONNECT: its target and its `Proxy-Authorization` header.
 */
interface ConnectSeen {
  /**
   * The CONNECT's target, `<host>:<port>`.
   */
  target: string
  /**
   * The `Proxy-Authorization` header, or `undefined` when the CONNECT had none.
   */
  authorization: string | undefined
}

/**
 * Starts a proxy whose CONNECTs the handler answers, keeping each client's socket to destroy after the test. Returns
 * its URL, holding the credentials when given.
 */
async function startProxyWith(
  credentials: string,
  handler: (request: IncomingMessage, clientSocket: Socket, head: Buffer) => void,
): Promise<URL> {
  const server = createServer()

  server.on('connect', (request: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    proxySockets.push(clientSocket)
    handler(request, clientSocket, head)
  })

  return new URL(`http://${credentials}127.0.0.1:${await listen(server)}`)
}

/**
 * How a test proxy started by `startProxy` answers.
 */
interface ProxyBehaviour {
  /**
   * The status it answers CONNECT with, 200 unless given. With 200 it opens the tunnel.
   */
  status?: number
  /**
   * The `user:password@` its URL holds, none unless given.
   */
  credentials?: string
  /**
   * Where it opens the tunnel to, `<host>:<port>` by the CONNECT's target, for targets that aren't the real address.
   */
  routes?: Record<string, string>
}

/**
 * Starts a proxy that answers CONNECT with the status, and with 200 opens the tunnel to the target. Returns its URL
 * and what it saw.
 */
async function startProxy(behaviour: ProxyBehaviour = {}): Promise<{ proxy: URL; seen: ConnectSeen[] }> {
  const { status = 200, credentials = '', routes = {} } = behaviour
  const seen: ConnectSeen[] = []
  const proxy = await startProxyWith(credentials, (request, clientSocket, head) => {
    const target = request.url ?? ''

    seen.push({ target, authorization: request.headers['proxy-authorization'] })

    if (status !== 200) {
      clientSocket.end(`HTTP/1.1 ${status} Refused\r\nContent-Length: 0\r\n\r\n`)

      return
    }

    const [host = '', port = ''] = (routes[target] ?? target).split(':')
    const targetSocket = connect(Number(port), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      targetSocket.write(head)
      targetSocket.pipe(clientSocket)
      clientSocket.pipe(targetSocket)
    })

    proxySockets.push(targetSocket)
  })

  return { proxy, seen }
}

/**
 * The message the download fails with, or `''` when it succeeds.
 */
async function failureOf(download: Promise<unknown>): Promise<string> {
  return download.then(
    () => '',
    (error: Error) => error.message,
  )
}

/**
 * Downloads the URL into the test's destination, through the proxy and with the idle timeout when given, collecting
 * the progress.
 */
async function download(
  url: string,
  options: { proxy?: URL; idleTimeoutMs?: number } = {},
): Promise<{ hash: string; progress: string }> {
  let progress = ''
  const hash = await downloadFile({
    url: new URL(url),
    destination,
    label,
    proxy: options.proxy,
    ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
    progress: (text) => {
      progress += text
    },
  })

  return { hash, progress }
}

describe('downloadFile', () => {
  it('saves the body and gives its SHA-256', async () => {
    const body = bytesOf(300_000)
    const base = await serve((_request, response) => {
      response.end(body)
    })

    const { hash } = await download(`${base}/zip`)

    expect(readFileSync(destination)).toEqual(body)
    expect(hash).toBe(sha256Of(body))
  })

  it('follows a relative redirect', async () => {
    const body = bytesOf(1000)
    const base = await serve((request, response) => {
      if (request.url === '/moved/zip') {
        response.end(body)

        return
      }

      response.writeHead(302, { location: '../moved/zip' })
      response.end()
    })

    const { hash } = await download(`${base}/old/zip`)

    expect(hash).toBe(sha256Of(body))
    expect(readFileSync(destination)).toEqual(body)
  })

  it('follows 5 redirects and fails on the 6th', async () => {
    const body = bytesOf(10)
    const base = await serve((request, response) => {
      const hop = Number(request.url?.slice(1))

      if (hop === 5) {
        response.end(body)

        return
      }

      response.writeHead(301, { location: `/${hop + 1}` })
      response.end()
    })

    await expect(download(`${base}/0`)).resolves.toMatchObject({ hash: sha256Of(body) })

    const tooFar = download(`${base}/-1`)

    await expect(tooFar).rejects.toThrow(BrowserDownloadError)
    await expect(tooFar).rejects.toThrow(`The download of ${label} from ${base}/-1 failed: more than 5 redirects.`)
  })

  it('fails on a status that is not 2xx and leaves no file', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(404)
      response.end('Not Found')
    })

    const result = download(`${base}/zip`)

    await expect(result).rejects.toThrow(BrowserDownloadError)
    await expect(result).rejects.toThrow(`The download of ${label} from ${base}/zip failed with HTTP 404.`)
    expect(existsSync(destination)).toBe(false)
  })

  it('names the URL it was redirected to when that one fails', async () => {
    const base = await serve((request, response) => {
      if (request.url === '/zip') {
        response.writeHead(307, { location: '/gone' })
      } else {
        response.writeHead(410)
      }

      response.end()
    })

    await expect(download(`${base}/zip`)).rejects.toThrow(
      `The download of ${label} from ${base}/gone failed with HTTP 410.`,
    )
  })

  it('fails with the network error when nothing listens', async () => {
    const base = `http://127.0.0.1:${await takeUnusedPort()}`

    const result = download(`${base}/zip`)

    await expect(result).rejects.toThrow(BrowserDownloadError)
    await expect(result).rejects.toThrow(`The download of ${label} from ${base}/zip failed: connect ECONNREFUSED`)
  })

  it('names every refused address of a host that has several', async () => {
    const base = `http://localhost:${await takeUnusedPort()}`

    const message = await failureOf(download(`${base}/zip`))

    // localhost can have an IPv6 and an IPv4 address, which Node reports together with no message of its own. The IPv6
    // one can fail with another code, such as EADDRNOTAVAIL in some containers.
    expect(message).toMatch(/ failed: connect E[A-Z]+ [^,]+(, connect E[A-Z]+ [^,]+)?\.$/)
    expect(message.startsWith(`The download of ${label} from ${base}/zip failed: connect E`)).toBe(true)
  })

  it('prints where it downloads from, then each 10 % step when the size is known', async () => {
    const body = bytesOf(2_000_000)
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-length': body.length })

      for (let start = 0; start < body.length; start += 64_000) {
        response.write(body.subarray(start, start + 64_000))
      }

      response.end()
    })

    const { progress } = await download(`${base}/zip`)

    expect(progress).toBe(
      [
        `Downloading ${label} from ${base}/zip`,
        ...[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((percent) => `${label}: ${percent}% of 2.0 MB`),
        '',
      ].join('\n'),
    )
  })

  it('prints every 10 MB when the size is unknown', async () => {
    const body = bytesOf(25_000_000)
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'transfer-encoding': 'chunked' })
      response.end(body)
    })

    const { hash, progress } = await download(`${base}/zip`)

    expect(hash).toBe(sha256Of(body))
    expect(progress).toBe(
      [`Downloading ${label} from ${base}/zip`, `${label}: 10 MB`, `${label}: 20 MB`, ''].join('\n'),
    )
  })

  it('never prints the credentials in the URL', async () => {
    const base = await serve((_request, response) => {
      response.end('zip')
    })

    const { progress } = await download(`${base.replace('//', '//user:secret@')}/zip`)

    expect(progress.split('\n')[0]).toBe(`Downloading ${label} from ${base}/zip`)
    expect(progress).not.toContain('secret')
  })

  it('fails when the server stops sending, and removes the partial file', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-length': 1000 })
      response.write(bytesOf(100))
    })

    const result = download(`${base}/zip`, { idleTimeoutMs: 100 })

    await expect(result).rejects.toThrow(BrowserDownloadError)
    await expect(result).rejects.toThrow(`The download of ${label} from ${base}/zip stalled: no data came for 0.1 s.`)
    expect(existsSync(destination)).toBe(false)
  })

  it('fails when the connection drops before the body ends, and removes the partial file', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-length': 1000 })
      response.write(bytesOf(100), () => {
        response.socket?.destroy()
      })
    })

    const result = download(`${base}/zip`)

    await expect(result).rejects.toThrow(BrowserDownloadError)
    await expect(result).rejects.toThrow(
      `The download of ${label} from ${base}/zip failed: the connection closed before the download finished.`,
    )
    expect(existsSync(destination)).toBe(false)
  })

  it('fails when the server stops before the headers', async () => {
    const base = await serve(() => undefined)

    await expect(download(`${base}/zip`, { idleTimeoutMs: 100 })).rejects.toThrow(
      `The download of ${label} from ${base}/zip stalled: no data came for 0.1 s.`,
    )
  })

  describe('through a proxy', () => {
    it('downloads through the CONNECT tunnel', async () => {
      const body = bytesOf(50_000)
      const base = await serve((_request, response) => {
        response.end(body)
      })
      const { proxy, seen } = await startProxy()

      const { hash } = await download(`${base}/zip`, { proxy })

      expect(hash).toBe(sha256Of(body))
      expect(seen).toEqual([{ target: base.replace('http://', ''), authorization: undefined }])
    })

    it('names the default port in the CONNECT but not in the Host header', async () => {
      let host: string | undefined
      const base = await serve((request, response) => {
        host = request.headers.host
        response.end('zip')
      })
      const { proxy, seen } = await startProxy({ routes: { 'target.test:80': base.replace('http://', '') } })

      await download('http://target.test/zip', { proxy })

      expect(seen.map((connect) => connect.target)).toEqual(['target.test:80'])
      expect(host).toBe('target.test')
    })

    it('sends the proxy credentials, decoded, as Basic authorization', async () => {
      const base = await serve((_request, response) => {
        response.end('zip')
      })
      const { proxy, seen } = await startProxy({ credentials: 'us%20er:p%40ss@' })

      await download(`${base}/zip`, { proxy })

      expect(seen[0]?.authorization).toBe(`Basic ${Buffer.from('us er:p@ss').toString('base64')}`)
    })

    it('opens a new tunnel for each redirect', async () => {
      const base = await serve((request, response) => {
        if (request.url === '/zip') {
          response.writeHead(302, { location: '/moved' })
          response.end()

          return
        }

        response.end('zip')
      })
      const { proxy, seen } = await startProxy()

      await download(`${base}/zip`, { proxy })

      expect(seen).toHaveLength(2)
    })

    it('speaks TLS through the tunnel to an https URL', async () => {
      const base = await serve((_request, response) => {
        response.end('zip')
      })
      const { proxy } = await startProxy()
      const secureBase = base.replace('http://', 'https://')

      // The target speaks plain HTTP, so a request sent without TLS would succeed and a TLS handshake fails.
      const result = download(`${secureBase}/zip`, { proxy })

      await expect(result).rejects.toThrow(`The download of ${label} from ${secureBase}/zip failed: `)
      await expect(result).rejects.toThrow(/wrong version number/)
    })

    it('fails when the proxy never answers the CONNECT, which names port 443 by default', async () => {
      const targets: (string | undefined)[] = []
      const proxy = await startProxyWith('', (request) => {
        targets.push(request.url)
      })

      await expect(download('https://storage.example.com/zip', { proxy, idleTimeoutMs: 100 })).rejects.toThrow(
        `The download of ${label} from https://storage.example.com/zip failed: ` +
          `the proxy ${proxy.origin} didn't answer the CONNECT within 0.1 s.`,
      )
      expect(targets).toEqual(['storage.example.com:443'])
    })

    it('fails to reach a proxy that nothing listens on, naming every refused address', async () => {
      const proxy = new URL(`http://localhost:${await takeUnusedPort()}`)

      const message = await failureOf(download('https://storage.example.com/zip', { proxy }))

      expect(
        message.startsWith(
          `The download of ${label} from https://storage.example.com/zip failed: ` +
            `couldn't reach the proxy ${proxy.origin}: connect E`,
        ),
      ).toBe(true)
      expect(message).toMatch(/: connect E[A-Z]+ [^,]+(, connect E[A-Z]+ [^,]+)?\.$/)
    })

    it('fails as stalled when the TLS handshake through the tunnel gets no answer', async () => {
      const proxy = await startProxyWith('', (_request, clientSocket) => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      })

      await expect(download('https://storage.example.com/zip', { proxy, idleTimeoutMs: 100 })).rejects.toThrow(
        `The download of ${label} from https://storage.example.com/zip stalled: no data came for 0.1 s.`,
      )
    })

    it('fails when the proxy refuses the tunnel, naming the proxy without its credentials', async () => {
      const base = await serve((_request, response) => {
        response.end('zip')
      })
      const { proxy } = await startProxy({ status: 407, credentials: 'user:secret@' })
      const proxyOrigin = proxy.origin

      const result = download(`${base}/zip`, { proxy })

      await expect(result).rejects.toThrow(BrowserDownloadError)
      await expect(result).rejects.toThrow(
        `The download of ${label} from ${base}/zip failed: the proxy ${proxyOrigin} answered HTTP 407.`,
      )
      expect(existsSync(destination)).toBe(false)
    })
  })
})
