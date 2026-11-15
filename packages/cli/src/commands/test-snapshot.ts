import { BaselineError } from '../baselines/baseline-error.js'
import { baselinePathOf, readBaseline } from '../baselines/baseline-files.js'
import type { BrokenStory, StoryCapture } from '../capture/capture-session.js'
import { writeFailureImages } from '../report/report-folder.js'
import { ImageDecodeError, type VisualDiff, type VisualDiffResult } from '../visual-diff/visual-diff.js'
import type { SnapshotToCapture } from './plan-snapshots.js'
import { type CaptureStory, type SnapshotResult, storyToCaptureOf } from './snapshot-result.js'

/**
 * What `test` needs besides the run: the visual diff it compares snapshots with, the report folder it writes the
 * images of each differing snapshot to, and how many more times it captures a snapshot that differs.
 */
export interface TestTools {
  /**
   * The run's visual diff.
   */
  visualDiff: VisualDiff
  /**
   * The report folder.
   */
  reportFolder: string
  /**
   * How many more times a snapshot that differs is captured before it fails: the config's `retries`.
   */
  retries: number
}

/**
 * Compares a snapshot with its baseline at `path` by the story's tolerance, at its viewport's device scale factor.
 *
 * @throws {BaselineError} When the files differ and the baseline can't be decoded, with the decoder's reason.
 */
async function compareWithBaseline(
  visualDiff: VisualDiff,
  item: SnapshotToCapture,
  baseline: Uint8Array,
  snapshot: Uint8Array,
  path: string,
): Promise<VisualDiffResult> {
  try {
    return await visualDiff.compare({
      baseline,
      snapshot,
      tolerance: item.tolerance,
      scale: item.viewport.deviceScaleFactor,
    })
  } catch (error) {
    if (error instanceof ImageDecodeError && error.image === 'baseline') {
      // The bare decoder reason, since the printed line already names the baseline.
      throw new BaselineError('read', path, new Error(error.reason, { cause: error }))
    }

    throw error
  }
}

/**
 * A capture of a story that wasn't broken: its snapshot, with how long Storybook's `completing` render step took and,
 * when asked for, the remote content it shows.
 */
type CapturedStory = Extract<StoryCapture, { snapshot: Uint8Array }>

/**
 * A snapshot's baseline: its bytes and the path they were read from.
 */
interface Baseline {
  /**
   * The baseline's bytes.
   */
  bytes: Uint8Array
  /**
   * The baseline's path.
   */
  path: string
}

/**
 * A capture of a snapshot compared with its baseline.
 */
interface ComparedCapture {
  /**
   * The capture.
   */
  capture: CapturedStory
  /**
   * How long the capture took, in ms, leaving out the browser's launch and the comparison.
   */
  elapsedMs: number
  /**
   * What the comparison with the baseline found.
   */
  result: VisualDiffResult
}

/**
 * One capture of a snapshot compared with its baseline, or the broken story it came back as.
 */
type Attempt = ComparedCapture | Extract<StoryCapture, { broken: BrokenStory }>

/**
 * How a snapshot is captured on one attempt.
 */
interface AttemptOptions {
  /**
   * Whether the capture also brings back the remote content the snapshot shows.
   */
  findRemoteContent: boolean
}

/**
 * What the retries of a snapshot that differs came to: the retry that passed, or the last retry when none did.
 */
type Retries =
  | {
      /**
       * The retry that passed.
       */
      passed: ComparedCapture
    }
  | {
      /**
       * The last retry, which differs or is broken, or `undefined` when there was no retry.
       */
      failed: Attempt | undefined
    }

/**
 * Captures a snapshot and compares it with its baseline. With `findRemoteContent`, the capture also brings back the
 * remote content the snapshot shows. The time is the capture's alone: it leaves out the browser's launch and the
 * comparison.
 *
 * @throws {BaselineError} When the files differ and the baseline can't be decoded.
 * @throws {ImageDecodeError} When the snapshot can't be decoded, which the browser's PNG files rule out.
 * @throws {Error} When a visual diff thread stops mid-comparison.
 */
