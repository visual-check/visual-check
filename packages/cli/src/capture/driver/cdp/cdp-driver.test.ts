import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CdpDriverOptions, launchCdpDriver } from './cdp-driver.js'
import { defaultVersionReply, FakeBrowser, pageSetup, type ReceivedCommand } from './fake-browser.fixture.js'
import { graphicsFailureOutput } from './graphics-failure.fixture.js'
import { launchArguments } from './launch-arguments.js'

/**
 * The profile folder every test launches with.
 */
const profileDir = '/tmp/visual-check-profile'

/**
 * Sixty lines of browser output.
 */
const sixtyLines = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`)

/**
 * Builds a fake browser that writes these lines as its output when asked for its version, then exits with code 133,
 * as a browser does when its graphics process dies under QEMU.
 */
function browserExitingWith(lines: readonly string[]): FakeBrowser {
  return new FakeBrowser({
    handlers: {
      'Browser.getVersion': (_command: ReceivedCommand, fake: FakeBrowser) => {
        void fake.writeOutput(lines.map((line) => `${line}\n`).join(''))
        fake.exit({ code: 133 })
      },
    },
  })
}

/**
 * Launches a driver on the fake browser, with the sandbox off unless the options say otherwise.
 */
function launch(browser: FakeBrowser, options: Partial<CdpDriverOptions> = {}) {
  return launchCdpDriver({ sandbox: false, profileDir, start: browser.start, ...options })
}

/**
 * Waits until every pending stream event and promise callback has run.
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

/**
 * Fakes the timers the driver waits with, leaving `setImmediate` real for `flush`.
 */
function fakeTimers(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('launchCdpDriver', () => {
  it('starts the browser with the launch arguments', async () => {
    const browser = new FakeBrowser()

    await launch(browser)
    expect(browser.browserArguments).toEqual(launchArguments({ sandbox: false, profileDir }))
  })

  it('passes the sandbox setting on to the launch arguments', async () => {
    const browser = new FakeBrowser()

    await launch(browser, { sandbox: true })
    expect(browser.browserArguments).toEqual(launchArguments({ sandbox: true, profileDir }))
  })

  it('reads the version from the product after its slash', async () => {
    const driver = await launch(new FakeBrowser())

    expect(driver.version).toBe('157.0.8103.78')
  })

  it('takes the whole product as the version when it has no slash', async () => {
    const browser = new FakeBrowser({
      handlers: {
        'Browser.getVersion': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.reply(command, { product: '157.0.8103.78', userAgent: 'UA' }),
      },
    })

    expect((await launch(browser)).version).toBe('157.0.8103.78')
  })

  it('ignores the events the browser sends while it starts', async () => {
    const browser = new FakeBrowser({
      handlers: {
        'Browser.getVersion': (command: ReceivedCommand, fake: FakeBrowser) => {
          fake.emit('Target.targetCreated', { targetInfo: { targetId: 't1' } })
          fake.emit('Inspector.detached', { reason: 'test' }, 'session-1')
          fake.reply(command, defaultVersionReply)
        },
      },
    })

    expect((await launch(browser)).version).toBe('157.0.8103.78')
  })

  it("fails to launch with the reason when the browser couldn't start", async () => {
    const browser = new FakeBrowser({ startError: new Error('spawn docker ENOENT') })

    await expect(launch(browser)).rejects.toMatchObject({
      name: 'BrowserLaunchError',
      message: "The browser couldn't start: spawn docker ENOENT.",
      output: [],
      exited: true,
    })
  })

  it('fails to launch with the last 50 output lines when the browser exits before answering', async () => {
    const browser = new FakeBrowser({
      handlers: {
        'Browser.getVersion': (_command: ReceivedCommand, fake: FakeBrowser) => {
          void fake.writeOutput(sixtyLines.map((line) => `${line}\n`).join(''))
          fake.exit({ code: 1 })
        },
      },
    })

    await expect(launch(browser)).rejects.toMatchObject({
      name: 'BrowserLaunchError',
      message: 'The browser exited with code 1 before it answered.',
      output: sixtyLines.slice(10),
      exited: true,
    })
  })

  it('keeps the last fatal log line first when a stack trace pushes it out of the last 50 lines', async () => {
    const fatal =
      "[1:1:1114/201503.000000:FATAL:gpu_data_manager_impl_private.cc(1)] GPU process isn't usable. Goodbye."
    const browser = new FakeBrowser({
      handlers: {
        'Browser.getVersion': (_command: ReceivedCommand, fake: FakeBrowser) => {
          void fake.writeOutput([fatal, ...sixtyLines].map((line) => `${line}\n`).join(''))
          fake.exit({ code: 133 })
        },
      },
    })

    await expect(launch(browser)).rejects.toMatchObject({
      name: 'BrowserLaunchError',
      output: [fatal, ...sixtyLines.slice(11)],
    })
  })

  it('keeps no line that only quotes the fatal marker', async () => {
    const browser = new FakeBrowser({
      handlers: {
        'Browser.getVersion': (_command: ReceivedCommand, fake: FakeBrowser) => {
          void fake.writeOutput(
            ['see [1:1:1114/201503.000000:FATAL: in the log', ...sixtyLines].map((line) => `${line}\n`).join(''),
          )
          fake.exit({ code: 133 })
        },
      },
    })

    await expect(launch(browser)).rejects.toMatchObject({ output: sixtyLines.slice(10) })
  })

  it("kills the browser and fails to launch when it doesn't answer in time", async () => {
    const browser = new FakeBrowser({
      handlers: {
        'Browser.getVersion': (_command: ReceivedCommand, fake: FakeBrowser) => {
          void fake.writeOutput('still starting\n')
        },
      },
    })

    await expect(launch(browser, { launchTimeoutMs: 50 })).rejects.toMatchObject({
      name: 'BrowserLaunchError',
      message: "The browser didn't answer its version call within 0.05 s.",
      output: ['still starting'],
      exited: false,
    })
    expect(browser.killed).toBe(true)
  })

  it("fails to launch 5 s after the kill when the browser doesn't answer and the kill doesn't work", async () => {
    fakeTimers()

    const browser = new FakeBrowser({ exitsOnKill: false, handlers: { 'Browser.getVersion': () => undefined } })
    const launching = launch(browser, { launchTimeoutMs: 1000 })
    let failed = false

    launching.catch(() => {
      failed = true
    })
    await vi.advanceTimersByTimeAsync(1000)
    await flush()
    expect(browser.killed).toBe(true)
    await vi.advanceTimersByTimeAsync(4999)
    await flush()
    expect(failed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(launching).rejects.toMatchObject({ message: "The browser didn't answer its version call within 1 s." })
  })

  it("kills the browser and fails to launch with the browser's message when it answers the version call with an error", async () => {
    const browser = new FakeBrowser({
      handlers: {
        'Browser.getVersion': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.fail(command, -32000, 'Internal error'),
      },
    })

    await expect(launch(browser)).rejects.toMatchObject({
      name: 'BrowserLaunchError',
      message: 'The browser answered its version call with an error: Internal error',
      exited: false,
    })
    expect(browser.killed).toBe(true)
  })

  it('turns on target discovery for pages, at the browser level, after the version call', async () => {
    const browser = new FakeBrowser()

    await launch(browser)
    expect(browser.received.map(({ method, params, sessionId }) => ({ method, params, sessionId }))).toEqual([
      { method: 'Browser.getVersion', params: {}, sessionId: undefined },
      {
        method: 'Target.setDiscoverTargets',
        params: { discover: true, filter: [{ type: 'page' }] },
        sessionId: undefined,
      },
    ])
  })

  it("kills the browser and fails to launch with the browser's message when target discovery fails", async () => {
    const browser = new FakeBrowser({
      handlers: {
        'Target.setDiscoverTargets': (command: ReceivedCommand, fake: FakeBrowser) =>
          fake.fail(command, -32000, 'Discovery failed'),
      },
    })

    await expect(launch(browser)).rejects.toMatchObject({
      name: 'BrowserLaunchError',
      message: 'The browser answered its target discovery call with an error: Discovery failed',
    })
    expect(browser.killed).toBe(true)
  })

  it('fails to launch when the browser exits during target discovery', async () => {
    const browser = new FakeBrowser({
      handlers: {
        'Target.setDiscoverTargets': (_command: ReceivedCommand, fake: FakeBrowser) => fake.exit({ code: 1 }),
      },
    })

    await expect(launch(browser)).rejects.toMatchObject({
      name: 'BrowserLaunchError',
      message: 'The browser exited with code 1 before it answered.',
    })
  })

  it("kills the browser and fails to launch when target discovery isn't answered in time", async () => {
    const browser = new FakeBrowser({ handlers: { 'Target.setDiscoverTargets': () => undefined } })

    await expect(launch(browser, { launchTimeoutMs: 50 })).rejects.toMatchObject({
      name: 'BrowserLaunchError',
      message: "The browser didn't answer its target discovery call within 0.05 s.",
    })
    expect(browser.killed).toBe(true)
  })

  it.each([
    [{ userAgent: 'UA' }],
    [{ product: '', userAgent: 'UA' }],
    [{ product: 'HeadlessChrome/', userAgent: 'UA' }],
    [{ product: 'HeadlessChrome/157.0.8103.78' }],
  ])(
    'kills the browser and fails to launch when its version reply has no version or user agent (%o)',
    async (reply) => {
      const browser = new FakeBrowser({
        handlers: {
          'Browser.getVersion': (command: ReceivedCommand, fake: FakeBrowser) => fake.reply(command, reply),
        },
      })

      await expect(launch(browser)).rejects.toMatchObject({
        name: 'BrowserLaunchError',
        message: "The browser's answer to its version call has no version or user agent.",
        exited: false,
      })
      expect(browser.killed).toBe(true)
    },
  )

  it('reads the browser output from the start, so a full pipe never blocks the browser', async () => {
    const browser = new FakeBrowser({
      handlers: {
        'Browser.getVersion': (command: ReceivedCommand, fake: FakeBrowser) => {
          const writes = Array.from({ length: 1024 }, () => fake.writeOutput(`${'x'.repeat(1023)}\n`))

          void Promise.all(writes).then(() => fake.reply(command, defaultVersionReply))
        },
      },
    })

    expect((await launch(browser, { launchTimeoutMs: 2000 })).version).toBe('157.0.8103.78')
  })

  it.each([
    [{ code: 1 }, 'The browser exited with code 1 while in use.'],
    [{ signal: 'SIGSEGV' }, 'The browser was killed by signal SIGSEGV while in use.'],
  ])('settles exited with a BrowserExitedError when the browser exits on its own (%o)', async (exit, message) => {
    const browser = new FakeBrowser()
    const driver = await launch(browser)

    await browser.writeOutput('one\ntwo\n')
    browser.exit(exit)
    await expect(driver.exited).resolves.toMatchObject({
      name: 'BrowserExitedError',
      message,
      output: ['one', 'two'],
      graphicsFailed: false,
    })
  })
})

describe("a browser whose graphics process can't start", () => {
  it('fails to launch with graphicsFailed for the reconstructed output of one under QEMU', async () => {
    await expect(launch(browserExitingWith(graphicsFailureOutput))).rejects.toMatchObject({
      name: 'BrowserLaunchError',
      output: graphicsFailureOutput,
      graphicsFailed: true,
    })
  })

  it('fails to launch with graphicsFailed when a long trailer follows the fatal line', async () => {
    await expect(launch(browserExitingWith([...graphicsFailureOutput, ...sixtyLines]))).rejects.toMatchObject({
      name: 'BrowserLaunchError',
      graphicsFailed: true,
    })
  })

  it.each([
    ['an ordinary crash', ['[1:1:1114/201502.1:ERROR:content/renderer.cc:1] Renderer killed: out of memory', 'bye']],
    ['a missing library', ['error while loading shared libraries: libnss3.so: cannot open shared object file']],
    ['GPU process errors without the fatal line', graphicsFailureOutput.slice(0, -1)],
    ['no output', []],
  ])('fails to launch without graphicsFailed for %s', async (_name, lines) => {
    await expect(launch(browserExitingWith(lines))).rejects.toMatchObject({
      name: 'BrowserLaunchError',
      graphicsFailed: false,
    })
  })

  it('settles exited with graphicsFailed when the browser exits so while in use', async () => {
    const browser = new FakeBrowser()
    const driver = await launch(browser)

    await browser.writeOutput(graphicsFailureOutput.map((line) => `${line}\n`).join(''))
    browser.exit({ code: 133 })
    await expect(driver.exited).resolves.toMatchObject({ name: 'BrowserExitedError', graphicsFailed: true })
  })
})

describe('Driver.newPage', () => {
  it('rejects at once, opening nothing, once close() has started', async () => {
    const browser = new FakeBrowser()
    const driver = await launch(browser)
    const closing = driver.close()

    await expect(driver.newPage(pageSetup)).rejects.toThrow("The browser is closing, so it can't open a page.")
    await closing
    expect(browser.received.map((command) => command.method)).toEqual([
      'Browser.getVersion',
      'Target.setDiscoverTargets',
      'Browser.close',
    ])
  })
})

describe('Driver.close', () => {
  it('sends Browser.close, resolves once the browser has exited, and leaves exited unsettled', async () => {
    const browser = new FakeBrowser({
      handlers: { 'Browser.close': (command: ReceivedCommand, fake: FakeBrowser) => fake.reply(command, {}) },
    })
    const driver = await launch(browser)
    let exitedSettled = false
    let closed = false

    void driver.exited.then(() => {
      exitedSettled = true
    })

    const closing = driver.close().then(() => {
      closed = true
    })

    await flush()
    expect(browser.received.map((command) => command.method)).toEqual([
      'Browser.getVersion',
      'Target.setDiscoverTargets',
      'Browser.close',
    ])
    expect(closed).toBe(false)
    browser.exit({ code: 0 })
    await closing
    await flush()
    expect(exitedSettled).toBe(false)
    expect(browser.killed).toBe(false)
  })

  it('returns the same promise when called again, and sends Browser.close once', async () => {
    const browser = new FakeBrowser()
    const driver = await launch(browser)
    const first = driver.close()

    expect(driver.close()).toBe(first)
    await first
    expect(driver.close()).toBe(first)
    expect(browser.received.filter((command) => command.method === 'Browser.close')).toHaveLength(1)
  })

  it('ends the input after 5 s and kills the browser 3 s later when it ignores both', async () => {
    const browser = new FakeBrowser({ exitsOnInputEnd: false, handlers: { 'Browser.close': () => undefined } })
    const driver = await launch(browser)

    fakeTimers()

    const closing = driver.close()

    await vi.advanceTimersByTimeAsync(4999)
    await flush()
    expect(browser.inputEnded).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await flush()
    expect(browser.inputEnded).toBe(true)
    await vi.advanceTimersByTimeAsync(2999)
    await flush()
    expect(browser.killed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await flush()
    expect(browser.killed).toBe(true)
    await closing
  })

  it("resolves 5 s after the kill when the kill doesn't work", async () => {
    const browser = new FakeBrowser({
      exitsOnInputEnd: false,
      exitsOnKill: false,
      handlers: { 'Browser.close': () => undefined },
    })
    const driver = await launch(browser)

    fakeTimers()

    let closed = false
    const closing = driver.close().then(() => {
      closed = true
    })

    await vi.advanceTimersByTimeAsync(8000)
    await flush()
    expect(browser.killed).toBe(true)
    await vi.advanceTimersByTimeAsync(4999)
    await flush()
    expect(closed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await closing
  })

  it('stops at the end of the input when the browser exits then', async () => {
    const browser = new FakeBrowser({ handlers: { 'Browser.close': () => undefined } })
    const driver = await launch(browser)

    fakeTimers()

    const closing = driver.close()

    await vi.advanceTimersByTimeAsync(5000)
    await closing
    expect(browser.inputEnded).toBe(true)
    expect(browser.killed).toBe(false)
  })

  it('resolves at once when the browser has already exited', async () => {
    const browser = new FakeBrowser()
    const driver = await launch(browser)

    browser.exit({ code: 1 })
    await driver.exited
    await driver.close()
    expect(browser.received.map((command) => command.method)).toEqual([
      'Browser.getVersion',
      'Target.setDiscoverTargets',
    ])
  })
})
