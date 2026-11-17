/**
 * The report document's version: a whole number, starting at 1.
 *
 * @public
 */
export const reportVersion = 1

/**
 * The report folder, relative to the config file's folder, with `/` on every OS.
 *
 * @public
 */
export const reportDir = '.visual-check/report'

/**
 * Why a story is broken: the codes of the readiness and stability rules.
 *
 * @public
 */
export type ReportBrokenReason =
  | 'load-failed'
  | 'error'
  | 'play-threw'
  | 'timeout'
  | 'fonts-not-loaded'
  | 'wait-threw'
  | 'navigated-away'
  | 'element-missing'
  | 'too-tall'
  | 'grid-too-wide'
  | 'crashed'
  | 'browser-exited'
  | 'changed-after-capture'
  | 'unstable'

/**
 * Why a snapshot differs from its baseline: more pixels than allowed, or another size.
 *
 * @public
 */
export type ReportDiffReason = 'pixels' | 'size'

/**
 * A Storybook of the run.
 *
 * @public
 */
export interface ReportStorybook {
  /**
   * The Storybook's name.
   */
  name: string
  /**
   * The Storybook's URL.
   */
  url: string
}

/**
 * The shard a `test` run covered.
 *
 * @public
 */
export interface ReportShard {
  /**
   * The shard's number, from 1.
   */
  index: number
  /**
   * How many shards there are.
   */
  total: number
}

/**
 * How the run picked its stories.
 *
 * @public
 */
export interface ReportSelection {
  /**
   * What picked them: affected stories, every story, or a filter.
   */
  by: 'affected' | 'all' | 'filter'
  /**
   * The git base the changes were measured from, or `null` when affected stories didn't pick them.
   */
  base: string | null
  /**
   * The changed files, or `null` when affected stories didn't pick the stories.
   */
  changedFiles: string[] | null
  /**
   * Whether the selection couldn't be worked out and every story was selected, or `null` when affected stories didn't
   * pick the stories.
   */
  fallback: boolean | null
}

/**
 * How many pixels differ, and how many are allowed.
 *
 * @public
 */
export interface ReportPixels {
  /**
   * The pixels that differ.
   */
  differ: number
  /**
   * The pixels allowed to differ, in device pixels.
   */
  allowed: number
  /**
   * The budget as written: a count, or a percentage such as `"0.1%"`.
   */
  budget: number | `${number}%`
  /**
   * The device scale factor of the capture.
   */
  scale: number
}

/**
 * The baseline's and the snapshot's sizes of a size difference, each as `[width, height]` in device pixels.
 *
 * @public
 */
export interface ReportSize {
  /**
   * The baseline's size.
   */
  baseline: [number, number]
  /**
   * The snapshot's size.
   */
  snapshot: [number, number]
}

/**
 * A broken story's details. Only the keys that apply to its reason are present.
 *
 * @public
 */
export interface ReportBrokenDetails {
  /**
   * The URL a story navigated away to.
   */
  url?: string
  /**
   * What `play` threw: the message and the first 5 stack lines.
   */
  play?: {
    /**
     * The message `play` threw with.
     */
    message: string
    /**
     * The first 5 lines of its stack.
     */
    stack: string[]
  }
  /**
   * The timeout that passed, in milliseconds.
   */
  timeoutMs?: number
  /**
   * The size of a page that was too tall, as `[width, height]` in device pixels.
   */
  size?: [number, number]
  /**
   * The font faces still pending.
   */
  pendingFonts?: string[]
  /**
   * A grid's width and the viewport's.
   */
  grid?: {
    /**
     * The grid's width, in CSS pixels.
     */
    width: number
    /**
     * The viewport's width, in CSS pixels.
     */
    viewportWidth: number
  }
  /**
   * The error a stories file failed to load with.
   */
  loadError?: string
}

/**
 * A hint on a failure.
 *
 * @public
 */
export interface ReportHint {
  /**
   * What the hint is about: remote content, the only kind so far.
   */
  kind: 'remote-content'
  /**
   * The hosts the content came from.
   */
  hosts: string[]
  /**
   * The hint for people.
   */
  message: string
}

/**
 * The level of a console message.
 *
 * @public
 */
export type ReportConsoleLevel = 'debug' | 'info' | 'log' | 'warn' | 'error'

/**
 * A console message of a captured page.
 *
 * @public
 */
export interface ReportConsoleMessage {
  /**
   * The message's level.
   */
  level: ReportConsoleLevel
  /**
   * The message's text, cut to 500 characters.
   */
  text: string
}

/**
 * The paths of an entry's images, relative to the report folder, with `/`. `null` for an image the entry has none of.
 *
 * @public
 */
export interface ReportImages {
  /**
   * The baseline's image.
   */
  baseline: string | null
  /**
   * The snapshot's image. A broken story's image of its page is here.
   */
  snapshot: string | null
  /**
   * The visual diff.
   */
  diff: string | null
}

/**
 * What every entry holds, in the order of the document's fields.
 *
 * @public
 */
