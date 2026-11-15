import { type CdpConnection, type CdpEvent, isRecord } from './cdp-connection.js'

/**
 * The resource types of the requests a page sends that can count as real network requests, as
 * `Network.requestWillBeSent` names them. Fonts, stylesheets, images and scripts never count.
 */
const watchedResourceTypes: ReadonlySet<unknown> = new Set(['Fetch', 'XHR', 'EventSource'])

/**
 * The scheme of the origin a request's URL is compared with, by the URL's own scheme: a WebSocket's is the scheme of
 * the page it would share an origin with, so a socket to the Storybook's own host and port isn't counted.
 */
const originSchemes: ReadonlyMap<string, string> = new Map([
  ['http:', 'http:'],
  ['https:', 'https:'],
  ['ws:', 'http:'],
  ['wss:', 'https:'],
])

/**
 * The parameters each `Network.enable` goes with: no response or request body is kept for later reading, since nothing
 * reads one, so watching holds no bodies in memory. The events come all the same.
 */
const networkEnableParams = { maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0 }

/**
 * A request the page sent that can count, as the page's session reported it.
 */
interface WatchedRequest {
  /**
   * The URL the request went to, the last one a redirect took it to.
   */
  url: string
  /**
   * Whether it is a WebSocket, which a service worker can't answer.
   */
  socket: boolean
  /**
   * Whether its response came through a service worker, or undefined while it has no response, as when it is still
   * pending or failed.
   */
  fromServiceWorker: boolean | undefined
}

/**
 * Gives the host of a request's URL, such as `api.example.com` or `127.0.0.1:6007`, when the request went over the
 * network to an origin other than `pageOrigin`: an `http:`, `https:`, `ws:` or `wss:` URL whose origin, with `ws:` read
 * as `http:` and `wss:` as `https:`, isn't the page's. Gives undefined for any other URL.
 */
function foreignHostOf(url: string, pageOrigin: string | undefined): string | undefined {
  if (!URL.canParse(url)) {
    return undefined
  }

  const { protocol, host } = new URL(url)
  const originScheme = originSchemes.get(protocol)

  if (originScheme === undefined || `${originScheme}//${host}` === pageOrigin) {
    return undefined
  }

  return host
}

/**
 * Watches the real network requests a page makes, for a page whose setup asks for it. It turns on the Network domain
 * in the page's session, and has that session report the browser's service workers. It attaches to every service
 * worker of the page's own browser context, at the browser level, in a flat session, and turns the Network domain on
 * there too. A service worker of another browser context is never attached. Watching service workers is best-effort:
 * a command for it that fails changes nothing for the page. A worker counts as watched once the browser has answered
 * its `Network.enable`, and no longer once its session detaches.
 *
 * Service workers are found by discovery rather than auto-attach, so a worker isn't paused when it starts: the requests
 * a newly started worker passes on before its `Network.enable` lands go unseen, and since the page's response for each
 * says it came through a service worker, they don't count. Page-session auto-attach that waits for the debugger would
 * close that gap, but in Chromium 157 the documents in the worker's scope then load without the worker controlling
 * them. Only the page's own session and its service workers' are watched: requests a dedicated worker or an
 * out-of-process iframe sends come from other targets, and go unseen.
 *
 * From the page's session it keeps the `fetch`, XHR and EventSource requests and the WebSockets the page sends, and
 * whether each response came through a service worker. From its service workers' sessions it keeps the URLs they send
 * requests to, which are the requests a worker passed on, to the network or the HTTP cache. Both are forgotten when
 * the main frame commits a new document, so nothing is kept across documents.
 *
 * A request counts as a real network request when its URL is `http:`, `https:`, `ws:` or `wss:` and its origin isn't
 * the page's, and:
 *
 * - it is a WebSocket, which a service worker can't answer;
 * - or its response didn't come through a service worker, a response from the HTTP cache included;
 * - or a service worker of the page's context sent a request for the same URL, so the worker passed it on;
 * - or it has no response, as when it is still pending or failed, and no service worker of the page's context is
 *   watched.
 *
 * So a response a service worker built itself, as MSW's does, doesn't count.
 */
export class RequestWatch {
  /**
   * The browser's CDP connection.
   */
  private readonly connection: CdpConnection

  /**
   * The page's browser context, whose service workers are attached.
   */
  private readonly browserContextId: string

  /**
   * The page's flat CDP session.
   */
  private readonly sessionId: string

  /**
   * The sessions of the attached service workers of the page's browser context, from the browser's answer to the
   * attach until the browser says the session detached or fails its `Network.enable`, each with whether it is watched:
   * true once the browser has answered its `Network.enable`.
   */
  private readonly workerSessions = new Map<string, boolean>()

  /**
   * The requests the page sent that can count, since the main frame last committed a document, by request id, in the
   * order first sent.
   */
  private readonly requests = new Map<string, WatchedRequest>()

  /**
   * The URLs the attached service workers sent requests to since the main frame last committed a document.
   */
  private readonly workerUrls = new Set<string>()

  /**
   * Watches the page with this browser context and session, on this connection.
   */
  constructor(connection: CdpConnection, browserContextId: string, sessionId: string) {
    this.connection = connection
    this.browserContextId = browserContextId
    this.sessionId = sessionId
  }

