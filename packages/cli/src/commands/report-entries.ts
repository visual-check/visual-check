import { basename } from 'node:path'
import { baselinePathOf, stemOfFileName } from '../baselines/baseline-files.js'
import type { BrokenReason, BrokenStory } from '../capture/capture-session.js'
import type { ConsoleMessage } from '../capture/driver/driver.js'
import type { Tolerance } from '../config/define-config.js'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import { displayPathOf } from '../report/display-path.js'
import type {
  ReportBrokenDetails,
  ReportBrokenReason,
  ReportConsoleLevel,
  ReportConsoleMessage,
  ReportEntryFields,
  ReportHint,
  ReportImages,
  ReportPixels,
  ReportSize,
  TestReportCounts,
  TestReportEntry,
  UpdateReportCounts,
  UpdateReportEntry,
} from '../report/report-document.js'
import { failedLoadsHintMessageOf } from './failed-loads-hint.js'
import type { PlannedSnapshot } from './plan-snapshots.js'
import { remoteContentHintMessageOf } from './remote-content-hint.js'
import type { ReportedComparison, SnapshotResult, SnapshotStatus } from './snapshot-result.js'

/**
 * The report's code for each reason a story is broken: the same code. It fails to compile when the capture has a reason
 * the report lacks, or the map misses or keeps one the capture doesn't have.
 */
export const reportReasons: Record<BrokenReason, ReportBrokenReason> = {
  'load-failed': 'load-failed',
  error: 'error',
  'play-threw': 'play-threw',
  timeout: 'timeout',
  'fonts-not-loaded': 'fonts-not-loaded',
  'wait-threw': 'wait-threw',
  'navigated-away': 'navigated-away',
  crashed: 'crashed',
  'too-tall': 'too-tall',
  'element-missing': 'element-missing',
  'grid-too-wide': 'grid-too-wide',
  overflows: 'overflows',
  'browser-exited': 'browser-exited',
  'changed-after-capture': 'changed-after-capture',
  unstable: 'unstable',
}

/**
 * The console level of each kind of console message. Uncaught errors and unhandled rejections are errors.
 */
const consoleLevels: Record<ConsoleMessage['kind'], ReportConsoleLevel> = {
  'console.debug': 'debug',
  'console.info': 'info',
  'console.log': 'log',
  'console.warn': 'warn',
  'console.error': 'error',
  error: 'error',
  unhandledrejection: 'error',
}

/**
 * What the text of each kind of console message starts with in the report.
 */
const consolePrefixes: Record<ConsoleMessage['kind'], string> = {
  'console.debug': '',
  'console.info': '',
  'console.log': '',
  'console.warn': '',
  'console.error': '',
  error: 'Uncaught ',
  unhandledrejection: 'Unhandled rejection: ',
}

/**
 * An entry's status and reason, kept together by status.
 */
type VerdictOf<Entry extends { status: unknown; reason: unknown }> = Entry extends unknown
  ? Pick<Entry, 'status' | 'reason'>
  : never

/**
 * The fields an entry starts with, before its status and reason.
 */
type EntryHead = Pick<ReportEntryFields, 'storybook' | 'id' | 'kind' | 'story' | 'importPath' | 'mode'>

/**
 * The fields an entry ends with, after its status and reason.
 */
type EntryTail = Omit<ReportEntryFields, keyof EntryHead>

/**
 * An `update` entry's hosts, after its other fields.
 */
type EntryHosts = Pick<UpdateReportEntry, 'realRequestHosts' | 'remoteContentHosts'>

/**
 * One snapshot of the addon's Update, in the report's shape. Unlike `update`'s document, it lists a baseline kept
 * because the capture was identical to it, and one rewritten within tolerance.
 *
 * @public
 */
export type StoryUpdateEntry = ReportEntryFields &
  EntryHosts &
  (
    | { status: 'written'; reason: 'missing' | 'differs' | 'within-tolerance' }
    | { status: 'kept'; reason: null }
    | { status: 'broken'; reason: ReportBrokenReason }
  )

/**
 * No images.
 */
const noImages: ReportImages = { baseline: null, snapshot: null, diff: null }

/**
 * Whether the report lists a snapshot: anything but a plain pass and a baseline `update` kept, or a flaky pass.
 */
export function isListed(result: SnapshotResult): boolean {
  if (result.status === 'passed') {
    return result.flaky === true
  }

  return result.status !== 'kept'
}

