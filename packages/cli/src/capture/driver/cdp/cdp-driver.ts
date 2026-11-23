import {
  BrowserExitedError,
  BrowserLaunchError,
  type BrowserProcess,
  type Driver,
  describeExit,
  type Page,
  type PageSetup,
  type ProcessExit,
  type StartBrowser,
} from '../driver.js'
import { CdpConnection, CdpError } from './cdp-connection.js'
import { openCdpPage } from './cdp-page.js'
import { keepLastLines } from './last-lines.js'
import { launchArguments } from './launch-arguments.js'
import { settlesWithin } from './time-limit.js'

/**
 * How many of the browser's last output lines an error carries.
 */
const outputLineLimit = 50

/**
 * Tells whether a line of the browser's output is a Chromium fatal log line, one that starts with its `[...:FATAL:`
 * prefix, which names why it exits and scrolls out of the last lines under the stack trace that follows it.
 */
function isFatalLogLine(line: string): boolean {
  return /^\[[^\]]*:FATAL:/.test(line)
}

/**
 * Tells whether the browser's output says its graphics process couldn't start: Chromium's "GPU process isn't usable"
 * line, which it logs as it exits under an emulator that can't run it, such as QEMU.
 */
function graphicsFailedIn(output: readonly string[]): boolean {
  return output.some((line) => line.includes("GPU process isn't usable"))
}

/**
 * How long the browser has to answer each of its launch calls, the version call and the target discovery call, when
 * the options don't say, in ms.
 */
const defaultLaunchTimeoutMs = 30_000

/**
 * How long `close()` waits for the browser to exit after `Browser.close`, in ms.
 */
const browserCloseGraceMs = 5_000

/**
 * How long `close()` waits for the browser to exit after ending its CDP input, in ms, before killing it.
 */
const inputEndGraceMs = 3_000

/**
 * How long a kill has to end the browser, in ms, so a kill that doesn't work can't hang a launch or `close()`.
 */
const killGraceMs = 5_000

/**
 * What `launchCdpDriver` needs to start Chromium.
 *
 * @public
 */
export interface CdpDriverOptions {
  /**
   * Whether Chromium's sandbox is on. In visual-check's container, and inside its image, it is off, because the container
   * is the boundary.
   */
  sandbox: boolean
  /**
   * The folder Chromium keeps its profile in, as the starter sees it. The starter removes it once the browser has
   * exited.
   */
  profileDir: string
  /**
   * How long the browser has to answer each of its launch calls, the version call and the target discovery call, in ms.
   * 30 000 by default.
   */
  launchTimeoutMs?: number
  /**
   * The proxy every request goes through, loopback included, such as `socks5://host.docker.internal:40123`. None when
   * not given.
   */
  proxyServer?: string
  /**
   * Starts the browser executable with the launch arguments.
   */
  start: StartBrowser
}

/**
 * What the driver keeps from the browser's answer to `Browser.getVersion`.
 */
interface BrowserVersion {
  /**
   * The browser's exact version, such as `157.0.8103.78`.
   */
  version: string
  /**
   * The browser's own user agent.
   */
  userAgent: string
}

/**
 * Reads the version and user agent out of a `Browser.getVersion` reply, or undefined when the version is missing or
 * empty, or the user agent is missing. The version is the part of `product` after its `/`, such as `157.0.8103.78` from
 * `HeadlessChrome/157.0.8103.78`, or the whole product when it has no `/`.
 */
function readBrowserVersion(reply: Record<string, unknown>): BrowserVersion | undefined {
  const { product, userAgent } = reply

  if (typeof product !== 'string' || typeof userAgent !== 'string') {
    return undefined
  }

  const version = product.slice(product.indexOf('/') + 1)

  return version === '' ? undefined : { version, userAgent }
}

/**
 * A started browser with a CDP connection on its pipe. It reads the browser's output from the start and keeps its
 * last lines, makes the browser's launch calls, closes the connection when the process exits, and shuts the process
 * down.
 */
class BrowserSession {
  /**
   * The CDP connection on the browser's pipe.
   */
  readonly connection: CdpConnection