  /**
   * Starts the commands that set watching up, in the page's session: the Network domain, which the page's setup waits
   * for, and the discovery of service workers, which reports the ones that already run too. Its failure is taken in,
   * so it never fails the setup.
   */
  setUp(): Promise<unknown>[] {
    return [
      this.connection.send('Network.enable', networkEnableParams, this.sessionId),
      this.connection
        .send('Target.setDiscoverTargets', { discover: true, filter: [{ type: 'service_worker' }] }, this.sessionId)
        .catch(() => undefined),
    ]
  }

  /**
   * Takes in an event: a request, a WebSocket or a response of the page's session, a service worker the page's session
   * discovered, a request of an attached service worker's session, or the detach of such a session.
   */
  observe(event: CdpEvent): void {
    if (event.sessionId === this.sessionId) {
      this.observePage(event)
    } else if (event.sessionId !== undefined && this.workerSessions.has(event.sessionId)) {
      this.observeWorker(event)
    } else if (event.sessionId === undefined && event.method === 'Target.detachedFromTarget') {
      this.workerSessions.delete(String(event.params.sessionId))
    }
  }

  /**
   * Forgets the requests the page and its service workers sent, as when the main frame commits a new document, whose
   * requests the old document's can't follow.
   */
  reset(): void {
    this.requests.clear()
    this.workerUrls.clear()
  }

  /**
   * Gives the hosts of the requests that count as real network requests, each once, in the order first sent, for a
   * page whose document has this origin, or undefined when it is opaque.
   */
  hosts(pageOrigin: string | undefined): string[] {
    const hosts = new Set<string>()

    for (const request of this.requests.values()) {
      const host = foreignHostOf(request.url, pageOrigin)

      if (host !== undefined && this.isReal(request)) {
        hosts.add(host)
      }
    }

    return [...hosts]
  }

  /**
   * Says whether a request went over the network, as far as the page and its service workers tell.
   */
  private isReal(request: WatchedRequest): boolean {
    if (request.socket || request.fromServiceWorker === false || this.workerUrls.has(request.url)) {
      return true
    }

    return request.fromServiceWorker === undefined && !this.watchesWorker()
  }

  /**
   * Says whether a service worker of the page's browser context is watched.
   */
  private watchesWorker(): boolean {
    for (const watched of this.workerSessions.values()) {
      if (watched) {
        return true
      }
    }

    return false
  }

  /**
   * Takes in an event of the page's session: keeps a request or WebSocket that can count, notes whether a response came
   * through a service worker, and attaches to a service worker of the page's browser context.
   */
  private observePage(event: CdpEvent): void {
    const { method, params } = event
    const requestId = String(params.requestId)

    if (method === 'Network.requestWillBeSent' && watchedResourceTypes.has(params.type) && isRecord(params.request)) {
      this.requests.set(requestId, { url: String(params.request.url), socket: false, fromServiceWorker: undefined })
    } else if (method === 'Network.webSocketCreated') {
      this.requests.set(requestId, { url: String(params.url), socket: true, fromServiceWorker: undefined })
    } else if (method === 'Network.responseReceived' && isRecord(params.response)) {
      const request = this.requests.get(requestId)

      if (request !== undefined) {
        request.fromServiceWorker = params.response.fromServiceWorker === true
      }
    } else if (method === 'Target.targetCreated') {
      this.attachToWorker(params.targetInfo)
    }
  }

  /**
   * Takes in an event of an attached service worker's session: keeps the URL of a request it sent.
   */
  private observeWorker(event: CdpEvent): void {
    const { request } = event.params

    if (event.method === 'Network.requestWillBeSent' && isRecord(request)) {
      this.workerUrls.add(String(request.url))
    }
  }

  /**
   * Attaches to the target a `Target.targetCreated` event describes, at the browser level, in a flat session, and
   * turns the Network domain on in that session, when the target is a service worker of the page's browser context.
   * Its session's requests are kept from the attach on, and the worker counts as watched once `Network.enable` is
   * answered. The commands are not awaited, and a failed one changes nothing but that: the worker's requests then go
   * unseen, and it isn't watched.
   */
  private attachToWorker(targetInfo: unknown): void {
    if (
      !isRecord(targetInfo) ||
      targetInfo.type !== 'service_worker' ||
      targetInfo.browserContextId !== this.browserContextId
    ) {
      return
    }

    this.connection
      .send('Target.attachToTarget', { targetId: targetInfo.targetId, flatten: true })
      .then((reply: Record<string, unknown>) => {
        if (typeof reply.sessionId === 'string') {
          this.watchWorker(reply.sessionId)
        }
      })
      .catch(() => undefined)
  }

  /**
   * Turns the Network domain on in an attached service worker's session, and marks the worker as watched once the
   * browser has answered, unless its session detached first. Forgets the session when the browser fails the command.
   */
  private watchWorker(workerSessionId: string): void {
    this.workerSessions.set(workerSessionId, false)
    this.connection.send('Network.enable', networkEnableParams, workerSessionId).then(
      () => {
        if (this.workerSessions.has(workerSessionId)) {
          this.workerSessions.set(workerSessionId, true)
        }
      },
      () => {
        this.workerSessions.delete(workerSessionId)
      },
    )
  }
}
