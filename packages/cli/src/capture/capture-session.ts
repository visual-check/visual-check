import { readStoryWait, type StoryWait, storyWaitExpression } from '../storybook/preview-script.js'
import { testPathUserAgentSuffix } from '../storybook/test-path.js'
import { readWaitHookRun, type WaitHookRun, waitHookExpression } from '../storybook/wait-hook.js'
import {
  BrowserExitedError,
  type CaptureArea,
  CaptureTooLargeError,
  type Driver,
  maxCaptureSide,
  type Page,
  PageCrashedError,
  PageNavigatedAwayError,
  type PageSetup,
  PageTimeoutError,
  type PageViewport,
} from './driver/driver.js'
import { type EndState, readEndState } from './end-state.js'
import {
  type AssetsReadiness,
  assetsReadyExpression,
  endStateExpression,
  pageInitScript,
  prepareCaptureExpression,
  readAssetsReadiness,
} from './page-script.js'
import { type CapturePrep, readCapturePrep, type StoryMask } from './prepare-capture.js'

/**
 * How much longer than a wait in the page the driver waits for its answer, in ms. The wait in the page gives up first
 * and says why; this catches a page that stopped answering.
 */
export const waitMarginMs = 1_000

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
   * each with the whole of it. It's counted from just before the viewport is set. Loading the story (`goto`), waiting
   * for Storybook to report it finished, waiting for its images and fonts, running its wait hook, checking its images
   * and fonts again after the hook, bringing it to its end state, checking its images and fonts again after that and
   * painting its masks share it, each getting what's left, in whole ms rounded up. Each wait in the page gives up when
   * it runs out, and the driver allows up to 1 s more for the page's answer. Setting the viewport and the capture are
   * bound by the driver's own fixed limits instead.
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
  /**
   * The colour masks are painted in: `#RGB` or `#RRGGBB`.
   */
  maskColor: string
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
  /**
   * The CSS selector of the element whose box is captured. The full page is captured without it.
   */
  element?: string
  /**
   * The masks painted over the story before its capture, in order. None without it.
   */
  masks?: readonly StoryMask[]
}

/**
 * Why a story can't be captured, as a code a report can group by.
 *
 * - `load-failed`: its stories file failed to load, or didn't load within readyTimeout, so every story of that file is
 *   broken. The run's options read gives it, before any capture; a capture session never does.
 * - `error`: the story, Storybook or the browser failed it: Storybook reported an error or showed its error display,
 *   the story threw, the page script didn't run, the story's wait hook couldn't run, or a step of the capture failed.
 * - `play-threw`: the story's `play` function threw or left unhandled errors.
 * - `timeout`: the story wasn't ready within readyTimeout.
 * - `fonts-not-loaded`: a font face the story's page uses was still loading when readyTimeout ran out.
 * - `wait-threw`: the story's `wait` hook threw or rejected.
 * - `navigated-away`: the story's page went to another document.
 * - `crashed`: the page crashed, usually from running out of memory.
 * - `too-tall`: the capture is over 32,767 device pixels on a side.
 * - `element-missing`: the story's `element` selector matched nothing, or an element whose box is of zero size.
 * - `browser-exited`: the browser exited while the story was in flight. The run's browser gives it; a capture session
 *   rejects with a `BrowserExitedError` instead.
 *
 * @public
 */
export type BrokenReason =
  | 'load-failed'
  | 'error'
  | 'play-threw'
  | 'timeout'
  | 'fonts-not-loaded'
  | 'wait-threw'
  | 'navigated-away'
  | 'crashed'
  | 'too-tall'
  | 'element-missing'
  | 'browser-exited'

/**
 * A story that can't be captured: why, and a one-line message for people saying so. A capture session gives one for a
 * story it can't capture, and the run gives one for a story in flight when its browser exits and for each story of a
 * stories file that didn't load. A story whose fonts didn't load also keeps the faces still loading, and a story that
 * navigated away keeps where it went.
 *
 * @public
 */