  /**
   * Settles when the browser exits other than through `close()`, and never once `close()` has been called.
   */
  readonly exited: Promise<BrowserExitedError>

  /**
   * The browser's process.
   */
  private readonly browser: BrowserProcess

  /**
   * Gives the browser's last output lines.
   */
  private readonly lastLines: () => string[]

  /**
   * The shutdown `close()` started, or undefined before it is called.
   */
  private closing: Promise<void> | undefined

  /**
   * Starts reading the browser's output and opens the connection on its pipe.
   */
  constructor(browser: BrowserProcess) {
    this.browser = browser
    this.lastLines = keepLastLines(browser.output, outputLineLimit, isFatalLogLine)
    this.connection = new CdpConnection(browser.toBrowser, browser.fromBrowser)
    this.exited = browser.exited.then((exit) => this.onExit(exit))
  }

  /**
   * Whether `close()` has been called.
   */
  get closeStarted(): boolean {
    return this.closing !== undefined
  }

  /**
   * Calls `Browser.getVersion` and reads its reply. Throws a `BrowserLaunchError` when the browser exits first, answers
   * with an error, or doesn't answer within `timeoutMs`; a browser still running then is killed first.
   */
  async readVersion(timeoutMs: number): Promise<BrowserVersion> {
    const reply = await this.launchCall('Browser.getVersion', {}, 'version', timeoutMs)
    const browserVersion = readBrowserVersion(reply)

    if (browserVersion === undefined) {
      await this.kill()

      throw this.launchErrorWith("The browser's answer to its version call has no version or user agent.", {
        exited: false,
      })
    }

    return browserVersion
  }

  /**
   * Turns on target discovery for `page` targets, at the browser level, so every page can see the targets that open
   * next to it, popups included. Discovery doesn't attach to any target. Throws a `BrowserLaunchError` when the browser
   * exits first, answers with an error, or doesn't answer within `timeoutMs`; a browser still running then is killed
   * first.
   */
  async discoverPageTargets(timeoutMs: number): Promise<void> {
    await this.launchCall(
      'Target.setDiscoverTargets',
      { discover: true, filter: [{ type: 'page' }] },
      'target discovery',
      timeoutMs,
    )
  }

  /**
   * Closes the browser and resolves once it has gone: `Browser.close`, then the end of its CDP input after 5 s, then a
   * kill 3 s later. It also resolves 5 s after a kill that didn't work, leaving a browser that won't die to the starter.
   * Calling it again returns the same promise.
   */
  close(): Promise<void> {
    this.closing ??= this.shutDown()

    return this.closing
  }

  /**
   * Closes the connection once the process has gone. After `close()`, pending calls fail with a plain error and
   * `exited` never settles. Otherwise they fail with a `BrowserExitedError`, which `exited` settles with.
   */
  private onExit(exit: ProcessExit): BrowserExitedError | Promise<never> {
    if (this.closing !== undefined) {
      this.connection.close(new Error('The browser was closed.'))

      return new Promise(() => undefined)
    }

    const output = this.lastLines()
    const error = new BrowserExitedError(exit, output, graphicsFailedIn(output))

    this.connection.close(error)

    return error
  }

  /**
   * Calls a method at launch and gives its reply. Throws a `BrowserLaunchError` when the browser exits first, answers
   * with an error, or doesn't answer within `timeoutMs`; a browser still running then is killed first.
   */
  private async launchCall(
    method: string,
    params: Record<string, unknown>,
    callName: string,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const call = this.connection.send(method, params)

    if (!(await settlesWithin(call, timeoutMs))) {
      await this.kill()

      throw this.launchErrorWith(`The browser didn't answer its ${callName} call within ${timeoutMs / 1000} s.`, {
        exited: false,
      })
    }

    try {
      return await call
    } catch (error) {
      throw await this.launchError(error, callName)
    }
  }

