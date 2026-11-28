import { readStoryWait, type StoryWait, storyWaitExpression } from '../storybook/preview-script.js'
import { testPathUserAgentSuffix } from '../storybook/test-path.js'
import { readWaitHookRun, type WaitHookRun, waitHookExpression } from '../storybook/wait-hook.js'
import {
  BrowserExitedError,
  type CaptureArea,
  CaptureTooLargeError,
  type ConsoleMessage,
  type Driver,
  eachPageErrorOnce,
  type FailedLoad,
  maxCaptureSide,
  type Page,
  PageCrashedError,
  type PageError,
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
  type FramesPassed,
  framesAfterGrowthExpression,
  pageInitScript,
  prepareCaptureExpression,
  readAssetsReadiness,
  readFramesPassed,
} from './page-script.js'
import {
  type CapturePrep,
  type PageGrid,
  type PageOverflow,
  type PageRemoteContent,
  readCapturePrep,
  type StoryMask,
} from './prepare-capture.js'

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
   * The config's `readyTimeout`, in ms, per attempt: a story that navigates away is captured again, up to 2 more times,
   * each with the whole of it. It's counted from just before the viewport is set. Loading the story (`goto`), waiting
   * for Storybook to report it finished, waiting for its images and fonts, letting frames pass once the viewport grew
   * and checking its images and fonts again, running its wait hook, checking its images and fonts again after the hook,
   * letting frames pass and checking its images and fonts again once the viewport was set again after the hook,
   * bringing it to its end state, checking its images and fonts again after that and painting its masks share it, each
   * getting what's left, in whole ms rounded up. Each wait in the page gives up when it runs out, and the driver allows
   * up to 1 s more for the page's answer. Setting the viewport, growing it, the capture and capturing the snapshot
   * again are bound by the driver's own fixed limits instead. Nothing limits a story's `captureAgainIf`.
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
  /**
   * Whether each capture also lists the hosts its story sends real network requests to and shows remote content from.
   * It turns on the page's request watching, so only `update` sets it.
   */
  listHosts: boolean
  /**
   * How long the capture of a broken story's image may take, in ms: `brokenImageTimeLimitMs` outside tests. A capture
   * that takes longer gives no image.
   */
  brokenImageTimeLimitMs: number
}

/**
 * How long the capture of a broken story's image may take, in ms.
 *
 * @public
 */
export const brokenImageTimeLimitMs = 5_000

/**
 * A snapshot to capture: a story's URL, with a mode's globals in it, the viewport to capture it at, the story's element
 * and masks, and whether to capture the same page again once the snapshot is captured.
 *
 * @public
 */
export interface StoryToCapture {
  /**
   * The story's ID, such as `button--primary`.
   */
  id: string
  /**
   * The URL of the story on its own, such as `http://localhost:6006/iframe.html?id=button--primary&viewMode=story`. A
   * mode's snapshot adds the mode's globals to it.
   */
  url: string
  /**
   * The size the snapshot is laid out and captured at: the default capture's, or its mode's merged over it.
   */
  viewport: PageViewport
  /**
   * The CSS selector of the element whose box is captured. The full page is captured without it.
   */
  element?: string
  /**
   * Whether a full-page capture first grows the viewport's height to the page's, so fixed and sticky elements sit
   * where they would on a screen as tall as the page, and, once the story's wait hook ran, sets the story's viewport
   * again and grows it to the page measured then. `false` captures the full page beyond the viewport at the
   * viewport's height, so `100vh` stays the viewport's height. Without it, the viewport grows. An element's capture
   * never grows it.
   */
  growViewport?: boolean
  /**
   * Whether content the capture would cut doesn't break the story: content wider than the viewport for the full page,
   * spilling past the `element` box, or the element past the page's top or left edge. When true, the story is
   * captured as it is. Without it, such a story is broken with `overflows`.
   */
  allowOverflow?: boolean
  /**
   * The masks painted over the story before its capture, in order. None without it.
   */
  masks?: readonly StoryMask[]
  /**
   * Whether the capture also brings back the remote content the snapshot shows. Without it, the snapshot comes
   * without it, and no remote content search runs for it unless a host mask needs one or the session's settings ask
   * to list hosts.
   */
  findRemoteContent?: boolean
  /**
   * Whether a story that breaks while its page still shows something comes with an image of that page: for the
   * reasons `error`, `play-threw`, `timeout`, `fonts-not-loaded`, `wait-threw`, `element-missing`, `grid-too-wide`
   * and `overflows`, the full page, captured at once, before the page is closed. Without it, a broken story comes
   * without one.
   */
  imageWhenBroken?: boolean
  /**
   * Decides whether to capture the same page again. It's called with the snapshot as soon as it's captured and what
   * the snapshot comes with is read, with the page left as it is. Each attempt that captured a snapshot calls it once,
   * and an attempt that's broken before its snapshot is captured never calls it. A second capture that navigates away
   * is retried like any other attempt, and the retry calls it again, so it may be called once per attempt. When it
   * resolves true, the area the snapshot was captured from is captured again at once, with nothing done to the page in
   * between, and the capture gives it as `capturedAgain`. For the full page, the page is measured again at the second
   * capture, so its size can change. When it resolves false, nothing more is captured. When it rejects, the page is
   * closed and the capture rejects with the same error. readyTimeout doesn't limit it. Without it, the snapshot is
   * captured once.
   */
  captureAgainIf?: (snapshot: Uint8Array) => Promise<boolean>
}

/**
 * Remote content a snapshot shows: one box per element and host, in pixels of the snapshot's image.
 *
 * @public
 */
