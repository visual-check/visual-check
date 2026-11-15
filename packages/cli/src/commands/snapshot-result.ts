import type { StoryCapture, StoryToCapture } from '../capture/capture-session.js'
import type { StoryMask } from '../capture/prepare-capture.js'
import type { StoryOptions } from '../config/story-options.js'
import { storyUrlOf } from '../storybook/read-stories.js'
import type { SnapshotToCapture } from './plan-snapshots.js'

/**
 * What became of one snapshot: a `test` status, or an `update` one. `broken` belongs to both.
 */
export type SnapshotStatus = 'passed' | 'differs' | 'missing' | 'broken' | 'written' | 'kept'

/**
 * One snapshot's status, the text its line ends with and, for a captured snapshot, how long Storybook's `completing`
 * render step took. A snapshot that differs can carry a hint, printed under its line.
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
   * How long Storybook's `completing` render step took for the story, in ms. `undefined` for a story that wasn't
   * captured, or whose page didn't see the step.
   */
  completingMs?: number | undefined
  /**
   * Whether the snapshot passed only on a retry, after its first capture differed.
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
