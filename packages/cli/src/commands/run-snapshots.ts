import { relative, sep } from 'node:path'
import { BaselineError } from '../baselines/baseline-error.js'
import { baselinePathOf, isByteIdentical, readBaseline, writeBaseline } from '../baselines/baseline-files.js'
import { BrowserMismatchError, runImageOf } from '../browser/browser-version.js'
import type { ChromeForTestingPlatform } from '../browser/chrome-for-testing-platform.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import { BrowserDownloadError } from '../browser-download/browser-download-error.js'
import { headlessShellPathsOf } from '../browser-download/install-headless-shell.js'
import type { CaptureSettings, StoryCapture, StoryToCapture } from '../capture/capture-session.js'
import { BrowserExitedError, BrowserLaunchError } from '../capture/driver/driver.js'
import { runWorkerPool } from '../capture/worker-pool.js'
import type { ResolvedConfig, ResolvedStorybook } from '../config/resolve-config.js'
import { ContainerError } from '../container/container-error.js'
import { type Story, storyUrlOf } from '../storybook/read-stories.js'
import { testPathWarningOf } from '../storybook/test-path.js'
import type { BrowserPlace } from './browser-route.js'
import { dockerProblemOf } from './docker-problem.js'
import type { LaunchBrowser } from './launch-browser.js'
import { missingLibraryOf } from './missing-library.js'
import { type PlannedSnapshot, planSnapshots } from './plan-snapshots.js'
import { platformProblemOf } from './platform-problem.js'
import { type FirstBrowserExit, type RunBrowser, runBrowserOf } from './run-browser.js'

/**
 * The stories a run covers in one Storybook, in the order they are taken and printed.
 */
interface StorybookSelection {
  /**
   * The Storybook.
   */
  storybook: ResolvedStorybook
  /**
   * The version of the `storybook` package installed for it, or `undefined` when it can't be read.
   */
  version: string | undefined
  /**
   * Its selected stories.
   */
  stories: Story[]
  /**
   * Every story its `index.json` lists, whose options the run reads and checks whatever the selection.
   */
  allStories: Story[]
}

/**
 * What a `test` or `update` run needs once its checks have passed.
 */
interface SnapshotRun {
  /**
   * The command that runs.
   */
  command: 'test' | 'update'
  /**
   * The CLI's version, for the header.
   */
  version: string
  /**
   * The resolved config.
   */
  config: ResolvedConfig
  /**
   * How many workers capture at once: `--workers` or the config's `workers`, with `'auto'` already resolved.
   */
  workers: number
  /**
   * Where the browser runs.
   */
  place: BrowserPlace
  /**
   * The installed browser package.
   */
  browserPackage: BrowserPackage
  /**
   * The Storybooks in config order, each with its selected stories and every story it has.
   */
  selections: StorybookSelection[]
  /**
   * The folder the CLI runs in. Printed paths are relative to it.
   */
  cwd: string
  /**
   * Whether visual-check runs inside a container, which decides what a Docker problem suggests.
   */
  insideContainer: boolean
  /**
   * The environment, for where the headless shell is downloaded to on the host, and through which mirror and proxy.
   */
  environment: Record<string, string | undefined>
  /**
   * Launches the browser, at the first options read, and again at the first read or story that needs it after the
   * browser exits.
   */
  launchBrowser: LaunchBrowser
  /**
   * Writes the progress of the browser's launch, such as an image pull or a download, as it happens.
   */
  progress: (text: string) => void
}

/**
 * What a run printed and how it exits.
 */
interface SnapshotRunResult {
  /**
   * The exit code.
   */
  exitCode: number
  /**
   * The header, one line per snapshot and the counts, or, for a failure that stopped the run, the header and the lines
   * of the snapshots that finished before it. Nothing when the run stopped before any capture, while it read the
   * per-story options.
   */
  stdout: string
  /**
   * When the first browser exited mid-run, that it exited, whether visual-check relaunches it once, and its last output.
   * Then, for a run that stopped with exit 2, what stopped it, or for a run that finished, a warning for each Storybook
   * that seems to ignore the test path. Nothing for a run that went on with no exit and no warning.
   */
  stderr: string
}

/**
 * What became of one snapshot: a `test` status, or an `update` one. `broken` belongs to both.
 */
type SnapshotStatus = 'passed' | 'differs' | 'missing' | 'broken' | 'written' | 'kept'

/**
 * One snapshot's status, the text its line ends with and, for a captured snapshot, how long Storybook's `completing`
 * render step took.
 */