/**
 * Gives the report's pixels of a comparison that differed, with the budget exactly as the tolerance writes it.
 */
export function pixelsOf(comparison: ReportedComparison, tolerance: Required<Tolerance>, scale: number): ReportPixels {
  return { differ: comparison.differ, allowed: comparison.allowed, budget: tolerance.pixels, scale }
}

/**
 * Gives both sizes of a size difference, as `[width, height]`. Gives `null` for a difference in pixels.
 */
export function sizeOf(comparison: ReportedComparison): ReportSize | null {
  if (comparison.reason !== 'size') {
    return null
  }

  const { baselineSize, snapshotSize } = comparison

  return { baseline: [baselineSize.width, baselineSize.height], snapshot: [snapshotSize.width, snapshotSize.height] }
}

/**
 * Gives a broken story's details, with only the keys its reason has, in the document's order. `play`'s message is the
 * error as Storybook described it, or the broken story's message when it described none. A load that failed with no
 * error, or failed rather than timed out, leaves the missing one out.
 */
export function detailsOf(broken: BrokenStory): ReportBrokenDetails {
  switch (broken.reason) {
    case 'navigated-away':
      return { url: broken.url }
    case 'play-threw':
      return { play: { message: broken.errorText === '' ? broken.message : broken.errorText, stack: broken.stack } }
    case 'timeout':
      return { timeoutMs: broken.readyTimeoutMs }
    case 'fonts-not-loaded':
      return { timeoutMs: broken.readyTimeoutMs, pendingFonts: broken.faces }
    case 'too-tall':
      return { size: [broken.size.width, broken.size.height] }
    case 'grid-too-wide':
      return { grid: { width: broken.grid.width, viewportWidth: broken.grid.viewportWidth } }
    case 'overflows': {
      const { area, top, right, bottom, left, viewportWidth } = broken.overflow

      return { overflow: { area, top, right, bottom, left, viewportWidth } }
    }
    case 'load-failed':
      return {
        ...(broken.readyTimeoutMs === undefined ? {} : { timeoutMs: broken.readyTimeoutMs }),
        ...(broken.loadError === undefined ? {} : { loadError: broken.loadError }),
      }
    default:
      return {}
  }
}

/**
 * Gives the report's console messages: each kind as its level, an uncaught error's text prefixed `Uncaught ` and an
 * unhandled rejection's `Unhandled rejection: `.
 */
export function consoleOf(messages: readonly ConsoleMessage[]): ReportConsoleMessage[] {
  return messages.map(({ kind, text }) => ({ level: consoleLevels[kind], text: `${consolePrefixes[kind]}${text}` }))
}

/**
 * Gives a result's value that its status always carries.
 *
 * @throws {Error} When the result lacks it, which the commands rule out.
 */
function carried<Value>(value: Value | undefined, status: SnapshotStatus, what: string): Value {
  if (value === undefined) {
    throw new Error(`A ${status} result carries ${what}.`)
  }

  return value
}

/**
 * Gives the first fields of a planned snapshot's entry.
 */
function headOf(item: PlannedSnapshot): EntryHead {
  return {
    storybook: item.storybook.name,
    id: item.key,
    kind: 'story',
    story: item.story.id,
    importPath: item.story.importPath,
    mode: item.mode ?? null,
  }
}

/**
 * Gives the first fields of a baseline's entry when no story calls for it: its stem as the id, and no story.
 */
function baselineHeadOf(storybook: ResolvedStorybook, path: string): EntryHead {
  return {
    storybook: storybook.name,
    id: stemOfFileName(basename(path)),
    kind: 'story',
    story: null,
    importPath: null,
    mode: null,
  }
}

/**
 * Gives a result's hints: the remote content one when it differs only inside remote content, then the failed loads one
 * when its story broke on a page that couldn't load some of Storybook's own files.
 */
function hintsOf(result: SnapshotResult): ReportHint[] {
  const { hintHosts } = result
  const files = result.broken?.failedLoads ?? []

  return [
    ...(hintHosts === undefined
      ? []
      : [{ kind: 'remote-content' as const, hosts: hintHosts, message: remoteContentHintMessageOf(hintHosts) }]),
    ...(files.length === 0 ? [] : [{ kind: 'failed-loads' as const, files, message: failedLoadsHintMessageOf() }]),
  ]
}

/**
 * Gives the last fields of a snapshot's entry from its result, with `message`.
 */
