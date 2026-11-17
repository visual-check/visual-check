import { dirname } from 'node:path'
import { baselinePathOf } from '../baselines/baseline-files.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import { brokenImageTimeLimitMs, type CaptureSettings } from '../capture/capture-session.js'
import { runWorkerPool } from '../capture/worker-pool.js'
import type { ResolvedConfig, ResolvedStorybook } from '../config/resolve-config.js'
import type { ReportWarning } from '../report/report-document.js'
import { ReportError, reportFolderOf } from '../report/report-folder.js'
import type { Shard } from '../sharding/shard.js'
import type { Story } from '../storybook/read-stories.js'
import { testPathWarningOf } from '../storybook/test-path.js'
import { createVisualDiff } from '../visual-diff/visual-diff.js'
import type { BrowserPlace } from './browser-route.js'
import { hasOrphans, type StorybookBaselines } from './consistency-check.js'
import type { LaunchBrowser } from './launch-browser.js'
import { networkWarningsOf, warningsTextOf } from './network-warning.js'
import { type PlannedSnapshot, planSnapshots } from './plan-snapshots.js'
import { type RunBrowser, runBrowserOf } from './run-browser.js'
import { snapshotCountOf, snapshotLineOf, snapshotNameOf } from './run-output.js'
import type { RunFindings } from './run-report.js'
import { type ShardShare, shardHeaderPartOf, shardNotesOf, shardShareOf } from './shard-share.js'
import type { CaptureStory, SnapshotResult, SnapshotStatus } from './snapshot-result.js'
import { crashOf, exitNoticeOf, stopMessageOf } from './stop-message.js'
import { type SnapshotTools, takeSnapshot } from './take-snapshot.js'
import { type Taking, testPlanOf } from './test-plan.js'
import {
  type DeletedBaseline,
  deleteStorybookOrphans,
  longPathWarningOf,
  planUpdate,
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
   * Whether the run is in CI, where `test` stops before capturing when the consistency check finds anything.
   */
  ci: boolean
  /**
   * Whether the run is `test --consistency`: it runs the consistency check and captures nothing. Always `false` for
   * `update`.
   */
  consistencyOnly: boolean
  /**
   * The shard `test --shard` runs, which takes only its share of the stories files and runs no consistency check, or
   * `undefined` for a run that isn't sharded. Always `undefined` for `update` and `test --consistency`.
   */
  shard: Shard | undefined
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
   * How long after the capture session asks whether to capture a snapshot's page again, right after the first capture
   * and the reading of its hosts, `update` captures the page again, to check it isn't still changing, in ms. `test`
   * never captures a page again.
   */
  recaptureDelayMs: number
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
 * What a run that finished, or stopped after its consistency check, printed, how it exits and what it found.
 */
interface SnapshotRunEnd {
  /**
   * The exit code: 0 or 1.
   */
  exitCode: number
  /**
   * The header, a shard's notes and one line per snapshot, then for `update` its counts, the path of each baseline
   * written and each orphan deleted and its flaky snapshots. `test`'s end block is built from its report. For a CI
   * `test` whose consistency check found anything, the consistency output, then a line that says why it captured
   * nothing. For `test --consistency`, the consistency output alone.
   */
  stdout: string
  /**
   * When the first browser exited mid-run, that it exited, whether visual-check relaunches it once, and its last output.
   * Then a warning for each Storybook that seems to ignore the test path, then for `update` the hosts its stories
   * reach. A CI `test` that stopped before capturing gives only the notice of the exit. Nothing for a run that went on
   * with no exit and no warning.
   */
  stderr: string
  /**
   * What the run found, for the report: the snapshots it took and their results, each Storybook's orphans, and for
   * `update` the baselines it deleted and its warnings, or for a `test` that stopped after its consistency check what
   * the check found.
   */
  findings: RunFindings
  /**
   * Whether the run stopped after its consistency check without capturing: `test --consistency`, or a CI `test` whose
   * check found anything. Its stdout is the consistency output, and it gets no end block.
   */
  checkedOnly: boolean
}

/**
 * What a run that stopped with exit 2 printed, and what stopped it.
 */
interface SnapshotRunStop {
  /**
   * The exit code: 2.
   */
  exitCode: 2
  /**
   * The header and the lines of the snapshots that finished before the stop. Nothing when the run stopped before any
   * capture, while it planned the snapshots or checked the baselines folders.
   */
  stdout: string
  /**
   * When the first browser exited mid-run, that it exited, whether visual-check relaunches it once, and its last
   * output, then what stopped the run: a problem visual-check knows, or the stack trace of an error that is a bug.
   */
  stderr: string
  /**
   * What stopped the run, for the report: the problem, as stderr ends with it, or the error's message.
   */
  stopMessage: string
  /**
   * Whether the report folder is what failed, such as a snapshot's images that couldn't be written, so no report can be
   * written there.
   */
  reportFailed: boolean
}

/**
 * What a run printed and how it exits: a run that finished, or stopped after its consistency check, or one that
 * stopped with exit 2.
 */
type SnapshotRunResult = SnapshotRunEnd | SnapshotRunStop

/**
 * Per command, the statuses that make the run exit 1.
 */
const failingStatuses: Record<SnapshotRun['command'], readonly SnapshotStatus[]> = {
  test: ['differs', 'broken', 'missing'],
  update: ['broken'],
}

/**
 * The heading `update`'s flaky snapshots are listed under.
 */
const updateFlakyHeading = 'Flaky snapshots, whose loads disagreed:'

/**
 * The snapshots a run takes, and what became of each so far.
 */
interface PlannedSnapshots {
  /**
   * The header.
   */
  header: string
  /**
   * The notes printed after the header, before any snapshot line: a shard's, else none.
   */
  notes: string[]
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
 * A shard's share of the run, with each Storybook narrowed to the shard's stories files.
 */
type RunShare = ShardShare<StorybookSelection>

/**
 * Builds the header: the CLI's version, the command, for a shard which one it is and how many stories files it was
 * dealt, how many snapshots the run takes and how many workers it runs.
 */
function headerOf(run: SnapshotRun, share: RunShare | undefined, count: number): string {
  const snapshots = snapshotCountOf(count)
  const workers = `${run.workers} ${run.workers === 1 ? 'worker' : 'workers'}`

  return `visual-check ${run.version} · ${run.command}${shardHeaderPartOf(share)} · ${snapshots} · ${workers}`
}

/**
 * Builds the session's settings from the config. Only `update` lists the hosts a story reaches.
 */
function captureSettingsOf(run: SnapshotRun): CaptureSettings {
  const { config } = run

  return {
    readyTimeoutMs: config.readyTimeout,
    timezone: config.timezone,
    locale: config.locale,
    colorScheme: config.colorScheme,
    maskColor: config.maskColor,
    listHosts: run.command === 'update',
    brokenImageTimeLimitMs,
  }
}

/**
 * Gives how many snapshots have the status.
 */
function countOf(statuses: readonly SnapshotStatus[], counted: SnapshotStatus): number {
  return statuses.filter((status) => status === counted).length
}

/**
 * Gives the warnings, for `update`, about the hosts its stories send real network requests to and the hosts whose
 * remote content they show, apart from the ones the config silences. Gives none for `test`. Broken snapshots reach no
 * host.
 */
function updateWarningsOf(run: SnapshotRun, snapshots: PlannedSnapshots): ReportWarning[] {
  if (run.command !== 'update') {
    return []
  }

  const taken = snapshots.items.flatMap(({ storybook, story }, index) => {
    const hosts = snapshots.results[index]?.hosts

    return hosts === undefined ? [] : [{ storybook: storybook.name, storyId: story.id, hosts }]
  })

  return networkWarningsOf(taken, run.config.silenceHosts)
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
 * Builds the lines that end a finished `update`'s output: the counts of written, deleted and kept baselines and broken
 * snapshots, then the path of each baseline written, in the snapshots' order, and of each orphan deleted, then the
 * flaky snapshots under its heading, when there are any.
 */
function updateEndOf(run: SnapshotRun, snapshots: PlannedSnapshots, deleted: readonly DeletedBaseline[]): string[] {
  const statuses = snapshots.results.flatMap((result) => (result === undefined ? [] : [result.status]))
  const summary = {
    written: writtenPathsOf(snapshots),
    deleted: deleted.map(({ path }) => path),
    kept: countOf(statuses, 'kept'),
    broken: countOf(statuses, 'broken'),
  }

  return [...updateEndLinesOf(run.cwd, summary), ...updateFlakyLinesOf(snapshots)]
}

/**
 * Gives the exit code: 1 when any snapshot has a failing status for the command, or for `test` when any Storybook's
 * baselines hold an orphan, else 0.
 */
function exitCodeOf(
  command: SnapshotRun['command'],
  snapshots: PlannedSnapshots,
  baselines: readonly StorybookBaselines[],
): number {
  const failed = snapshots.results.some(
    (result) => result !== undefined && failingStatuses[command].includes(result.status),
  )
  const orphaned = command === 'test' && hasOrphans(baselines)

  return failed || orphaned ? 1 : 0
}

/**
 * Plans what the run takes once the snapshots are planned: `testPlanOf` for `test`, and for `update` `planUpdate`,
 * which also checks that every baseline decodes.
 *
 * @throws {BaselineError} When a baselines folder can't be listed, a baseline's path can't be looked at, or for
 * `update` a baseline can't be read or decoded.
 */
async function takingOf(run: SnapshotRun, tools: SnapshotTools, planned: PlannedSnapshot[]): Promise<Taking> {
  if (tools.command === 'test') {
    return await testPlanOf(
      {
        version: run.version,
        cwd: run.cwd,
        ci: run.ci,
        consistencyOnly: run.consistencyOnly,
        sharded: run.shard !== undefined,
        storybooks: run.selections.map(({ storybook }) => storybook),
      },
      planned,
    )
  }

  const storybooks = run.selections.map(({ storybook }) => storybook)
  const update = await planUpdate(storybooks, planned, tools.visualDiff, run.workers)

  return { taken: update.snapshots, baselines: update.orphans }
}

/**
 * The statuses of a snapshot that holds a capture, as a broken or missing one doesn't.
 */
const capturedStatuses: readonly SnapshotStatus[] = ['passed', 'differs', 'written', 'kept']

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
 * Gives the planned snapshots with the header that counts them, a shard's notes, and no result yet.
 */
function plannedSnapshotsOf(run: SnapshotRun, share: RunShare | undefined, items: PlannedSnapshot[]): PlannedSnapshots {
  return {
    header: headerOf(run, share, items.length),
    notes: shardNotesOf(share, items.length),
    items,
    results: items.map(() => undefined),
  }
}

/**
 * Gives the line of each snapshot that has finished, in the snapshots' order: its mark, name and detail.
 */
function linesOf({ items, results }: PlannedSnapshots): string[] {
  return items.flatMap((item, index) => {
    const result = results[index]

    return result === undefined ? [] : [snapshotLineOf(item, result)]
  })
}

/**
 * Lists `update`'s flaky snapshots by name under their heading, in the snapshots' order, each indented by two spaces.
 * Gives no line when none is flaky.
 */
function updateFlakyLinesOf({ items, results }: PlannedSnapshots): string[] {
  const names = items.flatMap((item, index) => (results[index]?.flaky === true ? [`  ${snapshotNameOf(item)}`] : []))

  return names.length === 0 ? [] : [updateFlakyHeading, ...names]
}

/**
 * Writes the header, the notes and the lines, each ending with a newline.
 */
function printedOf(snapshots: PlannedSnapshots, lines: string[]): string {
  return [snapshots.header, ...snapshots.notes, ...lines].map((line) => `${line}\n`).join('')
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

    snapshots.results[index] = await takeSnapshot(item, captureStory, tools)
  })
}

/**
 * Reads every Storybook's per-story options before any capture, then takes the snapshots of every selected story that
 * isn't disabled with a pool of `workers` that share one browser: its default capture, then one snapshot per mode it
 * lists, each at its own viewport and with its mode's globals in the story's URL. It prints one line per snapshot after
 * the header, which counts them; a mode's line names the mode after the story ID. The lines follow config order, then
 * `index.json` order, then the story's default capture and its modes in order, whatever order the captures finish in.
 * Each snapshot has its own baseline, `<story-id>.png` for the default capture and `<story-id>.<mode>.png` for a mode,
 * a key over 240 bytes shortened to its first 223 bytes, `-` and 16 hex characters of its SHA-256. `test` compares each
 * snapshot with its baseline by the story's tolerance, at the viewport's device scale factor, and never captures a
 * missing baseline. It writes the baseline, snapshot and visual diff of each snapshot whose first capture differs to
 * the report folder, `.visual-check/report` beside the config file, which `runCli` has cleared. A snapshot that differs
 * is captured again, up to the config's `retries` more times; one that passes on a retry passes, flaky, and its line
 * ends with `· flaky`. One that still differs by pixels on its first capture and its last retry, with every differing
 * pixel of the last retry inside its remote content, give or take the device scale factor rounded up, gets a hint that
 * names those hosts, which the report lists. The hint never changes the exit code. A flaky snapshot never fails the
 * run. `test`'s end block, with its failures, flaky snapshots and counts, is built by `runCli` from its report.
 *
 * Every `test` but a shard's runs the consistency check once the snapshots are planned, and `test --consistency` runs
 * only that check: `test-plan.ts` has the rules.
 *
 * A shard of `test --shard k/n` takes only its share of the stories files. Before anything is read or launched, it
 * lists each Storybook's baselines folder; one that can't be listed stops the run with exit 2, printing nothing on
 * stdout. It then splits the stories files that hold a selected story across the shards. Each Storybook is then
 * narrowed to the shard's files, its selected stories and the stories its options read covers alike, so a Storybook
 * with no file in the shard isn't read. A shard runs no consistency check. Its header names the shard and how many
 * stories files it was dealt, and is followed by a note that missing baselines and orphans are left to
 * `test --consistency`, then, when it takes no snapshot, a note that it has nothing to capture; such a shard exits 0. A
 * shard dealt no stories file launches no browser.
 *
 * `update` also takes every snapshot outside the selection whose baseline is missing, so it writes every missing
 * baseline of the Storybooks in the run. A story outside the selection whose stories file didn't load is taken, and
 * broken, when its default baseline is missing, and left out when it's there. Before any capture, it lists each
 * Storybook's baselines folder, where only `.png` files count, and decodes each of them; the first one that can't be
 * listed or decoded, in config order then file name order, stops the run with exit 2, printing nothing on stdout. It
 * compares each snapshot's first capture with its baseline as `test` does. A baseline within tolerance stays untouched,
 * even when its bytes differ, after one load and one capture. A baseline that is missing or differs beyond tolerance or
 * in size is written only once the story renders the same way twice, each check by the story's own tolerance, a size
 * difference counting as a difference. First, the same page is captured again `recaptureDelayMs` after the capture
 * session asks for it, right after the first capture and the reading of its hosts, so at least that long after the
 * first capture, which isn't delayed; when the two differ, the story is broken, `changed-after-capture`, and its line
 * points to the wait hook. Then the story is loaded a second time. A second load within tolerance of a baseline the
 * first differed from leaves that baseline untouched, kept and flaky. A second load that agrees with the first is
 * written. Otherwise a third load decides: the later of two loads that agree is written, flaky, and when no two agree,
 * the story is broken, `unstable`. So `update` makes at most 3 loads of a snapshot, not counting the capture session's
 * own retries of a story that navigates away, whatever `retries` says, and a broken story writes nothing. A flaky
 * snapshot's line ends with `· flaky`. Once every snapshot is taken, it deletes the orphans: the baselines that no
 * planned snapshot calls for, selected or not, apart from any that could belong to a story whose stories file didn't
 * load. An orphan the file system takes for an expected baseline is that baseline, so it stays. Its counts are of
 * written, deleted and kept baselines and broken snapshots, followed by the path of each baseline written and each
 * orphan deleted, then its flaky snapshots by name under a heading of their own, when there are any. A flaky snapshot
 * never fails `update`. `update` never touches the report folder.
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
 * Planning also stops the run with exit 2, before anything is captured, on two snapshots of one Storybook whose
 * baselines would be one file, selected or not, and on a shard only among its own stories files. Outside a shard,
 * that's before any baselines folder is listed. Stderr names the first such pair in each Storybook, in config order.
 *
 * When the browser exits, every story in flight is broken, `browser-exited`, the browser is relaunched once at the next
 * read or story that needs it, and the run goes on; stderr then says so, with the browser's last output, whatever the
 * run exits with. A baseline that can't be read, decoded or written, a report folder that can't be written to, a failed
 * launch or relaunch, a version mismatch or the relaunched browser's exit stops the run with exit 2, keeping the lines
 * of the snapshots that finished and deleting no orphan. So does a failed download, and an orphan that can't be
 * deleted. A browser that can't start its graphics process before the first capture says the machine can't run the
 * platform. The workers' sessions and the browsers are always closed.
 *
 * A run that finishes ends stderr with a warning for each Storybook, in config order, whose captured snapshots'
 * `completing` render steps took a median of 50 ms or more: it seems to ignore the test path. For `update` on Windows,
 * stderr ends with one more warning when a baseline it wrote has a path longer than 260 characters: it names each such
 * path and the git setting `core.longpaths`. A finished `update` ends stderr with one more block: a line for each host
 * its stories sent real network requests to, then a line for each host whose remote content they show, each kind
 * sorted by host name, with the count and the first three IDs of the stories that reach it. A story whose snapshot was
 * written or kept counts once however many modes it has, and a broken one counts for nothing. The config's
 * `silenceHosts` leaves both kinds of host out. Only `update` watches requests: `test` never does and prints no such
 * block. The warnings never change the exit code.
 *
 * Any other error, an error that is a bug, stops the run with exit 2 too, after closing the sessions and the browsers,
 * with its stack trace on stderr after the lines printed so far.
 */
export async function runSnapshots(run: SnapshotRun): Promise<SnapshotRunResult> {
  const browser = runBrowserOf(run.launchBrowser, {
    browserPackage: run.browserPackage,
    configImage: run.config.image,
    place: run.place,
    settings: captureSettingsOf(run),
    environment: run.environment,
    progress: run.progress,
  })
  const visualDiff = createVisualDiff()
  const tools: SnapshotTools =
    run.command === 'test'
      ? { command: 'test', visualDiff, reportFolder: reportFolderOf(run.config.path), retries: run.config.retries }
      : { command: 'update', visualDiff, recaptureDelayMs: run.recaptureDelayMs }
  let snapshots: PlannedSnapshots | undefined
  let baselines: StorybookBaselines[] = []
  let deleted: DeletedBaseline[] = []

  try {
    const share =
      run.shard === undefined ? undefined : await shardShareOf(run.selections, dirname(run.config.path), run.shard)

    const plan = await planSnapshots(share?.selections ?? run.selections, browser.readOptions, run.config)

    if ('problem' in plan) {
      const stopMessage = `${plan.problem}\n`

      return {
        exitCode: 2,
        stdout: '',
        stderr: `${exitNoticeOf(browser.firstExit())}${stopMessage}`,
        stopMessage,
        reportFailed: false,
      }
    }

    const taking = await takingOf(run, tools, plan.snapshots)

    if ('stopped' in taking) {
      return { ...taking.stopped, stderr: exitNoticeOf(browser.firstExit()), checkedOnly: true }
    }

    baselines = taking.baselines
    snapshots = plannedSnapshotsOf(run, share, taking.taken)
    await takeSnapshots(run, browser, snapshots, tools)

    if (tools.command === 'update') {
      deleted = await deleteStorybookOrphans(baselines)
    }
  } catch (error) {
    const stopMessage = stopMessageOf(error, run, capturedAnyOf(snapshots))
    // An error that is a bug stops the run too, keeping the lines printed so far, with its stack trace.
    const stop = stopMessage === undefined ? crashOf(error) : { stderr: stopMessage, message: stopMessage }
    const stdout = snapshots === undefined ? '' : printedOf(snapshots, linesOf(snapshots))

    return {
      exitCode: 2,
      stdout,
      stderr: `${exitNoticeOf(browser.firstExit())}${stop.stderr}`,
      stopMessage: stop.message,
      reportFailed: error instanceof ReportError,
    }
  } finally {
    try {
      await browser.close()
    } finally {
      await tools.visualDiff.close()
    }
  }

  const warnings = updateWarningsOf(run, snapshots)

  return {
    exitCode: exitCodeOf(run.command, snapshots, baselines),
    // test's end block is built by runCli from its report.
    stdout: printedOf(snapshots, [
      ...linesOf(snapshots),
      ...(run.command === 'update' ? updateEndOf(run, snapshots, deleted) : []),
    ]),
    stderr:
      exitNoticeOf(browser.firstExit()) +
      testPathWarningsOf(run.selections, snapshots.items, snapshots.results) +
      longPathWarningsOf(run, snapshots) +
      warningsTextOf(warnings),
    findings: { items: snapshots.items, results: snapshots.results, baselines, deleted, warnings },
    checkedOnly: false,
  }
}
