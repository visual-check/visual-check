import { BaselineError } from '../baselines/baseline-error.js'
import type { BrokenStory, StoryCapture, StoryHosts, StoryToCapture } from '../capture/capture-session.js'
import { type ConsoleMessage, eachPageErrorOnce, type PageError } from '../capture/driver/driver.js'
import type { StoryMask } from '../capture/prepare-capture.js'
import type { StoryOptions } from '../config/story-options.js'
import { type JudgedPageError, judgePageErrors } from '../page-errors/judge-page-errors.js'
import type { PageErrorPolicy } from '../page-errors/page-error-policy.js'
import type { ReportImages } from '../report/report-document.js'
import { storyUrlOf } from '../storybook/read-stories.js'
import {
  ImageDecodeError,
  type ImageRegion,
  type VisualDiff,
  type VisualDiffFailure,
  type VisualDiffResult,
} from '../visual-diff/visual-diff.js'
import type { SnapshotToCapture } from './plan-snapshots.js'

/**
 * What became of one snapshot: a `test` status, or an `update` one. `broken` belongs to both.
 */
export type SnapshotStatus = 'passed' | 'differs' | 'missing' | 'broken' | 'written' | 'kept'

/**
 * What the report keeps of a comparison that differed: why, its message, the pixels that differ and are allowed, and
 * both sizes.
 */
export type ReportedComparison = Pick<
  VisualDiffFailure,
  'reason' | 'message' | 'differ' | 'allowed' | 'baselineSize' | 'snapshotSize'
>

/**
 * One snapshot's status, the text its line ends with, how many captures it took and, for a captured snapshot, how long
 * Storybook's `completing` render step took and, for `update`, the hosts its story reaches. It also carries what the
 * report lists of it: the comparison that differed, why it broke, the hosts a hint names, the console messages and the
 * images of the listed capture, and why `update` wrote it. It also lists the page errors of every load of it that aren't
 * expected, and the story's expected page errors that went stale.
 */
export interface SnapshotResult {
  /**
   * What became of the snapshot.
   */
  status: SnapshotStatus
  /**
   * The line's last column, such as `142 ms` or `differs: 84 differ, 80 allowed (20 at scale 2)`.
   */
  detail: string
  /**
   * How many captures visual-check asked for: 0 for a stories file that didn't load, 0 for a missing baseline, or 1
   * when a check captures it, 1 and the retries made for `test`, and the loads made for `update`. The capture session's
   * own retries of a story that navigates away aren't counted.
   */
  attempts: number
  /**
   * The page errors of every load of the snapshot in the run that no expected page error matches, each once, in the
   * order first seen, with the severity its `pageErrors` gives them: `test`'s first capture and retries, `update`'s
   * loads, broken or not, and the capture session's own retries of a story that navigates away. None for a snapshot
   * that wasn't captured or whose `pageErrors` is `'off'`. They never change its status.
   */
  pageErrors: JudgedPageError[]
  /**
   * The story's own expected page errors that matched none of the snapshot's page errors, as written, such as
   * `"Failed to fetch"` or `/timeout/i`. None for a snapshot that wasn't captured or is broken, or whose `pageErrors`
   * is `'off'`.
   */
  staleExpectedPageErrors: string[]
  /**
   * How long Storybook's `completing` render step took for the story, in ms, on its first load for `update`.
   * `undefined` for a story that wasn't captured, or whose page didn't see the step.
   */
  completingMs?: number | undefined
  /**
   * The hosts the story reaches on its first load, for an `update` snapshot that was written or kept. `undefined` for a
   * snapshot that wasn't, and for any `test` snapshot, since `test` doesn't list hosts.
   */
  hosts?: StoryHosts | undefined
  /**
   * Whether the snapshot is flaky. For `test`, it passed only on a retry, after its first capture differed. For
   * `update`, its loads disagreed and another load decided: a third load that agreed with one of the first two, or a
   * second load within tolerance of the baseline the first load differed from.
   */
  flaky?: boolean
  /**
   * How the first capture differed from the baseline: for `test`, of a snapshot that differs or passed only on a
   * retry; for `update`, of a baseline written because it differed.
   */
  comparison?: ReportedComparison
  /**
   * Why a broken snapshot's story can't be captured.
   */
  broken?: BrokenStory
  /**
   * The hosts of the remote content a differing snapshot differs only inside, which its hint names.
   */
  hintHosts?: string[]
  /**
   * The console messages and errors of the capture the report lists: `test`'s first capture, or the load `update`
   * wrote or broke on. Left out when that capture had no page.
   */
  console?: ConsoleMessage[]
  /**
   * The images `test` wrote to the report folder, or a check to its own, relative to that folder: the first capture's
   * baseline, snapshot and visual diff of a snapshot that differs or passed only on a retry, a broken story's image of
   * its page as the snapshot, or the snapshot of a missing baseline a check captured.
   */
  images?: ReportImages
  /**
   * Why `update` wrote the baseline: it was missing, the snapshot differed from it, or it was within tolerance of the
   * baseline, which only the addon's Update rewrites.
   */
  writtenFor?: 'missing' | 'differs' | 'within-tolerance'
}