export interface RemoteContentBox {
  /**
   * The host it comes from, such as `images.example.com`, with its port when the URL has one.
   */
  host: string
  /**
   * The distance from the image's left edge to the box's, in whole pixels. It can be below 0, or past the image, for
   * content outside the capture area.
   */
  x: number
  /**
   * The distance from the image's top edge to the box's, in whole pixels. It can be below 0, or past the image, for
   * content outside the capture area.
   */
  y: number
  /**
   * The box's width, in whole pixels.
   */
  width: number
  /**
   * The box's height, in whole pixels.
   */
  height: number
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
 * - `too-tall`: the capture, or a grid on the story's page, is over 32,767 device pixels on a side.
 * - `element-missing`: the story's `element` selector matched nothing, or an element whose box is of zero size.
 * - `grid-too-wide`: a grid on the story's page is wider than the viewport.
 * - `overflows`: the story's capture would cut content its page shows: wider than the viewport for the full page,
 *   spilling past the `element` box, or the element past the page's top or left edge.
 * - `browser-exited`: the browser exited while the story was in flight. The run's browser gives it; a capture session
 *   rejects with a `BrowserExitedError` instead.
 * - `changed-after-capture`: the story's page, captured again a second after its first capture on one load, had
 *   changed beyond its tolerance, so `update` wrote no baseline. `update` gives it; a capture session never does.
 * - `unstable`: no two of the 3 loads `update` made of the story agreed within its tolerance, so it wrote no baseline.
 *   `update` gives it; a capture session never does.
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
  | 'grid-too-wide'
  | 'overflows'
  | 'browser-exited'
  | 'changed-after-capture'
  | 'unstable'

/**
 * A story that can't be captured: why, and a one-line message for people saying so. A capture session gives one for a
 * story it can't capture, and the run gives one for a story in flight when its browser exits and for each story of a
 * stories file that didn't load. `update` gives one for a story that doesn't render the same way twice. Some reasons
 * keep details besides: the stories file's load error or the time it had, `play`'s stack, the readyTimeout that ran
 * out, the font faces still loading, where a story that navigated away went, the size of a capture too tall to take,
 * the width of a grid wider than the viewport, and how far content the capture would cut reaches past each side. A
 * broken story whose page couldn't load some of Storybook's own files keeps those too.
 *
 * @public
 */
export type BrokenStory = (
  | {
      /**
       * Why the story can't be captured.
       */
      reason: Exclude<
        BrokenReason,
        | 'load-failed'
        | 'play-threw'
        | 'timeout'
        | 'fonts-not-loaded'
        | 'navigated-away'
        | 'too-tall'
        | 'grid-too-wide'
        | 'overflows'
      >
      /**
       * One line for people saying why.
       */
      message: string
    }
  | {
      /**
       * Why the story can't be captured: its stories file failed to load, or didn't load within readyTimeout.
       */
      reason: 'load-failed'
      /**
       * One line for people saying why.
       */
      message: string
      /**
       * The error the stories file failed to load with, as Storybook gave it. `undefined` when it didn't load in time,
       * or failed with no message.
       */
      loadError: string | undefined
      /**
       * The config's readyTimeout, in ms, when the stories file didn't load within it. `undefined` when it failed.
       */
      readyTimeoutMs: number | undefined
    }
  | {
      /**
       * Why the story can't be captured: its `play` function threw or left unhandled errors.
       */
      reason: 'play-threw'
      /**
       * One line for people saying why, with the error's message.
       */
      message: string
      /**
       * The error as Storybook described it, such as `Error: boom`, or the unhandled errors, `; ` apart. Empty when it
       * described none, unless the story's page had failed loads: then it's the message without their sentence, which
       * the report shows in its place.
       */
      errorText: string
      /**
       * Up to the first 5 frames of the error's stack, the lines that start with `at `, each trimmed, without its
       * message. None when the error had no stack.
       */
      stack: string[]
    }
  | {
      /**
       * Why the story can't be captured: it wasn't ready within readyTimeout.
       */
      reason: 'timeout'
      /**
       * One line for people saying why, and what the story was doing.
       */
      message: string
      /**
       * The config's readyTimeout, in ms, that ran out.
       */
      readyTimeoutMs: number
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
      /**
       * The config's readyTimeout, in ms, that ran out.
       */
      readyTimeoutMs: number
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
  | {
      /**
       * Why the story can't be captured: the capture, or a grid on the story's page, is over 32,767 device pixels on a
       * side.
       */
      reason: 'too-tall'
      /**
       * One line for people saying why, with the capture's size or the grid's.
       */
      message: string
      /**
       * The capture's size, or the grid's, in device pixels.
       */
      size: {
        /**
         * The capture's width, or the grid's, in device pixels.
         */
        width: number
        /**
         * The capture's height, or the grid's, in device pixels.
         */
        height: number
      }
    }
  | {
      /**
       * Why the story can't be captured: a grid on the story's page is wider than the viewport.
       */
      reason: 'grid-too-wide'
      /**
       * One line for people saying why, with the grid's width and the viewport's.
       */
      message: string
      /**
       * The widest grid's width and the viewport's, in CSS pixels.
       */
      grid: {
        /**
         * The widest grid's width, in CSS pixels, rounded up.
         */
        width: number
        /**
         * The viewport's width, in CSS pixels.
         */
        viewportWidth: number
      }
    }
  | {
      /**
       * Why the story can't be captured: its capture would cut content its page shows.
       */
      reason: 'overflows'
      /**
       * One line for people saying why, with how far the content reaches past each side that counts.
       */
      message: string
      /**
       * What the capture would cut: its area, how far content reaches past each side, and the viewport's width, in CSS
       * pixels.
       */
      overflow: {
        /**
         * What the capture takes: the full page, or the `element` box.
         */
        area: 'full-page' | 'element'
        /**
         * How far the element reaches past the page's top edge, in CSS pixels, rounded up. 0 for the full page.
         */
        top: number
        /**
         * How far content reaches past the capture's right edge, in CSS pixels, rounded up: the full page's past the
         * viewport's right edge, or the element's past its border box's.
         */
        right: number
        /**
         * How far the element's content reaches past its border box's bottom edge, in CSS pixels, rounded up. 0 for
         * the full page.
         */
        bottom: number
        /**
         * How far the element reaches past the page's left edge, in CSS pixels, rounded up. 0 for the full page.
         */
        left: number
        /**
         * The snapshot's viewport width, in CSS pixels: its mode's when it has one.
         */
        viewportWidth: number
      }
    }
) & {
  /**
   * The loads of Storybook's own files that failed at the network level on the story's page, when any did.
   */
  failedLoads?: FailedLoad[]
}

/**
 * The hosts a story reaches, as a capture lists them.
 *
 * @public
 */
export interface StoryHosts {
  /**
   * The hosts the story's page sent real network requests to, as the page reports them, each once.
   */
  requests: string[]
  /**
   * The hosts of the remote content the story shows, each once, in the order found, without the hosts one of the
   * story's host masks covers. None when the remote content search didn't answer in time.
   */
  remoteContent: string[]
}

/**
 * What capturing a story gave: its snapshot, with how long Storybook's `completing` render step took, the console
 * messages and errors its page sent, the remote content it shows when the story asked for it, the hosts it reaches
 * when the session lists them and the same page captured again when the story's `captureAgainIf` asked for it, or, for
 * a broken story, why it can't be captured and, when it had a page, what its page sent. Either way it comes with the
 * page errors of every attempt.
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
      /**
       * The last 50 console messages and errors the story's page sent from the load of the story in the attempt that
       * captured it, as the page gives them right after the first capture, before the story's `captureAgainIf` is
       * called.
       */
      console: ConsoleMessage[]
      /**
       * The page errors the story's pages raised in every attempt of the capture, the hidden ones on fresh pages of a
       * story that navigated away included, each once, in the order first seen: read once each attempt is done, after
       * the story's `captureAgainIf` too.
       */
      pageErrors: PageError[]
      /**
       * The remote content the snapshot shows, when the story asked for it with `findRemoteContent` and the search
       * answered in time. Without it, the remote content is unknown.
       */
      remoteContent?: RemoteContentBox[]
      /**
       * The hosts the story reaches. Present exactly when the session's settings ask to list hosts. They're read right
       * after the first capture, before the story's `captureAgainIf` is called.
       */
      hosts?: StoryHosts
      /**
       * The same area of the page captured a second time, at once after the story's `captureAgainIf` resolved true for
       * the snapshot, as PNG bytes exactly as the browser made them. Present exactly when it resolved true.
       */
      capturedAgain?: Uint8Array
    }
  | {
      /**
       * Why the story can't be captured.
       */
      broken: BrokenStory
      /**
       * The last 50 console messages and errors the story's page sent from the start of the attempt that broke, read
       * before the page is closed, from the document the story went to too when it navigated away. Left out when the
       * story had no page: a page that couldn't be opened, or a browser that exited.
       */
      console?: ConsoleMessage[]
      /**
       * The page errors the story's pages raised in every attempt of the capture, the hidden ones on fresh pages of a
       * story that navigated away included, each once, in the order first seen: read before each page is closed. None
       * from an attempt that had no page: a page that couldn't be opened, or a browser that exited.
       */
      pageErrors: PageError[]
      /**
       * The full page as it was when the story broke, as PNG bytes exactly as the browser made them. Present only when
       * the story asked for it with `imageWhenBroken`, broke for a reason whose page still shows something, and the
       * page was captured within the settings' `brokenImageTimeLimitMs`.
       */
      image?: Uint8Array
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
   * back as a broken story straight away, and the page is replaced by a fresh one for the next. A broken story whose
   * page couldn't load some of Storybook's own files at the network level keeps them, and its message names the first.
   * When the story's `captureAgainIf` resolves true for the snapshot, the same page is captured again at once. Rejects
   * with a `BrowserExitedError` when the browser exits, and, after closing the page, with whatever the story's
   * `captureAgainIf` rejects with. Call it once the previous capture has settled.
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
  | 'grow-viewport'
  | 'frames-after-grow'
  | 'assets-after-grow'
  | 'wait'
  | 'assets-after-wait'
  | 'regrow-viewport'
  | 'frames-after-regrow'
  | 'assets-after-regrow'
  | 'end-state'
  | 'assets-after-end-state'
  | 'masks'
  | 'capture'
  | 'capture-again'

/**
 * A check of the story's images and fonts: the one once the story finished, the one once the viewport grew, the one
 * after its wait hook ran, the one once the viewport was set again after its wait hook, or the one after its end state
 * changed the page.
 */
type AssetsStep = Extract<
  Step,
  'assets' | 'assets-after-grow' | 'assets-after-wait' | 'assets-after-regrow' | 'assets-after-end-state'
>

/**
 * A wait for frames to pass so the page reacts to its viewport: once it grew, or once it was set again after the wait
 * hook.
 */
type FramesStep = Extract<Step, 'frames-after-grow' | 'frames-after-regrow'>

/**
 * What the page reacts to in each wait for frames, as the messages name it.
 */
const framesTargets: Record<FramesStep, string> = {
  'frames-after-grow': 'the grown viewport',
  'frames-after-regrow': 'the viewport set again after its wait hook',
}

/**
 * What each step does, as a phrase that follows "while".
 */
const stepNames: Record<Step, string> = {
  viewport: 'setting the viewport',
  load: 'loading the story',
  story: 'waiting for the story to finish',
  assets: 'waiting for images and fonts',
  'grow-viewport': 'growing the viewport to the page',
  'frames-after-grow': 'letting the page react to the grown viewport',
  'assets-after-grow': 'waiting for images and fonts after growing the viewport',
  wait: "running the story's wait hook",
  'assets-after-wait': 'waiting for images and fonts after its wait hook',
  'regrow-viewport': 'growing the viewport to the page again after its wait hook',
  'frames-after-regrow': 'letting the page react to the viewport set again after its wait hook',
  'assets-after-regrow': 'waiting for images and fonts once the viewport was set again after its wait hook',
  'end-state': 'bringing the story to its end state',
  'assets-after-end-state': 'waiting for images and fonts after its end state',
  masks: 'painting its masks and hiding the caret',
  capture: 'capturing the snapshot',
  'capture-again': 'capturing the snapshot again',
}

/**
 * What the steps that readyTimeout limits were doing when it ran out.
 */
const stepTimeouts: Partial<Record<Step, string>> = {
  load: 'its page was still loading',
  story: 'its page stopped answering while visual-check waited for the story to finish',
  assets: 'its page stopped answering while visual-check waited for its images and fonts',
  'frames-after-grow': 'its page stopped answering while visual-check let it react to the grown viewport',
  'assets-after-grow':
    'its page stopped answering while visual-check waited for its images and fonts after growing the viewport',
  wait: 'its page stopped answering while its wait hook ran',
  'assets-after-wait':
    'its page stopped answering while visual-check waited for its images and fonts after its wait hook',
  'frames-after-regrow':
    'its page stopped answering while visual-check let it react to the viewport set again after its wait hook',
  'assets-after-regrow':
    'its page stopped answering while visual-check waited for its images and fonts once the viewport was set again after its wait hook',
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
  'assets-after-grow': ' after growing the viewport',
  'assets-after-wait': ' after its wait hook',
  'assets-after-regrow': ' once the viewport was set again after its wait hook',
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
 * Gives the broken story with the loads of Storybook's own files that failed at the network level on its page, and a
 * sentence at the end of its message naming the first, its path shown against the story's URL, and how many there were
 * when more than one. A `play-threw` story whose error Storybook described as nothing keeps the message without that
 * sentence as its error text, for the report's play details. Gives it as it is when none failed.
 */
function withFailedLoads(broken: BrokenStory, failedLoads: FailedLoad[], storyUrl: string): BrokenStory {
  const [first] = failedLoads

  if (first === undefined) {
    return broken
  }

  const path = displayUrlOf(first.url, storyUrl)
  const files =
    failedLoads.length === 1
      ? `${path} from Storybook`
      : `${failedLoads.length} files from Storybook, the first ${path}`

  return {
    ...broken,
    ...(broken.reason === 'play-threw' && broken.errorText === '' ? { errorText: broken.message } : {}),
    message: `${broken.message} Its page couldn't load ${files}: ${first.error}.`,
    failedLoads,
  }
}

/**
 * Gives a story that wasn't ready within readyTimeout, saying what it was doing.
 */
function notReady(readyTimeoutMs: number, doing: string): BrokenStory {
  return {
    reason: 'timeout',
    message: `The story wasn't ready within readyTimeout (${readyTimeoutMs} ms): ${doing}.`,
    readyTimeoutMs,
  }
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
      return { reason: 'play-threw', message: wait.message, errorText: wait.errorText, stack: wait.stack }
    case 'errored':
      return { reason: 'error', message: wait.message }
    case 'timed-out':
      return notReady(readyTimeoutMs, stillWaitingFor(wait))
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
    return notReady(readyTimeoutMs, `${imagesStillLoading(assets.pending)}${suffix}`)
  }

  const faces = assets.pendingFaces

  if (faces.length === 0) {
    return notReady(readyTimeoutMs, `document.fonts.ready hadn't resolved${suffix}`)
  }

  return {
    reason: 'fonts-not-loaded',
    message: `The story's fonts hadn't loaded within readyTimeout (${readyTimeoutMs} ms)${suffix}. Still loading: ${faces.join(', ')}.`,
    faces,
    readyTimeoutMs,
  }
}

/**
 * Says why a story isn't ready to capture, from what letting frames pass found in the wait `framesStep` names: once the
 * viewport grew, or once it was set again after the wait hook.
 */
function describeFrames(
  frames: Exclude<FramesPassed, { outcome: 'passed' }>,
  readyTimeoutMs: number,
  framesStep: FramesStep,
): BrokenStory {
  if (frames.outcome === 'script-missing') {
    return {
      reason: 'error',
      message: `visual-check's page script didn't run in the story's page, so it couldn't let the page react to ${framesTargets[framesStep]}.`,
    }
  }

  return notReady(readyTimeoutMs, `visual-check was still letting the page react to ${framesTargets[framesStep]}`)
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

  return notReady(readyTimeoutMs, endStateTimeouts[endState.step])
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
      return notReady(readyTimeoutMs, 'visual-check was still looking for remote content to mask')
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
      return notReady(readyTimeoutMs, "its wait hook hadn't finished")
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
      size: { width: error.deviceWidth, height: error.deviceHeight },
    }
  }

