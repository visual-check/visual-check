import { dirname } from 'node:path'
import { baselineStemOf } from '../baselines/baseline-files.js'
import { checkBrowserPackage } from '../browser/browser-package.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import { runWorkerPool } from '../capture/worker-pool.js'
import { ConfigError } from '../config/config-error.js'
import { isCi } from '../config/is-ci.js'
import { loadStorybookConfig, type StorybookConfig } from '../config/load-storybook-config.js'
import type { ResolvedConfig, ResolvedStorybook } from '../config/resolve-config.js'
import { isInsideContainer } from '../container/inside-container.js'
import type { ReportImages, TestReportEntry } from '../report/report-document.js'
import type { ReportImageBytes } from '../report/report-folder.js'
import type { Story } from '../storybook/read-stories.js'
import { createVisualDiff, type VisualDiff } from '../visual-diff/visual-diff.js'
import { abortable } from './abortable.js'
import { captureSettingsOf } from './capture-settings.js'
import { checkStorybooks } from './check-storybooks.js'
import type { LaunchBrowser } from './launch-browser.js'
import { type BrowserPlacement, type PlaceBrowserOptions, placeBrowser, workerCountOf } from './place-browser.js'
import { type PlannedSnapshot, planSnapshots } from './plan-snapshots.js'
import { testEntryOf } from './report-entries.js'
import { type RunBrowser, runBrowserOf } from './run-browser.js'
import { isSameAddress } from './same-address.js'
import type { CaptureStory } from './snapshot-result.js'
import { crashOf, exitNoticeOf, stopMessageOf } from './stop-message.js'
import { takeSnapshot } from './take-snapshot.js'

/**
 * How far a check is.
 *
 * @public
 */
export type CheckProgress =
  | {
      /**
       * The check reads the config, asks Docker and reads the Storybook's index.
       */
      step: 'preparing'
    }
  | {
      /**
       * The browser's image is pulled, or its download runs.
       */
      step: 'browser'
      /**
       * A chunk of the pull's or download's own output.
       */
      text: string
    }
  | {
      /**
       * The story's snapshots are captured and compared.
       */
      step: 'capturing'
      /**
       * How many snapshots have finished.
       */
      finished: number
      /**
       * How many snapshots the check takes.
       */
      total: number
    }

/**
 * How a check ended.
 *
 * @public
 */
export type CheckOutcome =
  | {
      /**
       * The check finished, whatever its snapshots came to.
       */
      result: 'checked'
      /**
       * The name the config gives the Storybook.
       */
      storybook: string
      /**
       * The folder the snapshots' image paths are relative to.
       */
      imagesFolder: string
      /**
       * The story's snapshots in the report's shape: its default capture, then its modes in order.
       */
      snapshots: TestReportEntry[]
      /**
       * Whether the story is disabled, so the check took no snapshot.
       */
      disabled: boolean
      /**
       * What else the check says: the address CLI runs check, the warnings, and that the browser exited.
       */
      notices: string[]
    }
  | {
      /**
       * A problem stopped the check.
       */
      result: 'stopped'
      /**
       * Whether the config is what stopped it, or anything else.
       */
      cause: 'config' | 'run'
      /**
       * The CLI's exit-2 message as it is, without its last newline.
       */
      message: string
      /**
       * What else the check says, as for one that finished.
       */
      notices: string[]
    }
  | {
      /**
       * The check's signal aborted.
       */
      result: 'cancelled'
    }

/**
 * Where a check's images go. A story's images stay until a later check of it has completed, so a check that was
 * cancelled or stopped leaves them as they were.
 *
 * @public
 */
export interface CheckImages {
  /**
   * Gives the folder the snapshots' image paths are relative to.
   */
  folderOf: (storybook: ResolvedStorybook) => string
  /**
   * Gives the paths a snapshot's images will have, as the entry lists them, the stem naming its baseline. Writes
   * nothing.
   */
  pathsOf: (storybook: ResolvedStorybook, stem: string, images: Partial<ReportImageBytes>) => ReportImages
  /**
   * Removes what the last check of this story left and writes these images, by stem.
   *
   * @throws {ReportError} When the old images can't be removed or the new ones can't be written.
   */
  replace: (
    storybook: ResolvedStorybook,
    storyId: string,
    images: ReadonlyMap<string, Partial<ReportImageBytes>>,
  ) => Promise<void>
}

