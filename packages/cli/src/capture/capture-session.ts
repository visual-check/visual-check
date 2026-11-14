import {
  BrowserExitedError,
  type Driver,
  type Page,
  PageCrashedError,
  PageNavigatedAwayError,
  type PageSetup,
  PageTimeoutError,
  type PageViewport,
} from './driver/driver.js'
import { pageInitScript, readStoryReadiness, type StoryReadiness, storyReadinessExpression } from './page-script.js'

/**
 * What every page's user agent ends in. It puts Storybook 9.1 and later on its test path, which skips a fixed 100 ms
 * wait per story.
 */
const userAgentSuffix = ' StorybookTestRunner'

/**
 * How much longer than the readiness wait in the page the driver waits for its answer, in ms. The wait in the page
 * gives up first and says why; this catches a page that stopped answering.
 */
const readinessMarginMs = 1_000

/**
 * How a session captures every story.
 *
 * @public
 */
export interface CaptureSettings {
  /**
   * The size every story is laid out and captured at.
   */
  viewport: PageViewport
  /**
   * The config's `readyTimeout`, in ms, counted from just before the viewport is set. Loading the story (`goto`) and
   * waiting for Storybook to report it finished share it, each getting what's left, in whole ms rounded up. The wait in
   * the page gives up when it runs out, and the driver allows up to 1 s more for the page's answer. Setting the
   * viewport and the capture are bound by the driver's own fixed limits instead.
   */
  readyTimeoutMs: number
  /**
   * The time zone the page runs in, such as `Europe/Warsaw`.
   */
  timezone: string
  /**
   * The locale the page runs in, such as `en-US`.
   */
  locale: string
  /**
   * The colour scheme the page's `prefers-color-scheme` media feature reports.
   */
  colorScheme: PageSetup['colorScheme']
}

/**
 * A story to capture.
 *
 * @public
 */
export interface StoryToCapture {
  /**
   * The story's ID, such as `button--primary`.
   */
  id: string
  /**
   * The URL of the story on its own, such as `http://localhost:6006/iframe.html?id=button--primary&viewMode=story`.
   */
  url: string
}

/**
 * What capturing a story gave: its snapshot, as PNG bytes exactly as the browser made them, or, for a broken story,
 * a one-line message for people saying why it can't be captured.
 *
 * @public
 */
export type StoryCapture = { snapshot: Uint8Array } | { broken: string }

/**
 * Captures stories one at a time on one page of a running browser.
 *
 * @public
 */
export interface CaptureSession {
  /**
   * Captures a story, opening the session's page first when none is open. A story that can't be captured comes back as
   * a broken story, and the page is replaced by a fresh one for the next. Rejects only with a `BrowserExitedError`,
   * when the browser exits. Call it once the previous capture has settled.
   */
  capture: (story: StoryToCapture) => Promise<StoryCapture>
  /**
   * Closes the session's page, if one is open. The browser stays open: it belongs to whoever opened the session.
   */
  close: () => Promise<void>
}

/**
 * A step of one capture.
 */
type Step = 'viewport' | 'load' | 'wait' | 'capture'

/**
 * What each step does, as a phrase that follows "while".
 */
const stepNames: Record<Step, string> = {
  viewport: 'setting the viewport',
  load: 'loading the story',
  wait: 'waiting for the story to finish',
  capture: 'capturing the snapshot',
}

/**
 * What the steps that readyTimeout limits were doing when it ran out.
 */
const stepTimeouts: Partial<Record<Step, string>> = {
  load: 'its page was still loading',
  wait: 'its page stopped answering while visual-check waited for it to finish',
}

/**
 * Says the story wasn't ready within readyTimeout, and what it was doing.
 */
function notReady(readyTimeoutMs: number, doing: string): string {
  return `The story wasn't ready within readyTimeout (${readyTimeoutMs} ms): ${doing}.`
}

/**
 * Gives an error's message, or the thrown value as text, ending with a period.
 */
function reasonOf(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error)

  return reason.endsWith('.') ? reason : `${reason}.`
}

/**
 * Says why a story isn't ready to capture, from what the readiness wait found.
 */