export interface ReportEntryFields {
  /**
   * The Storybook's name.
   */
  storybook: string
  /**
   * The snapshot's key, unique within a Storybook. An orphan's is its file's stem.
   */
  id: string
  /**
   * What the entry is of: a story, the only kind in v1.
   */
  kind: 'story'
  /**
   * The story's ID, or `null` for an orphan or a deleted baseline.
   */
  story: string | null
  /**
   * The story's stories file, or `null` for an orphan or a deleted baseline.
   */
  importPath: string | null
  /**
   * The mode, or `null` for the default capture.
   */
  mode: string | null
  /**
   * One line for people.
   */
  message: string
  /**
   * Whether it passed on a retry, or in `update` another load decided.
   */
  flaky: boolean
  /**
   * How many captures it took.
   */
  attempts: number
  /**
   * How many pixels the first capture of a snapshot that differs or passed on a retry differs by and how many are
   * allowed, otherwise `null`. On a size difference `differ` counts the padding too and can be at most `allowed`,
   * since the size alone makes it differ.
   */
  pixels: ReportPixels | null
  /**
   * The sizes of a size difference, otherwise `null`.
   */
  size: ReportSize | null
  /**
   * A broken story's details, otherwise `null`.
   */
  details: ReportBrokenDetails | null
  /**
   * The hints on a failure.
   */
  hints: ReportHint[]
  /**
   * The console messages of the capture whose images are listed.
   */
  console: ReportConsoleMessage[]
  /**
   * The baseline's path, relative to the config folder, with `/`.
   */
  baseline: string
  /**
   * The entry's images.
   */
  images: ReportImages
}

/**
 * An entry of a `test` report, by status.
 *
 * @public
 */
export type TestReportEntry = ReportEntryFields &
  (
    | {
        /**
         * It passed, maybe on a retry.
         */
        status: 'passed'
        /**
         * None for a pass.
         */
        reason: null
      }
    | {
        /**
         * It differs from its baseline beyond tolerance.
         */
        status: 'differs'
        /**
         * Whether pixels or the size made it differ.
         */
        reason: ReportDiffReason
      }
    | {
        /**
         * Its story is broken.
         */
        status: 'broken'
        /**
         * Why the story is broken.
         */
        reason: ReportBrokenReason
      }
    | {
        /**
         * It has no baseline.
         */
        status: 'missing'
        /**
         * None for a missing baseline.
         */
        reason: null
      }
    | {
        /**
         * It's an orphan.
         */
        status: 'orphan'
        /**
         * None for an orphan.
         */
        reason: null
      }
  )

/**
 * An entry of an `update` report, by status.
 *
 * @public
 */
export type UpdateReportEntry = ReportEntryFields &
  (
    | {
        /**
         * Its baseline was written.
         */
        status: 'written'
        /**
         * Whether the baseline was missing or differed.
         */
        reason: 'missing' | 'differs'
      }
    | {
        /**
         * Its baseline, an orphan, was deleted.
         */
        status: 'deleted'
        /**
         * None for a deleted baseline.
         */
        reason: null
      }
    | {
        /**
         * Its story is broken.
         */
        status: 'broken'
        /**
         * Why the story is broken.
         */
        reason: ReportBrokenReason
      }
  ) & {
    /**
     * The hosts the page really requested.
     */
    realRequestHosts: string[]
    /**
     * The hosts of remote content that differed between loads.
     */
    remoteContentHosts: string[]
  }

/**
 * A `test` report's counts. `passed` includes the flaky snapshots.
 *
 * @public
 */
export interface TestReportCounts {
  /**
   * Snapshots that passed, flaky ones included.
   */
  passed: number
  /**
   * Snapshots that passed on a retry.
   */
  flaky: number
  /**
   * Snapshots that differ.
   */
  differs: number
  /**
   * Broken stories.
   */
  broken: number
  /**
   * Snapshots with no baseline.
   */
  missing: number
  /**
   * Baselines no story makes.
   */
  orphan: number
}

/**
 * An `update` report's counts.
 *
 * @public
 */
export interface UpdateReportCounts {
  /**
   * Baselines written.
   */
  written: number
  /**
   * Baselines deleted.
   */
  deleted: number
  /**
   * Baselines kept as they were.
   */
  kept: number
  /**
   * Broken stories.
   */
  broken: number
  /**
   * Snapshots another load decided.
   */
  flaky: number
}

/**
 * A story a warning is about.
 *
 * @public
 */
export interface ReportStoryRef {
  /**
   * The Storybook's name.
   */
  storybook: string
  /**
   * The story's ID.
   */
  story: string
}

/**
 * A warning of an `update` run.
 *
 * @public
 */
export interface ReportWarning {
  /**
   * What the warning is about.
   */
  kind: 'real-requests' | 'remote-content'
  /**
   * The host.
   */
  host: string
  /**
   * The stories that used it.
   */
  stories: ReportStoryRef[]
  /**
   * The warning for people.
   */
  message: string
}

/**
 * Why a run exited 2.
 *
 * @public
 */