interface SnapshotResult {
  /**
   * What became of the snapshot.
   */
  status: SnapshotStatus
  /**
   * The line's last column, such as `142 ms` or `differs: …`.
   */
  detail: string
  /**
   * How long Storybook's `completing` render step took for the story, in ms. `undefined` for a story that wasn't
   * captured, or whose page didn't see the step.
   */
  completingMs?: number | undefined
}

/**
 * The mark each status's line starts with.
 */
const marks: Record<SnapshotStatus, string> = {
  passed: '✓',
  written: '✓',
  kept: '✓',
  differs: '✗',
  missing: '✗',
  broken: '!',
}

/**
 * Per command, the statuses the counts line names, in order, and the statuses that make the run exit 1.
 */
const statusesOf: Record<SnapshotRun['command'], { counted: SnapshotStatus[]; failing: SnapshotStatus[] }> = {
  test: { counted: ['passed', 'differs', 'broken', 'missing'], failing: ['differs', 'broken', 'missing'] },
  update: { counted: ['written', 'kept', 'broken'], failing: ['broken'] },
}

/**
 * What each failed baseline call asks the person to check, after its reason.
 */
const baselineFixes: Record<BaselineError['action'], string> = {
  read: "Check that it's a file visual-check can read.",
  write: 'Check that its folder is writable and the disk has room.',
}

/**
 * The snapshots a run takes, and what became of each so far.
 */
interface PlannedSnapshots {
  /**
   * The header.
   */
  header: string
  /**
   * Each snapshot, in config order and then selection order.
   */
  items: PlannedSnapshot[]
  /**
   * What became of each snapshot, by its index in `items`, once it finished.
   */
  results: (SnapshotResult | undefined)[]
}

/**
 * Builds the header: the CLI's version, the command, how many snapshots the run takes and how many workers it runs.
 */
function headerOf(run: SnapshotRun, count: number): string {
  const snapshots = `${count} ${count === 1 ? 'snapshot' : 'snapshots'}`
  const workers = `${run.workers} ${run.workers === 1 ? 'worker' : 'workers'}`

  return `visual-check ${run.version} · ${run.command} · ${snapshots} · ${workers}`
}

/**
 * Builds the session's settings from the config.
 */
function captureSettingsOf(config: ResolvedConfig): CaptureSettings {
  const { width, height, deviceScaleFactor } = config.viewport

  return {
    viewport: { width, height, deviceScaleFactor },
    readyTimeoutMs: config.readyTimeout,
    timezone: config.timezone,
    locale: config.locale,
    colorScheme: config.colorScheme,
    maskColor: config.maskColor,
  }
}

/**
 * Gives the story's ID and the URL of its own page.
 */
function storyToCaptureOf(storybook: ResolvedStorybook, story: Story): StoryToCapture {
  return { id: story.id, url: storyUrlOf(storybook.url, story.id) }
}

/**
 * Writes a path relative to the folder the CLI runs in, with `/` on every OS.
 */
function displayPathOf(cwd: string, path: string): string {
  return relative(cwd, path).split(sep).join('/')
}

/**
 * Captures a story in the run's browser, on the worker's own session. `started`, when given, is called once the
 * browser is up, just before the capture.
 */
type CaptureStory = (story: StoryToCapture, started?: () => void) => Promise<StoryCapture>

/**
 * Takes one snapshot as the command says. A story whose stories file didn't load is broken, with no capture and no
 * baseline read.
 */
async function snapshotOf(
  run: SnapshotRun,
  item: PlannedSnapshot,
  captureStory: CaptureStory,
): Promise<SnapshotResult> {
  if ('broken' in item) {
    return { status: 'broken', detail: `broken: ${item.broken.message}` }
  }

  return run.command === 'test'
    ? await testSnapshot(item.storybook, item.story, captureStory)
    : await updateSnapshot(item.storybook, item.story, captureStory, run.cwd)
}

/**
 * Tests one story: a missing baseline is reported without a capture, and a snapshot passes only when it holds the
 * baseline's bytes. It asks for a capture only once it has read the baseline. A pass's time leaves out the browser's
 * launch.
 */
async function testSnapshot(
  storybook: ResolvedStorybook,
  story: Story,
  captureStory: CaptureStory,
): Promise<SnapshotResult> {
  const baseline = await readBaseline(baselinePathOf(storybook.baselines, story.id))

  if (baseline === undefined) {
    return { status: 'missing', detail: 'missing: no baseline yet; run visual-check update to write it' }
  }

  let started = performance.now()
  const capture = await captureStory(storyToCaptureOf(storybook, story), () => {
    started = performance.now()
  })

  if ('broken' in capture) {
    return { status: 'broken', detail: `broken: ${capture.broken.message}` }
  }

  const { completingMs } = capture

  if (!isByteIdentical(capture.snapshot, baseline)) {
    return { status: 'differs', detail: "differs: the snapshot isn't byte-identical to its baseline", completingMs }
  }

  return { status: 'passed', detail: `${Math.round(performance.now() - started)} ms`, completingMs }
}