function tailOf(item: PlannedSnapshot, result: SnapshotResult, configFolder: string, message: string): EntryTail {
  const { comparison } = result

  return {
    message,
    flaky: result.flaky === true,
    attempts: result.attempts,
    pixels:
      comparison === undefined || !('tolerance' in item)
        ? null
        : pixelsOf(comparison, item.tolerance, item.viewport.deviceScaleFactor),
    size: comparison === undefined ? null : sizeOf(comparison),
    details: result.broken === undefined ? null : detailsOf(result.broken),
    hints: hintsOf(result),
    console: consoleOf(result.console ?? []),
    baseline: displayPathOf(configFolder, baselinePathOf(item.storybook.baselines, item.key)),
    images: result.images ?? noImages,
  }
}

/**
 * Gives the last fields of an entry for a baseline no story calls for, with `message` and its images.
 */
function baselineTailOf(path: string, configFolder: string, message: string, images: ReportImages): EntryTail {
  return {
    message,
    flaky: false,
    attempts: 0,
    pixels: null,
    size: null,
    details: null,
    hints: [],
    console: [],
    baseline: displayPathOf(configFolder, path),
    images,
  }
}

/**
 * Gives a broken result's status, reason and message.
 */
function brokenVerdictOf(result: SnapshotResult): [{ status: 'broken'; reason: ReportBrokenReason }, string] {
  const broken = carried(result.broken, result.status, 'its broken story')

  return [{ status: 'broken', reason: reportReasons[broken.reason] }, broken.message]
}

/**
 * Gives a `test` result's status, reason and message.
 *
 * @throws {Error} When the result is `update`'s, or lacks what its status carries.
 */
function testVerdictOf(result: SnapshotResult): [VerdictOf<TestReportEntry>, string] {
  switch (result.status) {
    case 'passed': {
      if (result.flaky !== true) {
        return [{ status: 'passed', reason: null }, 'Passed.']
      }

      const { message } = carried(result.comparison, result.status, 'its first comparison')

      return [
        { status: 'passed', reason: null },
        `Passed on retry ${result.attempts - 1} after its first capture differed: ${message}`,
      ]
    }

    case 'differs': {
      const { reason, message } = carried(result.comparison, result.status, 'its comparison')

      return [{ status: 'differs', reason }, message]
    }

    case 'missing':
      return [{ status: 'missing', reason: null }, 'No baseline yet. Run visual-check update to write it.']
    case 'broken':
      return brokenVerdictOf(result)
    default:
      throw new Error(`A test report has no ${result.status} snapshot.`)
  }
}

/**
 * Gives a written result's status, reason and message: written for a missing baseline, over one that differed, or over
 * one within tolerance.
 *
 * @throws {Error} When the result lacks what its status carries.
 */
function writtenVerdictOf(result: SnapshotResult): [VerdictOf<StoryUpdateEntry> & { status: 'written' }, string] {
  const writtenFor = carried(result.writtenFor, result.status, 'why it was written')

  switch (writtenFor) {
    case 'missing':
      return [{ status: 'written', reason: 'missing' }, 'Written: missing']
    case 'within-tolerance':
      return [{ status: 'written', reason: 'within-tolerance' }, 'Written: within tolerance']
    default: {
      const { message } = carried(result.comparison, result.status, 'its first comparison')

      return [{ status: 'written', reason: 'differs' }, `Written: differs: ${message}`]
    }
  }
}

/**
 * Gives an `update` result's status, reason and message.
 *
 * @throws {Error} When the result is `test`'s, a kept baseline or one written within tolerance, or lacks what its
 * status carries.
 */
function updateVerdictOf(result: SnapshotResult): [VerdictOf<UpdateReportEntry>, string] {
  switch (result.status) {
    case 'written': {
      const [{ reason }, message] = writtenVerdictOf(result)

      if (reason === 'within-tolerance') {
        throw new Error('An update report has no snapshot written within tolerance.')
      }

      return [{ status: 'written', reason }, message]
    }

    case 'broken':
      return brokenVerdictOf(result)
    default:
      throw new Error(`An update report has no ${result.status} snapshot.`)
  }
}

/**
 * Gives the status, reason and message of a result of the addon's Update.
 *
 * @throws {Error} When the result is `test`'s, or lacks what its status carries.
 */
function storyUpdateVerdictOf(result: SnapshotResult): [VerdictOf<StoryUpdateEntry>, string] {
  switch (result.status) {
    case 'written':
      return writtenVerdictOf(result)
    case 'kept':
      return [{ status: 'kept', reason: null }, 'Untouched: identical, byte for byte']
    case 'broken':
      return brokenVerdictOf(result)
    default:
      throw new Error(`The addon's Update has no ${result.status} snapshot.`)
  }
}

