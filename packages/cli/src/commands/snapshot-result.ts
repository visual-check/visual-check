import { BaselineError } from '../baselines/baseline-error.js'
import type { BrokenStory, StoryCapture, StoryHosts, StoryToCapture } from '../capture/capture-session.js'
import type { StoryMask } from '../capture/prepare-capture.js'
import type { StoryOptions } from '../config/story-options.js'
import { storyUrlOf } from '../storybook/read-stories.js'
import {
  ImageDecodeError,
  type ImageRegion,
  type VisualDiff,
  type VisualDiffResult,
} from '../visual-diff/visual-diff.js'
import type { SnapshotToCapture } from './plan-snapshots.js'

/**
 * What became of one snapshot: a `test` status, or an `update` one. `broken` belongs to both.
 */
export type SnapshotStatus = 'passed' | 'differs' | 'missing' | 'broken' | 'written' | 'kept'

/**
 * One snapshot's status, the text its line ends with and, for a captured snapshot, how long Storybook's `completing`
 * render step took and, for `update`, the hosts its story reaches. A snapshot that differs can carry a hint, printed
 * under its line.
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
   * What the person can do about a snapshot that differs, such as masking the remote content it differs inside, as
   * lines with no indentation.
   */
  hint?: string[]
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
 * Gives the masks a story's options set, in the order they are named, with the ones set to `null` dropped. Gives
 * nothing when the options set no masks or set them to `null`.
 */
function masksOf(masks: StoryOptions['masks']): StoryMask[] {
  return Object.entries(masks ?? {}).flatMap(([name, mask]) => (mask === null ? [] : [{ name, ...mask }]))
}

/**
 * Gives the story's ID, the URL of its own page with the snapshot's globals, the snapshot's viewport, and the element
 * and the masks the story's options set. A story with no element, or with `null`, is captured in full, and one with no
 * masks is captured with none.
 */
export function storyToCaptureOf({ storybook, story, options, globals, viewport }: SnapshotToCapture): StoryToCapture {
  const { element } = options
  const masks = masksOf(options.masks)

  return {
    id: story.id,
    url: storyUrlOf(storybook.url, story.id, globals),
    viewport,
    ...(typeof element === 'string' ? { element } : {}),
    ...(masks.length === 0 ? {} : { masks }),
  }
}

/**
 * Gives the result of a snapshot whose baseline is missing, whose detail says to run `update`.
 */
export function missingResultOf(): SnapshotResult {
  return { status: 'missing', detail: 'missing: no baseline yet; run visual-check update to write it' }
}

/**
 * Gives a broken snapshot's result, whose detail is the broken story's message.
 */
export function brokenResultOf(broken: BrokenStory): SnapshotResult {
  return { status: 'broken', detail: `broken: ${broken.message}` }
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