/**
 * Updates one story's baseline: writes the snapshot when the baseline is missing or differs, and leaves an identical
 * baseline untouched. A broken story writes nothing.
 */
async function updateSnapshot(
  storybook: ResolvedStorybook,
  story: Story,
  captureStory: CaptureStory,
  cwd: string,
): Promise<SnapshotResult> {
  const capture = await captureStory(storyToCaptureOf(storybook, story))

  if ('broken' in capture) {
    return { status: 'broken', detail: `broken: ${capture.broken.message}` }
  }

  const { completingMs } = capture
  const path = baselinePathOf(storybook.baselines, story.id)
  const baseline = await readBaseline(path)

  if (baseline !== undefined && isByteIdentical(capture.snapshot, baseline)) {
    return { status: 'kept', detail: 'kept', completingMs }
  }

  await writeBaseline(path, capture.snapshot)

  return { status: 'written', detail: `written ${displayPathOf(cwd, path)}`, completingMs }
}

/**
 * Builds the counts line: each counted status with its count, leaving out zero counts except the first.
 */
function countsLineOf(command: SnapshotRun['command'], statuses: SnapshotStatus[]): string {
  return statusesOf[command].counted
    .flatMap((counted, index) => {
      const count = statuses.filter((status) => status === counted).length

      return index === 0 || count > 0 ? [`${count} ${counted}`] : []
    })
    .join(' · ')
}

/**
 * Gives the exit code: 1 when any snapshot has a failing status for the command, else 0.
 */
function exitCodeOf(command: SnapshotRun['command'], statuses: SnapshotStatus[]): number {
  return statuses.some((status) => statusesOf[command].failing.includes(status)) ? 1 : 0
}

/**
 * The statuses of a snapshot that holds a capture, as a broken or missing one doesn't.
 */
const capturedStatuses: readonly SnapshotStatus[] = ['passed', 'differs', 'written', 'kept']

/**
 * Writes the browser's last output lines under a heading, or nothing when there are none.
 */
function browserOutputOf(output: readonly string[]): string {
  return output.length === 0 ? '' : `The browser's last output:\n${output.map((line) => `  ${line}\n`).join('')}`
}

/**
 * Says that the first browser exited mid-run: the exit, whether visual-check relaunches the browser for the rest of
 * the run, and the browser's last output. Gives nothing when the browser didn't exit.
 */
function exitNoticeOf(exit: FirstBrowserExit | undefined): string {
  if (exit === undefined) {
    return ''
  }

  const relaunch = exit.relaunched
    ? 'visual-check relaunches it once for the rest of the run.'
    : "No story left needed a capture, so visual-check didn't relaunch the browser."

  return `${exit.error.message}\n${relaunch}\n${browserOutputOf(exit.error.output)}`
}

/**
 * Warns, one line each, for every Storybook in the run whose stories' `completing` render steps took a median of 50 ms
 * or more, in config order: it seems to ignore the test path. Gives nothing when none does.
 */
function testPathWarningsOf(
  selections: readonly StorybookSelection[],
  items: readonly { storybook: ResolvedStorybook }[],
  results: readonly (SnapshotResult | undefined)[],
): string {
  return selections
    .flatMap(({ storybook, version }) => {
      const completingMs = items.flatMap((item, index) =>
        item.storybook === storybook ? (results[index]?.completingMs ?? []) : [],
      )
      const warning = testPathWarningOf({ name: storybook.name, version }, completingMs)

      return warning === undefined ? [] : [`${warning}\n`]
    })
    .join('')
}

/**
 * Gives the next step after the browser failed to launch or exited while in use, pointing to its output first when it
 * printed any.
 */
function browserFixOf(error: BrowserLaunchError | BrowserExitedError, run: SnapshotRun): string {
  const why = error.output.length === 0 ? '' : "The browser's output below may say why. "

  if (!(error instanceof BrowserLaunchError)) {
    return `${why}Running out of memory is a common cause. Run visual-check again.`
  }

  return `${why}Check that ${whatToCheckOf(run)}, then run visual-check again.`
}

/**
 * Gives what to check after the browser failed to launch where it runs: that the image's headless shell starts in this
 * container, that Docker can run the platform's images, or that the downloaded executable starts on this machine.
 */