/**
 * A snapshot's result before the page errors of its loads are gathered and judged onto it.
 */
export type UnjudgedResult = Omit<SnapshotResult, 'pageErrors' | 'staleExpectedPageErrors'>

/**
 * What a broken snapshot's result keeps besides its broken story: how many captures it took and the console messages
 * of the capture that broke, when it had a page.
 */
interface BrokenAttempts {
  /**
   * How many captures visual-check asked for, the one that broke included.
   */
  attempts: number
  /**
   * The console messages and errors of the capture that broke. `undefined` when it had no page or no capture.
   */
  console?: ConsoleMessage[] | undefined
}

/**
 * The snapshot the browser returned can't be decoded, which its PNG files rule out unless something is wrong with the
 * browser or the machine.
 */
export class SnapshotDecodeError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `SnapshotDecodeError`.
   */
  override name = 'SnapshotDecodeError'

  /**
   * The name of the snapshot's Storybook.
   */
  readonly storybook: string

  /**
   * The snapshot's key: `<story-id>`, or `<story-id>.<mode>` for a mode.
   */
  readonly key: string

  /**
   * The decoder's reason, such as `Input buffer contains unsupported image format`.
   */
  readonly reason: string

  /**
   * Keeps which snapshot couldn't be decoded and the decoder's reason.
   */
  constructor(storybook: string, key: string, reason: string) {
    super(`Couldn't decode the snapshot of ${storybook}  ${key}: ${reason}.`)
    this.storybook = storybook
    this.key = key
    this.reason = reason
  }
}

/**
 * Captures a story in the run's browser, on the worker's own session. `started`, when given, is called once the
 * browser is up, just before the capture.
 */
export type CaptureStory = (story: StoryToCapture, started?: () => void) => Promise<StoryCapture>

/**
 * Gives the result of a snapshot that took no capture: no page errors, and no expected page error gone stale.
 */
export function withNoPageErrors(result: UnjudgedResult): SnapshotResult {
  return { ...result, pageErrors: [], staleExpectedPageErrors: [] }
}

/**
 * Takes a snapshot with `take`, handing it a capture that keeps the page errors of every capture made through it, and
 * gives the result with those page errors judged by `policy`: every load of the snapshot, each once, in the order
 * first seen. A broken snapshot's expected page errors don't go stale, and one that took no capture has nothing judged.
 */
export async function withJudgedPageErrors(
  captureStory: CaptureStory,
  policy: PageErrorPolicy,
  take: (captureStory: CaptureStory) => Promise<UnjudgedResult>,
): Promise<SnapshotResult> {
  const loads: PageError[][] = []
  const result = await take(async (story, started) => {
    const capture = await captureStory(story, started)

    loads.push(capture.pageErrors)

    return capture
  })

  if (loads.length === 0) {
    return withNoPageErrors(result)
  }

  return {
    ...result,
    ...judgePageErrors(eachPageErrorOnce(...loads), policy, { broken: result.status === 'broken' }),
  }
}

/**
 * Gives the masks a story's options set, in the order they are named, with the ones set to `null` dropped. Gives
 * nothing when the options set no masks or set them to `null`.
 */
function masksOf(masks: StoryOptions['masks']): StoryMask[] {
  return Object.entries(masks ?? {}).flatMap(([name, mask]) => (mask === null ? [] : [{ name, ...mask }]))
}

/**
 * Gives the story's ID, the URL of its own page with the snapshot's globals, the snapshot's viewport, and the element,
 * the masks and the viewport's growth the story's options set. A story with no element, or with `null`, is captured in
 * full, one with no masks is captured with none, and one that doesn't set `growViewport` grows the viewport.
 */
export function storyToCaptureOf({ storybook, story, options, globals, viewport }: SnapshotToCapture): StoryToCapture {
  const { element, growViewport } = options
  const masks = masksOf(options.masks)

  return {
    id: story.id,
    url: storyUrlOf(storybook.url, story.id, globals),
    viewport,
    ...(typeof element === 'string' ? { element } : {}),
    ...(growViewport === undefined ? {} : { growViewport }),
    ...(masks.length === 0 ? {} : { masks }),
  }
}

