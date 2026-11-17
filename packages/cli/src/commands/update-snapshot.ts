import { setTimeout as sleep } from 'node:timers/promises'
import { baselinePathOf, readBaseline, writeBaseline } from '../baselines/baseline-files.js'
import type { BrokenStory, StoryCapture } from '../capture/capture-session.js'
import type { ConsoleMessage } from '../capture/driver/driver.js'
import type { VisualDiff, VisualDiffFailure, VisualDiffResult } from '../visual-diff/visual-diff.js'
import type { SnapshotToCapture } from './plan-snapshots.js'
import {
  brokenResultOf,
  type CaptureStory,
  compareCaptures,
  compareWithBaseline,
  reportedComparisonOf,
  type SnapshotResult,
  storyToCaptureOf,
} from './snapshot-result.js'

/**
 * What `update` needs besides the run: the visual diff it compares snapshots with, and how long it waits before it
 * captures a snapshot's page again.
 */
export interface UpdateTools {
  /**
   * The run's visual diff.
   */
  visualDiff: VisualDiff
  /**
   * How long after the capture session asks whether to capture a snapshot's page again, right after the first capture
   * and the reading of its hosts, the page is captured again, to check it isn't still changing, in ms. So the second
   * capture comes at least that long after the first.
   */
  recaptureDelayMs: number
}

/**
 * How long `update` waits before it captures a snapshot's page again unless told otherwise, in ms.
 */
export const defaultRecaptureDelayMs = 1_000

/**
 * A capture of a story that wasn't broken: its snapshot, with how long Storybook's `completing` render step took, the
 * hosts it reaches and, when asked for, the same page captured again.
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
 * What a snapshot's first load came to: a broken story; a snapshot within tolerance of the baseline, which keeps it;
 * or a snapshot that needs the stability checks, with its page captured again and how it differs from the baseline.
 */
type FirstLoad =
  | {
      /**
       * Why the story can't be captured.
       */
      broken: BrokenStory
      /**
       * The console messages and errors of the load that broke, left out when it had no page.
       */
      console?: ConsoleMessage[]
    }
  | {
      /**
       * Marks a snapshot within tolerance of its baseline.
       */
      kept: true
      /**
       * The capture.
       */
      capture: CapturedStory
    }
  | {
      /**
       * The capture.
       */
      capture: CapturedStory
      /**
       * The same page captured again.
       */
      capturedAgain: Uint8Array
      /**
       * How the snapshot differs from the baseline, for the attempt that gave it. `undefined` for a missing baseline.
       */
      comparison: VisualDiffFailure | undefined
    }

/**
 * What the latest call of a first load's `captureAgainIf` found.
 */
interface LatestCheck {
  /**
   * What comparing the snapshot with the baseline found. `undefined` for a missing baseline, and before any call.
   */
  comparison: VisualDiffResult | undefined
}

/**
 * Captures a snapshot's first load, asking the capture session to capture the same page again unless the snapshot is
 * within tolerance of the baseline. The session asks right after the first capture and the reading of its hosts. The
 * snapshot is then compared with the baseline, when there is one. When they agree, nothing more is captured, and the
 * baseline is kept. Otherwise the page is captured again `recaptureDelayMs` after the session asked, so at least that
 * long after the first capture: the comparison runs during that wait, not before it. The session asks once per attempt
 * that captured a snapshot, so only the latest attempt's comparison counts.
 *
 * @throws {BaselineError} When the files differ and the baseline can't be decoded, through the session's capture.
 * @throws {SnapshotDecodeError} When the snapshot can't be decoded, which the browser's PNG files rule out.
 * @throws {VisualDiffError} When sharp can't be loaded, or a visual diff thread stops mid-comparison.
 * @throws {Error} When the page wasn't captured again although it was asked for, which the capture session rules out.
 */
