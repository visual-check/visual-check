import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import { isIP, type Socket } from 'node:net'
import { pipeline } from 'node:stream/promises'
import * as tls from 'node:tls'
import { BrowserDownloadError } from './browser-download-error.js'
import { portOf, unbracketed } from './proxy.js'

/**
 * How long a download waits for data before it counts as stalled, unless `idleTimeoutMs` says otherwise.
 */
const defaultIdleTimeoutMs = 60_000

/**
 * The most redirects a download follows.
 */
const maxRedirects = 5

/**
 * The statuses that send a request on to the URL in their `Location`.
 */
const redirectStatuses = new Set([301, 302, 303, 307, 308])

/**
 * What `downloadFile` fetches, where it writes it, and where its progress goes.
 */
export interface DownloadFileOptions {
  /**
   * The URL to download.
   */
  url: URL
  /**
   * The file to write. Its folder exists.
   */
  destination: string
  /**
   * What is downloaded, as progress and errors name it, such as `Chromium 157.0.8103.78 (mac-arm64)`.
   */
  label: string
  /**
   * The proxy every request, redirects included, tunnels through with CONNECT, or `undefined` to connect directly.
   */
  proxy: URL | undefined
  /**
   * How long, in milliseconds, the download waits for data before it counts as stalled. 60 s unless given.
   */
  idleTimeoutMs?: number
  /**
   * Takes each line of progress, newline included.
   */
  progress: (text: string) => void
}

/**
 * The URL as messages print it, without credentials.
 */
function printable(url: URL): string {
  const copy = new URL(url)

  copy.username = ''
  copy.password = ''

  return copy.href
}

/**
 * A size in megabytes as progress prints it: one decimal under 10 MB, none from there.
 */
function megabytes(bytes: number): string {
  const value = bytes / 1_000_000

  return value < 10 ? value.toFixed(1) : String(Math.round(value))
}

/**
 * Builds what reports the bytes received so far: each 10 % step when the size is known, else every 10 MB. A chunk that
 * crosses several steps reports each of them, so the lines don't depend on how the data was split.
 */
function progressReporter(
  label: string,
  size: number | undefined,
  progress: (text: string) => void,
): (received: number) => void {
  let reported = 0

  return (received) => {
    const steps =
      size === undefined ? Math.floor(received / 10_000_000) : Math.min(10, Math.floor((received * 10) / size))

    while (reported < steps) {
      reported += 1
      progress(
        size === undefined
          ? `${label}: ${megabytes(reported * 10_000_000)} MB\n`
          : `${label}: ${reported * 10}% of ${megabytes(size)} MB\n`,
      )
    }
  }
}

/**
 * The response's size from its `Content-Length`, or `undefined` when it has none.
 */
function sizeOf(response: http.IncomingMessage): number | undefined {
  const size = Number(response.headers['content-length'])

  return Number.isFinite(size) && size > 0 ? size : undefined
}

/**
 * What went wrong, as a message says it. Node's `aborted`, which a response gets when its connection closes before the
 * body ends, says so in words. An `AggregateError`, which Node raises with no message when every address of a host
 * refuses, gives its errors' messages. An error with no message gives its code.
 */
function causeOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }

  const code = (error as NodeJS.ErrnoException).code

  if (error.message === 'aborted' && code === 'ECONNRESET') {
    return 'the connection closed before the download finished'
  }

  if (error instanceof AggregateError && error.errors.length > 0) {
    return [...new Set(error.errors.map(causeOf))].join(', ')
  }

  return error.message !== '' ? error.message : (code ?? error.name)
}

/**
 * One download as it runs: the URL it is at, the sockets it opened and the first problem they hit. Every socket closes
 * once it settles.
 */
class Transfer {
  /**
   * What `downloadFile` was given.
   */
  readonly #options: DownloadFileOptions

  /**
   * How long a socket waits for data before the download counts as stalled.
   */
  readonly #idleTimeoutMs: number

  /**
   * Every socket the download opened.
   */
  readonly #sockets = new Set<Socket>()

