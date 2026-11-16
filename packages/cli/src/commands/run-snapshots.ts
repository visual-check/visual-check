import { BaselineError } from '../baselines/baseline-error.js'
import { baselinePathOf, readBaseline, writeBaseline } from '../baselines/baseline-files.js'
import { BrowserMismatchError, runImageOf } from '../browser/browser-version.js'
import type { ChromeForTestingPlatform } from '../browser/chrome-for-testing-platform.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import { BrowserDownloadError } from '../browser-download/browser-download-error.js'
import { headlessShellPathsOf } from '../browser-download/install-headless-shell.js'
import type { CaptureSettings } from '../capture/capture-session.js'
import { BrowserExitedError, BrowserLaunchError } from '../capture/driver/driver.js'
import { runWorkerPool } from '../capture/worker-pool.js'
import type { ResolvedConfig, ResolvedStorybook } from '../config/resolve-config.js'
import { ContainerError } from '../container/container-error.js'
import { clearReport, ReportError, reportFolderOf } from '../report/report-folder.js'
import type { Story } from '../storybook/read-stories.js'
import { testPathWarningOf } from '../storybook/test-path.js'
import { createVisualDiff, type VisualDiff } from '../visual-diff/visual-diff.js'
import type { BrowserPlace } from './browser-route.js'
import { dockerProblemOf } from './docker-problem.js'
import type { LaunchBrowser } from './launch-browser.js'
import { missingLibraryOf } from './missing-library.js'
import { type PlannedSnapshot, planSnapshots, type SnapshotToCapture } from './plan-snapshots.js'
import { platformProblemOf } from './platform-problem.js'
import { type FirstBrowserExit, type RunBrowser, runBrowserOf } from './run-browser.js'
import { countsLineOf, displayPathOf } from './run-output.js'
import {
  brokenResultOf,
  type CaptureStory,
  compareWithBaseline,
  type SnapshotResult,
  type SnapshotStatus,
  storyToCaptureOf,
} from './snapshot-result.js'
import { type TestTools, testSnapshot } from './test-snapshot.js'
import {
  deleteStorybookOrphans,
  longPathWarningOf,
  planUpdate,
  type StorybookOrphans,
  updateEndLinesOf,
} from './update-baselines.js'

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
   * The OS the CLI runs on, which decides whether `update` warns about baseline paths too long for Windows.
   */
  os: NodeJS.Platform
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
   * The header, one line per snapshot and the counts, then for `update` the path of each baseline written and each
   * orphan deleted, or, for a failure that stopped the run, the header and the lines of the snapshots that finished
   * before it. Nothing when the run stopped before any capture, while it planned the snapshots or, for `update`,
   * checked the baselines folders.
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
 * The statuses `test`'s counts line names, in order.
 */
const testCountedStatuses: readonly SnapshotStatus[] = ['passed', 'differs', 'broken', 'missing']

/**
 * Per command, the statuses that make the run exit 1.
 */
const failingStatuses: Record<SnapshotRun['command'], readonly SnapshotStatus[]> = {
  test: ['differs', 'broken', 'missing'],
  update: ['broken'],
}

/**
 * What each failed baseline call asks the person to check, after its reason.
 */
const baselineFixes: Record<BaselineError['action'], string> = {
  read: "Check that it's a file visual-check can read.",
  decode: 'Delete it or restore it from git, then run visual-check again.',
  write: 'Check that its folder is writable and the disk has room.',
  delete: 'Check that its folder is writable.',
  list: "Check that it's a folder visual-check can read.",
}

/**
 * What each failed report call asks the person to check, after its reason.
 */
const reportFixes: Record<ReportError['action'], string> = {
  clear: 'Check that visual-check can remove it.',
  write: 'Check that its folder is writable and the disk has room.',
}

/**
 * What each snapshot of a run is taken with, by command: the visual diff both commands compare snapshots with and, for
 * `test` alone, the report folder it writes the images of each differing snapshot to and how many more times it
 * captures a snapshot that differs.
 */
