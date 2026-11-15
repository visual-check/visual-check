import {
  type FileOptions,
  type OptionsRead,
  optionsReadExpression,
  readOptionsAnswer,
  type StoriesFile,
} from '../storybook/options-read.js'
import { minimumText, newestSupportedMajor } from '../storybook/storybook-version.js'
import { type CaptureSettings, failureReasonOf, pageSetupOf, waitMarginMs } from './capture-session.js'
import { BrowserExitedError, type Driver, type Page, PageTimeoutError } from './driver/driver.js'

/**
 * What to read the per-story options of, and in which Storybook.
 *
 * @public
 */
export interface OptionsRequest {
  /**
   * The Storybook's name in the config, which a problem names it by.
   */
  storybookName: string
  /**
   * The URL of the Storybook's preview page that renders no story, such as
   * `http://localhost:6006/iframe.html?viewMode=story`.
   */
  previewUrl: string
  /**
   * The stories files to read, each with the stories whose options are wanted.
   */
  files: StoriesFile[]
}

/**
 * What reading the options gave: what the page read of each stories file, or a problem that stops the run.
 *
 * @public
 */
export type StorybookOptionsRead =
  | {
      /**
       * What the page read of each stories file, in the order asked for.
       */
      files: FileOptions[]
    }
  | {
      /**
       * One or more lines for people saying why the options couldn't be read, with no trailing newline.
       */
      problem: string
    }

/**
 * What a problem ends with when running visual-check again is the only fix.
 */
const tryAgain = 'Run visual-check again, and report it if it keeps failing.'

/**
 * What a problem that names the preview's URL says to do about a preview that doesn't load or get ready in time.
 */
const openPreview = 'Open it to see why, or raise readyTimeout.'

/**
 * Says what to do about a preview that doesn't answer, when the problem doesn't name its URL.
 */
function lookAtPreview(previewUrl: string): string {
  return `Open ${previewUrl} to see why, or raise readyTimeout.`
}

/**
 * Says the options couldn't be read, from where the preview was when readyTimeout ran out.
 */
function timedOutProblem(
  step: Extract<OptionsRead, { outcome: 'timed-out' }>['step'],
  request: OptionsRequest,
  readyTimeoutMs: number,
): string {
  const { storybookName, previewUrl } = request
  if (step === 'preview-start') {
    return `Storybook ${storybookName}'s preview never started at ${previewUrl} within readyTimeout (${readyTimeoutMs} ms). ${openPreview}`
  }

  return `Storybook ${storybookName}'s preview started at ${previewUrl} but never became ready within readyTimeout (${readyTimeoutMs} ms). ${openPreview}`
}

/**
 * Says what the page found, in the terms of the run: the files it read, or why it couldn't read them.
 */
function describeRead(read: OptionsRead, request: OptionsRequest, readyTimeoutMs: number): StorybookOptionsRead {
  const { storybookName, previewUrl } = request

  switch (read.outcome) {
    case 'read':
      return { files: read.files }
    case 'timed-out':
      return { problem: timedOutProblem(read.step, request, readyTimeoutMs) }
    case 'preview-failed': {
      const failed = `Storybook ${storybookName}'s preview failed to load`
      const fix = `Open ${previewUrl} to see the error, then fix what Storybook reports.`

      return {
        problem: read.message === '' ? `${failed}. ${fix}` : `${failed}: ${failureReasonOf(read.message)} ${fix}`,
      }
    }
    case 'unsupported':
      return {
        problem: `Storybook ${storybookName}'s preview has no loadStory, so visual-check can't read its per-story options. Check that its version is one visual-check supports, ${minimumText} to ${newestSupportedMajor}.x.`,
      }
    case 'script-missing':
      return {
        problem: `visual-check's page script didn't run in the preview's page, so it couldn't read Storybook ${storybookName}'s per-story options. ${tryAgain}`,
      }
  }
}

/**
 * Gives the problem for a step that failed, or rethrows the error when the browser exited.
 *
 * @throws {BrowserExitedError} When the browser exited.
 */
function problemOf(error: unknown, problem: string): { problem: string } {
  if (error instanceof BrowserExitedError) {
    throw error
  }

  return { problem }
}

/**
 * Says the page's evaluation of the read failed: it stopped answering within its time limit, or failed another way.
 */
function evaluationProblem(error: unknown, request: OptionsRequest, readyTimeoutMs: number): string {
  const { storybookName, previewUrl } = request

  if (error instanceof PageTimeoutError) {
    return `Storybook ${storybookName}'s preview stopped answering while visual-check read its per-story options, within readyTimeout (${readyTimeoutMs} ms). ${lookAtPreview(previewUrl)}`
  }

  return `visual-check couldn't read Storybook ${storybookName}'s per-story options: ${failureReasonOf(error)} ${tryAgain}`
}

/**
 * Loads the preview on an open page and reads the options in it. The preview gets the whole readyTimeout to become
 * ready and the files get the whole of it to load, and the driver allows the margin more for the page's answer.
 * Rejects only with a `BrowserExitedError`.
 */
async function readOnPage(
  page: Page,
  settings: CaptureSettings,
  request: OptionsRequest,
): Promise<StorybookOptionsRead> {
  const { storybookName, previewUrl, files } = request
  const { readyTimeoutMs } = settings

  try {
    await page.goto(previewUrl, readyTimeoutMs)
  } catch (error) {
    return problemOf(
      error,
      error instanceof PageTimeoutError
        ? `Storybook ${storybookName}'s preview at ${previewUrl} didn't load within readyTimeout (${readyTimeoutMs} ms). ${openPreview}`
        : `visual-check couldn't load Storybook ${storybookName}'s preview at ${previewUrl}: ${failureReasonOf(error)} Check that Storybook is running there, or restart it.`,
    )
  }

  try {
    const answer = await page.evaluate(optionsReadExpression(files, readyTimeoutMs), 2 * readyTimeoutMs + waitMarginMs)

    return describeRead(readOptionsAnswer(answer), request, readyTimeoutMs)
  } catch (error) {
    return problemOf(error, evaluationProblem(error, request, readyTimeoutMs))
  }
}

/**
 * Reads the merged per-story options of the stories in a Storybook's preview, on a page of its own set up as a
 * capture page is. The page loads the preview, which renders no story, and reads each stories file, giving the preview
 * and the files each the whole readyTimeout. It's closed afterwards, ignoring a failure to. Whatever goes wrong other
 * than the browser exiting comes back as a problem that names the Storybook and the fix. Rejects only with a
 * `BrowserExitedError`, and then the page isn't closed, since the browser is gone.
 *
 * @public
 */
export async function readStoryOptions(
  driver: Driver,
  settings: CaptureSettings,
  request: OptionsRequest,
): Promise<StorybookOptionsRead> {
  let page: Page

  try {
    page = await driver.newPage(pageSetupOf(settings))
  } catch (error) {
    return problemOf(
      error,
      `visual-check couldn't open a page to read Storybook ${request.storybookName}'s per-story options: ${failureReasonOf(error)} ${tryAgain}`,
    )
  }

  const read = await readOnPage(page, settings, request)

  await page.close().catch(() => undefined)

  return read
}