/**
 * Gives a `test` snapshot's entry, with its baseline's path relative to `configFolder`.
 *
 * @throws {Error} When the result is `update`'s, or lacks what its status carries.
 */
export function testEntryOf(item: PlannedSnapshot, result: SnapshotResult, configFolder: string): TestReportEntry {
  const [verdict, message] = testVerdictOf(result)

  return { ...headOf(item), ...verdict, ...tailOf(item, result, configFolder, message) }
}

/**
 * Gives an orphan's entry: the baseline at `path`, which no story calls for, with its stem as the id, no story, and
 * `image` as its copied baseline, relative to the report folder, or `null` when it wasn't copied.
 */
export function orphanEntryOf(
  storybook: ResolvedStorybook,
  path: string,
  configFolder: string,
  image: string | null,
): TestReportEntry {
  const baseline = displayPathOf(configFolder, path)
  const message = `No story calls for ${baseline}. Run visual-check update to delete it.`

  return {
    ...baselineHeadOf(storybook, path),
    status: 'orphan',
    reason: null,
    ...baselineTailOf(path, configFolder, message, { ...noImages, baseline: image }),
  }
}

/**
 * Gives the hosts of an `update` entry: the ones its first load reached, none when it didn't capture.
 */
function hostsOf(result: SnapshotResult | undefined): EntryHosts {
  return {
    realRequestHosts: result?.hosts?.requests ?? [],
    remoteContentHosts: result?.hosts?.remoteContent ?? [],
  }
}

/**
 * Gives an `update` snapshot's entry, with its baseline's path relative to `configFolder` and the hosts of its first
 * load.
 *
 * @throws {Error} When the result is `test`'s or a kept baseline, or lacks what its status carries.
 */
export function updateEntryOf(item: PlannedSnapshot, result: SnapshotResult, configFolder: string): UpdateReportEntry {
  const [verdict, message] = updateVerdictOf(result)

  return { ...headOf(item), ...verdict, ...tailOf(item, result, configFolder, message), ...hostsOf(result) }
}

/**
 * Gives a snapshot's entry of the addon's Update, with its baseline's path relative to `configFolder` and the hosts of
 * its first load.
 *
 * @throws {Error} When the result is `test`'s, or lacks what its status carries.
 */
export function storyUpdateEntryOf(
  item: PlannedSnapshot,
  result: SnapshotResult,
  configFolder: string,
): StoryUpdateEntry {
  const [verdict, message] = storyUpdateVerdictOf(result)

  return { ...headOf(item), ...verdict, ...tailOf(item, result, configFolder, message), ...hostsOf(result) }
}

/**
 * Gives a deleted orphan's entry: the baseline at `path`, with its stem as the id and no story.
 */
export function deletedEntryOf(storybook: ResolvedStorybook, path: string, configFolder: string): UpdateReportEntry {
  return {
    ...baselineHeadOf(storybook, path),
    status: 'deleted',
    reason: null,
    ...baselineTailOf(path, configFolder, 'Deleted: no story calls for it.', noImages),
    ...hostsOf(undefined),
  }
}

/**
 * Gives how many results have the status.
 */
function countOf(results: readonly SnapshotResult[], status: SnapshotStatus): number {
  return results.filter((result) => result.status === status).length
}

/**
 * Gives how many results are flaky.
 */
function flakyCountOf(results: readonly SnapshotResult[]): number {
  return results.filter((result) => result.flaky === true).length
}

/**
 * Counts a `test` run's results and its `orphans`, the flaky passes among the passed.
 */
export function testCountsOf(results: readonly SnapshotResult[], orphans: number): TestReportCounts {
  return {
    passed: countOf(results, 'passed'),
    flaky: flakyCountOf(results),
    differs: countOf(results, 'differs'),
    broken: countOf(results, 'broken'),
    missing: countOf(results, 'missing'),
    orphan: orphans,
  }
}

/**
 * Counts an `update` run's results and its `deleted` baselines, the flaky ones among the written and kept.
 */
export function updateCountsOf(results: readonly SnapshotResult[], deleted: number): UpdateReportCounts {
  return {
    written: countOf(results, 'written'),
    deleted,
    kept: countOf(results, 'kept'),
    broken: countOf(results, 'broken'),
    flaky: flakyCountOf(results),
  }
}