type SnapshotTools =
  | (TestTools & {
      /**
       * The command, `test`, which compares each snapshot and reports the ones that differ.
       */
      command: 'test'
    })
  | {
      /**
       * The command, `update`, which compares each snapshot and writes the baselines that are missing or differ. It
       * never touches the report folder.
       */
      command: 'update'
      /**
       * The run's visual diff.
       */
      visualDiff: VisualDiff
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
   * Each snapshot, in config order and then `index.json` order, then each story's default capture and its modes in
   * order.
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
  return {
    readyTimeoutMs: config.readyTimeout,
    timezone: config.timezone,
    locale: config.locale,
    colorScheme: config.colorScheme,
    maskColor: config.maskColor,
  }
}

/**
 * Takes one snapshot: tests it for `test`, else updates its baseline. A story whose stories file didn't load is
 * broken, with no capture and no baseline read.
 */
async function snapshotOf(
  item: PlannedSnapshot,
  captureStory: CaptureStory,
  tools: SnapshotTools,
): Promise<SnapshotResult> {
  if ('broken' in item) {
    return brokenResultOf(item.broken)
  }

  return tools.command === 'test'
    ? await testSnapshot(item, captureStory, tools)
    : await updateSnapshot(item, captureStory, tools.visualDiff)
}

/**
 * Updates one snapshot's baseline: writes the snapshot when the baseline is missing, or differs from it beyond the
 * story's tolerance or in size, and leaves a baseline within tolerance untouched. The detail says why a baseline was
 * written: `written: missing`, or `written: differs: ` and what `test` would say. A broken story writes nothing.
 *
 * @throws {BaselineError} When the baseline can't be read, decoded or written.
 * @throws {ImageDecodeError} When the snapshot can't be decoded, which the browser's PNG files rule out.
 * @throws {Error} When a visual diff thread stops mid-comparison.
 */
async function updateSnapshot(
  item: SnapshotToCapture,
  captureStory: CaptureStory,
  visualDiff: VisualDiff,
): Promise<SnapshotResult> {
  const capture = await captureStory(storyToCaptureOf(item))

  if ('broken' in capture) {
    return brokenResultOf(capture.broken)
  }

  const { snapshot, completingMs } = capture
  const path = baselinePathOf(item.storybook.baselines, item.key)
  const baseline = await readBaseline(path)

  if (baseline === undefined) {
    await writeBaseline(path, snapshot)

    return { status: 'written', detail: 'written: missing', completingMs }
  }

  const result = await compareWithBaseline(visualDiff, item, baseline, snapshot, path)

  if (result.outcome === 'differs') {
    await writeBaseline(path, snapshot)

    return { status: 'written', detail: `written: differs: ${result.message}`, completingMs }
  }

  return { status: 'kept', detail: 'kept', completingMs }
}

/**
 * Gives how many snapshots have the status.
 */
function countOf(statuses: readonly SnapshotStatus[], counted: SnapshotStatus): number {
  return statuses.filter((status) => status === counted).length
}

/**
 * Gives the path of each baseline `update` wrote, in the snapshots' order.
 */
function writtenPathsOf(snapshots: PlannedSnapshots): string[] {
  return snapshots.items.flatMap((item, index) =>
    snapshots.results[index]?.status === 'written' ? [baselinePathOf(item.storybook.baselines, item.key)] : [],
  )
}

/**
 * Warns, for `update` on Windows, about each baseline it wrote whose path is longer than 260 characters. Gives nothing
 * for `test`, on any other OS, or when none is that long.
 */
function longPathWarningsOf(run: SnapshotRun, snapshots: PlannedSnapshots): string {
  if (run.command !== 'update') {
    return ''
  }

  return longPathWarningOf(run.os, run.cwd, writtenPathsOf(snapshots))
}

/**
 * Labels a counted status of `test`: the passed count says how many of its snapshots are flaky, when any is.
 */
