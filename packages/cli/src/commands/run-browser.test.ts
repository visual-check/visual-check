import { describe, expect, it } from 'vitest'
import { BrowserMismatchError } from '../browser/browser-version.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import type { StoryCapture, StoryToCapture } from '../capture/capture-session.js'
import { BrowserExitedError, BrowserLaunchError, type Driver, type Page } from '../capture/driver/driver.js'
import { answerEvaluate } from '../capture/fake-driver.fixture.js'
import type { OptionsRequest, StorybookOptionsRead } from '../capture/read-options.js'
import { type RunBrowser, runBrowserOf } from './run-browser.js'

/**
 * The browser package every browser is checked against.
 */
const browserPackage: BrowserPackage = {
  packageVersion: '157.0.0',
  chromium: '157.0.8103.78',
  image: { tag: 'ghcr.io/visual-check/chromium:157.0.0', digest: 'sha256:0' },
  headlessShell: '/opt/chromium/chrome-headless-shell',
  sha256: {
    linux64: '1'.repeat(64),
    'linux-arm64': '2'.repeat(64),
    'mac-x64': '3'.repeat(64),
    'mac-arm64': '4'.repeat(64),
    win64: '5'.repeat(64),
  },
}

/**
 * The snapshot every fake page captures.
 */
const snapshot = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

/**
 * What a capture of a story on a fake page gives: the snapshot, and no console message, since the page sent none.
 */
const captured = { snapshot, console: [] }

/**
 * A fake browser the test makes exit, which can hold a story's capture until the test lets it go.
 */
interface FakeBrowser {
  /**
   * The browser's driver.
   */
  driver: Driver
  /**
   * The ID of every story it captured, in order.
   */
  captured: string[]
  /**
   * How many of its pages are open.
   */
  openPages: number
  /**
   * How many times its driver was closed.
   */
  closes: number
  /**
   * Makes the browser exit: `exited` settles with the exit, and every later call on it fails with it, a held capture
   * included once it's let go. The exit says its graphics process couldn't start when `graphicsFailed` is true. Calling
   * it again gives the same exit.
   */
  exit: (graphicsFailed?: boolean) => BrowserExitedError
  /**
   * Holds every capture of the story until the function it gives is called.
   */
  hold: (id: string) => () => void
}

/**
 * Builds a fake browser of the given version, which captures every story well until it exits.
 */
function fakeBrowserOf(version: string = browserPackage.chromium): FakeBrowser {
  const holds = new Map<string, Promise<void>>()
  let settleExited: (error: BrowserExitedError) => void = () => undefined
  let gone: BrowserExitedError | undefined
  const failIfGone = (): void => {
    if (gone !== undefined) {
      throw gone
    }
  }
  const pageOf = (): Page => {
    let id = ''

    return {
      setViewport: async () => {
        failIfGone()
      },
      goto: async (url) => {
        failIfGone()
        id = new URL(url).searchParams.get('id') ?? ''
      },
      evaluate: async (expression, timeoutMs) => {
        failIfGone()

        return await answerEvaluate({}, expression, timeoutMs)
      },
      capture: async () => {
        await holds.get(id)
        failIfGone()
        fake.captured.push(id)

        return snapshot
      },
      clearStorage: async () => {
        failIfGone()
      },
      close: async () => {
        fake.openPages -= 1
      },
      requestHosts: () => [],
      messages: () => [],
    }
  }
  const fake: FakeBrowser = {
    driver: {
      version,
      exited: new Promise((resolve) => {
        settleExited = resolve
      }),
      newPage: async () => {
        failIfGone()
        fake.openPages += 1

        return pageOf()
      },
      close: async () => {
        fake.closes += 1
      },
    },
    captured: [],
    openPages: 0,
    closes: 0,
    exit: (graphicsFailed = false) => {
      gone ??= new BrowserExitedError({ code: 137, signal: null, error: undefined }, ['Out of memory'], graphicsFailed)
      settleExited(gone)

      return gone
    },
    hold: (id) => {
      let release: () => void = () => undefined

      holds.set(
        id,
        new Promise((resolve) => {
          release = resolve
        }),
      )

      return release
    },
  }

  return fake
}

/**
 * Makes a promise and the functions that settle it.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

/**
 * Prepares a run's browser whose launches give `browsers` in order: a fake browser, a promise of one, which launches
 * once it settles, or an error, which fails the launch. Returns it with how many launches it made so far.
 */
