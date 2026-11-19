import {
  type FileOptions,
  type OptionsRead,
  optionsReadExpression,
  readOptionsAnswer,
  type StoriesFile,
} from '../storybook/options-read.js'
import { minimumText, newestSupportedMajor } from '../storybook/storybook-version.js'
import { type CaptureSettings, failureReasonOf, pageSetupOf, waitMarginMs } from './capture-session.js'
import {
  BrowserExitedError,
  type Driver,
  type Page,
  PageNavigatedAwayError,
  PageTimeoutError,
} from './driver/driver.js'

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
 * What the page read of a Storybook: the globals it declares and each stories file.
 *
 * @public
 */
export interface StorybookOptions {
  /**
   * The globals Storybook keeps from a story's URL, which are the keys of its `initialGlobals` and `globalTypes`, or
   * `null` when the page couldn't read them.
   */
  declaredGlobals: string[] | null
  /**
   * What the page read of each stories file asked for, and of each story asked for in a file that loaded. It holds
   * nothing else.
   */
  files: FileOptions[]
}

/**
 * What reading the options gave: what the page read of the Storybook, or a problem that stops the run.
 *
 * @public
 */
export type StorybookOptionsRead =
  | StorybookOptions
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
 * How many times the preview is loaded again, each on a fresh page, when it reloads itself before it loads, as Vite's
 * dev server does once it has optimized dependencies it found late. The retries follow at once, with no wait.
 */
const previewReloadRetries = 2

/**
 * What loading the preview on a page gives when the preview reloaded itself before it loaded and may be loaded again.
 */
type Reloaded = 'reloaded'

/**
 * Whether `goto` failed because the preview reloaded itself before it loaded: its page navigated to the preview's own
 * URL.
 */
function reloadedItself(error: unknown, previewUrl: string): boolean {
  return error instanceof PageNavigatedAwayError && error.url === previewUrl
}

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
 * Lists what the read must answer for, each as text: every stories file, and every story of a file that loaded.
 * `storyIdsOf` gives a file's stories, or `undefined` for a file that didn't load.
 */
function entriesOf<File extends { importPath: string }>(
  files: readonly File[],
  storyIdsOf: (file: File) => readonly string[] | undefined,
): string[] {
  return files.flatMap((file) => [
    `the stories file ${file.importPath}`,
    ...(storyIdsOf(file) ?? []).map((id) => `the story ${id} of ${file.importPath}`),
  ])
}

/**
 * Gives the first entry that comes again in the list, or `undefined` when none does.
 */
function firstRepeatOf(entries: readonly string[]): string | undefined {
  const seen = new Set<string>()

  for (const entry of entries) {
    if (seen.has(entry)) {
      return entry
    }

    seen.add(entry)
  }

  return undefined
}

/**
 * Says how the files the page read differ from the files asked for: the first file or story it left out, gave though
 * it wasn't asked for, or gave twice. Gives `undefined` when they match.
 */
function mismatchOf(asked: readonly StoriesFile[], read: readonly FileOptions[]): string | undefined {
  const loaded = new Set(read.flatMap((file) => (file.outcome === 'loaded' ? [file.importPath] : [])))
  const wanted = entriesOf(asked, (file) => (loaded.has(file.importPath) ? file.storyIds : undefined))
  const given = entriesOf(read, (file) => (file.outcome === 'loaded' ? file.stories.map(({ id }) => id) : undefined))
  const givenSet = new Set(given)
  const missing = wanted.find((entry) => !givenSet.has(entry))

  if (missing !== undefined) {
    return `it left out ${missing}`
  }

  const wantedSet = new Set(wanted)
  const extra = given.find((entry) => !wantedSet.has(entry))

  if (extra !== undefined) {
    return `it gave ${extra}, which visual-check didn't ask for`
  }

  const twice = firstRepeatOf(given)

  return twice === undefined ? undefined : `it gave ${twice} twice`
}

/**
 * Gives the declared globals and the files the page read, or a problem when the files aren't exactly the files and
 * stories asked for.
 */
function filesReadOf(
  { declaredGlobals, files }: Extract<OptionsRead, { outcome: 'read' }>,
  request: OptionsRequest,
): StorybookOptionsRead {
  const mismatch = mismatchOf(request.files, files)

  if (mismatch === undefined) {
    return { declaredGlobals, files }
  }

  return {
    problem: `The page's answer to visual-check's read of Storybook ${request.storybookName}'s per-story options doesn't match what it asked for: ${mismatch}. ${tryAgain}`,
  }
}

/**
 * Says what the page found, in the terms of the run: the files it read, or why it couldn't read them.
 */
function describeRead(read: OptionsRead, request: OptionsRequest, readyTimeoutMs: number): StorybookOptionsRead {
  const { storybookName, previewUrl } = request

  switch (read.outcome) {
    case 'read':
      return filesReadOf(read, request)
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
 * ready and the files get the whole of it to load, and the driver allows the margin more for the page's answer. When
 * `mayReload` and the preview reloads itself before it loads, it gives `'reloaded'`, so the caller loads it again on a
 * fresh page. Rejects only with a `BrowserExitedError`.
 */
async function readOnPage(
  page: Page,
  settings: CaptureSettings,
  request: OptionsRequest,
  mayReload: boolean,
): Promise<StorybookOptionsRead | Reloaded> {
  const { storybookName, previewUrl, files } = request
  const { readyTimeoutMs } = settings

  try {
    await page.goto(previewUrl, readyTimeoutMs)
  } catch (error) {
    if (mayReload && reloadedItself(error, previewUrl)) {
      return 'reloaded'
    }

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
 * Opens a page, reads the options on it as `readOnPage` does, and closes it, ignoring a failure to. Rejects only with a
 * `BrowserExitedError`, and then the page isn't closed, since the browser is gone.
 */
async function readOnNewPage(
  driver: Driver,
  settings: CaptureSettings,
  request: OptionsRequest,
  mayReload: boolean,
): Promise<StorybookOptionsRead | Reloaded> {
  let page: Page

  try {
    // The options-read page never watches requests: only the pages that capture stories list hosts.
    page = await driver.newPage({ ...pageSetupOf(settings), watchRequests: false })
  } catch (error) {
    return problemOf(
      error,
      `visual-check couldn't open a page to read Storybook ${request.storybookName}'s per-story options: ${failureReasonOf(error)} ${tryAgain}`,
    )
  }

  const read = await readOnPage(page, settings, request, mayReload)

  await page.close().catch(() => undefined)

  return read
}

/**
 * Reads the merged per-story options of the stories in a Storybook's preview, with the globals each story pins and the
 * globals the Storybook declares, on a page of its own set up as a capture page is. The page loads the preview, which
 * renders no story, and reads each stories file, giving the preview and the files each the whole readyTimeout. It's
 * closed afterwards, ignoring a failure to. A preview that reloads itself before it loads, as Vite's dev server does
 * once it has optimized dependencies it found late, is loaded again on a fresh page, up to 2 times. Whatever goes wrong
 * other than the browser exiting comes back as a problem that names the Storybook and the fix, an answer that isn't
 * exactly the files and stories asked for included. Rejects only with a `BrowserExitedError`, and then the page isn't
 * closed, since the browser is gone.
 *
 * @public
 */
export async function readStoryOptions(
  driver: Driver,
  settings: CaptureSettings,
  request: OptionsRequest,
): Promise<StorybookOptionsRead> {
  for (let retry = 0; ; retry += 1) {
    const read = await readOnNewPage(driver, settings, request, retry < previewReloadRetries)

    if (read !== 'reloaded') {
      return read
    }
  }
}