function testCountLabelOf(status: SnapshotStatus, flaky: number): string {
  return status === 'passed' && flaky > 0 ? `${status} (${flaky} flaky)` : status
}

/**
 * Builds the lines that end a finished run's output: for `test`, the flaky snapshots under a heading, when there are
 * any, then the counts line, each counted status with its count, leaving out zero counts except the first, the passed
 * count saying how many are flaky; for `update`, the counts of written, deleted and kept baselines and broken
 * snapshots, then the path of each baseline written, in the snapshots' order, and of each orphan deleted.
 */
function endLinesOf(run: SnapshotRun, snapshots: PlannedSnapshots, deleted: string[]): string[] {
  const statuses = snapshots.results.flatMap((result) => (result === undefined ? [] : [result.status]))

  if (run.command === 'test') {
    const flaky = snapshots.results.filter((result) => result?.flaky === true).length
    const counts = testCountedStatuses.map(
      (status) => [testCountLabelOf(status, flaky), countOf(statuses, status)] as const,
    )

    return [...flakyLinesOf(snapshots), countsLineOf(counts)]
  }

  return updateEndLinesOf(run.cwd, {
    written: writtenPathsOf(snapshots),
    deleted,
    kept: countOf(statuses, 'kept'),
    broken: countOf(statuses, 'broken'),
  })
}

/**
 * Gives the exit code: 1 when any snapshot has a failing status for the command, else 0.
 */
