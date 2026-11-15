import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finishedAnswer, timedOutAnswer } from '../storybook/preview-script.fixture.js'
import { storyWaitExpression } from '../storybook/preview-script.js'
import { waitHookExpression } from '../storybook/wait-hook.js'
import { type CaptureSettings, openCaptureSession } from './capture-session.js'
import {
  BrowserExitedError,
  CaptureTooLargeError,
  PageCrashedError,
  PageLoadError,
  PageNavigatedAwayError,
  PageTimeoutError,
} from './driver/driver.js'
import { animationsTimedOutAnswer, mediaTimedOutAnswer, settledAnswer } from './end-state.fixture.js'
import { defaultSnapshot, FakeDriver, type FakePageBehaviour } from './fake-driver.fixture.js'
import { fontsTimedOutAnswer, imagesTimedOutAnswer, readyAnswer } from './page-script.fixture.js'
import { assetsReadyExpression, endStateExpression, pageInitScript } from './page-script.js'

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
  it('sets the viewport, loads the story, waits for it to finish and for its images and fonts, runs its wait hook, brings it to its end state and captures the full page', async () => {
    const driver = new FakeDriver()

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls).toEqual([
      { page: 1, method: 'setViewport', args: [{ width: 1280, height: 720, deviceScaleFactor: 2 }] },
      { page: 1, method: 'goto', args: [primary.url, 10_000] },
      { page: 1, method: 'evaluate', args: [storyWaitExpression('button--primary', 10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [waitHookExpression('button--primary', 10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [endStateExpression(10_000), 11_000] },
      { page: 1, method: 'capture', args: ['full-page'] },
    ])
  })

  it('checks images and fonts again before the capture when the end state changed anything', async () => {
    const driver = new FakeDriver({ pages: [{ endStateWait: async () => settledAnswer(true) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({ snapshot: defaultSnapshot })
    expect(driver.calls.slice(3)).toEqual([
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [waitHookExpression('button--primary', 10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [endStateExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'capture', args: ['full-page'] },
    ])
  })

  it('gives each step only the time readyTimeout has left', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          setViewport: async () => pass(500),
          goto: async () => pass(3000),
          storyWait: async () => {
            pass(2000)

            return finishedAnswer()
          },
          assetsWait: async () => {
            pass(1500)

            return readyAnswer()
          },
          endStateWait: async () => {
            pass(1500)

            return settledAnswer(true)
          },
        },
      ],
    })

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls[1]?.args).toEqual([primary.url, 9500])
    expect(driver.calls[2]?.args).toEqual([storyWaitExpression('button--primary', 6500), 7500])
    expect(driver.calls[3]?.args).toEqual([assetsReadyExpression(4500), 5500])
    expect(driver.calls[4]?.args).toEqual([waitHookExpression('button--primary', 3000), 4000])
    expect(driver.calls[5]?.args).toEqual([endStateExpression(3000), 4000])
    expect(driver.calls[6]?.args).toEqual([assetsReadyExpression(1500), 2500])
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
    expect(driver.calls[9]).toEqual({ page: 1, method: 'goto', args: [secondary.url, 10_000] })
  })

  it('gives the snapshot exactly as the browser made it', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const driver = new FakeDriver({ pages: [{ capture: async () => bytes }] })
    const capture = await openCaptureSession(driver, settings).capture(primary)

    expect(capture).toEqual({ snapshot: bytes })
    expect('snapshot' in capture && capture.snapshot).toBe(bytes)
  })

  it('gives how long the story\'s "completing" render step took beside its snapshot', async () => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => finishedAnswer({ completingMs: 104 }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toStrictEqual({
      snapshot: defaultSnapshot,
      completingMs: 104,
    })
  })

  it('gives no "completing" time when the page saw no completing and completed render steps', async () => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => finishedAnswer({ completingMs: null }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toStrictEqual({
      snapshot: defaultSnapshot,
      completingMs: undefined,
    })
  })
})