async function firstLoadOf(
  item: SnapshotToCapture,
  captureStory: CaptureStory,
  { visualDiff, recaptureDelayMs }: UpdateTools,
  baseline: Baseline | undefined,
): Promise<FirstLoad> {
  const latest: LatestCheck = { comparison: undefined }

  /**
   * Compares the snapshot with the baseline, when there is one, keeping what it found. Resolves false when they
   * agree, else true once `recaptureDelayMs` has passed since it was called.
   */
  const captureAgainIf = async (snapshot: Uint8Array): Promise<boolean> => {
    const asked = performance.now()
    const comparison =
      baseline === undefined
        ? undefined
        : await compareWithBaseline(visualDiff, item, baseline.bytes, snapshot, baseline.path)

    latest.comparison = comparison

    if (comparison?.outcome === 'passed') {
      return false
    }

    await sleep(Math.max(0, asked + recaptureDelayMs - performance.now()))

    return true
  }
  const capture = await captureStory({ ...storyToCaptureOf(item), captureAgainIf })

  if ('broken' in capture) {
    return capture
  }

  const { comparison } = latest

  if (comparison?.outcome === 'passed') {
    return { kept: true, capture }
  }

  if (capture.capturedAgain === undefined) {
    throw new Error("The capture session didn't capture the story's page again.")
  }

  return { capture, capturedAgain: capture.capturedAgain, comparison }
}

/**
 * Whether a later capture of a snapshot agrees with an earlier one: it differs from it by no more than the story's
 * tolerance, at its viewport's device scale factor, and has the same size.
 *
 * @throws {SnapshotDecodeError} When either capture can't be decoded, which the browser's PNG files rule out.
 * @throws {VisualDiffError} When sharp can't be loaded, or a visual diff thread stops mid-comparison.
 */
async function capturesAgree(
  visualDiff: VisualDiff,
  item: SnapshotToCapture,
  earlier: Uint8Array,
  later: Uint8Array,
): Promise<boolean> {
  return (await compareCaptures(visualDiff, item, earlier, later)).outcome === 'passed'
}

/**
 * Gives the broken story of a first load whose page changed after its capture: the page captured again disagrees with
 * the snapshot. Gives `undefined` when they agree.
 *
 * @throws {SnapshotDecodeError} When either capture can't be decoded, which the browser's PNG files rule out.
 * @throws {VisualDiffError} When sharp can't be loaded, or a visual diff thread stops mid-comparison.
 */
async function changedAfterCaptureOf(
  visualDiff: VisualDiff,
  item: SnapshotToCapture,
  snapshot: Uint8Array,
  capturedAgain: Uint8Array,
): Promise<BrokenStory | undefined> {
  const result = await compareCaptures(visualDiff, item, snapshot, capturedAgain)

  if (result.outcome === 'passed') {
    return undefined
  }

  return {
    reason: 'changed-after-capture',
    message:
      `The story changed in the second after its capture: ${result.message}. ` +
      'Use its wait hook to wait until it settles.',
  }
}

/**
 * The broken story of a snapshot none of whose 3 loads agreed.
 */
const unstableStory: BrokenStory = {
  reason: 'unstable',
  message: "No two of the story's 3 loads agreed, so its baseline wasn't written.",
}

/**
 * Updates one snapshot's baseline, writing it only once the story renders the same way twice. It reads the baseline
 * before any capture. A first capture within the story's tolerance of its baseline leaves the baseline untouched,
 * `kept`, after one load and one capture. Otherwise, a missing baseline or one that differs beyond tolerance or in
 * size, it checks the story twice before writing:
 *
 * - The same page, a second later: the first load's page is captured again `recaptureDelayMs` after the capture session
 *   asks, right after the first capture and the reading of its hosts. When the two captures disagree, the story is
 *   broken, `changed-after-capture`, pointing to its wait hook.
 * - A second load: when it's within tolerance of a baseline the first load differed from, the baseline stays
 *   untouched, `kept · flaky`, whether or not it agrees with the first load. When it agrees with the first load, its
 *   snapshot is written. When it doesn't, a third load decides: the snapshot written is the third's, when it agrees
 *   with either of the first two, and the result is flaky. When no two loads agree, the story is broken, `unstable`.
 *
 * Two captures agree when they differ by no more than the story's tolerance, at its viewport's device scale factor,
 * and have the same size. It makes at most 3 loads, not counting the capture session's own retries of a story that
 * navigates away, whatever the config's `retries` says. A broken load stops it there, with that load's broken story. A
 * broken story writes nothing. The detail says why a baseline was written, `written: missing`, or `written: differs: `
 * and what `test` would say of the first capture, and ends with ` · flaky` for a flaky snapshot. The result's
 * completing time and hosts are the first load's. It counts the loads made, and carries why a baseline was written,
 * the first load's comparison with the baseline it differed from, and the console messages of the load written or
 * broken on: the third for a story whose loads never agreed, the first for one that changed after its capture.
 *
 * @throws {BaselineError} When the baseline can't be read, decoded or written.
 * @throws {SnapshotDecodeError} When a snapshot can't be decoded, which the browser's PNG files rule out.
 * @throws {VisualDiffError} When sharp can't be loaded, or a visual diff thread stops mid-comparison.
 * @throws {Error} When the first load's page wasn't captured again, which the capture session rules out.
 */