/**
 * A check of one story of a running Storybook.
 *
 * @public
 */
export interface StoryCheck extends PlaceBrowserOptions {
  /**
   * The story's ID.
   */
  storyId: string
  /**
   * The absolute path of Storybook's config folder, where the search for the config starts.
   */
  configDir: string
  /**
   * The Storybook's own address, which the story is captured at.
   */
  url: string
  /**
   * The absolute folder Storybook runs in. Paths in messages are relative to it.
   */
  cwd: string
  /**
   * The environment, which says whether this is CI, names the package manager, and says where the headless shell is
   * downloaded to on the host, and through which mirror and proxy.
   */
  environment: Record<string, string | undefined>
  /**
   * Launches the browser, at the options read, and again at the first capture that needs it after the browser exits.
   * When the signal aborts, it abandons a launch and fails the calls in flight on the browser's pages.
   */
  launchBrowser: LaunchBrowser
  /**
   * Where the images go.
   */
  images: CheckImages
  /**
   * Cancels the check.
   */
  signal: AbortSignal
  /**
   * Takes the check's progress as it happens.
   */
  progress: (progress: CheckProgress) => void
  /**
   * Whether visual-check runs inside a container, which decides what a Docker problem suggests. By default the
   * environment and the root's marker files say. A test gives its own.
   */
  insideContainer?: boolean
}

/**
 * A problem that stopped a check.
 */
interface CheckStop {
  /**
   * The problem, as a stopped check's outcome gives it.
   */
  stopped: Pick<Extract<CheckOutcome, { result: 'stopped' }>, 'cause' | 'message'>
}

/**
 * What a check needs once nothing but its browser can stop it: the story, and what the CLI's own checks found.
 */
interface PreparedCheck {
  /**
   * The installed browser package.
   */
  browserPackage: BrowserPackage
  /**
   * The config, resolved for the Storybook alone.
   */
  config: ResolvedConfig
  /**
   * The Storybook, at its own address.
   */
  storybook: ResolvedStorybook
  /**
   * The story.
   */
  story: Story
  /**
   * Where the browser runs, and the CPUs and memory there.
   */
  placement: BrowserPlacement
  /**
   * Whether visual-check runs inside a container.
   */
  insideContainer: boolean
}

/**
 * What a check's snapshots are taken with.
 */
interface CheckTools {
  /**
   * The check's browser.
   */
  browser: RunBrowser
  /**
   * The check's visual diff.
   */
  visualDiff: VisualDiff
}

/**
 * What a check's snapshots came to.
 */
interface TakenSnapshots {
  /**
   * Each finished snapshot's entry, at its place in the planned order.
   */
  entries: TestReportEntry[]
  /**
   * The images the entries list, by the stem of the snapshot's baseline.
   */
  images: Map<string, Partial<ReportImageBytes>>
}

/**
 * What a check notes as it goes, which counts however it ends.
 */
interface CheckNotes {
  /**
   * What else the check says, as its outcome gives it.
   */
  notices: string[]
  /**
   * Whether it has started to replace the story's images, after which it can't be cancelled.
   */
  replacing: boolean
}

/**
 * Gives the stop a problem makes, its message without the last newline.
 */
function stopOf(cause: CheckStop['stopped']['cause'], message: string): CheckStop {
  return { stopped: { cause, message: message.replace(/\n$/, '') } }
}

/**
 * Loads the config of the check's Storybook, or gives the stop a `ConfigError` makes.
 *
 * @throws {unknown} Any other error, and the signal's reason when it aborts first.
 */
async function loadedConfigOf({
  configDir,
  url,
  cwd,
  environment,
  signal,
}: StoryCheck): Promise<StorybookConfig | CheckStop> {
  try {
    const loading = loadStorybookConfig({ configDir, url, cwd, ci: isCi(environment), signal })

    return await abortable(loading, signal)
  } catch (error) {
    if (error instanceof ConfigError) {
      return stopOf('config', error.message)
    }

    throw error
  }
}

/**
 * Says that CLI runs check the URL the config gives, when that isn't the Storybook's own address.
 */
function addressNoticesOf(url: string, configUrl: string | undefined): string[] {
  return configUrl === undefined || isSameAddress(url, configUrl)
    ? []
    : [`This Storybook runs at ${url}. CLI runs check ${configUrl}, the config's url.`]
}

