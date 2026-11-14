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
   * The config's `readyTimeout`, in ms, per attempt: a story that navigates away is captured again, up to 2 more times,
   * each with the whole of it. It's counted from just before the viewport is set. Loading the story (`goto`) and
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
 * Why a story can't be captured, as a code a report can group by.
 *
 * - `error`: the story, Storybook or the browser failed it: Storybook reported a status other than success, the page
 *   script didn't run, or a step of the capture failed.
 * - `timeout`: the story wasn't ready within readyTimeout.
 * - `navigated-away`: the story's page went to another document.
 * - `crashed`: the page crashed, usually from running out of memory.
 * - `browser-exited`: the browser exited while the story was in flight. The run's browser gives it; a capture session
 *   rejects with a `BrowserExitedError` instead.
 *
 * @public
 */
export type BrokenReason = 'error' | 'timeout' | 'navigated-away' | 'crashed' | 'browser-exited'

/**
 * A story that can't be captured: why, and a one-line message for people saying so. A story that navigated away also
 * keeps where it went.
 *
 * @public
 */
export type BrokenStory =
  | {
      /**
       * Why the story can't be captured.
       */
      reason: Exclude<BrokenReason, 'navigated-away'>
      /**
       * One line for people saying why.
       */
      message: string
    }
  | {
      /**
       * Why the story can't be captured: its page went to another document.
       */
      reason: 'navigated-away'
      /**
       * One line for people saying why.
       */
      message: string
      /**
       * The full URL the document went to.
       */
      url: string
    }

/**
 * What capturing a story gave: its snapshot, as PNG bytes exactly as the browser made them, or, for a broken story,
 * why it can't be captured.
 *
 * @public
 */
export type StoryCapture = { snapshot: Uint8Array } | { broken: BrokenStory }

/**
 * Captures stories one at a time on one page of a running browser.
 *
 * @public
 */
export interface CaptureSession {
  /**
   * Captures a story, opening the session's page first when none is open. On a page kept from the previous story, it
   * first clears the cookies and storage that story left, and when that fails, it captures on a fresh page instead. A
   * story that navigates away is captured again at once, up to 2 more times, each on a fresh page in a fresh browser
   * context; when it navigates away a third time, it's a broken story. Any other story that can't be captured comes
   * back as a broken story straight away, and the page is replaced by a fresh one for the next. Rejects only with a
   * `BrowserExitedError`, when the browser exits. Call it once the previous capture has settled.
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
 * Shows a URL the story went to: its path, search and hash when it is an http(s) URL with the story's origin, else the
 * whole URL, which is also what a URL that can't be parsed comes to.
 */
function displayUrlOf(url: string, storyUrl: string): string {
  if (!URL.canParse(url) || !URL.canParse(storyUrl)) {
    return url
  }

  const target = new URL(url)
  const isWeb = target.protocol === 'http:' || target.protocol === 'https:'

  if (isWeb && target.origin === new URL(storyUrl).origin) {
    return `${target.pathname}${target.search}${target.hash}`
  }

  return url
}

/**
 * Says why a story isn't ready to capture, from what the readiness wait found.
 */
function describeReadiness(readiness: StoryReadiness, readyTimeoutMs: number): BrokenStory {
  switch (readiness.outcome) {
    case 'finished':
      return {
        reason: 'error',
        message: `Storybook reported the story finished with status ${JSON.stringify(readiness.status)}, as it does when a loader, beforeEach or the render throws, when play leaves unhandled errors, or when a check such as accessibility fails.`,
      }
    case 'timed-out':
      return {
        reason: 'timeout',
        message: notReady(
          readyTimeoutMs,
          readiness.channel
            ? 'Storybook never sent storyFinished for it'
            : "Storybook's preview never started in its page",
        ),
      }
    case 'script-missing':
      return {
        reason: 'error',
        message:
          "visual-check's page script didn't run in the story's page, so it couldn't wait for the story to finish.",
      }
  }
}

/**
 * Says why a story couldn't be captured, from the error a step failed with. A `PageTimeoutError` from loading the story
 * or waiting for it means readyTimeout ran out. `story` shows a URL on the story's own origin as a path.
 */
function describeFailure(error: unknown, step: Step, story: StoryToCapture, readyTimeoutMs: number): BrokenStory {
  if (error instanceof PageCrashedError) {
    return {
      reason: 'crashed',
      message: `The page crashed while ${stepNames[step]}, usually because it ran out of memory. Fewer workers leave each page more memory.`,
    }
  }

  if (error instanceof PageNavigatedAwayError) {
    return {
      reason: 'navigated-away',
      message: `The story navigated away to ${displayUrlOf(error.url, story.url)}. Await the new page before clicking.`,
      url: error.url,
    }
  }

  const doing = stepTimeouts[step]

  if (error instanceof PageTimeoutError && doing !== undefined) {
    return { reason: 'timeout', message: notReady(readyTimeoutMs, doing) }
  }

  const name = stepNames[step]

  return { reason: 'error', message: `${name.charAt(0).toUpperCase()}${name.slice(1)} failed: ${reasonOf(error)}` }
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

    return { broken: describeFailure(error, step, story, settings.readyTimeoutMs) }
  }
}

