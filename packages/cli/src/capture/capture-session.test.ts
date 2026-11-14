import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CaptureSettings, openCaptureSession } from './capture-session.js'
import { BrowserExitedError, PageCrashedError, PageNavigatedAwayError, PageTimeoutError } from './driver/driver.js'
import { defaultSnapshot, FakeDriver, type FakePageBehaviour } from './fake-driver.fixture.js'
import { pageInitScript, storyReadinessExpression } from './page-script.js'

/**
 * The settings every session in these tests captures with.
 */
const settings: CaptureSettings = {
  viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
  readyTimeoutMs: 10_000,
  timezone: 'Europe/Warsaw',
  locale: 'pl-PL',
  colorScheme: 'dark',
}

/**
 * The story most tests capture.
 */
const primary = { id: 'button--primary', url: 'http://localhost:6006/iframe.html?id=button--primary&viewMode=story' }

/**
 * Another story, for tests that capture twice.
 */
const secondary = {
  id: 'button--secondary',
  url: 'http://localhost:6006/iframe.html?id=button--secondary&viewMode=story',
}

/**
 * Lets `ms` pass on the clock the session measures time with.
 */
function pass(ms: number): void {
  vi.advanceTimersByTime(ms)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('openCaptureSession', () => {
  it('opens no page until the first capture', () => {
    const driver = new FakeDriver()

    openCaptureSession(driver, settings)
    expect(driver.setups).toEqual([])
  })

  it("opens its page with the settings, Storybook's test-runner user agent and the page script", async () => {
    const driver = new FakeDriver()

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.setups).toEqual([
      {
        userAgentSuffix: ' StorybookTestRunner',
        timezone: 'Europe/Warsaw',
        locale: 'pl-PL',
        colorScheme: 'dark',
        initScript: pageInitScript,
      },
    ])
  })

  it('keeps using its page while captures succeed', async () => {
    const driver = new FakeDriver()
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await session.capture(secondary)
    expect(driver.setups).toHaveLength(1)
    expect(driver.methods()).not.toContain('1:close')
  })
})

describe('a capture', () => {
  it('sets the viewport, loads the story, waits for it to finish and captures the full page', async () => {
    const driver = new FakeDriver()

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls).toEqual([
      { page: 1, method: 'setViewport', args: [{ width: 1280, height: 720, deviceScaleFactor: 2 }] },
      { page: 1, method: 'goto', args: [primary.url, 10_000] },
      { page: 1, method: 'evaluate', args: [storyReadinessExpression('button--primary', 10_000), 11_000] },
      { page: 1, method: 'captureFullPage', args: [] },
    ])
  })

  it('gives each step only the time readyTimeout has left', async () => {
    const driver = new FakeDriver({
      pages: [{ setViewport: async () => pass(500), goto: async () => pass(3000) }],
    })

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls[1]?.args).toEqual([primary.url, 9500])
    expect(driver.calls[2]?.args).toEqual([storyReadinessExpression('button--primary', 6500), 7500])
  })

  it('rounds the time left up to whole ms', async () => {
    const driver = new FakeDriver({ pages: [{ setViewport: async () => pass(500.4) }] })

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls[1]?.args).toEqual([primary.url, 9500])
  })

  it('starts each capture with the whole of readyTimeout', async () => {
    const driver = new FakeDriver({ pages: [{ goto: async () => pass(3000) }] })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await session.capture(secondary)
    expect(driver.calls[6]).toEqual({ page: 1, method: 'goto', args: [secondary.url, 10_000] })
  })

  it('gives the snapshot exactly as the browser made it', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const driver = new FakeDriver({ pages: [{ captureFullPage: async () => bytes }] })
    const capture = await openCaptureSession(driver, settings).capture(primary)

    expect(capture).toEqual({ snapshot: bytes })
    expect('snapshot' in capture && capture.snapshot).toBe(bytes)
  })
})