export async function updateSnapshot(
  item: SnapshotToCapture,
  captureStory: CaptureStory,
  tools: UpdateTools,
): Promise<SnapshotResult> {
  const { visualDiff } = tools
  const path = baselinePathOf(item.storybook.baselines, item.key)
  const bytes = await readBaseline(path)
  const baseline = bytes === undefined ? undefined : { bytes, path }
  const first = await firstLoadOf(item, captureStory, tools, baseline)

  if ('broken' in first) {
    return brokenResultOf(first.broken, { attempts: 1, console: first.console })
  }

  const { completingMs, hosts } = first.capture

  if ('kept' in first) {
    return { status: 'kept', detail: 'kept', attempts: 1, completingMs, hosts }
  }

  const { capture: firstCapture, capturedAgain, comparison } = first
  const changed = await changedAfterCaptureOf(visualDiff, item, firstCapture.snapshot, capturedAgain)

  if (changed !== undefined) {
    return brokenResultOf(changed, { attempts: 1, console: firstCapture.console })
  }

  const secondCapture = await captureStory(storyToCaptureOf(item))

  if ('broken' in secondCapture) {
    return brokenResultOf(secondCapture.broken, { attempts: 2, console: secondCapture.console })
  }

  const keptByBaseline =
    baseline !== undefined &&
    (await compareWithBaseline(visualDiff, item, baseline.bytes, secondCapture.snapshot, path)).outcome === 'passed'

  if (keptByBaseline) {
    return { status: 'kept', detail: 'kept · flaky', attempts: 2, completingMs, hosts, flaky: true }
  }

  const writtenDetail = comparison === undefined ? 'written: missing' : `written: differs: ${comparison.message}`
  const written = {
    completingMs,
    hosts,
    ...(comparison === undefined
      ? { writtenFor: 'missing' as const }
      : { comparison: reportedComparisonOf(comparison), writtenFor: 'differs' as const }),
  }

  if (await capturesAgree(visualDiff, item, firstCapture.snapshot, secondCapture.snapshot)) {
    await writeBaseline(path, secondCapture.snapshot)

    return { status: 'written', detail: writtenDetail, attempts: 2, ...written, console: secondCapture.console }
  }

  const thirdCapture = await captureStory(storyToCaptureOf(item))

  if ('broken' in thirdCapture) {
    return brokenResultOf(thirdCapture.broken, { attempts: 3, console: thirdCapture.console })
  }

  const thirdAgrees =
    (await capturesAgree(visualDiff, item, secondCapture.snapshot, thirdCapture.snapshot)) ||
    (await capturesAgree(visualDiff, item, firstCapture.snapshot, thirdCapture.snapshot))

  if (thirdAgrees) {
    await writeBaseline(path, thirdCapture.snapshot)

    return {
      status: 'written',
      detail: `${writtenDetail} · flaky`,
      attempts: 3,
      ...written,
      flaky: true,
      console: thirdCapture.console,
    }
  }

  return brokenResultOf(unstableStory, { attempts: 3, console: thirdCapture.console })
}