  const doing = stepTimeouts[step]

  if (error instanceof PageTimeoutError && doing !== undefined) {
    return notReady(readyTimeoutMs, doing)
  }

  const name = stepNames[step]

  return {
    reason: 'error',
    message: `${name.charAt(0).toUpperCase()}${name.slice(1)} failed: ${failureReasonOf(error)}`,
  }
}

/**
 * Converts the page's remote content boxes, in CSS pixels of the top document, to pixels of the snapshot's image:
 * measured from the capture area's origin, the element's box or the document's for the full page, times
 * `deviceScaleFactor`, and out to whole pixels, the left and top edges rounded down and the right and bottom edges up.
 */
export function remoteContentBoxesOf(
  remote: readonly PageRemoteContent[],
  area: CaptureArea,
  deviceScaleFactor: number,
): RemoteContentBox[] {
  const origin = area === 'full-page' ? { x: 0, y: 0 } : area

  return remote.map((item) => {
    const left = Math.floor((item.x - origin.x) * deviceScaleFactor)
    const top = Math.floor((item.y - origin.y) * deviceScaleFactor)
    const right = Math.ceil((item.x + item.width - origin.x) * deviceScaleFactor)
    const bottom = Math.ceil((item.y + item.height - origin.y) * deviceScaleFactor)

    return { host: item.host, x: left, y: top, width: right - left, height: bottom - top }
  })
}