function exitCodeOf(command: SnapshotRun['command'], snapshots: PlannedSnapshots): number {
  return snapshots.results.some((result) => result !== undefined && failingStatuses[command].includes(result.status))
    ? 1
    : 0
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
 * Warns, one line each, for every Storybook in the run whose snapshots' `completing` render steps took a median of 50
 * ms or more, in config order: it seems to ignore the test path. Gives nothing when none does.
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
 * Gives what to print for an error that stops the run with exit 2: a baseline that can't be read, decoded, written or
 * deleted, a baselines folder that can't be listed, a report folder that can't be cleared or written to, Docker's
 * error, a failed download, a failed launch's or a browser exit's with the next step and the browser's last output, or
 * a version mismatch. A browser that fails or exits before any capture, with output saying its graphics process can't
 * start, gives the platform problem for its container's platform, or the config's inside visual-check's image unless
 * that is `host`, instead of the next step. A failed launch on the host whose output names a missing library gives that
 * library and both ways out. Any other error gives `undefined`.
 *
 * `capturedAny` is whether a snapshot has been captured, which a broken or missing one hasn't.
 */
function stopMessageOf(error: unknown, run: SnapshotRun, capturedAny: boolean): string | undefined {
  if (error instanceof BaselineError) {
    return (
      `visual-check couldn't ${error.action} ${error.subject} ${displayPathOf(run.cwd, error.path)}: ${error.reason}. ` +
      `${baselineFixes[error.action]}\n`
    )
  }

  if (error instanceof ReportError) {
    return (
      `visual-check couldn't ${error.action} ${displayPathOf(run.cwd, error.path)}: ${error.reason}. ` +
      `${reportFixes[error.action]}\n`
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
 * Names a snapshot by its Storybook, story ID and mode when it has one, two spaces apart.
 */
function snapshotNameOf({ storybook, story, mode }: PlannedSnapshot): string {
  const modeColumn = mode === undefined ? '' : `  ${mode}`

  return `${storybook.name}  ${story.id}${modeColumn}`
}

/**
 * Gives the line of each snapshot that has finished, in the snapshots' order: its mark, name and detail, followed by
 * the lines of its hint, when it has one, each indented by two spaces.
 */
function linesOf({ items, results }: PlannedSnapshots): string[] {
  return items.flatMap((item, index) => {
    const result = results[index]

    if (result === undefined) {
      return []
    }

    const hintLines = result.hint?.map((line) => `  ${line}`) ?? []

    return [`${marks[result.status]} ${snapshotNameOf(item)}  ${result.detail}`, ...hintLines]
  })
}

/**
 * Lists the flaky snapshots by name under a heading, in the snapshots' order, each indented by two spaces. Gives no
 * line when none is flaky.
 */
function flakyLinesOf({ items, results }: PlannedSnapshots): string[] {
  const names = items.flatMap((item, index) => (results[index]?.flaky === true ? [`  ${snapshotNameOf(item)}`] : []))

  return names.length === 0 ? [] : ['Flaky snapshots, which passed on a retry:', ...names]
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
 * Takes every snapshot with a pool of `workers` that share the run's browser, testing each for `test` and updating its
 * baseline for `update`.
 */
async function takeSnapshots(
  run: SnapshotRun,
  browser: RunBrowser,
  snapshots: PlannedSnapshots,
  tools: SnapshotTools,
): Promise<void> {
  await runWorkerPool(run.workers, snapshots.items, async (item, index, worker) => {
    const captureStory: CaptureStory = (toCapture, started) => browser.capture(worker, toCapture, started)

    snapshots.results[index] = await snapshotOf(item, captureStory, tools)
  })
}

/**
 * Reads every Storybook's per-story options before any capture, then takes the snapshots of every selected story that
 * isn't disabled with a pool of `workers` that share one browser: its default capture, then one snapshot per mode it
 * lists, each at its own viewport and with its mode's globals in the story's URL. It prints one line per snapshot after
 * the header, which counts them, then the counts; a mode's line names the mode after the story ID. The lines follow
 * config order, then `index.json` order, then the story's default capture and its modes in order, whatever order the
 * captures finish in. Each snapshot has its own baseline, `<story-id>.png` for the default capture and
 * `<story-id>.<mode>.png` for a mode, a key over 240 bytes shortened to its first 223 bytes, `-` and 16 hex characters
 * of its SHA-256. `test` compares each snapshot with its baseline by the story's tolerance, at the viewport's device
 * scale factor, and never captures a missing baseline. It clears the report folder, `.visual-check/report` beside the
 * config file, once the snapshots are planned, and writes the baseline, snapshot and visual diff of each snapshot whose
 * first capture differs there. A snapshot that differs is captured again, up to the config's `retries` more times; one
 * that passes on a retry passes, flaky, and its line ends with `· flaky`. One that still differs by pixels on its first
 * capture and its last retry, with every differing pixel of the last retry inside its remote content, give or take the
 * device scale factor rounded up, gets a hint under its line: the hosts, a mask line for each and the docs page. The
 * hint never changes the exit code. After the lines, `test` lists the flaky snapshots by name under a heading, when
 * there are any, and its counts say how many passes are flaky. A flaky snapshot never fails the run.
 *
 * `update` also takes every snapshot outside the selection whose baseline is missing, so it writes every missing
 * baseline of the Storybooks in the run. A story outside the selection whose stories file didn't load is taken, and
 * broken, when its default baseline is missing, and left out when it's there. Before any capture, it lists each
 * Storybook's baselines folder, where only `.png` files count, and decodes each of them; the first one that can't be
 * listed or decoded, in config order then file name order, stops the run with exit 2, printing nothing on stdout. It
 * compares each snapshot with its baseline as `test` does, and writes it when the baseline is missing or differs beyond
 * tolerance or in size. A baseline within tolerance stays untouched, even when its bytes differ. Once every snapshot is
 * taken, it deletes the orphans: the baselines that no planned snapshot calls for, selected or not, apart from any that
 * could belong to a story whose stories file didn't load. An orphan the file system takes for an expected baseline is
 * that baseline, so it stays. Its counts are of written, deleted and kept baselines and broken snapshots, followed by
 * the path of each baseline written and each orphan deleted. `update` never touches the report folder.
 *
 * Each Storybook with stories gets one options read, in config order, on a page of its own, covering every story its
 * `index.json` lists whatever the selection. So the browser is launched at the first read, even when no story then
 * needs a capture, and a run launches nothing only when no Storybook has stories. A read problem, at the first
 * Storybook that has one, or invalid options in any Storybook stop the run with exit 2 before any capture, printing
 * nothing on stdout. Invalid options include a mode that breaks the mode rules, such as a bad name, a global the
 * Storybook doesn't declare or one the story pins. A disabled story is left out: it isn't captured, printed or counted.
 * Each story of a stories file that failed to load, or didn't load within readyTimeout, is one broken snapshot,
 * `load-failed`, with no mode, no capture and no baseline read.
 *
 * Planning also stops the run with exit 2, before the report folder is cleared or anything is captured, on two
 * snapshots of one Storybook whose baselines would be one file, selected or not. Stderr names the first such pair in
 * each Storybook, in config order.
 *
 * When the browser exits, every story in flight is broken, `browser-exited`, the browser is relaunched once at the next
 * read or story that needs it, and the run goes on; stderr then says so, with the browser's last output, whatever the
 * run exits with. A baseline that can't be read, decoded or written, a report folder that can't be cleared or written
 * to, a failed launch or relaunch, a version mismatch or the relaunched browser's exit stops the run with exit 2,
 * keeping the lines of the snapshots that finished and deleting no orphan. So does a failed download, and an orphan
 * that can't be deleted. A browser that can't start its graphics process before the first capture says the machine
 * can't run the platform. The workers' sessions and the browsers are always closed.
 *
 * A run that finishes ends stderr with a warning for each Storybook, in config order, whose captured snapshots'
 * `completing` render steps took a median of 50 ms or more: it seems to ignore the test path. For `update` on Windows,
 * stderr ends with one more warning when a baseline it wrote has a path longer than 260 characters: it names each such
 * path and the git setting `core.longpaths`. The warnings never change the exit code.
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
  const visualDiff = createVisualDiff()
  const tools: SnapshotTools =
    run.command === 'test'
      ? { command: 'test', visualDiff, reportFolder: reportFolderOf(run.config.path), retries: run.config.retries }
      : { command: 'update', visualDiff }
  let snapshots: PlannedSnapshots | undefined
  let orphans: StorybookOrphans[] = []
  let deleted: string[] = []

  try {
    const plan = await planSnapshots(run.selections, browser.readOptions, run.config)

    if ('problem' in plan) {
      return { exitCode: 2, stdout: '', stderr: `${exitNoticeOf(browser.firstExit())}${plan.problem}\n` }
    }

    let taken = plan.snapshots.filter(({ selected }) => selected)

    if (tools.command === 'test') {
      await clearReport(tools.reportFolder)
    } else {
      const storybooks = run.selections.map(({ storybook }) => storybook)
      const update = await planUpdate(storybooks, plan.snapshots, tools.visualDiff, run.workers)

      taken = update.snapshots
      orphans = update.orphans
    }

    snapshots = plannedSnapshotsOf(run, taken)
    await takeSnapshots(run, browser, snapshots, tools)
    deleted = await deleteStorybookOrphans(orphans)
  } catch (error) {
    const message = stopMessageOf(error, run, capturedAnyOf(snapshots))

    if (message === undefined) {
      throw error
    }

    const stdout = snapshots === undefined ? '' : printedOf(snapshots, linesOf(snapshots))

    return { exitCode: 2, stdout, stderr: `${exitNoticeOf(browser.firstExit())}${message}` }
  } finally {
    try {
      await browser.close()
    } finally {
      await tools.visualDiff.close()
    }
  }

  return {
    exitCode: exitCodeOf(run.command, snapshots),
    stdout: printedOf(snapshots, [...linesOf(snapshots), ...endLinesOf(run, snapshots, deleted)]),
    stderr:
      exitNoticeOf(browser.firstExit()) +
      testPathWarningsOf(run.selections, snapshots.items, snapshots.results) +
      longPathWarningsOf(run, snapshots),
  }
}