describe("the story's wait hook", () => {
  /**
   * The answer of a wait hook that ran and settled well.
   */
  const ran = { outcome: 'done' }

  it('runs after images and fonts, and captures straight away when the story has none', async () => {
    const driver = new FakeDriver()

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({ snapshot: defaultSnapshot })
    expect(driver.calls.slice(3)).toEqual([
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [waitHookExpression('button--primary', 10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [endStateExpression(10_000), 11_000] },
      { page: 1, method: 'capture', args: ['full-page'] },
    ])
  })

  it('checks images and fonts again once it ran, then captures', async () => {
    const driver = new FakeDriver({ pages: [{ waitHook: async () => ran }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({ snapshot: defaultSnapshot })
    expect(driver.calls.slice(3)).toEqual([
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [waitHookExpression('button--primary', 10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [assetsReadyExpression(10_000), 11_000] },
      { page: 1, method: 'evaluate', args: [endStateExpression(10_000), 11_000] },
      { page: 1, method: 'capture', args: ['full-page'] },
    ])
  })

  it('gets only the time readyTimeout has left, and leaves the second check of images and fonts only what is left after it', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async () => pass(3000),
          waitHook: async () => {
            pass(4000)

            return ran
          },
        },
      ],
    })

    await openCaptureSession(driver, settings).capture(primary)
    expect(driver.calls[4]?.args).toEqual([waitHookExpression('button--primary', 7000), 8000])
    expect(driver.calls[5]?.args).toEqual([assetsReadyExpression(3000), 4000])
  })

  it.each([
    [
      'wait-threw',
      'that threw, saying what it threw',
      { outcome: 'threw', text: 'Error: The data never came.' },
      "The story's wait hook threw Error: The data never came.",
    ],
    [
      'timeout',
      "that hadn't finished within readyTimeout",
      { outcome: 'timed-out' },
      "The story wasn't ready within readyTimeout (10000 ms): its wait hook hadn't finished.",
    ],
    [
      'error',
      "whose context visual-check couldn't build",
      { outcome: 'context-failed', text: 'Error: No context.' },
      "visual-check couldn't read the story's wait hook or build its context: Error: No context.",
    ],
    [
      'error',
      "that couldn't run because Storybook's preview had no render of the story",
      { outcome: 'no-render' },
      "Storybook's preview had no render of the story to run its wait hook with.",
    ],
    [
      'error',
      "that couldn't run because the page script didn't run",
      { outcome: 'script-missing' },
      "visual-check's page script didn't run in the story's page, so it couldn't run its wait hook.",
    ],
  ])('makes a broken story, %s, of a wait hook %s', async (reason, _what, answer, message) => {
    const driver = new FakeDriver({ pages: [{ waitHook: async () => answer }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({ broken: { reason, message } })
    expect(driver.methods()).toEqual(['1:setViewport', '1:goto', '1:evaluate', '1:evaluate', '1:evaluate', '1:close'])
  })

  /**
   * A page whose story's wait hook runs, and whose check of images and fonts after it answers as `second` says.
   */
  const checkedAfterTheHook = (second: (timeoutMs: number) => Promise<unknown>): FakePageBehaviour => {
    let checks = 0

    return {
      assetsWait: async (timeoutMs) => {
        checks += 1

        return checks === 1 ? readyAnswer() : await second(timeoutMs)
      },
      waitHook: async () => ran,
    }
  }

  it.each([
    [
      'images still loading',
      imagesTimedOutAnswer(1),
      {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): 1 of its images was still loading after its wait hook.",
      },
    ],
    [
      'document.fonts.ready unresolved',
      fontsTimedOutAnswer([]),
      {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): document.fonts.ready hadn't resolved after its wait hook.",
      },
    ],
    [
      'fonts still loading',
      fontsTimedOutAnswer(['Inter 400 normal']),
      {
        reason: 'fonts-not-loaded',
        message:
          "The story's fonts hadn't loaded within readyTimeout (10000 ms) after its wait hook. Still loading: Inter 400 normal.",
        faces: ['Inter 400 normal'],
      },
    ],
    [
      'a page that lost the page script',
      { outcome: 'script-missing' },
      {
        reason: 'error',
        message:
          "visual-check's page script didn't run in the story's page, so it couldn't wait for its images and fonts after its wait hook.",
      },
    ],
  ])('makes a broken story of %s once it ran, saying it was after the hook', async (_what, answer, broken) => {
    const driver = new FakeDriver({ pages: [checkedAfterTheHook(async () => answer)] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({ broken })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it("makes a broken story, timeout, of a page that doesn't answer while it runs, naming that step", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          waitHook: async (timeoutMs) => {
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
          "The story wasn't ready within readyTimeout (10000 ms): its page stopped answering while its wait hook ran.",
      },
    })
  })

  it('names the step it was in when the page crashes while it runs', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          waitHook: async () => {
            throw new PageCrashedError()
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'crashed',
        message:
          "The page crashed while running the story's wait hook, usually because it ran out of memory. Fewer workers leave each page more memory.",
      },
    })
  })

  it("names the check of images and fonts after it when the page doesn't answer that check in time", async () => {
    const driver = new FakeDriver({
      pages: [
        checkedAfterTheHook(async (timeoutMs) => {
          pass(timeoutMs)

          throw new PageTimeoutError("The expression evaluated in the page didn't finish within 11 s.", timeoutMs)
        }),
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): its page stopped answering while visual-check waited for its images and fonts after its wait hook.",
      },
    })
  })

  it('names the check of images and fonts after it when the page crashes in that check', async () => {
    const driver = new FakeDriver({
      pages: [
        checkedAfterTheHook(async () => {
          throw new PageCrashedError()
        }),
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'crashed',
        message:
          'The page crashed while waiting for images and fonts after its wait hook, usually because it ran out of memory. Fewer workers leave each page more memory.',
      },
    })
  })

  it("names the check of images and fonts after it when that check gives an answer visual-check doesn't know", async () => {
    const driver = new FakeDriver({ pages: [checkedAfterTheHook(async () => 42)] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "Waiting for images and fonts after its wait hook failed: The wait for images and fonts in the page gave an answer visual-check doesn't know: 42.",
      },
    })
  })

  it("makes a broken story of a run that gives an answer visual-check doesn't know", async () => {
    const driver = new FakeDriver({ pages: [{ waitHook: async () => 42 }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "Running the story's wait hook failed: The wait hook in the page gave an answer visual-check doesn't know: 42.",
      },
    })
  })

  it('leaves the next story a fresh page after it threw', async () => {
    const driver = new FakeDriver({ pages: [{ waitHook: async () => ({ outcome: 'threw', text: 'Error: boom' }) }] })
    const session = openCaptureSession(driver, settings)

    expect(await session.capture(primary)).toHaveProperty('broken.reason', 'wait-threw')
    expect(await session.capture(secondary)).toEqual({ snapshot: defaultSnapshot })
    expect(driver.setups).toHaveLength(2)
    expect(driver.methods()).toContain('1:close')
    expect(driver.methods()).not.toContain('2:clearStorage')
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
      '1:evaluate',
      '1:evaluate',
      '1:evaluate',
      '1:capture',
      '1:clearStorage',
      '1:setViewport',
      '1:goto',
      '1:evaluate',
      '1:evaluate',
      '1:evaluate',
      '1:evaluate',
      '1:capture',
      '1:clearStorage',
      '1:setViewport',
      '1:goto',
      '1:evaluate',
      '1:evaluate',
      '1:evaluate',
      '1:evaluate',
      '1:capture',
    ])
  })

  it("clears nothing on the fresh page that replaced a broken story's page", async () => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => finishedAnswer({ status: 'error' }) }] })
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
      '2:evaluate',
      '2:evaluate',
      '2:evaluate',
      '2:capture',
    ])
  })

  it('leaves readyTimeout whole for the capture after it', async () => {
    const driver = new FakeDriver({ pages: [{ clearStorage: async () => pass(3000) }] })
    const session = openCaptureSession(driver, settings)

    await session.capture(primary)
    await session.capture(secondary)
    expect(driver.calls[9]).toEqual({ page: 1, method: 'goto', args: [secondary.url, 10_000] })
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
    expect(driver.methods().slice(7)).toEqual([
      '1:clearStorage',
      '1:close',
      '2:setViewport',
      '2:goto',
      '2:evaluate',
      '2:evaluate',
      '2:evaluate',
      '2:evaluate',
      '2:capture',
    ])
  })
})