export interface ReportRunError {
  /**
   * What went wrong, for people.
   */
  message: string
  /**
   * The unreachable Storybooks.
   */
  storybooks: ReportStorybook[]
}

/**
 * The document a `test` run leaves.
 *
 * @public
 */
export interface TestReport {
  /**
   * The document's version.
   */
  version: typeof reportVersion
  /**
   * The CLI's version.
   */
  visualCheck: string
  /**
   * The command that ran.
   */
  command: 'test'
  /**
   * Whether it was `test --consistency`.
   */
  consistencyOnly: boolean
  /**
   * The exit code.
   */
  exitCode: number
  /**
   * The shard, or `null` without sharding.
   */
  shard: ReportShard | null
  /**
   * How the stories were picked.
   */
  selection: ReportSelection
  /**
   * The report folder, relative to the config folder, or `null` with no config.
   */
  reportDir: string | null
  /**
   * The Storybooks of the run.
   */
  storybooks: ReportStorybook[]
  /**
   * The counts.
   */
  counts: TestReportCounts
  /**
   * The entries.
   */
  snapshots: TestReportEntry[]
  /**
   * Always empty for `test`.
   */
  warnings: ReportWarning[]
  /**
   * Why the run exited 2, otherwise `null`.
   */
  error: ReportRunError | null
}

/**
 * The document an `update` run prints.
 *
 * @public
 */
export interface UpdateReport {
  /**
   * The document's version.
   */
  version: typeof reportVersion
  /**
   * The CLI's version.
   */
  visualCheck: string
  /**
   * The command that ran.
   */
  command: 'update'
  /**
   * Always `false` for `update`.
   */
  consistencyOnly: false
  /**
   * The exit code.
   */
  exitCode: number
  /**
   * Always `null` for `update`.
   */
  shard: null
  /**
   * How the stories were picked.
   */
  selection: ReportSelection
  /**
   * Always `null`, because `update` writes no report folder.
   */
  reportDir: null
  /**
   * The Storybooks of the run.
   */
  storybooks: ReportStorybook[]
  /**
   * The counts.
   */
  counts: UpdateReportCounts
  /**
   * The entries.
   */
  snapshots: UpdateReportEntry[]
  /**
   * The run's warnings.
   */
  warnings: ReportWarning[]
  /**
   * Why the run exited 2, otherwise `null`.
   */
  error: ReportRunError | null
}

/**
 * Either report document.
 *
 * @public
 */
export type Report = TestReport | UpdateReport

/**
 * What {@link testReportOf} assembles a `test` report from: the report without the fields it fills.
 *
 * @public
 */
export type TestReportInput = Omit<TestReport, 'version' | 'command' | 'warnings'>

/**
 * What {@link updateReportOf} assembles an `update` report from: the report without the fields it fills.
 *
 * @public
 */
export type UpdateReportInput = Omit<UpdateReport, 'version' | 'command' | 'consistencyOnly' | 'shard' | 'reportDir'>

/**
 * Assembles a `test` report. The keys follow the document's order, which `JSON.stringify` keeps.
 *
 * @public
 */
export function testReportOf(input: TestReportInput): TestReport {
  return {
    version: reportVersion,
    visualCheck: input.visualCheck,
    command: 'test',
    consistencyOnly: input.consistencyOnly,
    exitCode: input.exitCode,
    shard: input.shard,
    selection: input.selection,
    reportDir: input.reportDir,
    storybooks: input.storybooks,
    counts: input.counts,
    snapshots: input.snapshots,
    warnings: [],
    error: input.error,
  }
}

/**
 * Assembles an `update` report. The keys follow the document's order, which `JSON.stringify` keeps.
 *
 * @public
 */
export function updateReportOf(input: UpdateReportInput): UpdateReport {
  return {
    version: reportVersion,
    visualCheck: input.visualCheck,
    command: 'update',
    consistencyOnly: false,
    exitCode: input.exitCode,
    shard: null,
    selection: input.selection,
    reportDir: null,
    storybooks: input.storybooks,
    counts: input.counts,
    snapshots: input.snapshots,
    warnings: input.warnings,
    error: input.error,
  }
}

/**
 * Gives a `test` report's counts before anything is counted.
 *
 * @public
 */
export function emptyTestCounts(): TestReportCounts {
  return { passed: 0, flaky: 0, differs: 0, broken: 0, missing: 0, orphan: 0 }
}

/**
 * Gives an `update` report's counts before anything is counted.
 *
 * @public
 */
export function emptyUpdateCounts(): UpdateReportCounts {
  return { written: 0, deleted: 0, kept: 0, broken: 0, flaky: 0 }
}

/**
 * Gives the report as one minified JSON document.
 *
 * @public
 */
export function reportJsonOf(report: Report): string {
  return JSON.stringify(report)
}

/**
 * Gives an image's path relative to the report folder: `images/<storybook>/<stem>.<image>.png`. It uses `/` on every
 * OS.
 *
 * @public
 */
export function reportImagePathOf(storybook: string, stem: string, image: 'baseline' | 'snapshot' | 'diff'): string {
  return `images/${storybook}/${stem}.${image}.png`
}