function whatToCheckOf(run: SnapshotRun): string {
  switch (run.place.in) {
    case 'image':
      return `${run.browserPackage.headlessShell} starts in this container`
    case 'container':
      return `Docker can run images for ${run.place.platform}`
    case 'host':
      return `${hostExecutableOf(run, run.place.platform)} starts on this machine`
  }
}

/**
 * Gives the path of the headless shell's executable that visual-check downloads for the platform on the host.
 */
function hostExecutableOf(run: SnapshotRun, platform: ChromeForTestingPlatform): string {
  return headlessShellPathsOf(run.environment, run.browserPackage.chromium, platform).executable
}

/**
 * Gives what to print when the browser on the host can't start because Linux lacks a shared library it links against:
 * the library, both ways out, how to list every missing library, since the loader names only the first, and the
 * browser's last output.
 */
function missingLibraryMessageOf(
  library: string,
  run: SnapshotRun,
  platform: ChromeForTestingPlatform,
  output: readonly string[],
): string {
  const containerPlatform = platform === 'linux-arm64' ? 'linux/arm64' : 'linux/amd64'

  return (
    `The browser can't start because ${library} is missing.\n` +
    "Install the libraries the headless shell needs, since visual-check doesn't install system packages, or set " +
    `platform to '${containerPlatform}' in the config to run the browser in visual-check's container.\n` +
    `To list every missing library, run: ldd '${hostExecutableOf(run, platform)}' | grep 'not found'\n` +
    browserOutputOf(output)
  )
}

/**
 * Gives what to print for a browser that failed to launch or exited while in use: the platform problem when it stopped
 * before any capture with output saying its graphics process can't start, for its container's platform, or the
 * config's inside visual-check's image unless that is `host`; for a failed launch on the host whose output names a
 * missing library, that library, both ways out and how to list every missing one. Otherwise the error's message, the
 * next step and the browser's last output.
 */
function browserStopMessageOf(
  error: BrowserLaunchError | BrowserExitedError,
  run: SnapshotRun,
  capturedAny: boolean,
): string {
  const platform = run.place.in === 'container' ? run.place.platform : run.config.platform

  if (platform !== 'host' && !capturedAny && error.graphicsFailed) {
    return `${platformProblemOf(platform)}${browserOutputOf(error.output)}`
  }

  if (error instanceof BrowserLaunchError && run.place.in === 'host') {
    const library = missingLibraryOf(error.output)

    if (library !== undefined) {
      return missingLibraryMessageOf(library, run, run.place.platform, error.output)
    }
  }

  return `${error.message}\n${browserFixOf(error, run)}\n${browserOutputOf(error.output)}`
}

/**
 * Gives what to print for an error that stops the run with exit 2: a baseline that can't be read or written, Docker's
 * error, a failed download, a failed launch's or a browser exit's with the next step and the browser's last output, or
 * a version mismatch. A browser that fails or exits before any capture, with output saying its graphics process can't
 * start, gives the platform problem for its container's platform, or the config's inside visual-check's image unless
 * that is `host`, instead of the next step. A failed launch on the host whose output names a missing library gives
 * that library and both ways out. Any other error gives `undefined`.
 *
 * `capturedAny` is whether a snapshot has been captured, which a broken or missing one hasn't.
 */
function stopMessageOf(error: unknown, run: SnapshotRun, capturedAny: boolean): string | undefined {
  if (error instanceof BaselineError) {
    return (
      `visual-check couldn't ${error.action} the baseline ${displayPathOf(run.cwd, error.path)}: ${error.reason}. ` +
      `${baselineFixes[error.action]}\n`
    )
  }

  if (error instanceof BrowserLaunchError || error instanceof BrowserExitedError) {
    return browserStopMessageOf(error, run, capturedAny)
  }

  if (error instanceof ContainerError) {
    return dockerProblemOf(error, {
      insideContainer: run.insideContainer,
      image: runImageOf(run.browserPackage, run.config.image),
    })
  }

  if (error instanceof BrowserDownloadError || error instanceof BrowserMismatchError) {
    return `${error.message}\n`
  }

  return undefined
}

/**
 * Gives the planned snapshots with the header that counts them, and no result yet.
 */
function plannedSnapshotsOf(run: SnapshotRun, items: PlannedSnapshot[]): PlannedSnapshots {
  return { header: headerOf(run, items.length), items, results: items.map(() => undefined) }
}

/**
 * Gives the line of each snapshot that has finished, in the snapshots' order.
 */
function linesOf({ items, results }: PlannedSnapshots): string[] {
  return items.flatMap(({ storybook, story }, index) => {
    const result = results[index]

    return result === undefined ? [] : [`${marks[result.status]} ${storybook.name}  ${story.id}  ${result.detail}`]
  })
}