function describeReadiness(readiness: StoryReadiness, readyTimeoutMs: number): string {
  switch (readiness.outcome) {
    case 'finished':
      return `Storybook reported the story finished with status ${JSON.stringify(readiness.status)}, as it does when a loader, beforeEach or the render throws, when play leaves unhandled errors, or when a check such as accessibility fails.`
    case 'timed-out':
      return notReady(
        readyTimeoutMs,
        readiness.channel
          ? 'Storybook never sent storyFinished for it'
          : "Storybook's preview never started in its page",
      )
    case 'script-missing':
      return "visual-check's page script didn't run in the story's page, so it couldn't wait for the story to finish."
  }
}

/**
 * Says why a story couldn't be captured, from the error a step failed with. A `PageTimeoutError` from loading the story
 * or waiting for it means readyTimeout ran out.
 */
function describeFailure(error: unknown, step: Step, readyTimeoutMs: number): string {
  if (error instanceof PageCrashedError) {
    return `The page crashed while ${stepNames[step]}, usually because it ran out of memory.`
  }

  if (error instanceof PageNavigatedAwayError) {
    return `The story navigated away to ${error.url}, and a story has to stay on its page to be captured.`
  }

  const doing = stepTimeouts[step]

  if (error instanceof PageTimeoutError && doing !== undefined) {
    return notReady(readyTimeoutMs, doing)
  }

  const name = stepNames[step]

  return `${name.charAt(0).toUpperCase()}${name.slice(1)} failed: ${reasonOf(error)}`
}

/**
 * Captures a story on an open page: sets the viewport, loads the story, waits until Storybook reports it finished and
 * captures the full page. Loading and waiting share readyTimeout, each getting only what's left of it. A story that
 * can't be captured comes back as a broken story. Rejects only with a `BrowserExitedError`.
 */
async function captureOnPage(page: Page, story: StoryToCapture, settings: CaptureSettings): Promise<StoryCapture> {
  const deadline = performance.now() + settings.readyTimeoutMs
  const timeLeft = (): number => Math.max(0, Math.ceil(deadline - performance.now()))
  let step: Step = 'viewport'

  try {
    await page.setViewport(settings.viewport)
    step = 'load'
    await page.goto(story.url, timeLeft())
    step = 'wait'

    const limit = timeLeft()
    const answer = await page.evaluate(storyReadinessExpression(story.id, limit), limit + readinessMarginMs)
    const readiness = readStoryReadiness(answer)

    if (readiness.outcome !== 'finished' || readiness.status !== 'success') {
      return { broken: describeReadiness(readiness, settings.readyTimeoutMs) }
    }

    step = 'capture'

    return { snapshot: await page.captureFullPage() }
  } catch (error) {
    if (error instanceof BrowserExitedError) {
      throw error
    }

    return { broken: describeFailure(error, step, settings.readyTimeoutMs) }
  }
}

/**
 * Starts a session that captures stories on `driver`, one at a time, on one page. It opens the page at its first
 * capture, set up with the settings, a user agent ending in `StorybookTestRunner` and the page script. After a broken
 * story, it closes the page and opens a fresh one for the next story.
 *
 * @public
 */
export function openCaptureSession(driver: Driver, settings: CaptureSettings): CaptureSession {
  const setup: PageSetup = {
    userAgentSuffix,
    timezone: settings.timezone,
    locale: settings.locale,
    colorScheme: settings.colorScheme,
    initScript: pageInitScript,
  }
  let page: Page | undefined

  const closePage = async (): Promise<void> => {
    const closing = page

    page = undefined
    await closing?.close().catch(() => undefined)
  }

  return {
    capture: async (story) => {
      try {
        page ??= await driver.newPage(setup)
      } catch (error) {
        if (error instanceof BrowserExitedError) {
          throw error
        }

        return { broken: `visual-check couldn't open a page for the story: ${reasonOf(error)}` }
      }

      const capture = await captureOnPage(page, story, settings).catch((error: unknown) => {
        page = undefined

        throw error
      })

      if ('broken' in capture) {
        await closePage()
      }

      return capture
    },
    close: closePage,
  }
}
