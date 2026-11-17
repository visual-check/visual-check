import { baselinePathOf, baselineStemOf, readBaseline } from '../baselines/baseline-files.js'
import type { BrokenStory, RemoteContentBox, StoryCapture } from '../capture/capture-session.js'
import { writeReportImages } from '../report/report-folder.js'
import type { ImageRegion, VisualDiff, VisualDiffResult } from '../visual-diff/visual-diff.js'
import type { SnapshotToCapture } from './plan-snapshots.js'
import {
  brokenResultOf,
  type CaptureStory,
  compareWithBaseline,
  missingResultOf,
  reportedComparisonOf,
  type SnapshotResult,
  storyToCaptureOf,
} from './snapshot-result.js'

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
  /**
   * Whether a broken story comes with an image of its page, when its page still shows something.
   */
  imageWhenBroken: boolean
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
 * Gives the regions of a snapshot's remote content boxes, in the boxes' order, each grown by `margin` image pixels on
 * every side, so a differing pixel on an anti-aliased edge counts as inside.
 */
function regionsAround(boxes: readonly RemoteContentBox[], margin: number): ImageRegion[] {
  return boxes.map(({ x, y, width, height }) => ({
    x: x - margin,
    y: y - margin,
    width: width + 2 * margin,
    height: height + 2 * margin,
  }))
}

/**
 * Captures a snapshot and compares it with its baseline. With `findRemoteContent`, the capture also brings back the
 * remote content the snapshot shows, and the comparison is told its boxes, each grown by the device scale factor
 * rounded up, in image pixels, so a failure by pixels says which boxes hold the differing pixels. The time is the
 * capture's alone: it leaves out the browser's launch and the comparison.
 *
 * @throws {BaselineError} When the files differ and the baseline can't be decoded.
 * @throws {SnapshotDecodeError} When the snapshot can't be decoded, which the browser's PNG files rule out.
 * @throws {VisualDiffError} When sharp can't be loaded, or a visual diff thread stops mid-comparison.
 */
async function attemptOf(
  item: SnapshotToCapture,
  captureStory: CaptureStory,
  visualDiff: VisualDiff,
  baseline: Baseline,
  { findRemoteContent, imageWhenBroken }: AttemptOptions,
): Promise<Attempt> {
  let started = performance.now()
  const capture = await captureStory({ ...storyToCaptureOf(item), findRemoteContent, imageWhenBroken }, () => {
    started = performance.now()
  })

  if ('broken' in capture) {
    return capture
  }

  const elapsedMs = Math.round(performance.now() - started)
  const regions =
    capture.remoteContent === undefined
      ? undefined
      : regionsAround(capture.remoteContent, Math.ceil(item.viewport.deviceScaleFactor))
  const result = await compareWithBaseline(visualDiff, item, baseline.bytes, capture.snapshot, baseline.path, regions)

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
 * Gives the hosts of the remote content that holds a retry's differing pixels, each once, in the order of its boxes,
 * when every differing pixel lies inside that remote content. Gives `undefined` when there was no retry, when it's
 * broken or differs in size, when its remote content is unknown, or when a differing pixel lies outside it.
 */
function remoteHostsOf(retry: Attempt | undefined): string[] | undefined {
  if (retry === undefined || 'broken' in retry) {
    return undefined
  }

  const { capture, result } = retry

  if (result.outcome !== 'differs' || result.reason !== 'pixels' || result.regionsHit === undefined) {
    return undefined
  }

  const boxes = capture.remoteContent ?? []

  return [...new Set(result.regionsHit.flatMap((index) => boxes[index]?.host ?? []))]
}

/**
 * Tests one snapshot: a missing baseline is reported without a capture, and a snapshot passes when it differs from
 * its baseline by no more than the story's tolerance. One that differs beyond it, or in size, leaves its baseline,
 * snapshot and visual diff in the report folder at once, named after its baseline's stem, then is captured again, up
 * to `retries` more times, each capture a fresh one that also brings back the remote content it shows. The first retry
 * that passes makes the snapshot pass, flaky. A retry that comes back broken stops the retries. When no retry passes,
 * the snapshot differs with its first capture's message, and the report keeps that capture's images. When both the
 * first capture and the last retry differ by pixels, and every differing pixel of the last retry lies inside its remote
 * content, give or take the device scale factor rounded up, the result names those hosts, for a hint. A broken
 * first capture isn't retried. The first capture asks for an image of the story's page should it break; retries don't,
 * since a broken retry keeps the first capture's images. A broken first capture that came with an image of its page
 * leaves it in the report folder as its snapshot. It asks for a capture only once it has read the baseline. A pass's
 * time is the passing capture's alone: it leaves out the browser's launch and the comparison. The result counts the
 * captures it asked for and carries what the report lists: the first capture's console messages and, for a snapshot
 * that differs or passed only on a retry, its comparison and images, and the hosts a hint names.
 *
 * @throws {BaselineError} When the baseline can't be read or decoded.
 * @throws {ReportError} When an image can't be written to the report folder.
 * @throws {SnapshotDecodeError} When the snapshot can't be decoded, which the browser's PNG files rule out.
 * @throws {VisualDiffError} When sharp can't be loaded, or a visual diff thread stops mid-comparison.
 */
export async function testSnapshot(
  item: SnapshotToCapture,
  captureStory: CaptureStory,
  { visualDiff, reportFolder, retries }: TestTools,
): Promise<SnapshotResult> {
  const path = baselinePathOf(item.storybook.baselines, item.key)
  const bytes = await readBaseline(path)

  if (bytes === undefined) {
    return missingResultOf()
  }

  let attempts = 0
  const attempt = (options: AttemptOptions): Promise<Attempt> => {
    attempts += 1

    return attemptOf(item, captureStory, visualDiff, { bytes, path }, options)
  }
  const stem = baselineStemOf(item.key)
  const first = await attempt({ findRemoteContent: false, imageWhenBroken: true })

  if ('broken' in first) {
    const brokenResult = brokenResultOf(first.broken, { attempts, console: first.console })

    if (first.image === undefined) {
      return brokenResult
    }

    return {
      ...brokenResult,
      images: await writeReportImages(reportFolder, item.storybook.name, stem, { snapshot: first.image }),
    }
  }

  const { capture, elapsedMs, result } = first

  if (result.outcome !== 'differs') {
    return {
      status: 'passed',
      detail: `${elapsedMs} ms`,
      attempts,
      completingMs: capture.completingMs,
      console: capture.console,
    }
  }

  const images = await writeReportImages(reportFolder, item.storybook.name, stem, {
    baseline: bytes,
    snapshot: capture.snapshot,
    diff: result.diff,
  })
  const listed = { comparison: reportedComparisonOf(result), console: capture.console, images }
  const retried = await retryOf(retries, () => attempt({ findRemoteContent: true, imageWhenBroken: false }))

  if ('failed' in retried) {
    const hosts = result.reason === 'pixels' ? remoteHostsOf(retried.failed) : undefined

    return {
      status: 'differs',
      detail: `differs: ${result.message}`,
      attempts,
      completingMs: capture.completingMs,
      ...listed,
      ...(hosts === undefined ? {} : { hintHosts: hosts }),
    }
  }

  const { passed } = retried

  return {
    status: 'passed',
    detail: `${passed.elapsedMs} ms · flaky`,
    attempts,
    completingMs: passed.capture.completingMs,
    flaky: true,
    ...listed,
  }
}