/**
 * Checks the Storybook as a run does and finds the check's story in its index, adding the warnings to `notices`.
 *
 * @throws {unknown} Any error besides the Storybook's own, and the signal's reason when it aborts first.
 */
async function storyOf(check: StoryCheck, storybook: ResolvedStorybook, notices: string[]): Promise<Story | CheckStop> {
  const checks = await abortable(checkStorybooks([storybook], check.cwd), check.signal)

  notices.push(...checks.warnings)

  if ('problems' in checks) {
    return stopOf('run', checks.problems.join('\n'))
  }

  const story = checks.storybooks.flatMap(({ stories }) => stories).find(({ id }) => id === check.storyId)

  return (
    story ??
    stopOf(
      'run',
      `Storybook ${storybook.name}'s index.json lists no story ${check.storyId}. It may have been renamed or removed.`,
    )
  )
}

/**
 * Does all a check does before its browser: checks the browser package, loads the config, places the browser and finds
 * the story. Adds the address notice and the warnings to `notices`. Once the signal aborts, nothing is waited for.
 *
 * @throws {unknown} An unexpected error, and the signal's reason when it aborts.
 */
async function prepareCheck(check: StoryCheck, notices: string[]): Promise<PreparedCheck | CheckStop> {
  const browserCheck = checkBrowserPackage(check.environment)

  if ('problem' in browserCheck) {
    return stopOf('run', browserCheck.problem)
  }

  const loaded = await loadedConfigOf(check)

  if ('stopped' in loaded) {
    return loaded
  }

  const { browserPackage } = browserCheck
  const { config, storybook, configUrl } = loaded
  const insideContainer = check.insideContainer ?? isInsideContainer(check.environment)

  notices.push(...addressNoticesOf(check.url, configUrl))

  const placement = await abortable(placeBrowser(config, browserPackage, insideContainer, check), check.signal)

  if ('problem' in placement) {
    return stopOf('run', placement.problem)
  }

  const story = await storyOf(check, storybook, notices)

  return 'stopped' in story ? story : { browserPackage, config, storybook, story, placement, insideContainer }
}

/**
 * Takes the planned snapshots with a pool of workers, telling the progress and adding each one's entry and images to
 * `taken`. Writes no image. Once the signal aborts, no capture starts and none counts.
 *
 * @throws {unknown} What `takeSnapshot` throws, and the signal's reason when it aborts.
 */
async function takeCheckSnapshots(
  check: StoryCheck,
  { config, placement }: PreparedCheck,
  { browser, visualDiff }: CheckTools,
  items: readonly PlannedSnapshot[],
  taken: TakenSnapshots,
): Promise<void> {
  const { images, signal, progress } = check
  const total = items.length
  let finished = 0

  progress({ step: 'capturing', finished, total })

  await runWorkerPool(workerCountOf(config.workers, placement.host), items, async (item, index, worker) => {
    const captureStory: CaptureStory = async (story, started) => {
      signal.throwIfAborted()

      const capture = await browser.capture(worker, story, started)

      signal.throwIfAborted()

      return capture
    }
    const result = await takeSnapshot(item, captureStory, {
      command: 'test',
      visualDiff,
      retries: config.retries,
      captureMissing: true,
      writeImages: async ({ storybook, key }, bytes) => {
        const stem = baselineStemOf(key)

        taken.images.set(stem, bytes)

        return images.pathsOf(storybook, stem, bytes)
      },
    })

    taken.entries[index] = testEntryOf(item, result, dirname(config.path))
    finished += 1
    progress({ step: 'capturing', finished, total })
  })
}

/**
 * Plans the story's snapshots from its own options alone, takes them and replaces the images its last check left with
 * theirs, noting when it starts to. Gives their entries, none for a disabled story, or the stop a problem or a known
 * error makes. Until it replaces them, the last check's images are left alone.
 *
 * @throws {unknown} Any other error, and the signal's reason when it aborts before the images are replaced.
 */