describe('a broken story', () => {
  it('is one Storybook reports finished with a status other than success, naming the status', async () => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => finishedAnswer({ status: 'error' }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          'Storybook reported the story finished with status "error", as it does when a loader, beforeEach or the render throws, or when a check such as accessibility fails.',
      },
    })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it.each([
    [
      'play-threw',
      'whose play function threw, even though Storybook reports it finished well',
      { errors: [{ event: 'playFunctionThrewException', text: 'Error: boom' }] },
      "The story's play function threw Error: boom.",
    ],
    [
      'play-threw',
      'whose play function left unhandled errors',
      { status: 'error', errors: [{ event: 'unhandledErrorsWhilePlaying', text: 'Error: late' }] },
      "The story's play function left unhandled errors: Error: late.",
    ],
    [
      'error',
      'that threw as it rendered',
      { errors: [{ event: 'storyThrewException', text: 'TypeError: x is undefined' }] },
      'The story threw TypeError: x is undefined.',
    ],
    [
      'error',
      'where Storybook showed its error display',
      { errorDisplay: true },
      'Storybook showed its error display.',
    ],
  ])('is %s for a story %s, saying so', async (reason, _what, answer, message) => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => finishedAnswer(answer) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({ broken: { reason, message } })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it.each([
    [
      "Storybook's preview never started",
      timedOutAnswer('preview-start'),
      "Storybook's preview never started in its page",
    ],
    [
      "Storybook's preview never became ready",
      timedOutAnswer('preview-ready'),
      "Storybook's preview started but never became ready",
    ],
    [
      'Storybook never reported the story finished',
      timedOutAnswer('story'),
      'Storybook never sent storyFinished for it',
    ],
    [
      'Storybook never reported the story finished, with its last render step',
      timedOutAnswer('story', 'playing'),
      'Storybook never sent storyFinished for it, and its last render step was "playing"',
    ],
  ])('is a timeout when %s, saying so', async (_what, answer, doing) => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => answer }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: { reason: 'timeout', message: `The story wasn't ready within readyTimeout (10000 ms): ${doing}.` },
    })
  })

  it("is one whose page didn't run the page script", async () => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => ({ outcome: 'script-missing' }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "visual-check's page script didn't run in the story's page, so it couldn't wait for the story to finish.",
      },
    })
  })

  it.each([
    ['1 image still loading', 1, '1 of its images was still loading'],
    ['3 images still loading', 3, '3 of its images were still loading'],
    ['loaded images still decoding', 0, 'its images were still decoding'],
  ])('is a timeout with %s at the time limit, saying so', async (_what, pending, doing) => {
    const driver = new FakeDriver({ pages: [{ assetsWait: async () => imagesTimedOutAnswer(pending) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: { reason: 'timeout', message: `The story wasn't ready within readyTimeout (10000 ms): ${doing}.` },
    })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it('is fonts-not-loaded when fonts were still loading at the time limit, naming the faces', async () => {
    const faces = ['Never Loads 400 normal', 'Slow 700 italic']
    const driver = new FakeDriver({ pages: [{ assetsWait: async () => fontsTimedOutAnswer(faces) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'fonts-not-loaded',
        message:
          "The story's fonts hadn't loaded within readyTimeout (10000 ms). Still loading: Never Loads 400 normal, Slow 700 italic.",
        faces,
      },
    })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it("is a timeout when document.fonts.ready hadn't resolved at the time limit with no face still loading", async () => {
    const driver = new FakeDriver({ pages: [{ assetsWait: async () => fontsTimedOutAnswer([]) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message: "The story wasn't ready within readyTimeout (10000 ms): document.fonts.ready hadn't resolved.",
      },
    })
  })

  it("is one whose page didn't run the page script when waiting for its images and fonts", async () => {
    const driver = new FakeDriver({ pages: [{ assetsWait: async () => ({ outcome: 'script-missing' }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "visual-check's page script didn't run in the story's page, so it couldn't wait for its images and fonts.",
      },
    })
  })

  it("is one whose page doesn't answer the wait for images and fonts in time, naming that step", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          assetsWait: async (timeoutMs) => {
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
          "The story wasn't ready within readyTimeout (10000 ms): its page stopped answering while visual-check waited for its images and fonts.",
      },
    })
  })

  it("is one whose wait for images and fonts gives an answer visual-check doesn't know", async () => {
    const driver = new FakeDriver({ pages: [{ assetsWait: async () => 42 }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "Waiting for images and fonts failed: The wait for images and fonts in the page gave an answer visual-check doesn't know: 42.",
      },
    })
  })

  it('is a timeout when visual-check was still finishing its animations at the time limit, saying so', async () => {
    const driver = new FakeDriver({ pages: [{ endStateWait: async () => animationsTimedOutAnswer() }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): visual-check was still finishing its animations.",
      },
    })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it('is a timeout when visual-check was still putting its media on their first frame at the time limit, saying so', async () => {
    const driver = new FakeDriver({ pages: [{ endStateWait: async () => mediaTimedOutAnswer() }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): visual-check was still putting its media on their first frame.",
      },
    })
    expect(driver.methods()).not.toContain('1:capture')
  })

  it("is one whose page didn't run the page script when bringing it to its end state", async () => {
    const driver = new FakeDriver({ pages: [{ endStateWait: async () => ({ outcome: 'script-missing' }) }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message: "visual-check's page script didn't run in the story's page, so it couldn't bring it to its end state.",
      },
    })
  })

  it("is one whose page doesn't answer the end state in time, naming that step", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          endStateWait: async (timeoutMs) => {
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
          "The story wasn't ready within readyTimeout (10000 ms): its page stopped answering while visual-check brought it to its end state.",
      },
    })
  })

  it("is one whose end state gives an answer visual-check doesn't know", async () => {
    const driver = new FakeDriver({ pages: [{ endStateWait: async () => 42 }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "Bringing the story to its end state failed: The end state in the page gave an answer visual-check doesn't know: 42.",
      },
    })
  })

  it('is one whose images were still loading after the end state changed anything, saying so', async () => {
    let assetsWaits = 0
    const driver = new FakeDriver({
      pages: [
        {
          assetsWait: async () => {
            assetsWaits += 1

            return assetsWaits === 1 ? readyAnswer() : imagesTimedOutAnswer(1)
          },
          endStateWait: async () => settledAnswer(true),
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'timeout',
        message:
          "The story wasn't ready within readyTimeout (10000 ms): 1 of its images was still loading after its end state.",
      },
    })
    expect(driver.methods()).not.toContain('1:capture')
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

  it("is one whose page doesn't answer the story wait in time, naming that step", async () => {
    const driver = new FakeDriver({
      pages: [
        {
          storyWait: async (timeoutMs) => {
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
          "The story wasn't ready within readyTimeout (10000 ms): its page stopped answering while visual-check waited for the story to finish.",
      },
    })
  })

  it('is one whose page fails to load as the time runs out, by the error it gives and not by the clock', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          goto: async (url, timeoutMs) => {
            pass(timeoutMs)

            throw new PageLoadError(url, 'net::ERR_CONNECTION_RESET')
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
            throw new PageLoadError(url, 'net::ERR_CONNECTION_REFUSED')
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
    ['storyWait', 'Waiting for the story to finish'],
    ['assetsWait', 'Waiting for images and fonts'],
    ['waitHook', "Running the story's wait hook"],
    ['endStateWait', 'Bringing the story to its end state'],
    ['capture', 'Capturing the snapshot'],
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

  it("is one whose story wait gives an answer visual-check doesn't know", async () => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => 42 }] })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'error',
        message:
          "Waiting for the story to finish failed: The Storybook wait in the page gave an answer visual-check doesn't know: 42.",
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
      storyWait: async () => {
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
          storyWait: async () => {
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
          capture: async () => {
            throw new PageTimeoutError("The page didn't capture within 30 s.", 30_000)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: { reason: 'error', message: "Capturing the snapshot failed: The page didn't capture within 30 s." },
    })
  })

  it('is too tall when the capture is over 32,767 device pixels on a side, and its page is closed', async () => {
    const driver = new FakeDriver({
      pages: [
        {
          capture: async () => {
            throw new CaptureTooLargeError(2560, 40_000)
          },
        },
      ],
    })

    expect(await openCaptureSession(driver, settings).capture(primary)).toEqual({
      broken: {
        reason: 'too-tall',
        message:
          'The capture is 2560 × 40000 device pixels, over 32,767 on a side. Set element to capture part of the story, or use a smaller viewport.',
      },
    })
    expect(driver.methods()).toContain('1:close')
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
      '2:evaluate',
      '2:evaluate',
      '2:evaluate',
      '2:capture',
    ])
  })

  it('closes its page when Storybook reports the story failed too', async () => {
    const driver = new FakeDriver({ pages: [{ storyWait: async () => finishedAnswer({ status: 'error' }) }] })
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
    `${page}:evaluate`,
    `${page}:evaluate`,
    `${page}:evaluate`,
    `${page}:capture`,
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
    ['timeout', { storyWait: async () => timedOutAnswer('story') }],
    ['fonts-not-loaded', { assetsWait: async () => fontsTimedOutAnswer(['Inter 400 normal']) }],
    ['wait-threw', { waitHook: async () => ({ outcome: 'threw', text: 'Error: boom' }) }],
    [
      'play-threw',
      {
        storyWait: async () =>
          finishedAnswer({ errors: [{ event: 'playFunctionThrewException', text: 'Error: boom' }] }),
      },
    ],
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