export type BrokenStory =
  | {
      /**
       * Why the story can't be captured.
       */
      reason: Exclude<BrokenReason, 'fonts-not-loaded' | 'navigated-away'>
      /**
       * One line for people saying why.
       */
      message: string
    }
  | {
      /**
       * Why the story can't be captured: a font face was still loading when readyTimeout ran out.
       */
      reason: 'fonts-not-loaded'
      /**
       * One line for people saying why, naming the faces still loading.
       */
      message: string
      /**
       * The font faces still loading, each as its family, weight and style. The weight and style are as declared, such
       * as `Inter normal normal` or `Inter 100 900 normal`.
       */
      faces: string[]
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
 * What capturing a story gave: its snapshot, with how long Storybook's `completing` render step took, or, for a broken
 * story, why it can't be captured.
 *
 * @public
 */
export type StoryCapture =
  | {
      /**
       * The snapshot, as PNG bytes exactly as the browser made them.
       */
      snapshot: Uint8Array
      /**
       * How long Storybook's `completing` render step took for the story, in ms: about 0 on Storybook's test path, and
       * 100 or more off it. `undefined` when the page didn't see both the `completing` and `completed` steps.
       */
      completingMs: number | undefined
    }
  | {
      /**
       * Why the story can't be captured.
       */
      broken: BrokenStory
    }

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
type Step =
  | 'viewport'
  | 'load'
  | 'story'
  | 'assets'
  | 'wait'
  | 'assets-after-wait'
  | 'end-state'
  | 'assets-after-end-state'
  | 'masks'
  | 'capture'

/**
 * A check of the story's images and fonts: the one once the story finished, the one after its wait hook ran, or the one
 * after its end state changed the page.
 */
type AssetsStep = Extract<Step, 'assets' | 'assets-after-wait' | 'assets-after-end-state'>

/**
 * What each step does, as a phrase that follows "while".
 */
const stepNames: Record<Step, string> = {
  viewport: 'setting the viewport',
  load: 'loading the story',
  story: 'waiting for the story to finish',
  assets: 'waiting for images and fonts',
  wait: "running the story's wait hook",
  'assets-after-wait': 'waiting for images and fonts after its wait hook',
  'end-state': 'bringing the story to its end state',
  'assets-after-end-state': 'waiting for images and fonts after its end state',
  masks: 'painting its masks and hiding the caret',
  capture: 'capturing the snapshot',
}

/**
 * What the steps that readyTimeout limits were doing when it ran out.
 */
const stepTimeouts: Partial<Record<Step, string>> = {
  load: 'its page was still loading',
  story: 'its page stopped answering while visual-check waited for the story to finish',
  assets: 'its page stopped answering while visual-check waited for its images and fonts',
  wait: 'its page stopped answering while its wait hook ran',
  'assets-after-wait':
    'its page stopped answering while visual-check waited for its images and fonts after its wait hook',
  'end-state': 'its page stopped answering while visual-check brought it to its end state',
  'assets-after-end-state':
    'its page stopped answering while visual-check waited for its images and fonts after its end state',
  masks: 'its page stopped answering while visual-check painted its masks and hid the caret',
}

/**
 * What each check of images and fonts adds to what a message says the story was doing, so the message names the check.
 */
const assetsCheckSuffixes: Record<AssetsStep, string> = {
  assets: '',
  'assets-after-wait': ' after its wait hook',
  'assets-after-end-state': ' after its end state',
}

/**
 * What bringing the story to its end state was still doing when readyTimeout ran out, by the step it was in.
 */
const endStateTimeouts: Record<Extract<EndState, { outcome: 'timed-out' }>['step'], string> = {
  animations: 'visual-check was still finishing its animations',
  media: 'visual-check was still putting its media on their first frame',
}

/**
 * Says the story wasn't ready within readyTimeout, and what it was doing.
 */
function notReady(readyTimeoutMs: number, doing: string): string {
  return `The story wasn't ready within readyTimeout (${readyTimeoutMs} ms): ${doing}.`
}

/**
 * Gives an error's message, or the thrown value as text, ending with a period.
 *
 * @public
 */
export function failureReasonOf(error: unknown): string {
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
 * Says what a story wait that timed out was still waiting for, by the step it was in.
 */
function stillWaitingFor(wait: Extract<StoryWait, { outcome: 'timed-out' }>): string {
  if (wait.step === 'preview-start') {
    return "Storybook's preview never started in its page"
  }

  if (wait.step === 'preview-ready') {
    return "Storybook's preview started but never became ready"
  }

  if (wait.lastRenderStep === undefined) {
    return 'Storybook never sent storyFinished for it'
  }

  return `Storybook never sent storyFinished for it, and its last render step was ${JSON.stringify(wait.lastRenderStep)}`
}

/**
 * Says why a story isn't ready to capture, from what the story wait found.
 */
function describeStoryWait(wait: Exclude<StoryWait, { outcome: 'finished' }>, readyTimeoutMs: number): BrokenStory {
  switch (wait.outcome) {
    case 'play-threw':
      return { reason: 'play-threw', message: wait.message }
    case 'errored':
      return { reason: 'error', message: wait.message }
    case 'timed-out':
      return { reason: 'timeout', message: notReady(readyTimeoutMs, stillWaitingFor(wait)) }
    case 'script-missing':
      return {
        reason: 'error',
        message:
          "visual-check's page script didn't run in the story's page, so it couldn't wait for the story to finish.",
      }
  }
}

/**
 * Says what the images of a story were doing when the wait for them timed out, by how many hadn't finished loading.
 */
function imagesStillLoading(pending: number): string {
  if (pending === 0) {
    return 'its images were still decoding'
  }

  return pending === 1 ? '1 of its images was still loading' : `${pending} of its images were still loading`
}

/**
 * Says why a story isn't ready to capture, from what a check of its images and fonts found. `suffix` follows what the
 * message says the story was doing, so it names the check.
 */
function describeAssetsWait(
  assets: Exclude<AssetsReadiness, { outcome: 'ready' }>,
  readyTimeoutMs: number,
  suffix: string,
): BrokenStory {
  if (assets.outcome === 'script-missing') {
    return {
      reason: 'error',
      message: `visual-check's page script didn't run in the story's page, so it couldn't wait for its images and fonts${suffix}.`,
    }
  }

  if (assets.step === 'images') {
    return { reason: 'timeout', message: notReady(readyTimeoutMs, `${imagesStillLoading(assets.pending)}${suffix}`) }
  }

  const faces = assets.pendingFaces

  if (faces.length === 0) {
    return { reason: 'timeout', message: notReady(readyTimeoutMs, `document.fonts.ready hadn't resolved${suffix}`) }
  }

  return {
    reason: 'fonts-not-loaded',
    message: `The story's fonts hadn't loaded within readyTimeout (${readyTimeoutMs} ms)${suffix}. Still loading: ${faces.join(', ')}.`,
    faces,
  }
}

/**
 * Says why a story isn't ready to capture, from what bringing it to its end state found.
 */
function describeEndState(endState: Exclude<EndState, { outcome: 'settled' }>, readyTimeoutMs: number): BrokenStory {
  if (endState.outcome === 'script-missing') {
    return {
      reason: 'error',
      message: "visual-check's page script didn't run in the story's page, so it couldn't bring it to its end state.",
    }
  }

  return { reason: 'timeout', message: notReady(readyTimeoutMs, endStateTimeouts[endState.step]) }
}

/**
 * Says why a story can't be captured, from what preparing its capture found. `element` is the story's element selector.
 */
function describeCapturePrep(
  prep: Exclude<CapturePrep, { outcome: 'ready' }>,
  element: string | null,
  readyTimeoutMs: number,
): BrokenStory {
  switch (prep.outcome) {
    case 'element-missing':
      return {
        reason: 'element-missing',
        message:
          prep.found === 'nothing'
            ? `The element selector ${JSON.stringify(element)} matched nothing.`
            : `The element selector ${JSON.stringify(element)} matched an element with a box of zero size.`,
      }
    case 'invalid-selector':
      return {
        reason: 'error',
        message:
          prep.of === 'element'
            ? `The element selector ${JSON.stringify(element)} isn't valid CSS: ${failureReasonOf(prep.message)}`
            : `The selector of mask ${JSON.stringify(prep.name)} isn't valid CSS: ${failureReasonOf(prep.message)}`,
      }
    case 'timed-out':
      return {
        reason: 'timeout',
        message: notReady(readyTimeoutMs, 'visual-check was still looking for remote content to mask'),
      }
    case 'script-missing':
      return {
        reason: 'error',
        message: "visual-check's page script didn't run in the story's page, so it couldn't paint its masks.",
      }
    case 'paint-failed':
      return {
        reason: 'error',
        message: `visual-check couldn't paint the story's masks: ${failureReasonOf(prep.message)}`,
      }
  }
}

/**
 * Says why a story isn't ready to capture, from what running its wait hook found.
 */
function describeWaitHookRun(
  run: Exclude<WaitHookRun, { outcome: 'none' | 'done' }>,
  readyTimeoutMs: number,
): BrokenStory {
  switch (run.outcome) {
    case 'threw':
      return { reason: 'wait-threw', message: run.message }
    case 'context-failed':
      return { reason: 'error', message: run.message }
    case 'timed-out':
      return { reason: 'timeout', message: notReady(readyTimeoutMs, "its wait hook hadn't finished") }
    case 'no-render':
      return {
        reason: 'error',
        message: "Storybook's preview had no render of the story to run its wait hook with.",
      }
    case 'script-missing':
      return {
        reason: 'error',
        message: "visual-check's page script didn't run in the story's page, so it couldn't run its wait hook.",
      }
  }
}

/**
 * Says why a story couldn't be captured, from the error a step failed with. A `PageTimeoutError` from loading the story
 * or from a wait in the page means readyTimeout ran out. A `CaptureTooLargeError` means the story is too tall to
 * capture: the hint says to set `element` for the full page, or to capture a smaller element. `story` shows a URL on
 * the story's own origin as a path.
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

  if (error instanceof CaptureTooLargeError) {
    const hint = story.element === undefined ? 'Set element to capture part of the story' : 'Capture a smaller element'

    return {
      reason: 'too-tall',
      message: `The capture is ${error.deviceWidth} × ${error.deviceHeight} device pixels, over ${maxCaptureSide.toLocaleString('en-US')} on a side. ${hint}, or use a smaller viewport.`,
    }
  }

  const doing = stepTimeouts[step]

  if (error instanceof PageTimeoutError && doing !== undefined) {
    return { reason: 'timeout', message: notReady(readyTimeoutMs, doing) }
  }

  const name = stepNames[step]

  return {
    reason: 'error',
    message: `${name.charAt(0).toUpperCase()}${name.slice(1)} failed: ${failureReasonOf(error)}`,
  }
}

/**
 * Captures a story on an open page: sets the viewport, loads the story, waits until Storybook reports it finished with
 * nothing gone wrong, waits for its images and fonts, runs its wait hook, brings it to its end state, measures its
 * element, paints its masks, hides the caret and captures the element's box, or the full page when the story has no
 * element. When the story has a wait hook, its images and fonts are checked again after it, and when the end state
 * changed anything, they're checked again before the masks. Loading, the waits, the hook, the end state, those checks
 * and the masks share readyTimeout, each getting only what's left of it. A story that can't be captured comes back as a
 * broken story. Rejects only with a `BrowserExitedError`.
 */
async function captureOnPage(page: Page, story: StoryToCapture, settings: CaptureSettings): Promise<StoryCapture> {
  const deadline = performance.now() + settings.readyTimeoutMs
  const timeLeft = (): number => Math.max(0, Math.ceil(deadline - performance.now()))
  let step: Step = 'viewport'

  /**
   * Evaluates a wait in the page, built by `expressionFor` for what's left of readyTimeout, and gives the page's
   * answer. The driver allows the margin more for it.
   */
  const waitInPage = async (expressionFor: (limitMs: number) => string): Promise<unknown> => {
    const limit = timeLeft()

    return await page.evaluate(expressionFor(limit), limit + waitMarginMs)
  }

  /**
   * Waits for the story's images and fonts, as the check `assetsStep` names. Gives why the story isn't ready when they
   * didn't load in time, or nothing when they did.
   */
  const checkAssets = async (assetsStep: AssetsStep): Promise<BrokenStory | undefined> => {
    step = assetsStep

    const assets = readAssetsReadiness(await waitInPage(assetsReadyExpression))

    if (assets.outcome === 'ready') {
      return undefined
    }

    return describeAssetsWait(assets, settings.readyTimeoutMs, assetsCheckSuffixes[assetsStep])
  }

  /**
   * Runs the story's wait hook, if it has one, and checks its images and fonts again once it ran. Gives why the story
   * isn't ready, or nothing when it is.
   */
  const runWaitHook = async (): Promise<BrokenStory | undefined> => {
    step = 'wait'

    const run = readWaitHookRun(await waitInPage((limit) => waitHookExpression(story.id, limit)))

    if (run.outcome === 'none') {
      return undefined
    }

    return run.outcome === 'done'
      ? await checkAssets('assets-after-wait')
      : describeWaitHookRun(run, settings.readyTimeoutMs)
  }

  /**
   * Brings the story to its end state, and checks its images and fonts again when that changed anything. Gives why the
   * story isn't ready, or nothing when it is.
   */
  const bringToEndState = async (): Promise<BrokenStory | undefined> => {
    step = 'end-state'

    const endState = readEndState(await waitInPage(endStateExpression))

    if (endState.outcome !== 'settled') {
      return describeEndState(endState, settings.readyTimeoutMs)
    }

    return endState.changed ? await checkAssets('assets-after-end-state') : undefined
  }

  /**
   * Measures the story's element, paints its masks and hides the caret. Gives what to capture: the element's box, or
   * the full page when the story has no element. Gives why the story can't be captured instead when that failed.
   */
  const prepareCapture = async (): Promise<{ area: CaptureArea } | { broken: BrokenStory }> => {
    step = 'masks'

    const element = story.element ?? null
    const request = { element, masks: story.masks ?? [], maskColor: settings.maskColor }
    const prep = readCapturePrep(await waitInPage((limit) => prepareCaptureExpression(request, limit)))

    if (prep.outcome !== 'ready') {
      return { broken: describeCapturePrep(prep, element, settings.readyTimeoutMs) }
    }

    return { area: prep.box ?? 'full-page' }
  }

  try {
    await page.setViewport(settings.viewport)
    step = 'load'
    await page.goto(story.url, timeLeft())
    step = 'story'

    const wait = readStoryWait(await waitInPage((limit) => storyWaitExpression(story.id, limit)))

    if (wait.outcome !== 'finished') {
      return { broken: describeStoryWait(wait, settings.readyTimeoutMs) }
    }

    const broken = (await checkAssets('assets')) ?? (await runWaitHook()) ?? (await bringToEndState())

    if (broken !== undefined) {
      return { broken }
    }

    const prepared = await prepareCapture()

    if ('broken' in prepared) {
      return prepared
    }

    step = 'capture'

    return { snapshot: await page.capture(prepared.area), completingMs: wait.completingMs }
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
 * Gives how a page is set up for the settings: a user agent ending in `StorybookTestRunner`, the settings' time zone,
 * locale and colour scheme, and the page script. A capture page and a page that reads options are set up the same way.
 */
export function pageSetupOf(settings: CaptureSettings): PageSetup {
  return {
    userAgentSuffix: testPathUserAgentSuffix,
    timezone: settings.timezone,
    locale: settings.locale,
    colorScheme: settings.colorScheme,
    initScript: pageInitScript,
  }
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
  const setup = pageSetupOf(settings)
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
        broken: {
          reason: 'error',
          message: `visual-check couldn't open a page for the story: ${failureReasonOf(error)}`,
        },
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
