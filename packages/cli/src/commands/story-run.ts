import { checkBrowserPackage } from '../browser/browser-package.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import { runWorkerPool } from '../capture/worker-pool.js'
import { ConfigError } from '../config/config-error.js'
import { isCi } from '../config/is-ci.js'
import { loadStorybookConfig, type StorybookConfig } from '../config/load-storybook-config.js'
import type { ResolvedConfig, ResolvedStorybook } from '../config/resolve-config.js'
import { isInsideContainer } from '../container/inside-container.js'
import type { Story } from '../storybook/read-stories.js'
import { createVisualDiff, type VisualDiff } from '../visual-diff/visual-diff.js'
import { abortable } from './abortable.js'
import { captureSettingsOf } from './capture-settings.js'
import { checkStorybooks } from './check-storybooks.js'
import type { LaunchBrowser } from './launch-browser.js'
import { type BrowserPlacement, type PlaceBrowserOptions, placeBrowser, workerCountOf } from './place-browser.js'
import { type PlannedSnapshot, planSnapshots } from './plan-snapshots.js'
import { type RunBrowser, runBrowserOf } from './run-browser.js'
import { isSameAddress } from './same-address.js'
import type { CaptureStory, SnapshotResult } from './snapshot-result.js'
import { crashOf, exitNoticeOf, type StopContext, stopMessageOf } from './stop-message.js'
import { type SnapshotTools, takeSnapshot } from './take-snapshot.js'

/**
 * How far a check or an update of one story is.
 *
 * @public
 */
export type StoryProgress =
  | {
      /**
       * The run reads the config, asks Docker and reads the Storybook's index.
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
       * How many snapshots the run takes.
       */
      total: number
    }

/**
 * A run of one story of a running Storybook, a check or an update.
 *
 * @public
 */
export interface StoryRunOptions extends PlaceBrowserOptions {
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
   * Cancels the run.
   */
  signal: AbortSignal
  /**
   * Takes the run's progress as it happens.
   */
  progress: (progress: StoryProgress) => void
  /**
   * Whether visual-check runs inside a container, which decides what a Docker problem suggests. By default the
   * environment and the root's marker files say. A test gives its own.
   */
  insideContainer?: boolean
}

/**
 * A run of one story that a problem stopped.
 *
 * @public
 */
export interface StoppedStory {
  /**
   * A problem stopped the run.
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
   * What else the run says: the address CLI runs check, the warnings, and that the browser exited.
   */
  notices: string[]
}

/**
 * A run of one story whose signal aborted.
 *
 * @public
 */
export interface CancelledStory {
  /**
   * The run's signal aborted.
   */
  result: 'cancelled'
}

/**
 * One snapshot a run took, and what it came to.
 *
 * @public
 */
export interface TakenSnapshot {
  /**
   * The planned snapshot.
   */
  snapshot: PlannedSnapshot
  /**
   * What it came to.
   */
  result: SnapshotResult
}

/**
 * What a run of one story took, once every snapshot is taken and the browser is closed.
 *
 * @public
 */
export interface TakenStory {
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
   * The story's snapshots in planned order: its default capture, then its modes. None for a disabled story.
   */
  snapshots: TakenSnapshot[]
  /**
   * What else the run says: the address CLI runs check, the warnings, and that the browser exited.
   */
  notices: string[]
}

/**
 * What sets a check of one story apart from an update of it.
 *
 * @public
 */
export interface StoryRunSteps<Done> {
  /**
   * Gives what each snapshot is taken with, from the run's visual diff and config. Its command decides whether the
   * capture session lists the hosts each snapshot's page asked, as `update` does.
   */
  toolsOf: (visualDiff: VisualDiff, config: ResolvedConfig) => SnapshotTools
  /**
   * Runs once every snapshot is taken, the browser is closed and the signal hasn't aborted, and gives how the run
   * ended. The notices it gets already say when the browser exited. From then on the run can't be cancelled.
   *
   * @throws {unknown} An error `stopMessageOf` knows stops the run with its message; any other is a bug.
   */
  finish: (taken: TakenStory) => Promise<Done>
}

/**
 * A problem that stopped a run.
 */
interface StoryStop {
  /**
   * The problem, as a stopped run's outcome gives it.
   */
  stopped: Pick<StoppedStory, 'cause' | 'message'>
}

/**
 * What a run needs once nothing but its browser can stop it: the story, and what the CLI's own checks found.
 */