/**
 * Writes the header and the lines, each ending with a newline.
 */
function printedOf(snapshots: PlannedSnapshots, lines: string[]): string {
  return [snapshots.header, ...lines].map((line) => `${line}\n`).join('')
}

/**
 * Whether a snapshot has been captured, which a broken or missing one hasn't.
 */
function capturedAnyOf(snapshots: PlannedSnapshots | undefined): boolean {
  return snapshots?.results.some((result) => result !== undefined && capturedStatuses.includes(result.status)) ?? false
}

/**
 * Takes every snapshot with a pool of `workers` that share the run's browser.
 */
async function takeSnapshots(run: SnapshotRun, browser: RunBrowser, snapshots: PlannedSnapshots): Promise<void> {
  await runWorkerPool(run.workers, snapshots.items, async (item, index, worker) => {
    const captureStory: CaptureStory = (toCapture, started) => browser.capture(worker, toCapture, started)

    snapshots.results[index] = await snapshotOf(run, item, captureStory)
  })
}

/**
 * Reads every Storybook's per-story options before any capture, then captures every selected story that isn't
 * disabled with a pool of `workers` that share one browser, and prints one line per snapshot after the header, then
 * the counts. The lines follow config order and then selection order, whatever order the captures finish in. `test`
 * compares each snapshot with its baseline byte for byte and never captures a missing baseline; `update` writes each
 * snapshot whose baseline is missing or differs.
 *
 * Each Storybook with stories gets one options read, in config order, on a page of its own, covering every story its
 * `index.json` lists whatever the selection. So the browser is launched at the first read, even when no story then
 * needs a capture, and a run launches nothing only when no Storybook has stories. A read problem, at the first
 * Storybook that has one, or invalid options in any Storybook stop the run with exit 2 before any capture, printing
 * nothing on stdout. A disabled story is left out: it isn't captured, printed or counted. Each story of a stories file
 * that failed to load, or didn't load within readyTimeout, is broken, `load-failed`, with no capture and no baseline
 * read.
 *
 * When the browser exits, every story in flight is broken, `browser-exited`, the browser is relaunched once at the
 * next read or story that needs it, and the run goes on; stderr then says so, with the browser's last output, whatever
 * the run exits with. A baseline that can't be read or written, a failed launch or relaunch, a version mismatch or the
 * relaunched browser's exit stops the run with exit 2, keeping the lines of the snapshots that finished. So does a
 * failed download. A browser that can't start its graphics process before the first capture says the machine can't
 * run the platform. The workers' sessions and the browsers are always closed.
 *
 * A run that finishes ends stderr with a warning for each Storybook, in config order, whose captured snapshots'
 * `completing` render steps took a median of 50 ms or more: it seems to ignore the test path. The warnings never
 * change the exit code.
 *
 * @throws {Error} Any other error, after closing the sessions and the browsers.
 */
export async function runSnapshots(run: SnapshotRun): Promise<SnapshotRunResult> {
  const browser = runBrowserOf(run.launchBrowser, {
    browserPackage: run.browserPackage,
    configImage: run.config.image,
    place: run.place,
    settings: captureSettingsOf(run.config),
    environment: run.environment,
    progress: run.progress,
  })
  let snapshots: PlannedSnapshots | undefined

  try {
    const plan = await planSnapshots(run.selections, browser.readOptions, run.config.readyTimeout)

    if ('problem' in plan) {
      return { exitCode: 2, stdout: '', stderr: `${exitNoticeOf(browser.firstExit())}${plan.problem}\n` }
    }

    snapshots = plannedSnapshotsOf(run, plan.snapshots)
    await takeSnapshots(run, browser, snapshots)
  } catch (error) {
    const message = stopMessageOf(error, run, capturedAnyOf(snapshots))

    if (message === undefined) {
      throw error
    }

    const stdout = snapshots === undefined ? '' : printedOf(snapshots, linesOf(snapshots))

    return { exitCode: 2, stdout, stderr: `${exitNoticeOf(browser.firstExit())}${message}` }
  } finally {
    await browser.close()
  }

  const statuses = snapshots.results.flatMap((result) => (result === undefined ? [] : [result.status]))

  return {
    exitCode: exitCodeOf(run.command, statuses),
    stdout: printedOf(snapshots, [...linesOf(snapshots), countsLineOf(run.command, statuses)]),
    stderr: `${exitNoticeOf(browser.firstExit())}${testPathWarningsOf(run.selections, snapshots.items, snapshots.results)}`,
  }
}
