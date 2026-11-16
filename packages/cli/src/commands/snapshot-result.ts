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
 * Gives a broken snapshot's result, whose detail is the broken story's message.
 */
export function brokenResultOf(broken: BrokenStory): SnapshotResult {
  return { status: 'broken', detail: `broken: ${broken.message}` }
}

/**
 * Compares a snapshot with an earlier image of it, its baseline or an earlier capture, by the story's tolerance, at its
 * viewport's device scale factor, a size difference counting as a difference. With `regions`, a failure by pixels says
 * whether every differing pixel lies inside one of them.
 *
 * @throws {ImageDecodeError} When the images differ and one of them can't be decoded.
 * @throws {Error} When a visual diff thread stops mid-comparison.
 */
export async function compareForStory(
  visualDiff: VisualDiff,
  item: SnapshotToCapture,
  earlier: Uint8Array,
  snapshot: Uint8Array,
  regions?: readonly ImageRegion[],
): Promise<VisualDiffResult> {
  return await visualDiff.compare({
    baseline: earlier,
    snapshot,
    tolerance: item.tolerance,
    scale: item.viewport.deviceScaleFactor,
    ...(regions === undefined ? {} : { regions }),
  })
}

/**
 * Compares a snapshot with its baseline at `path` as `compareForStory` does, naming the baseline when it can't be
 * decoded.
 *
 * @throws {BaselineError} When the files differ and the baseline can't be decoded, with the decoder's reason.
 */
export async function compareWithBaseline(
  visualDiff: VisualDiff,
  item: SnapshotToCapture,
  baseline: Uint8Array,
  snapshot: Uint8Array,
  path: string,
  regions?: readonly ImageRegion[],
): Promise<VisualDiffResult> {
  try {
    return await compareForStory(visualDiff, item, baseline, snapshot, regions)
  } catch (error) {
    if (error instanceof ImageDecodeError && error.image === 'baseline') {
      // The bare decoder reason, since the printed line already names the baseline.
      throw new BaselineError('decode', path, new Error(error.reason, { cause: error }))
    }

    throw error
  }
}