describe("clearing the previous story's storage", () => {
  it('clears the page before each later capture on it', async () => {
    const driver = new FakeDriver()
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await session.capture(secondary)
    await session.capture(primary)
    expect(driver.methods()).toEqual([
      '1:setViewport',
      '1:goto',
      '1:evaluate',
      '1:captureFullPage',
      '1:clearStorage',
      '1:setViewport',
      '1:goto',
      '1:evaluate',
      '1:captureFullPage',
      '1:clearStorage',
      '1:setViewport',
      '1:goto',
      '1:evaluate',
      '1:captureFullPage',
    ])
  })

  it("clears nothing on the fresh page that replaced a broken story's page", async () => {
    const driver = new FakeDriver({ pages: [{ evaluate: async () => ({ outcome: 'finished', status: 'error' }) }] })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await session.capture(secondary)
    expect(driver.methods()).toEqual([
      '1:setViewport',
      '1:goto',
      '1:evaluate',
      '1:close',
      '2:setViewport',
      '2:goto',
      '2:evaluate',
      '2:captureFullPage',
    ])
  })

  it('leaves readyTimeout whole for the capture after it', async () => {
    const driver = new FakeDriver({ pages: [{ clearStorage: async () => pass(3000) }] })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await session.capture(secondary)
    expect(driver.calls[6]).toEqual({ page: 1, method: 'goto', args: [secondary.url, 10_000] })
  })

  it.each([
    ['an error', new Error('The browser said no.')],
    ['a crash', new PageCrashedError()],
    ['a timeout', new PageTimeoutError("The page didn't clear its storage within 30 s.", 30_000)],
  ])('closes the page and captures the story on a fresh page when it fails with %s', async (_how, error) => {
    const driver = new FakeDriver({
      pages: [
        {
          clearStorage: async () => {
            throw error
          },
        },
      ],
    })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    expect(await session.capture(secondary)).toEqual({ snapshot: defaultSnapshot })
    expect(driver.methods().slice(4)).toEqual([
      '1:clearStorage',
      '1:close',
      '2:setViewport',
      '2:goto',
      '2:evaluate',
      '2:captureFullPage',
    ])
  })
})