/**
 * Gives the result of a snapshot whose baseline is missing, whose detail says to run `update`. It took no capture.
 */
export function missingResultOf(): UnjudgedResult {
  return { status: 'missing', detail: 'missing: no baseline yet; run visual-check update to write it', attempts: 0 }
}

/**
 * Gives a broken snapshot's result, whose detail is the broken story's message, with the broken story, how many
 * captures it took and, when given, the console messages of the capture that broke.
 */
export function brokenResultOf(broken: BrokenStory, { attempts, console }: BrokenAttempts): UnjudgedResult {
  return {
    status: 'broken',
    detail: `broken: ${broken.message}`,
    attempts,
    broken,
    ...(console === undefined ? {} : { console }),
  }
}

/**
 * Gives what the report keeps of a comparison that differed, leaving out the visual diff's bytes and the regions hit.
 */
export function reportedComparisonOf({
  reason,
  message,
  differ,
  allowed,
  baselineSize,
  snapshotSize,
}: VisualDiffFailure): ReportedComparison {
  return { reason, message, differ, allowed, baselineSize, snapshotSize }
}

/**
 * Compares a snapshot with an earlier image of it by the story's tolerance, at its viewport's device scale factor, a
 * size difference counting as a difference. With `regions`, a failure by pixels says whether every differing pixel
 * lies inside one of them. `earlierErrorOf` gives what to throw, from the decoder's reason, when the earlier image
 * can't be decoded.
 *
 * @throws {SnapshotDecodeError} When the images differ and the snapshot can't be decoded.
 * @throws {VisualDiffError} When sharp can't be loaded, or a visual diff thread stops mid-comparison.
 */
async function compareImagesOf(
  visualDiff: VisualDiff,
  item: SnapshotToCapture,
  earlier: Uint8Array,
  snapshot: Uint8Array,
  regions: readonly ImageRegion[] | undefined,
  earlierErrorOf: (error: ImageDecodeError) => Error,
): Promise<VisualDiffResult> {
  try {
    return await visualDiff.compare({
      baseline: earlier,
      snapshot,
      tolerance: item.tolerance,
      scale: item.viewport.deviceScaleFactor,
      ...(regions === undefined ? {} : { regions }),
    })
  } catch (error) {
    if (!(error instanceof ImageDecodeError)) {
      throw error
    }

    throw error.image === 'snapshot'
      ? new SnapshotDecodeError(item.storybook.name, item.key, error.reason)
      : earlierErrorOf(error)
  }
}

/**
 * Compares a later capture of a snapshot with an earlier one, as `compareWithBaseline` compares it with its baseline.
 * Both are images the browser returned, so either one that can't be decoded names the snapshot.
 *
 * @throws {SnapshotDecodeError} When the captures differ and either one can't be decoded.
 * @throws {VisualDiffError} When sharp can't be loaded, or a visual diff thread stops mid-comparison.
 */
export async function compareCaptures(
  visualDiff: VisualDiff,
  item: SnapshotToCapture,
  earlier: Uint8Array,
  later: Uint8Array,
): Promise<VisualDiffResult> {
  return await compareImagesOf(
    visualDiff,
    item,
    earlier,
    later,
    undefined,
    (error) => new SnapshotDecodeError(item.storybook.name, item.key, error.reason),
  )
}

/**
 * Compares a snapshot with its baseline at `path` by the story's tolerance, at its viewport's device scale factor, a
 * size difference counting as a difference. With `regions`, a failure by pixels says whether every differing pixel
 * lies inside one of them.
 *
 * @throws {BaselineError} When the files differ and the baseline can't be decoded, with the decoder's reason.
 * @throws {SnapshotDecodeError} When the files differ and the snapshot can't be decoded.
 * @throws {VisualDiffError} When sharp can't be loaded, or a visual diff thread stops mid-comparison.
 */
export async function compareWithBaseline(
  visualDiff: VisualDiff,
  item: SnapshotToCapture,
  baseline: Uint8Array,
  snapshot: Uint8Array,
  path: string,
  regions?: readonly ImageRegion[],
): Promise<VisualDiffResult> {
  return await compareImagesOf(
    visualDiff,
    item,
    baseline,
    snapshot,
    regions,
    // The bare decoder reason, since the printed line already names the baseline.
    (error) => new BaselineError('decode', path, new Error(error.reason, { cause: error })),
  )
}