/**
 * The host a page's remote content item comes from without its port: `cdn.example.com:8443` gives `cdn.example.com`.
 * A host without a port, such as `images.example.com` or `[::1]`, stays as it is.
 */
function hostnameOf(host: string): string {
  return host.replace(/:\d+$/, '')
}

/**
 * Lists the hosts of the remote content a story shows, from what the capture preparation found: each item's host,
 * once, in the order found. It leaves out a host one of the story's host masks covers, as the page matches them: the
 * mask's host, in lowercase, is the item's host or its hostname. Without `remote`, when the search didn't answer in
 * time, it lists none.
 */
export function remoteHostsOf(remote: readonly PageRemoteContent[] | undefined, masks: readonly StoryMask[]): string[] {
  if (remote === undefined) {
    return []
  }

  const maskedHosts = masks.flatMap((mask) => ('host' in mask ? [mask.host.toLowerCase()] : []))
  const hosts: string[] = []

  for (const item of remote) {
    const masked = maskedHosts.includes(item.host) || maskedHosts.includes(hostnameOf(item.host))

    if (!masked && !hosts.includes(item.host)) {
      hosts.push(item.host)
    }
  }

  return hosts
}

/**
 * Says why a story whose page shows a grid can't be captured, or gives nothing when the grid fits. A grid wider than the
 * viewport, rounded up, is too wide, whatever the capture area: a cell past the viewport's edge would be cut or wrap. A
 * grid whose own box, at the viewport's scale and rounded up, is over 32,767 device pixels on a side is too tall. Too
 * wide wins over too tall. `viewport` is the snapshot's: its mode's when it has one.
 */