describe('a broken story', () => {
  it('is one Storybook reports finished with a status other than success, naming the status', async () => {
    const driver = new FakeDriver({ pages: [{ evaluate: async () => ({ outcome: 'finished', status: 'error' }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          'Storybook reported the story finished with status "error", as it does when a loader, beforeEach or the render throws, when play leaves unhandled errors, or when a check such as accessibility fails.',
      },
    })
    expect(driver.methods()).not.toContain('1:captureFullPage')
  })

  it('is one that never finishes, saying Storybook never reported it finished', async () => {
    const driver = new FakeDriver({ pages: [{ evaluate: async () => ({ outcome: 'timed-out', channel: true }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message: "The story wasn't ready within readyTimeout (10000 ms): Storybook never sent storyFinished for it.",
      },
    })
  })

  it('is one whose Storybook preview never starts, saying so', async () => {
    const driver = new FakeDriver({ pages: [{ evaluate: async () => ({ outcome: 'timed-out', channel: false }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): Storybook's preview never started in its page.",
      },
    })
  })

  it("is one whose page didn't run the page script", async () => {
    const driver = new FakeDriver({ pages: [{ evaluate: async () => ({ outcome: 'script-missing' }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "visual-check's page script didn't run in the story's page, so it couldn't wait for the story to finish.",
      },
    })
  })

  it("is one whose page doesn't load in time, naming that step", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async (url, timeoutMs) => {
            pass(timeoutMs)

            throw new PageTimeoutError(`The page didn't load ${url} within 10 s.`, timeoutMs)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message: "The story wasn't ready within readyTimeout (10000 ms): its page was still loading.",
      },
    })
  })

  it("is one whose page doesn't answer the readiness wait in time, naming that step", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          evaluate: async (_expression, timeoutMs) => {
            pass(timeoutMs)

            throw new PageTimeoutError("The expression evaluated in the page didn't finish within 11 s.", timeoutMs)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): its page stopped answering while visual-check waited for it to finish.",
      },
    })
  })

  it('is one whose page fails to load as the time runs out, by the error it gives and not by the clock', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async (url, timeoutMs) => {
            pass(timeoutMs)

            throw new Error(`The page couldn't load ${url}: net::ERR_CONNECTION_RESET`)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message: `Loading the story failed: The page couldn't load ${primary.url}: net::ERR_CONNECTION_RESET.`,
      },
    })
  })

  it("is one whose viewport isn't set within the driver's own limit, saying so", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          setViewport: async () => {
            throw new PageTimeoutError("The page didn't set its viewport within 30 s.", 30_000)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message: "Setting the viewport failed: The page didn't set its viewport within 30 s.",
      },
    })
  })

  it('is one whose page fails to load, naming that step and why', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async (url) => {
            throw new Error(`The page couldn't load ${url}: net::ERR_CONNECTION_REFUSED`)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message: `Loading the story failed: The page couldn't load ${primary.url}: net::ERR_CONNECTION_REFUSED.`,
      },
    })
  })

  it.each([
    ['setViewport', 'Setting the viewport'],
    ['evaluate', 'Waiting for the story to finish'],
    ['captureFullPage', 'Capturing the snapshot'],
  ] as const)('is one whose %s fails, naming that step and why', async (method, step) => {
    const driver = new FakeDriver({
      pages: [
        {
          [method]: async () => {
            throw new Error('The browser said no.')
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: { reason: 'error', message: `${step} failed: The browser said no.` },
    })
  })

  it("is one whose readiness wait gives an answer visual-check doesn't know", async () => {
    const driver = new FakeDriver({ pages: [{ evaluate: async () => 42 }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "Waiting for the story to finish failed: The readiness wait in the page gave an answer visual-check doesn't know: 42.",
      },
    })
  })

  it('is one whose page crashed, pointing at memory', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async () => {
            throw new PageCrashedError()
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'crashed',
        message:
          'The page crashed while loading the story, usually because it ran out of memory. Fewer workers leave each page more memory.',
      },
    })
  })

  it.each([
    [
      "the story's own origin, as a path",
      'http://localhost:6006/categories/burgers?tab=a#top',
      '/categories/burgers?tab=a#top',
    ],
    ['another origin, in full', 'https://example.com/x', 'https://example.com/x'],
    ['a URL that cannot be parsed, as it is', 'not a url', 'not a url'],
    ["a blob URL of the story's origin, in full", 'blob:http://localhost:6006/abc', 'blob:http://localhost:6006/abc'],
  ])('is one that navigated away to %s, naming where it went', async (_where, url, shown) => {
    const page: FakePageBehaviour = {
      goto: async (storyUrl) => {
        throw new PageNavigatedAwayError(url, `The page navigated to ${url} before ${storyUrl} loaded.`)
      },
    }
    // The story navigates away on every attempt, the retries included.
    const driver = new FakeDriver({ pages: [page, page, page] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'navigated-away',
        message: `The story navigated away to ${shown}. Await the new page before clicking.`,
        url,
      },
    })
  })

  it('is one that navigated away while waiting for the story to finish', async () => {
    const page: FakePageBehaviour = {
      evaluate: async () => {
        throw new PageNavigatedAwayError('http://localhost:6006/next', 'The page navigated to /next.')
      },
    }
    // The story navigates away on every attempt, the retries included.
    const driver = new FakeDriver({ pages: [page, page, page] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'navigated-away',
        message: 'The story navigated away to /next. Await the new page before clicking.',
        url: 'http://localhost:6006/next',
      },
    })
  })

  it('is one whose page crashed while waiting for the story to finish, naming that step', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          evaluate: async () => {
            throw new PageCrashedError()
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'crashed',
        message:
          'The page crashed while waiting for the story to finish, usually because it ran out of memory. Fewer workers leave each page more memory.',
      },
    })
  })

  it("is one whose capture hits the driver's own time limit, as an error and not a timeout", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          captureFullPage: async () => {
            throw new PageTimeoutError("The page didn't capture within 30 s.", 30_000)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: { reason: 'error', message: "Capturing the snapshot failed: The page didn't capture within 30 s." },
    })
  })

  it('is one whose page fails to open, saying why', async () => {
    const driver = new FakeDriver({
      newPage: async () => {
        throw new Error("The browser didn't open a page within 30 s.")
      },
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message: "visual-check couldn't open a page for the story: The browser didn't open a page within 30 s.",
      },
    })
  })

  it('closes its page and opens a fresh one for the next story', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async () => {
            throw new PageCrashedError()
          },
        },
      ],
    })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    expect(await session.capture(secondary)).toEqual({ snapshot: defaultSnapshot })
    expect(driver.methods()).toEqual([
      '1:setViewport',
      '1:goto',
      '1:close',
      '2:setViewport',
      '2:goto',
      '2:evaluate',
      '2:captureFullPage',
    ])
  })

  it('closes its page when Storybook reports the story failed too', async () => {
    const driver = new FakeDriver({ pages: [{ evaluate: async () => ({ outcome: 'finished', status: 'error' }) }] })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await session.capture(secondary)
    expect(driver.setups).toHaveLength(2)
    expect(driver.methods()).toContain('1:close')
  })

  it("carries on when its page doesn't close", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async () => {
            throw new PageCrashedError()
          },
          close: async () => {
            throw new Error('The page crashed.')
          },
        },
      ],
    })
    const session = openCaptureSession(driver, settings)

    expect(await session.capture(primary)).toHaveProperty('broken.reason', 'crashed')
    expect(await session.capture(secondary)).toEqual({ snapshot: defaultSnapshot })
  })

  it('tries to open a page again after one failed to open', async () => {
    let openings = 0
    const driver = new FakeDriver({
      newPage: async () => {
        openings += 1

        if (openings === 1) {
          throw new Error("The browser didn't open a page within 30 s.")
        }
      },
    })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    expect(await session.capture(secondary)).toEqual({ snapshot: defaultSnapshot })
  })
})