async function attemptOf(
  item: SnapshotToCapture,
  captureStory: CaptureStory,
  visualDiff: VisualDiff,
  baseline: Baseline,
  { findRemoteContent }: AttemptOptions,
): Promise<Attempt> {
  let started = performance.now()
  const capture = await captureStory({ ...storyToCaptureOf(item), findRemoteContent }, () => {
    started = performance.now()
  })

  if ('broken' in capture) {
    return capture
  }

  const elapsedMs = Math.round(performance.now() - started)
  const result = await compareWithBaseline(visualDiff, item, baseline.bytes, capture.snapshot, baseline.path)

  return { capture, elapsedMs, result }
}

/**
 * Captures a snapshot that differs again, up to `retries` times, by calling `attempt` for each retry. It stops at the
 * first retry that passes or comes back broken.
 */
async function retryOf(retries: number, attempt: () => Promise<Attempt>): Promise<Retries> {
  let last: Attempt | undefined

  for (let retry = 0; retry < retries; retry += 1) {
    last = await attempt()

    if ('broken' in last) {
      return { failed: last }
    }

    if (last.result.outcome !== 'differs') {
      return { passed: last }
    }
  }

  return { failed: last }
}

/**
 * Tests one snapshot: a missing baseline is reported without a capture, and a snapshot passes when it differs from
 * its baseline by no more than the story's tolerance. One that differs beyond it, or in size, leaves its baseline,
 * snapshot and visual diff in the report folder at once, then is captured again, up to `retries` more times, each
 * capture a fresh one that also brings back the remote content it shows. The first retry that passes makes the
 * snapshot pass, flaky. A retry that comes back broken stops the retries. When no retry passes, the snapshot differs
 * with its first capture's message, and the report keeps that capture's images. A broken first capture isn't retried.
 * It asks for a capture only once it has read the baseline. A pass's time is the passing capture's alone: it leaves
 * out the browser's launch and the comparison.
 *
 * @throws {BaselineError} When the baseline can't be read or decoded.
 * @throws {ReportError} When an image can't be written to the report folder.
 * @throws {ImageDecodeError} When the snapshot can't be decoded, which the browser's PNG files rule out.
 * @throws {Error} When a visual diff thread stops mid-comparison.
 */
export async function testSnapshot(
  item: SnapshotToCapture,
  captureStory: CaptureStory,
  { visualDiff, reportFolder, retries }: TestTools,
): Promise<SnapshotResult> {
  const path = baselinePathOf(item.storybook.baselines, item.key)
  const bytes = await readBaseline(path)

  if (bytes === undefined) {
    return { status: 'missing', detail: 'missing: no baseline yet; run visual-check update to write it' }
  }

  const attempt = (options: AttemptOptions): Promise<Attempt> =>
    attemptOf(item, captureStory, visualDiff, { bytes, path }, options)
  const first = await attempt({ findRemoteContent: false })

  if ('broken' in first) {
    return { status: 'broken', detail: `broken: ${first.broken.message}` }
  }

  const { capture, elapsedMs, result } = first

  if (result.outcome !== 'differs') {
    return { status: 'passed', detail: `${elapsedMs} ms`, completingMs: capture.completingMs }
  }

  await writeFailureImages(reportFolder, item.storybook.name, item.key, {
    baseline: bytes,
    snapshot: capture.snapshot,
    diff: result.diff,
  })

  const retried = await retryOf(retries, () => attempt({ findRemoteContent: true }))

  if ('failed' in retried) {
    return { status: 'differs', detail: `differs: ${result.message}`, completingMs: capture.completingMs }
  }

  const { passed } = retried

  return {
    status: 'passed',
    detail: `${passed.elapsedMs} ms · flaky`,
    completingMs: passed.capture.completingMs,
    flaky: true,
  }
}