function runBrowserWith(...browsers: (FakeBrowser | Promise<FakeBrowser> | Error)[]): {
  browser: RunBrowser
  launches: () => number
} {
  let launches = 0
  const browser = runBrowserOf(
    async () => {
      const next = browsers[launches]

      launches += 1

      if (next === undefined) {
        throw new Error('The run launched more browsers than the test gave.')
      }

      if (next instanceof Error) {
        throw next
      }

      return (await next).driver
    },
    {
      browserPackage,
      configImage: undefined,
      place: { in: 'image' },
      environment: {},
      settings: {
        readyTimeoutMs: 15_000,
        timezone: 'UTC',
        locale: 'en-US',
        colorScheme: 'light',
        maskColor: '#FF00FF',
        listHosts: false,
      },
      progress: () => undefined,
    },
  )

  return { browser, launches: () => launches }
}

/**
 * Gives the story with the given ID and the URL of its own page.
 */
function storyOf(id: string): StoryToCapture {
  return {
    id,
    url: `http://127.0.0.1:6006/iframe.html?id=${id}&viewMode=story`,
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1, touch: false },
  }
}

/**
 * Gives what a capture in flight gives when the first browser exits with `error`.
 */
function brokenBy(error: BrowserExitedError): StoryCapture {
  return {
    broken: {
      reason: 'browser-exited',
      message: `The browser exited while visual-check captured this story: ${error.message}`,
    },
  }
}

/**
 * The request the tests read the options of: one stories file of one story.
 */
const optionsRequest: OptionsRequest = {
  storybookName: 'web',
  previewUrl: 'http://127.0.0.1:6006/iframe.html?viewMode=story',
  files: [{ importPath: './src/a.stories.ts', storyIds: ['a'] }],
}

/**
 * Gives what reading the options of `optionsRequest` gives when the page finds it loaded with no options or pinned
 * globals, and can't read the declared globals.
 */
const optionsRead: StorybookOptionsRead = {
  declaredGlobals: null,
  files: [
    {
      importPath: './src/a.stories.ts',
      outcome: 'loaded',
      stories: [{ id: 'a', options: undefined, pinnedGlobals: [] }],
    },
  ],
}