  /**
   * The URL being requested: the first, then each redirect's.
   */
  #url: URL

  /**
   * The first problem, which is what the user reads, rather than the `aborted` that closing the sockets leaves on a
   * response.
   */
  #problem: BrowserDownloadError | undefined

  /**
   * The proxy while a CONNECT to it waits for its answer, so a failure then is put down to reaching the proxy.
   */
  #connectingTo: URL | undefined

  /**
   * Prepares the download. Nothing is sent until `run`.
   */
  constructor(options: DownloadFileOptions) {
    this.#options = options
    this.#idleTimeoutMs = options.idleTimeoutMs ?? defaultIdleTimeoutMs
    this.#url = options.url
  }

  /**
   * Downloads the file and gives its SHA-256 as lowercase hex. On a failure, removes the partial file.
   *
   * @throws {BrowserDownloadError} The first problem the download hit.
   */
  async run(): Promise<string> {
    const { url, destination, label, progress } = this.#options

    progress(`Downloading ${label} from ${printable(url)}\n`)

    try {
      return await this.#save(await this.#fileResponse())
    } catch (error) {
      const problem = this.#fail(error)

      await rm(destination, { force: true }).catch(() => undefined)

      throw problem
    } finally {
      this.#close()
    }
  }

  /**
   * An error saying the download from a URL, the current one unless given, went wrong as `rest` says.
   */
  #error(rest: string, url = this.#url): BrowserDownloadError {
    return new BrowserDownloadError(`The download of ${this.#options.label} from ${printable(url)} ${rest}`)
  }

  /**
   * An error saying the download failed for the cause, put down to reaching the proxy while a CONNECT waits.
   */
  #failedWith(cause: string): BrowserDownloadError {
    const proxy = this.#connectingTo === undefined ? '' : `couldn't reach the proxy ${this.#connectingTo.origin}: `

    return this.#error(`failed: ${proxy}${cause}.`)
  }

  /**
   * Keeps the first problem and closes every socket, so whatever waits on them fails too. Gives the problem kept.
   */
  #fail(error: unknown): BrowserDownloadError {
    this.#problem ??= error instanceof BrowserDownloadError ? error : this.#failedWith(causeOf(error))
    this.#close()

    return this.#problem
  }

  /**
   * Closes every socket the download opened.
   */
  #close(): void {
    for (const socket of this.#sockets) {
      socket.destroy()
    }
  }

  /**
   * The error for a socket that got no data for the idle timeout. While a CONNECT waits, the proxy wasn't reached when
   * the socket is still connecting, and didn't answer when it connected. Otherwise the download stalled.
   */
  #silenceOf(socket: Socket): BrowserDownloadError {
    const seconds = this.#idleTimeoutMs / 1000

    if (this.#connectingTo === undefined) {
      return this.#error(`stalled: no data came for ${seconds} s.`)
    }

    if (socket.connecting) {
      return this.#failedWith(`no connection within ${seconds} s`)
    }

    return this.#error(`failed: the proxy ${this.#connectingTo.origin} didn't answer the CONNECT within ${seconds} s.`)
  }

  /**
   * Keeps the socket to close at the end, and fails the download when the socket gets no data for the idle timeout.
   */
  #watch(socket: Socket): void {
    if (this.#sockets.has(socket)) {
      return
    }

    this.#sockets.add(socket)
    socket.setTimeout(this.#idleTimeoutMs, () => {
      this.#fail(this.#silenceOf(socket))
    })
  }

  /**
   * Requests the URL, following up to 5 redirects, and gives the 2xx response that holds the file.
   */
  async #fileResponse(): Promise<http.IncomingMessage> {
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      const response = await this.#request()
      const status = response.statusCode ?? 0
      const location = response.headers.location

      if (redirectStatuses.has(status) && location !== undefined) {
        // Destroying the response closes its socket, and with it the socket's idle timeout.
        response.destroy()
        this.#url = new URL(location, this.#url)
        continue
      }

      if (status < 200 || status > 299) {
        throw this.#error(`failed with HTTP ${status}.`)
      }

      return response
    }

    throw this.#error(`failed: more than ${maxRedirects} redirects.`, this.#options.url)
  }

  /**
   * Sends a GET for the current URL, through a tunnel when there's a proxy, and gives its response once the headers
   * arrive.
   */
  async #request(): Promise<http.IncomingMessage> {
    const url = this.#url
    const { proxy } = this.#options
    const tunnel = proxy === undefined ? undefined : await this.#tunnel(proxy)
    // A request over the tunnel has no agent, and without one Node puts port 80 in the Host header, so it's set here.
    const options =
      tunnel === undefined ? { agent: false } : { createConnection: () => tunnel, headers: { host: url.host } }

    return new Promise((resolve, reject) => {
      const request = url.protocol === 'https:' ? https.get(url, options) : http.get(url, options)

      request.on('socket', (socket) => {
        this.#watch(socket)
      })
      request.on('error', (error) => {
        reject(this.#fail(error))
      })
      request.on('response', resolve)
    })
  }

  /**
   * Opens a tunnel to the current URL's host and port through the proxy with CONNECT. Gives the socket to send the
   * request over: TLS to the host for an https URL, the tunnel itself for an http one.
   */
  async #tunnel(proxy: URL): Promise<Socket> {
    const url = this.#url
    const target = `${url.hostname}:${portOf(url)}`
    const headers: Record<string, string> = { host: target }

    if (proxy.username !== '' || proxy.password !== '') {
      const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`

      headers['proxy-authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`
    }

    this.#connectingTo = proxy

    const { status, socket, head } = await new Promise<{ status: number; socket: Socket; head: Buffer }>(
      (resolve, reject) => {
        const request = http.request({
          host: unbracketed(proxy.hostname),
          port: portOf(proxy),
          method: 'CONNECT',
          path: target,
          headers,
          agent: false,
        })

        request.on('socket', (connectSocket) => {
          this.#watch(connectSocket)
        })
        request.on('error', (error) => {
          reject(this.#fail(error))
        })
        request.on('connect', (response, connectSocket, connectHead) => {
          this.#connectingTo = undefined
          resolve({ status: response.statusCode ?? 0, socket: connectSocket, head: connectHead })
        })
        request.end()
      },
    )

    if (status !== 200) {
      throw this.#error(`failed: the proxy ${proxy.origin} answered HTTP ${status}.`)
    }

    if (head.length > 0) {
      socket.unshift(head)
    }

    if (url.protocol !== 'https:') {
      return socket
    }

    // TLS reads the tunnel from here on, so its own socket takes the idle timeout.
    socket.setTimeout(0)
    const host = unbracketed(url.hostname)

    // The certificate is checked against `host`. Without it, an IP address with no `servername` is checked against the
    // proxy's host, the one the tunnel's socket connected to.
    return tls.connect({ socket, host, ...(isIP(host) === 0 ? { servername: host } : {}) })
  }

  /**
   * Streams the response's body into the destination while hashing it and reporting progress. Gives the SHA-256 as
   * lowercase hex.
   */
  async #save(response: http.IncomingMessage): Promise<string> {
    const { destination, label, progress } = this.#options
    const hash = createHash('sha256')
    const report = progressReporter(label, sizeOf(response), progress)
    let received = 0

    await pipeline(
      response,
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          hash.update(chunk)
          received += chunk.length
          report(received)
          yield chunk
        }
      },
      createWriteStream(destination),
    )

    return hash.digest('hex')
  }
}

/**
 * Downloads the URL into the destination, following up to 5 redirects and tunnelling through the proxy when given,
 * while hashing the body as it arrives. Progress says where it downloads from, then each 10 % step, or every 10 MB
 * when the server gives no size. Leaves no partial file and no socket open.
 *
 * @throws {BrowserDownloadError} When the proxy refuses the tunnel, the server answers anything but 2xx after its
 * redirects, the network fails, or no data comes for the idle timeout.
 */
export async function downloadFile(options: DownloadFileOptions): Promise<string> {
  return new Transfer(options).run()
}