export function gridProblemOf(grid: PageGrid | undefined, viewport: PageViewport): BrokenStory | undefined {
  if (grid === undefined) {
    return undefined
  }

  const width = Math.ceil(grid.width)

  if (width > viewport.width) {
    return {
      reason: 'grid-too-wide',
      message: `The grid is ${width} px wide, wider than the ${viewport.width} px viewport. Give the story its own viewport width, list modes without the narrow ones, or set a smaller cellWidth.`,
      grid: { width, viewportWidth: viewport.width },
    }
  }

  const deviceWidth = Math.ceil(grid.width * viewport.deviceScaleFactor)
  const deviceHeight = Math.ceil(grid.height * viewport.deviceScaleFactor)

  if (deviceWidth <= maxCaptureSide && deviceHeight <= maxCaptureSide) {
    return undefined
  }

  return {
    reason: 'too-tall',
    message: `The grid is ${deviceWidth} × ${deviceHeight} device pixels, over ${maxCaptureSide.toLocaleString('en-US')} on a side. Split the grid into several stories.`,
    size: { width: deviceWidth, height: deviceHeight },
  }
}

/**
 * Says how far content reaches past each edge that counts, such as `12 px past the page's top edge`, from pairs of a
 * distance in CSS pixels and an edge. An edge whose distance is 0 doesn't count.
 */
function edgePhrasesOf(edges: readonly [distance: number, edge: string][]): string[] {
  return edges.filter(([distance]) => distance > 0).map(([distance, edge]) => `${distance} px past ${edge}`)
}

/**
 * Says how far an element's capture would cut content, as a sentence of at most two clauses: first the element past
 * the page's top and left edges, then its content past its right and bottom edges, each clause naming only the sides
 * that count. The content's clause names the element when it comes first. Two clauses are joined with `, and` when
 * either names two sides, and with `and` otherwise.
 */