/**
 * Waits until every callback already queued has run, such as the run's browser seeing a driver's `exited` settle.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('runBrowserOf', () => {
  it("throws, relaunching nothing, when the first browser's exit says this machine can't run the platform", async () => {
    const first = fakeBrowserOf()
    const { browser, launches } = runBrowserWith(first, fakeBrowserOf())
    const releaseA = first.hold('a')
    const a = browser.capture(0, storyOf('a'))

    await settle()

    const exit = first.exit(true)

    releaseA()
    await expect(a).rejects.toBe(exit)
    await expect(browser.capture(1, storyOf('b'))).rejects.toBe(exit)
    expect(launches()).toBe(1)
    expect(browser.firstExit()).toBeUndefined()
  })

  it('breaks the story and relaunches when the graphics process fails after a capture gave a snapshot', async () => {
    const first = fakeBrowserOf()
    const second = fakeBrowserOf()
    const { browser, launches } = runBrowserWith(first, second)

    expect(await browser.capture(0, storyOf('a'))).toEqual(captured)

    const releaseB = first.hold('b')
    const b = browser.capture(0, storyOf('b'))

    await settle()

    const exit = first.exit(true)

    releaseB()
    expect(await b).toEqual(brokenBy(exit))
    expect(await browser.capture(0, storyOf('c'))).toEqual(captured)
    expect(launches()).toBe(2)
    expect(browser.firstExit()).toEqual({ error: exit, relaunched: true })
  })

  it('breaks the captures in flight when the browser exits, and relaunches it once for every worker after', async () => {
    const first = fakeBrowserOf()
    const second = fakeBrowserOf()
    const relaunch = deferred<FakeBrowser>()
    const { browser, launches } = runBrowserWith(first, relaunch.promise)
    const releaseA = first.hold('a')
    const releaseB = first.hold('b')
    const a = browser.capture(0, storyOf('a'))
    const b = browser.capture(1, storyOf('b'))

    await settle()

    const exit = first.exit()

    releaseA()
    releaseB()
    expect(await a).toEqual(brokenBy(exit))
    expect(await b).toEqual(brokenBy(exit))

    const rest = Promise.all(['c', 'd', 'e'].map((id, worker) => browser.capture(worker, storyOf(id))))

    await settle()
    expect(launches()).toBe(2)
    relaunch.resolve(second)
    expect(await rest).toEqual([captured, captured, captured])
    expect(launches()).toBe(2)
    expect(first.captured).toEqual([])
    expect(second.captured.toSorted()).toEqual(['c', 'd', 'e'])
    expect(browser.firstExit()).toEqual({ error: exit, relaunched: true })
  })

  it('breaks a capture that started on the first browser even when it fails after the relaunch', async () => {
    const first = fakeBrowserOf()
    const second = fakeBrowserOf()
    const { browser, launches } = runBrowserWith(first, second)
    const releaseA = first.hold('a')
    const a = browser.capture(0, storyOf('a'))

    await settle()

    const exit = first.exit()

    await settle()
    expect(await browser.capture(1, storyOf('b'))).toEqual(captured)
    releaseA()
    expect(await a).toEqual(brokenBy(exit))
    expect(await browser.capture(0, storyOf('c'))).toEqual(captured)
    expect(launches()).toBe(2)
    expect(second.captured).toEqual(['b', 'c'])
  })

  it('relaunches at the next capture after an exit between captures, breaking no story', async () => {
    const first = fakeBrowserOf()
    const second = fakeBrowserOf()
    const { browser, launches } = runBrowserWith(first, second)

    expect(await browser.capture(0, storyOf('a'))).toEqual(captured)
    expect(browser.firstExit()).toBeUndefined()

    const exit = first.exit()

    await settle()
    expect(first.openPages).toBe(1)
    expect(await browser.capture(0, storyOf('b'))).toEqual(captured)
    expect(launches()).toBe(2)
    expect(first.captured).toEqual(['a'])
    expect(second.captured).toEqual(['b'])
    expect(first.openPages).toBe(0)
    expect(browser.firstExit()).toEqual({ error: exit, relaunched: true })
  })

  it("doesn't relaunch for an exit no capture came after, and says so", async () => {
    const first = fakeBrowserOf()
    const { browser, launches } = runBrowserWith(first)

    await browser.capture(0, storyOf('a'))

    const exit = first.exit()

    await settle()
    expect(browser.firstExit()).toEqual({ error: exit, relaunched: false })
    expect(launches()).toBe(1)
  })

  it('throws the exit of the relaunched browser when it exits during a capture', async () => {
    const first = fakeBrowserOf()
    const second = fakeBrowserOf()
    const { browser } = runBrowserWith(first, second)
    const releaseA = first.hold('a')
    const a = browser.capture(0, storyOf('a'))

    await settle()

    const firstExit = first.exit()

    releaseA()
    expect(await a).toEqual(brokenBy(firstExit))

    const releaseB = second.hold('b')
    const b = browser.capture(0, storyOf('b'))

    await settle()

    const secondExit = second.exit()

    releaseB()
    await expect(b).rejects.toBe(secondExit)
    await expect(browser.capture(1, storyOf('c'))).rejects.toBe(secondExit)
    expect(browser.firstExit()).toEqual({ error: firstExit, relaunched: true })
  })

  it('throws the exit of the relaunched browser when it exited before a capture', async () => {
    const first = fakeBrowserOf()
    const second = fakeBrowserOf()
    const { browser, launches } = runBrowserWith(first, second)

    await browser.capture(0, storyOf('a'))
    first.exit()
    await settle()
    await browser.capture(0, storyOf('b'))

    const secondExit = second.exit()

    await settle()
    await expect(browser.capture(0, storyOf('c'))).rejects.toBe(secondExit)
    expect(launches()).toBe(2)
  })

  it('throws when the relaunch fails, and closes without throwing', async () => {
    const first = fakeBrowserOf()
    const error = new BrowserLaunchError('The browser exited with code 127 before it answered.', [], { exited: true })
    const { browser } = runBrowserWith(first, error)

    await browser.capture(0, storyOf('a'))
    first.exit()
    await settle()
    await expect(browser.capture(0, storyOf('b'))).rejects.toBe(error)
    await expect(browser.close()).resolves.toBeUndefined()
    expect(first.closes).toBe(1)
  })

  it('gives every capture waiting for a relaunch that fails its error', async () => {
    const first = fakeBrowserOf()
    const relaunch = deferred<FakeBrowser>()
    const { browser, launches } = runBrowserWith(first, relaunch.promise)
    const error = new BrowserLaunchError('The browser exited with code 127 before it answered.', [], { exited: true })

    await browser.capture(0, storyOf('a'))
    first.exit()
    await settle()

    const waiting = Promise.allSettled(['b', 'c', 'd'].map((id, worker) => browser.capture(worker, storyOf(id))))

    await settle()
    relaunch.reject(error)
    expect(await waiting).toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
    ])
    expect(launches()).toBe(2)
    await expect(browser.close()).resolves.toBeUndefined()
  })

  it('calls started once the browser is up, before the capture opens its page', async () => {
    const first = fakeBrowserOf()
    const launch = deferred<FakeBrowser>()
    const { browser } = runBrowserWith(launch.promise)
    const pagesOpenWhenStarted: number[] = []
    const capture = browser.capture(0, storyOf('a'), () => {
      pagesOpenWhenStarted.push(first.openPages)
    })

    await settle()
    expect(pagesOpenWhenStarted).toEqual([])
    launch.resolve(first)
    expect(await capture).toEqual(captured)
    expect(pagesOpenWhenStarted).toEqual([0])
    expect(first.openPages).toBe(1)
  })

  it("doesn't call started when the launch fails", async () => {
    const error = new BrowserLaunchError('The browser exited with code 127 before it answered.', [], { exited: true })
    const { browser } = runBrowserWith(error)
    let started = false

    await expect(
      browser.capture(0, storyOf('a'), () => {
        started = true
      }),
    ).rejects.toBe(error)
    expect(started).toBe(false)
  })

  it("checks the relaunched browser's version, and closes it when it's another build", async () => {
    const first = fakeBrowserOf()
    const second = fakeBrowserOf('156.0.7000.1')
    const { browser } = runBrowserWith(first, second)

    await browser.capture(0, storyOf('a'))
    first.exit()
    await settle()
    await expect(browser.capture(0, storyOf('b'))).rejects.toBeInstanceOf(BrowserMismatchError)
    expect(second.closes).toBe(1)
  })

  it('closes no browser before close(), then every session on both browsers and both browsers', async () => {
    const first = fakeBrowserOf()
    const second = fakeBrowserOf()
    const { browser } = runBrowserWith(first, second)

    await Promise.all([browser.capture(0, storyOf('a')), browser.capture(1, storyOf('b'))])
    first.exit()
    await settle()
    await browser.capture(0, storyOf('c'))
    expect(first.openPages).toBe(1)
    expect(second.openPages).toBe(1)
    expect(first.closes).toBe(0)
    expect(second.closes).toBe(0)
    await browser.close()
    expect(first.openPages).toBe(0)
    expect(second.openPages).toBe(0)
    expect(first.closes).toBe(1)
    expect(second.closes).toBe(1)
  })

  it('reads the options in the browser the captures share, launching it once', async () => {
    const first = fakeBrowserOf()
    const { browser, launches } = runBrowserWith(first)

    expect(await browser.readOptions(optionsRequest)).toEqual(optionsRead)
    expect(first.openPages).toBe(0)
    expect(await browser.capture(0, storyOf('a'))).toEqual(captured)
    expect(await browser.readOptions(optionsRequest)).toEqual(optionsRead)
    expect(launches()).toBe(1)
    expect(first.captured).toEqual(['a'])
  })

  it('throws the launch error when the browser fails to launch for a read', async () => {
    const error = new BrowserLaunchError('The browser exited with code 127 before it answered.', [], { exited: true })
    const { browser } = runBrowserWith(error)

    await expect(browser.readOptions(optionsRequest)).rejects.toBe(error)
    await expect(browser.close()).resolves.toBeUndefined()
  })

  it('relaunches once and reads in the second browser when the first exits during a read', async () => {
    const first = fakeBrowserOf()
    const second = fakeBrowserOf()
    const { browser, launches } = runBrowserWith(first, second)

    await browser.readOptions(optionsRequest)

    const exit = first.exit()

    expect(await browser.readOptions(optionsRequest)).toEqual(optionsRead)
    expect(launches()).toBe(2)
    expect(browser.firstExit()).toEqual({ error: exit, relaunched: true })
    expect(await browser.capture(0, storyOf('b'))).toEqual(captured)
    expect(second.captured).toEqual(['b'])
    expect(launches()).toBe(2)
  })

  it('throws the exit when the relaunched browser exits during the read', async () => {
    const first = fakeBrowserOf()
    const second = fakeBrowserOf()
    const { browser, launches } = runBrowserWith(first, second)

    await browser.readOptions(optionsRequest)
    first.exit()

    const secondExit = second.exit()

    await expect(browser.readOptions(optionsRequest)).rejects.toBe(secondExit)
    expect(launches()).toBe(2)
    await expect(browser.capture(0, storyOf('b'))).rejects.toBe(secondExit)
  })

  it("throws, relaunching nothing, when the first browser's exit during a read says the platform can't run", async () => {
    const first = fakeBrowserOf()
    const { browser, launches } = runBrowserWith(first, fakeBrowserOf())

    await browser.readOptions(optionsRequest)

    const exit = first.exit(true)

    await expect(browser.readOptions(optionsRequest)).rejects.toBe(exit)
    expect(launches()).toBe(1)
    expect(browser.firstExit()).toBeUndefined()
    await expect(browser.capture(0, storyOf('a'))).rejects.toBe(exit)
    expect(launches()).toBe(1)
  })
})