describe('a story that navigates away', () => {
  /**
   * A page whose story navigates away to `url` as it loads.
   */
  const navigatesAway = (url: string): FakePageBehaviour => ({
    goto: async () => {
      throw new PageNavigatedAwayError(url, `The page navigated to ${url}.`)
    },
  })

  /**
   * The methods a page that navigated away at its load received: it was set up, failed to load and was closed.
   */
  const navigatedAwayAt = (page: number): string[] => [`${page}:setViewport`, `${page}:goto`, `${page}:close`]

  /**
   * The methods a page that captured well received.
   */
  const capturedOn = (page: number): string[] => [
    `${page}:setViewport`,
    `${page}:goto`,
    `${page}:evaluate`,
    `${page}:captureFullPage`,
  ]

  it('is broken with the last attempt after 2 retries, each on a fresh page', async () => {
    const driver = new FakeDriver({
      pages: [
        navigatesAway('http://localhost:6006/one'),
        navigatesAway('http://localhost:6006/two'),
        navigatesAway('http://localhost:6006/three'),
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'navigated-away',
        message: 'The story navigated away to /three. Await the new page before clicking.',
        url: 'http://localhost:6006/three',
      },
    })
    expect(driver.setups).toHaveLength(3)
    expect(driver.methods()).toEqual([...navigatedAwayAt(1), ...navigatedAwayAt(2), ...navigatedAwayAt(3)])
  })

  it('gives the snapshot of a retry that captured, keeping that page', async () => {
    const driver = new FakeDriver({ pages: [navigatesAway('http://localhost:6006/one')] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({ snapshot: defaultSnapshot })
    expect(driver.methods()).toEqual([...navigatedAwayAt(1), ...capturedOn(2)])
  })

  it('clears the kept page of a retry before the next story, as after any story that captured', async () => {
    const driver = new FakeDriver({ pages: [navigatesAway('http://localhost:6006/one')] })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    expect(await session.capture(secondary)).toEqual({ snapshot: defaultSnapshot })
    expect(driver.setups).toHaveLength(2)
    expect(driver.methods()).toEqual([...navigatedAwayAt(1), ...capturedOn(2), '2:clearStorage', ...capturedOn(2)])
  })

  /**
   * Each outcome other than navigating away, as the reason it gives and a page that has it as it loads.
   */
  const otherOutcomes: [string, FakePageBehaviour][] = [
    [
      'crashed',
      {
        goto: async () => {
          throw new PageCrashedError()
        },
      },
    ],
    [
      'error',
      {
        goto: async () => {
          throw new Error('The page broke.')
        },
      },
    ],
    ['timeout', { evaluate: async () => ({ outcome: 'timed-out', channel: true }) }],
  ]

  it.each(otherOutcomes)('is not retried when the first attempt is %s', async (reason, behaviour) => {
    const driver = new FakeDriver({ pages: [behaviour] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toHaveProperty('broken.reason', reason)
    expect(driver.setups).toHaveLength(1)
  })

  it.each(otherOutcomes)('gives the outcome of a retry that is %s, retrying no more', async (reason, behaviour) => {
    const driver = new FakeDriver({ pages: [navigatesAway('http://localhost:6006/one'), behaviour] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toHaveProperty('broken.reason', reason)
    expect(driver.setups).toHaveLength(2)
  })

  it('gives each retry the whole readyTimeout', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async () => {
            pass(4_000)
            throw new PageNavigatedAwayError('http://localhost:6006/one', 'The page navigated to /one.')
          },
        },
      ],
    })

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls.filter((call) => call.method === 'goto').map((call) => call.args[1])).toEqual([
      settings.readyTimeoutMs,
      settings.readyTimeoutMs,
    ])
  })

  it('gives the error of a page that cannot be opened for a retry', async () => {
    let openings = 0
    const driver = new FakeDriver({
      pages: [navigatesAway('http://localhost:6006/one')],
      newPage: async () => {
        openings += 1

        if (openings === 2) {
          throw new Error("The browser didn't open a page within 30 s.")
        }
      },
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message: "visual-check couldn't open a page for the story: The browser didn't open a page within 30 s.",
      },
    })
    expect(driver.methods()).toEqual(navigatedAwayAt(1))
  })

  it('rejects when the browser exits during a retry', async () => {
    const exited = new BrowserExitedError({ code: 1, signal: null, error: undefined }, [])
    const driver = new FakeDriver({
      pages: [
        navigatesAway('http://localhost:6006/one'),
        {
          goto: async () => {
            throw exited
          },
        },
      ],
    })

    await expect(openCaptureSession(driver, settings).capture(primary)).rejects.toBe(exited)
    expect(driver.methods()).toEqual([...navigatedAwayAt(1), '2:setViewport', '2:goto'])
  })
})