interface PreparedStory {
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
 * A run whose snapshots are all taken and whose browser is closed.
 */
interface CapturedStory {
  /**
   * What it took.
   */
  taken: TakenStory
  /**
   * What the exit-2 messages need to know about it.
   */
  context: StopContext
}

/**
 * Gives the stop a problem makes, its message without the last newline.
 */
function stopOf(cause: StoppedStory['cause'], message: string): StoryStop {
  return { stopped: { cause, message: message.replace(/\n$/, '') } }
}

/**
 * Gives the outcome of a run a problem stopped, with what else it says.
 */
function stoppedOf({ stopped }: StoryStop, notices: string[]): StoppedStory {
  return { result: 'stopped', ...stopped, notices }
}

/**
 * Loads the config of the run's Storybook, or gives the stop a `ConfigError` makes.
 *
 * @throws {unknown} Any other error, and the signal's reason when it aborts first.
 */
async function loadedConfigOf({
  configDir,
  url,
  cwd,
  environment,
  signal,
}: StoryRunOptions): Promise<StorybookConfig | StoryStop> {
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
 * Checks the Storybook as a run does and finds the run's story in its index, adding the warnings to `notices`.
 *
 * @throws {unknown} Any error besides the Storybook's own, and the signal's reason when it aborts first.
 */
async function storyOf(
  run: StoryRunOptions,
  storybook: ResolvedStorybook,
  notices: string[],
): Promise<Story | StoryStop> {
  const checks = await abortable(checkStorybooks([storybook], run.cwd), run.signal)

  notices.push(...checks.warnings)

  if ('problems' in checks) {
    return stopOf('run', checks.problems.join('\n'))
  }

  const story = checks.storybooks.flatMap(({ stories }) => stories).find(({ id }) => id === run.storyId)

  return (
    story ??
    stopOf(
      'run',
      `Storybook ${storybook.name}'s index.json lists no story ${run.storyId}. It may have been renamed or removed.`,
    )
  )
}

/**
 * Does all a run does before its browser: checks the browser package, loads the config, places the browser and finds
 * the story. Adds the address notice and the warnings to `notices`. Once the signal aborts, nothing is waited for.
 *
 * @throws {unknown} An unexpected error, and the signal's reason when it aborts.
 */
async function prepareStory(run: StoryRunOptions, notices: string[]): Promise<PreparedStory | StoryStop> {
  const browserCheck = checkBrowserPackage(run.environment)

  if ('problem' in browserCheck) {
    return stopOf('run', browserCheck.problem)
  }

  const loaded = await loadedConfigOf(run)

  if ('stopped' in loaded) {
    return loaded
  }

  const { browserPackage } = browserCheck
  const { config, storybook, configUrl } = loaded
  const insideContainer = run.insideContainer ?? isInsideContainer(run.environment)

  notices.push(...addressNoticesOf(run.url, configUrl))

  const placement = await abortable(placeBrowser(config, browserPackage, insideContainer, run), run.signal)

  if ('problem' in placement) {
    return stopOf('run', placement.problem)
  }

  const story = await storyOf(run, storybook, notices)

  return 'stopped' in story ? story : { browserPackage, config, storybook, story, placement, insideContainer }
}

/**
 * Takes the planned snapshots with a pool of workers, telling the progress and storing each one's result in `results`
 * at its place in the planned order. Once the signal aborts, no capture starts and none counts.
 *
 * @throws {unknown} What `takeSnapshot` throws, and the signal's reason when it aborts.
 */
async function takeSnapshots(
  run: StoryRunOptions,
  { config, placement }: PreparedStory,
  browser: RunBrowser,
  tools: SnapshotTools,
  items: readonly PlannedSnapshot[],
  results: SnapshotResult[],
): Promise<void> {
  const { signal, progress } = run
  const total = items.length
  let finished = 0

  progress({ step: 'capturing', finished, total })

  await runWorkerPool(workerCountOf(config.workers, placement.host), items, async (item, index, worker) => {
    const captureInWorker: CaptureStory = async (story, started) => {
      signal.throwIfAborted()

      const capture = await browser.capture(worker, story, started)

      signal.throwIfAborted()

      return capture
    }

    results[index] = await takeSnapshot(item, captureInWorker, tools)
    finished += 1
    progress({ step: 'capturing', finished, total })
  })
}

/**
 * Pairs each planned snapshot with its result.
 *
 * @throws {Error} When a snapshot has no result, which is a bug.
 */
function takenSnapshotsOf(items: readonly PlannedSnapshot[], results: readonly SnapshotResult[]): TakenSnapshot[] {
  return items.map((snapshot, index) => {
    const result = results[index]

    if (result === undefined) {
      throw new Error(`Snapshot ${index} of the story has no result.`)
    }

    return { snapshot, result }
  })
}

/**
 * Gives what the exit-2 messages need to know about a prepared run.
 */
function contextOf(run: StoryRunOptions, prepared: PreparedStory): StopContext {
  const { config, placement, browserPackage, insideContainer } = prepared

  return { cwd: run.cwd, place: placement.place, config, browserPackage, environment: run.environment, insideContainer }
}

/**
 * Plans the story's snapshots from its own options alone and takes them, or gives the stop a problem or a known error
 * makes.
 *
 * @throws {unknown} Any other error, and the signal's reason when it aborts.
 */
async function snapshotsOf(
  run: StoryRunOptions,
  prepared: PreparedStory,
  browser: RunBrowser,
  tools: SnapshotTools,
): Promise<TakenSnapshot[] | StoryStop> {
  const { config, storybook, story } = prepared
  const results: SnapshotResult[] = []

  try {
    const selection = { storybook, stories: [story], allStories: [story] }
    const plan = await planSnapshots([selection], browser.readOptions, config)

    if ('problem' in plan) {
      return stopOf('run', plan.problem)
    }

    if (plan.snapshots.length > 0) {
      await takeSnapshots(run, prepared, browser, tools, plan.snapshots, results)
    }

    return takenSnapshotsOf(plan.snapshots, results)
  } catch (error) {
    // A missing baseline's snapshot is captured too.
    const capturedAny = results.some(({ status }) => status !== 'broken')
    const message = stopMessageOf(error, contextOf(run, prepared), capturedAny)

    if (message === undefined) {
      throw error
    }

    return stopOf('run', message)
  }
}

/**
 * Takes a prepared run's snapshots in a browser of its own, whose exits count from none, adding to `notices` that it
 * exited. The browser and the visual diff are always closed.
 *
 * @throws {unknown} An unexpected error, and the signal's reason when it aborts.
 */
async function captureStory<Done>(
  run: StoryRunOptions,
  steps: StoryRunSteps<Done>,
  prepared: PreparedStory,
  notices: string[],
): Promise<TakenSnapshot[] | StoryStop> {
  const { config, browserPackage, placement } = prepared
  const visualDiff = createVisualDiff()

  try {
    const tools = steps.toolsOf(visualDiff, config)
    const browser = runBrowserOf(run.launchBrowser, {
      browserPackage,
      configImage: config.image,
      place: placement.place,
      settings: captureSettingsOf(config, tools.command === 'update'),
      environment: run.environment,
      progress: (text) => run.progress({ step: 'browser', text }),
    })

    try {
      return await snapshotsOf(run, prepared, browser, tools)
    } finally {
      const exitNotice = exitNoticeOf(browser.firstExit()).trim()

      if (exitNotice !== '') {
        notices.push(exitNotice)
      }

      await browser.close()
    }
  } finally {
    await visualDiff.close()
  }
}

/**
 * Prepares the run and takes its snapshots, adding to `notices` as it goes.
 *
 * @throws {unknown} An unexpected error, and the signal's reason when it aborts.
 */
async function capturedOf<Done>(
  run: StoryRunOptions,
  steps: StoryRunSteps<Done>,
  notices: string[],
): Promise<CapturedStory | StoryStop> {
  run.progress({ step: 'preparing' })

  const prepared = await prepareStory(run, notices)

  if ('stopped' in prepared) {
    return prepared
  }

  const snapshots = await captureStory(run, steps, prepared, notices)

  if ('stopped' in snapshots) {
    return snapshots
  }

  const { config, storybook, story } = prepared

  return { taken: { config, storybook, story, snapshots, notices }, context: contextOf(run, prepared) }
}

/**
 * Finishes a captured run with the steps' `finish`, or gives the stop a known error makes, the CLI's exit-2 message,
 * and for any other error its stack trace.
 */
async function finishedOf<Done>(
  steps: StoryRunSteps<Done>,
  { taken, context }: CapturedStory,
): Promise<Done | StoppedStory> {
  try {
    return await steps.finish(taken)
  } catch (error) {
    const capturedAny = taken.snapshots.some(({ result }) => result.status !== 'broken')
    const message = stopMessageOf(error, context, capturedAny) ?? crashOf(error).stderr

    return stoppedOf(stopOf('run', message), taken.notices)
  }
}

/**
 * Runs one story of a running Storybook through what `test` and `update` go through, in the same order: the browser
 * package, the config, read afresh and found from Storybook's config folder, where the browser runs, the Storybook's
 * version and index, the browser. Then it plans the story's snapshots from its own options alone, takes them with a
 * pool of workers and the steps' tools, closes the browser and gives them to the steps' `finish`.
 *
 * A problem stops the run with the CLI's exit-2 message, and an error that is a bug with its stack trace. Until
 * `finish` starts, a signal that aborts ends the run cancelled, whatever else came of it. An abort after that comes too
 * late. It never throws.
 *
 * @public
 */
export async function runStory<Done>(
  run: StoryRunOptions,
  steps: StoryRunSteps<Done>,
): Promise<Done | StoppedStory | CancelledStory> {
  const notices: string[] = []
  const captured = await capturedOf(run, steps, notices).catch((error: unknown) => stopOf('run', crashOf(error).stderr))

  if (run.signal.aborted) {
    return { result: 'cancelled' }
  }

  if ('stopped' in captured) {
    return stoppedOf(captured, notices)
  }

  return await finishedOf(steps, captured)
}