async function entriesOf(
  check: StoryCheck,
  prepared: PreparedCheck,
  tools: CheckTools,
  notes: CheckNotes,
): Promise<{ entries: TestReportEntry[] } | CheckStop> {
  const { config, storybook, story, placement, browserPackage, insideContainer } = prepared
  const { cwd, environment } = check
  const taken: TakenSnapshots = { entries: [], images: new Map() }

  try {
    const selection = { storybook, stories: [story], allStories: [story] }
    const plan = await planSnapshots([selection], tools.browser.readOptions, config)

    if ('problem' in plan) {
      return stopOf('run', plan.problem)
    }

    if (plan.snapshots.length > 0) {
      await takeCheckSnapshots(check, prepared, tools, plan.snapshots, taken)
    }

    check.signal.throwIfAborted()
    notes.replacing = true
    await check.images.replace(storybook, story.id, taken.images)

    return { entries: taken.entries }
  } catch (error) {
    const context = { cwd, place: placement.place, config, browserPackage, environment, insideContainer }
    // A missing baseline's snapshot is captured too.
    const capturedAny = taken.entries.some(({ status }) => status !== 'broken')
    const message = stopMessageOf(error, context, capturedAny)

    if (message === undefined) {
      throw error
    }

    return stopOf('run', message)
  }
}

/**
 * Takes a prepared check's snapshots in a browser of its own, whose exits count from none, adding to the notices that
 * it exited. The browser and the visual diff are always closed.
 *
 * @throws {unknown} An unexpected error.
 */
async function captureCheck(
  check: StoryCheck,
  prepared: PreparedCheck,
  notes: CheckNotes,
): Promise<{ entries: TestReportEntry[] } | CheckStop> {
  const { config, browserPackage, placement } = prepared
  const visualDiff = createVisualDiff()
  const browser = runBrowserOf(check.launchBrowser, {
    browserPackage,
    configImage: config.image,
    place: placement.place,
    settings: captureSettingsOf(config, false),
    environment: check.environment,
    progress: (text) => check.progress({ step: 'browser', text }),
  })

  try {
    return await entriesOf(check, prepared, { browser, visualDiff }, notes)
  } finally {
    const exitNotice = exitNoticeOf(browser.firstExit()).trim()

    if (exitNotice !== '') {
      notes.notices.push(exitNotice)
    }

    try {
      await browser.close()
    } finally {
      await visualDiff.close()
    }
  }
}

/**
 * Runs a check to its end, noting what counts however it ends.
 *
 * @throws {unknown} An unexpected error, and the signal's reason when it aborts.
 */
async function endOf(check: StoryCheck, notes: CheckNotes): Promise<CheckOutcome | CheckStop> {
  check.progress({ step: 'preparing' })

  const prepared = await prepareCheck(check, notes.notices)

  if ('stopped' in prepared) {
    return prepared
  }

  const captured = await captureCheck(check, prepared, notes)

  if ('stopped' in captured) {
    return captured
  }

  return {
    result: 'checked',
    storybook: prepared.storybook.name,
    imagesFolder: check.images.folderOf(prepared.storybook),
    snapshots: captured.entries,
    disabled: captured.entries.length === 0,
    notices: notes.notices,
  }
}

/**
 * Checks one story of a running Storybook: captures its default capture and each mode it lists, those with no baseline
 * too, and compares each snapshot with its baseline as `test` does, with the config's retries. The entries are in the
 * report's shape. It writes no baseline.
 *
 * It goes through what `test` goes through, in the same order: the browser package, the config, read afresh and found
 * from Storybook's config folder, where the browser runs, the Storybook's version and index, the browser. The config's
 * `url` may have none for the current environment: the story is captured at the Storybook's own address, and a notice
 * says when CLI runs check another one. Only this story's options are read and checked, so only its stories file is
 * loaded. A problem stops the check with the CLI's exit-2 message, and an error that is a bug with its stack trace.
 *
 * When the browser exits, the stories in flight are broken and it's relaunched once, with a notice, and a second exit
 * stops the check with the CLI's message. Each check counts its own exits.
 *
 * The images are written once every snapshot is taken, in place of those the story's last check left. Until then, a
 * signal that aborts ends the check cancelled, whatever else came of it: each wait before the browser is abandoned, and
 * the launcher ends the ones on the browser. An abort after that comes too late. It never throws.
 *
 * @public
 */
export async function checkStory(check: StoryCheck): Promise<CheckOutcome> {
  const notes: CheckNotes = { notices: [], replacing: false }
  const end = await endOf(check, notes).catch((error: unknown) => stopOf('run', crashOf(error).stderr))

  if (!('stopped' in end)) {
    return end
  }

  return check.signal.aborted && !notes.replacing
    ? { result: 'cancelled' }
    : { result: 'stopped', ...end.stopped, notices: notes.notices }
}