function elementOverflowSentenceOf({ top, right, bottom, left }: PageOverflow): string {
  const pageEdges = edgePhrasesOf([
    [top, "the page's top edge"],
    [left, top > 0 ? 'its left edge' : "the page's left edge"],
  ])
  const contentEdges = edgePhrasesOf([
    [right, 'its right edge'],
    [bottom, 'its bottom edge'],
  ])
  const contentSubject = pageEdges.length > 0 ? 'its content' : "the element's content"
  const clauses = [
    { subject: 'the element', edges: pageEdges },
    { subject: contentSubject, edges: contentEdges },
  ]
    .filter(({ edges }) => edges.length > 0)
    .map(({ subject, edges }) => `${subject} reaches ${edges.join(' and ')}`)
  const sentence = clauses.join(pageEdges.length > 1 || contentEdges.length > 1 ? ', and ' : ' and ')

  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`
}

/**
 * Says why a story whose capture would cut content its page shows can't be captured, or gives nothing when it would cut
 * nothing or the story sets `allowOverflow: true`. For the full page, it names how far content reaches past the
 * viewport's right edge; for an element's box, each side that counts. `area` is what the capture takes, and the
 * story's viewport is the snapshot's: its mode's when it has one.
 */
export function overflowProblemOf(
  overflow: PageOverflow | undefined,
  area: CaptureArea,
  story: StoryToCapture,
): BrokenStory | undefined {
  if (overflow === undefined || story.allowOverflow === true) {
    return undefined
  }

  const viewportWidth = story.viewport.width
  const { top, right, bottom, left } = overflow

  if (area === 'full-page') {
    return {
      reason: 'overflows',
      message: `Content reaches ${right} px past the right edge of the ${viewportWidth} px viewport, so the capture would cut it. Fix the layout, give the story a wider viewport or list modes without the narrow ones, or set allowOverflow when the cut is intended.`,
      overflow: { area: 'full-page', top, right, bottom, left, viewportWidth },
    }
  }

  return {
    reason: 'overflows',
    message: `${elementOverflowSentenceOf(overflow)}, so the capture would cut it. Fix the layout, capture an element that holds the content, or set allowOverflow when the cut is intended.`,
    overflow: { area: 'element', top, right, bottom, left, viewportWidth },
  }
}

/**
 * What the page prepared a capture with.
 */
interface PreparedCapture {
  /**
   * What to capture: the element's box, or the full page.
   */
  area: CaptureArea
  /**
   * The remote content the page gives, when the capture asked for it and the search answered in time. Without it, the
   * remote content is unknown.
   */
  remote: PageRemoteContent[] | undefined
  /**
   * The grids the page shows: the widest grid's width and the tallest grid's height. Without it, the page shows none.
   */
  grid: PageGrid | undefined
  /**
   * How far content the capture would cut reaches past each side of the capture. Without it, the capture would cut
   * nothing.
   */
  overflow: PageOverflow | undefined
}

/**
 * What a snapshot comes with besides its bytes, read right after the capture: the remote content it shows, in pixels
 * of its image, when the story asked for it with `findRemoteContent` and the page gave it, and the hosts the story
 * reaches when the settings ask to list hosts.
 */
function capturedExtrasOf(
  page: Page,
  story: StoryToCapture,
  settings: CaptureSettings,
  prepared: PreparedCapture,
): { remoteContent?: RemoteContentBox[]; hosts?: StoryHosts } {
  const hosts = settings.listHosts
    ? { requests: page.requestHosts(), remoteContent: remoteHostsOf(prepared.remote, story.masks ?? []) }
    : undefined
  const remoteContent =
    story.findRemoteContent === true && prepared.remote !== undefined
      ? remoteContentBoxesOf(prepared.remote, prepared.area, story.viewport.deviceScaleFactor)
      : undefined

  return {
    ...(remoteContent === undefined ? {} : { remoteContent }),
    ...(hosts === undefined ? {} : { hosts }),
  }
}

/**
 * A snapshot captured on a page: what capturing the story gave, and the area it was captured from, so the same area
 * can be captured again.
 */
interface CapturedSnapshot {
  /**
   * What capturing the story gave: its snapshot and what it comes with, without a second capture and without its page
   * errors, which are read once the story's `captureAgainIf` ran.
   */
  result: Omit<Extract<StoryCapture, { snapshot: Uint8Array }>, 'capturedAgain' | 'pageErrors'>
  /**
   * What the snapshot was captured from: the element's box, or the full page.
   */
  area: CaptureArea
}

/**
 * Captures a story on an open page: sets the story's viewport, loads the story, waits until Storybook reports it
 * finished with nothing gone wrong, waits for its images and fonts, grows the viewport to the page for a full-page
 * capture, runs its wait hook, measures the page again for a full-page capture once its wait hook ran, brings it to its
 * end state, measures its element, paints its masks, hides the caret and captures the element's box, or the full page
 * when the story has no element. When the viewport grew, two frames pass so the page reacts to the new size, then its
 * images and fonts are checked again. When the story's wait hook ran, they're checked again after it, then, for a
 * full-page capture, the story's viewport is set again and grows to the page, two frames pass whether it grew or not,
 * and they're checked again. When the end state changed anything, they're checked again before the masks.
 * Loading, the waits, the frames, the hook, the end state, those checks and the masks share readyTimeout, each getting
 * only what's left of it. When the story asks for it with `findRemoteContent`, the snapshot comes with the remote content it shows, unless the search didn't answer in time.
 * When the settings ask to list hosts, it also gives the hosts the page sent requests to, read once the capture is
 * done, and the hosts of the remote content the story shows, from the same search as the host masks. A story whose page
 * shows a grid wider than the viewport, or too tall to capture, is broken before anything is captured, as
 * `gridProblemOf` says. Then one whose capture would cut content its page shows is broken, as `overflowProblemOf` says,
 * unless it sets `allowOverflow: true`; a capture too tall is only found as it's taken, after that. Gives the area the
 * snapshot was captured from beside it, and leaves the story's `captureAgainIf` to the caller. A story that can't be captured comes back as a broken story. Either way it comes with
 * the console messages and errors the page sent, read once the capture is done or the story broke, while the page is
 * still open, and a broken story with the loads of Storybook's files that failed on the page and its page errors. A
 * snapshot's page errors are left to the caller, read once `captureAgainIf` ran. Rejects only with a
 * `BrowserExitedError`.
 */
async function captureOnPage(
  page: Page,
  story: StoryToCapture,
  settings: CaptureSettings,
): Promise<CapturedSnapshot | Extract<StoryCapture, { broken: BrokenStory }>> {
  const deadline = performance.now() + settings.readyTimeoutMs
  const timeLeft = (): number => Math.max(0, Math.ceil(deadline - performance.now()))
  let step: Step = 'viewport'

  /**
   * Gives the broken story with the messages the page sent and the loads of Storybook's files that failed on it.
   */
  const brokenBy = (broken: BrokenStory): Extract<StoryCapture, { broken: BrokenStory }> => ({
    broken: withFailedLoads(broken, page.failedLoads(), story.url),
    console: page.consoleMessages(),
    pageErrors: page.pageErrors(),
  })

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
   * Whether the capture is of the full page with the viewport's growth on: the viewport grows to the page before the
   * wait hook and is measured again after a hook that ran.
   */
  const growsViewport = story.element === undefined && story.growViewport !== false

  /**
   * Lets two frames pass once the viewport grew or was set again, as `framesStep` names, so the page reacts to its
   * size: its observers and `resize` listeners call back and the render they cause is done. Gives why the story isn't
   * ready, or nothing when it is.
   */
  const letPageReact = async (framesStep: FramesStep): Promise<BrokenStory | undefined> => {
    step = framesStep

    const frames = readFramesPassed(await waitInPage(framesAfterGrowthExpression))

    return frames.outcome === 'passed' ? undefined : describeFrames(frames, settings.readyTimeoutMs, framesStep)
  }

  /**
   * Grows the viewport's height to the page's for a full-page capture, unless the story turns that off. When it grew,
   * lets the page react to the new size, then checks its images and fonts again. Gives why the story isn't ready, or
   * nothing when it is.
   */
  const growViewport = async (): Promise<BrokenStory | undefined> => {
    if (!growsViewport) {
      return undefined
    }

    step = 'grow-viewport'

    if (!(await page.growViewportToContent())) {
      return undefined
    }

    return (await letPageReact('frames-after-grow')) ?? (await checkAssets('assets-after-grow'))
  }

  /**
   * Measures the page again once the story's wait hook ran, for a full-page capture with the growth on: sets the
   * story's own viewport again, so a `min-height: 100vh` page doesn't keep its last growth, and grows it to the
   * page's height when the page is taller. A page the hook made shorter shrinks back, and one too tall to capture
   * stays at the story's viewport. Then lets two frames pass, whether it grew or not, since setting the viewport
   * fires `resize` too, and checks the images and fonts again. Gives why the story isn't ready, or nothing when it
   * is.
   */
  const regrowViewport = async (): Promise<BrokenStory | undefined> => {
    if (!growsViewport) {
      return undefined
    }

    step = 'regrow-viewport'
    await page.setViewport(story.viewport)
    await page.growViewportToContent()

    return (await letPageReact('frames-after-regrow')) ?? (await checkAssets('assets-after-regrow'))
  }

  /**
   * Runs the story's wait hook, if it has one. Once it ran, checks its images and fonts again, then measures the page
   * again for a full-page capture. Gives why the story isn't ready, or nothing when it is.
   */
  const runWaitHook = async (): Promise<BrokenStory | undefined> => {
    step = 'wait'

    const run = readWaitHookRun(await waitInPage((limit) => waitHookExpression(story.id, limit)))

    if (run.outcome === 'none') {
      return undefined
    }

    if (run.outcome !== 'done') {
      return describeWaitHookRun(run, settings.readyTimeoutMs)
    }

    return (await checkAssets('assets-after-wait')) ?? (await regrowViewport())
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
   * Gets the finished story ready to capture: waits for its images and fonts, grows the viewport, runs its wait hook
   * and measures the page again after it, and brings it to its end state, stopping at the first that leaves it not
   * ready. Gives why the story isn't ready, or nothing when it is.
   */
  const getReady = async (): Promise<BrokenStory | undefined> =>
    (await checkAssets('assets')) ?? (await growViewport()) ?? (await runWaitHook()) ?? (await bringToEndState())

  /**
   * Measures the story's element, paints its masks and hides the caret. Gives what to capture: the element's box, or
   * the full page when the story has no element, with the remote content the page gives when the story asked for it
   * or the settings ask to list hosts. Gives why the story can't be captured instead when that failed.
   */
  const prepareCapture = async (): Promise<PreparedCapture | { broken: BrokenStory }> => {
    step = 'masks'

    const element = story.element ?? null
    const request = {
      element,
      masks: story.masks ?? [],
      maskColor: settings.maskColor,
      findRemote: story.findRemoteContent === true || settings.listHosts,
    }
    const prep = readCapturePrep(await waitInPage((limit) => prepareCaptureExpression(request, limit)))

    if (prep.outcome !== 'ready') {
      return { broken: describeCapturePrep(prep, element, settings.readyTimeoutMs) }
    }

    return {
      area: prep.box ?? 'full-page',
      remote: request.findRemote ? prep.remote : undefined,
      grid: prep.grid,
      overflow: prep.overflow,
    }
  }

  try {
    await page.setViewport(story.viewport)
    step = 'load'
    await page.goto(story.url, timeLeft())
    step = 'story'

    const wait = readStoryWait(await waitInPage((limit) => storyWaitExpression(story.id, limit)))

    if (wait.outcome !== 'finished') {
      return brokenBy(describeStoryWait(wait, settings.readyTimeoutMs))
    }

    const broken = await getReady()

    if (broken !== undefined) {
      return brokenBy(broken)
    }

    const prepared = await prepareCapture()

    if ('broken' in prepared) {
      return brokenBy(prepared.broken)
    }

    const gridBroken = gridProblemOf(prepared.grid, story.viewport)

    if (gridBroken !== undefined) {
      return brokenBy(gridBroken)
    }

    const overflowBroken = overflowProblemOf(prepared.overflow, prepared.area, story)

    if (overflowBroken !== undefined) {
      return brokenBy(overflowBroken)
    }

    step = 'capture'

    const snapshot = await page.capture(prepared.area)

    return {
      result: {
        snapshot,
        completingMs: wait.completingMs,
        console: page.consoleMessages(),
        ...capturedExtrasOf(page, story, settings, prepared),
      },
      area: prepared.area,
    }
  } catch (error) {
    if (error instanceof BrowserExitedError) {
      throw error
    }

    return brokenBy(describeFailure(error, step, story, settings.readyTimeoutMs))
  }
}

/**
 * Why a story can be broken while its page still shows something, so an image of the page says what went wrong. A
 * crash, a capture or a grid too tall, a page that went to another document and a story that had no page leave
 * nothing to capture.
 */
const imagedReasons: readonly BrokenReason[] = [
  'error',
  'play-threw',
  'timeout',
  'fonts-not-loaded',
  'wait-threw',
  'element-missing',
  'grid-too-wide',
  'overflows',
]

/**
 * Captures the full page of a story that just broke, as it is. Gives nothing when the capture fails or doesn't finish
 * within `limitMs`. Rejects with a `BrowserExitedError` when the browser exits during the capture.
 */
async function brokenImageOf(page: Page, limitMs: number): Promise<Uint8Array | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeUp = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, limitMs, undefined)
  })

  try {
    return await Promise.race([page.capture('full-page'), timeUp])
  } catch (error) {
    if (error instanceof BrowserExitedError) {
      throw error
    }

    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Adds an image of the page to a broken story when the story asked for one with `imageWhenBroken` and broke for a
 * reason whose page still shows something. Gives the broken story as it is otherwise, or when no image came.
 */
async function withBrokenImage(
  page: Page,
  story: StoryToCapture,
  settings: CaptureSettings,
  capture: Extract<StoryCapture, { broken: BrokenStory }>,
): Promise<Extract<StoryCapture, { broken: BrokenStory }>> {
  if (story.imageWhenBroken !== true || !imagedReasons.includes(capture.broken.reason)) {
    return capture
  }

  const image = await brokenImageOf(page, settings.brokenImageTimeLimitMs)

  return image === undefined ? capture : { ...capture, image }
}

/**
 * Calls the story's `captureAgainIf` with a snapshot just captured on the page, leaving the page as it is. When it
 * resolves true, captures the area the snapshot was captured from again at once, doing nothing to the page in between,
 * bound by the driver's own capture limit, and gives the snapshot with the second capture as `capturedAgain`. Gives the
 * snapshot as it is when the story has no `captureAgainIf` or it resolves false. Either way the page errors are read
 * again, so one the page raised during `captureAgainIf` counts. A second capture that fails comes back as a broken
 * story, with the messages and page errors the page sent, read again, and the loads that failed on it. Rejects with a
 * `BrowserExitedError` when the browser exits during the second capture, and with whatever `captureAgainIf` rejects
 * with: it runs outside the handling that turns the page's failures into a broken story.
 */
async function captureAgainIfAsked(
  page: Page,
  story: StoryToCapture,
  settings: CaptureSettings,
  captured: CapturedSnapshot,
): Promise<StoryCapture> {
  const again = await story.captureAgainIf?.(captured.result.snapshot)

  if (again !== true) {
    return { ...captured.result, pageErrors: page.pageErrors() }
  }

  try {
    const capturedAgain = await page.capture(captured.area)

    return { ...captured.result, pageErrors: page.pageErrors(), capturedAgain }
  } catch (error) {
    if (error instanceof BrowserExitedError) {
      throw error
    }

    return {
      broken: withFailedLoads(
        describeFailure(error, 'capture-again', story, settings.readyTimeoutMs),
        page.failedLoads(),
        story.url,
      ),
      console: page.consoleMessages(),
      pageErrors: page.pageErrors(),
    }
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
 * locale and colour scheme, the page script, and the watching of its real network requests when the settings list
 * hosts. A capture page is set up this way.
 */
export function pageSetupOf(settings: CaptureSettings): PageSetup {
  return {
    userAgentSuffix: testPathUserAgentSuffix,
    timezone: settings.timezone,
    locale: settings.locale,
    colorScheme: settings.colorScheme,
    initScript: pageInitScript,
    watchRequests: settings.listHosts,
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
 * retried. The capture keeps the page errors of every attempt, each once, in the order first seen, though only the
 * last attempt's outcome counts.
 *
 * A story whose page shows a grid wider than the viewport, or too tall to capture, is broken with `grid-too-wide` or
 * `too-tall` before anything is captured. Then a story whose capture would cut content its page shows is broken with
 * `overflows`, unless it sets `allowOverflow: true`.
 *
 * A broken story whose page couldn't load some of Storybook's own files at the network level, such as a connection the
 * server dropped, keeps them as `failedLoads`, and its message gains a sentence naming the first and the browser's
 * error, with how many there were when more than one. Its reason stays as it was, and nothing more is retried.
 *
 * A story that asks for it with `imageWhenBroken` and breaks while its page still shows something, for the reasons
 * `error`, `play-threw`, `timeout`, `fonts-not-loaded`, `wait-threw`, `element-missing`, `grid-too-wide` and
 * `overflows`, comes with an image of the full page, captured before the page is closed, unless that capture fails or
 * takes longer than the settings' `brokenImageTimeLimitMs`. A browser exit during it rejects the capture with a `BrowserExitedError`.
 *
 * When a story has `captureAgainIf`, each attempt that captured a snapshot calls it with the snapshot, the page left as
 * it is, and captures the same area again at once when it resolves true. A second capture that fails makes the story
 * broken, and its page is closed; one that navigates away is retried like any attempt that does. When
 * `captureAgainIf` rejects, the session closes the page and the capture rejects with the same error.
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
   * Captures the story on the open page, opening one first when none is, and captures it again there when the story's
   * `captureAgainIf` asks for it. A story that can't be captured, or whose page can't be opened, comes back as a broken
   * story, with an image of its page when it asked for one and its page still shows something, and a broken story's
   * page is closed. Rejects with a `BrowserExitedError`, and then drops the page without
   * closing it. When the story's `captureAgainIf` rejects, closes the page and rejects with the same error.
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
        pageErrors: [],
      }
    }

    try {
      const captured = await captureOnPage(page, story, settings)
      const capture =
        'broken' in captured
          ? await withBrokenImage(page, story, settings, captured)
          : await captureAgainIfAsked(page, story, settings, captured)

      if ('broken' in capture) {
        await closePage()
      }

      return capture
    } catch (error) {
      if (error instanceof BrowserExitedError) {
        page = undefined
      } else {
        await closePage()
      }

      throw error
    }
  }

  return {
    capture: async (story) => {
      await clearOpenPage()

      let capture = await captureOnOpenPage(story)
      const pageErrors = [capture.pageErrors]

      for (let retry = 0; retry < navigatedAwayRetries && navigatedAway(capture); retry += 1) {
        capture = await captureOnOpenPage(story)
        pageErrors.push(capture.pageErrors)
      }

      return { ...capture, pageErrors: eachPageErrorOnce(...pageErrors) }
    },
    close: closePage,
  }
}