describe('a browser exit', () => {
  const exited = new BrowserExitedError({ code: 1, signal: null, error: undefined }, [])

  it('rejects the capture with the error, closing nothing', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async () => {
            throw exited
          },
        },
      ],
    })

    await expect(openCaptureSession(driver, settings).capture(primary)).rejects.toBe(exited)
    expect(driver.methods()).not.toContain('1:close')
  })

  it("rejects the capture when the previous story's storage is being cleared", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          clearStorage: async () => {
            throw exited
          },
        },
      ],
    })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await expect(session.capture(secondary)).rejects.toBe(exited)
    expect(driver.methods()).not.toContain('1:close')
    expect(driver.setups).toHaveLength(1)
  })

  it('rejects the capture when the page is being opened', async () => {
    const driver = new FakeDriver({
      newPage: async () => {
        throw exited
      },
    })

    await expect(openCaptureSession(driver, settings).capture(primary)).rejects.toBe(exited)
  })
})

describe('close', () => {
  it('closes the open page', async () => {
    const driver = new FakeDriver()
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await session.close()
    expect(driver.methods().at(-1)).toBe('1:close')
  })

  it('does nothing without an open page', async () => {
    const driver = new FakeDriver()

    await openCaptureSession(driver, settings).close()
    expect(driver.calls).toEqual([])
  })
})