/**
 * How many times a story that navigated away is captured again, each on a fresh page, before it's a broken story. The
 * retries follow at once, with no wait.
 */
const navigatedAwayRetries = 2

/**
 * Whether a capture came back as a broken story that navigated away, the only outcome that's retried.
 */
function navigatedAway(capture: StoryCapture): boolean {
  return 'broken' in capture && capture.broken.reason === 'navigated-away'
}

/**
 * Starts a session that captures stories on `driver`, one at a time, on one page. It opens the page at its first
 * capture, set up with the settings, a user agent ending in `StorybookTestRunner` and the page script. After a broken
 * story, it closes the page and opens a fresh one, in a fresh browser context, for the next story.
 *
 * Before each later capture on that page, it clears the cookies, `localStorage`, `sessionStorage` and IndexedDB the
 * previous story left, keeping Cache Storage and service workers. The previous story's document stays loaded until the
 * next story's commits, so a timer or handler of it can still write storage after the clearing. When the clearing
 * fails, such as after the previous story left its document, the story isn't to blame: the session closes the page and
 * captures the story on a fresh one, whose fresh browser context holds nothing.
 *
 * A story that navigates away is captured again at once, up to 2 more times, each on a fresh page in a fresh browser
 * context. When the third attempt navigates away too, the story is broken, with that attempt's message and URL. Any
 * other outcome of a retry, a snapshot or another broken reason, is the story's outcome, and no other reason is
 * retried.
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

  /**
   * Clears the storage the previous story left on the open page, if one is open: a page stays open only after a story
   * captured well. When that fails other than by the browser exiting, closes the page, so the next story opens a fresh
   * one.
   */
  const clearOpenPage = async (): Promise<void> => {
    try {
      await page?.clearStorage()
    } catch (error) {
      if (error instanceof BrowserExitedError) {
        page = undefined

        throw error
      }

      await closePage()
    }
  }

  /**
   * Captures the story on the open page, opening one first when none is. A story that can't be captured, or whose page
   * can't be opened, comes back as a broken story, and a broken story's page is closed. Rejects only with a
   * `BrowserExitedError`, and then drops the page without closing it.
   */
  const captureOnOpenPage = async (story: StoryToCapture): Promise<StoryCapture> => {
    try {
      page ??= await driver.newPage(setup)
    } catch (error) {
      if (error instanceof BrowserExitedError) {
        throw error
      }

      return {
        broken: { reason: 'error', message: `visual-check couldn't open a page for the story: ${reasonOf(error)}` },
      }
    }

    const capture = await captureOnPage(page, story, settings).catch((error: unknown) => {
      page = undefined

      throw error
    })

    if ('broken' in capture) {
      await closePage()
    }

    return capture
  }

  return {
    capture: async (story) => {
      await clearOpenPage()

      let capture = await captureOnOpenPage(story)

      for (let retry = 0; retry < navigatedAwayRetries && navigatedAway(capture); retry += 1) {
        capture = await captureOnOpenPage(story)
      }

      return capture
    },
    close: closePage,
  }
}