  /**
   * Builds the launch error for a failed launch call, which `callName` names, such as `version`. A browser that
   * answered with an error is killed first.
   */
  private async launchError(error: unknown, callName: string): Promise<BrowserLaunchError> {
    if (error instanceof CdpError) {
      await this.kill()

      return this.launchErrorWith(`The browser answered its ${callName} call with an error: ${error.browserMessage}`, {
        exited: false,
      })
    }

    // The connection fails a call with anything else only once the process has exited, so `exited` has settled.
    const exit = await this.browser.exited

    return this.launchErrorWith(describeExit(exit, 'before it answered'), { exited: true })
  }

  /**
   * Builds a launch error with this message, the browser's last output lines and whether the browser exited before it
   * answered, noting whether the lines say its graphics process couldn't start.
   */
  private launchErrorWith(message: string, options: { exited: boolean }): BrowserLaunchError {
    const output = this.lastLines()

    return new BrowserLaunchError(message, output, { exited: options.exited, graphicsFailed: graphicsFailedIn(output) })
  }

  /**
   * Asks the browser to close, ends its input if it is still running after 5 s, and kills it if it is still running
   * 3 s after that.
   */
  private async shutDown(): Promise<void> {
    this.connection.send('Browser.close').catch(() => undefined)

    if (await settlesWithin(this.browser.exited, browserCloseGraceMs)) {
      return
    }

    this.browser.toBrowser.end()

    if (await settlesWithin(this.browser.exited, inputEndGraceMs)) {
      return
    }

    await this.kill()
  }

  /**
   * Kills the process and resolves once it has gone, or after 5 s when the kill doesn't work.
   */
  private async kill(): Promise<void> {
    this.browser.kill()
    await settlesWithin(this.browser.exited, killGraceMs)
  }
}

/**
 * Chromium driven over raw CDP, once it has answered its version call and has target discovery on.
 */
class CdpDriver implements Driver {
  /**
   * The browser's exact version, such as `157.0.8103.78`.
   */
  readonly version: string

  /**
   * The browser's own user agent, which pages extend with ` StorybookTestRunner`.
   */
  readonly userAgent: string

  /**
   * Settles when the browser exits other than through `close()`.
   */
  readonly exited: Promise<BrowserExitedError>

  /**
   * The started browser and its connection.
   */
  private readonly session: BrowserSession

  /**
   * Wraps a session whose browser has answered its version call and has target discovery on.
   */
  constructor(session: BrowserSession, browserVersion: BrowserVersion) {
    this.session = session
    this.version = browserVersion.version
    this.userAgent = browserVersion.userAgent
    this.exited = session.exited
  }

  /**
   * Opens a page in a fresh browser context, set up once, with the browser's user agent extended by the setup's suffix.
   * Rejects at once after `close()` has started, and when the page isn't open within 30 s.
   */
  newPage(setup: PageSetup): Promise<Page> {
    if (this.session.closeStarted) {
      return Promise.reject(new Error("The browser is closing, so it can't open a page."))
    }

    return openCdpPage(this.session.connection, this.userAgent, setup)
  }

  /**
   * Closes the browser and resolves once it has gone, or 5 s after a kill that didn't work, leaving a browser that won't
   * die to the starter. Calling it again returns the same promise.
   */
  close(): Promise<void> {
    return this.session.close()
  }
}

/**
 * Starts Chromium with Playwright's launch arguments and connects to it over raw CDP on its pipe. Resolves once the
 * browser has answered its version call and turned on target discovery for pages, which the pages need to close the
 * popups they open. Throws a `BrowserLaunchError`, with the browser's last output lines, when the browser exits before
 * answering either call, doesn't answer one within the launch timeout, or answers one with an error.
 *
 * @public
 */
export async function launchCdpDriver(options: CdpDriverOptions): Promise<Driver> {
  const session = new BrowserSession(options.start(launchArguments(options)))
  const launchTimeoutMs = options.launchTimeoutMs ?? defaultLaunchTimeoutMs
  const browserVersion = await session.readVersion(launchTimeoutMs)

  await session.discoverPageTargets(launchTimeoutMs)

  return new CdpDriver(session, browserVersion)
}
