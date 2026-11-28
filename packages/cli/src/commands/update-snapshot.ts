import { setTimeout as sleep } from 'node:timers/promises'
import { baselinePathOf, readBaseline, writeBaseline } from '../baselines/baseline-files.js'
import type { BrokenStory, StoryCapture, StoryToCapture } from '../capture/capture-session.js'
import type { ReportImages } from '../report/report-document.js'
import type { ReportImageBytes } from '../report/report-folder.js'
import type { VisualDiff, VisualDiffResult } from '../visual-diff/visual-diff.js'
import type { SnapshotToCapture } from './plan-snapshots.js'
import {
  type BrokenAttempts,
  brokenResultOf,
  type CaptureStory,
  compareCaptures,
  compareWithBaseline,
  reportedComparisonOf,
  type SnapshotResult,
  storyToCaptureOf,
  type UnjudgedResult,
} from './snapshot-result.js'

/**
 * What `update` needs besides the run: the visual diff it compares snapshots with, how long it waits before it
 * captures a snapshot's page again, and what writes a broken snapshot's images.
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
  /**
   * Whether a baseline within tolerance of the first capture is rewritten too, as the Storybook addon's Update does.
   * Each snapshot then takes the stability checks a missing baseline takes. `false` by default.
   */
  rewrite?: boolean
  /**
   * Writes a baseline. `writeBaseline` by default. The addon's Update gives one that holds the bytes until every
   * snapshot is taken.
   */
  writeBaseline?: (path: string, bytes: Uint8Array) => Promise<void>
  /**
   * Writes a broken snapshot's images and gives their paths, as the report lists them. When given, every load asks for
   * an image of the story's page should it break. `update` gives one. The addon's Update gives none, so it keeps no
   * images.
   *
   * @throws {ReportError} When an image can't be written.
   */
  writeImages?: (item: SnapshotToCapture, images: Partial<ReportImageBytes>) => Promise<ReportImages>
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
 * A capture that came back as a broken story, with the console messages of its load and, when asked for and its page
 * still showed something, an image of that page.
 */
type BrokenCapture = Extract<StoryCapture, { broken: BrokenStory }>

/**
 * Why a story is broken, with the visual diff of the two of its captures that disagreed.
 */
interface Disagreement {
  /**
   * Why the story is broken.
   */
  broken: BrokenStory
  /**
   * The visual diff of the later capture against the earlier one.
   */
  diff: Uint8Array
}

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
 * or a snapshot that needs the stability checks, with its page captured again and how it compares with the baseline.
 */
type FirstLoad =
  | BrokenCapture
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
       * How the snapshot compares with the baseline, for the attempt that gave it. `undefined` for a missing baseline.
       * It passed only when baselines within tolerance are rewritten.
       */
      comparison: VisualDiffResult | undefined
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
 * Gives the story to capture for one load of a snapshot: with `writeImages`, it asks for an image of the story's page
 * should it break.
 */
function storyOf(item: SnapshotToCapture, { writeImages }: UpdateTools): StoryToCapture {
  return { ...storyToCaptureOf(item), ...(writeImages === undefined ? {} : { imageWhenBroken: true }) }
}

/**
 * Captures a snapshot's first load, asking the capture session to capture the same page again unless the snapshot is
 * within tolerance of the baseline and `rewrite` isn't set. The session asks right after the first capture and the
 * reading of its hosts. The snapshot is then compared with the baseline, when there is one. When they agree and
 * `rewrite` isn't set, nothing more is captured and the baseline is kept. Otherwise the page is captured again
 * `recaptureDelayMs` after the session asked, so at least that long after the first capture: the comparison runs
 * during that wait, not before it. The session asks once per attempt that captured a snapshot, so only the latest
 * attempt's comparison counts.
 *
 * @throws {BaselineError} When the files differ and the baseline can't be decoded, through the session's capture.
 * @throws {SnapshotDecodeError} When the snapshot can't be decoded, which the browser's PNG files rule out.
 * @throws {VisualDiffError} When sharp can't be loaded, or a visual diff thread stops mid-comparison.
 * @throws {Error} When the page wasn't captured again although it was asked for, which the capture session rules out.
 */
async function firstLoadOf(
  item: SnapshotToCapture,
  captureStory: CaptureStory,
  tools: UpdateTools,
  baseline: Baseline | undefined,
): Promise<FirstLoad> {
  const { visualDiff, recaptureDelayMs, rewrite = false } = tools
  const latest: LatestCheck = { comparison: undefined }

  /**
   * Compares the snapshot with the baseline, when there is one, keeping what it found. Resolves false when they
   * agree and `rewrite` isn't set, else true once `recaptureDelayMs` has passed since it was called.
   */
  const captureAgainIf = async (snapshot: Uint8Array): Promise<boolean> => {
    const asked = performance.now()
    const comparison =
      baseline === undefined
        ? undefined
        : await compareWithBaseline(visualDiff, item, baseline.bytes, snapshot, baseline.path)

    latest.comparison = comparison

    if (comparison?.outcome === 'passed' && !rewrite) {
      return false
    }

    await sleep(Math.max(0, asked + recaptureDelayMs - performance.now()))

    return true
  }
  const capture = await captureStory({ ...storyOf(item, tools), captureAgainIf })

  if ('broken' in capture) {
    return capture
  }

  const { comparison } = latest

  if (comparison?.outcome === 'passed' && !rewrite) {
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
 * Gives the broken story of a first load whose page changed after its capture, with the visual diff of the page
 * captured again against the snapshot, when the two disagree. Gives `undefined` when they agree.
 *
 * @throws {SnapshotDecodeError} When either capture can't be decoded, which the browser's PNG files rule out.
 * @throws {VisualDiffError} When sharp can't be loaded, or a visual diff thread stops mid-comparison.
 */
async function changedAfterCaptureOf(
  visualDiff: VisualDiff,
  item: SnapshotToCapture,
  snapshot: Uint8Array,
  capturedAgain: Uint8Array,
): Promise<Disagreement | undefined> {
  const result = await compareCaptures(visualDiff, item, snapshot, capturedAgain)

  if (result.outcome === 'passed') {
    return undefined
  }

  return {
    broken: {
      reason: 'changed-after-capture',
      message:
        `The story changed in the second after its capture: ${result.message}. ` +
        'Use its wait hook to wait until it settles.',
    },
    diff: result.diff,
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
 * Gives the broken story of a snapshot none of whose 3 loads agreed, with the visual diff of the third load against
 * the first, when the third agrees with neither of the first two, which disagree. Gives `undefined` when it agrees with
 * either.
 *
 * @throws {SnapshotDecodeError} When a capture can't be decoded, which the browser's PNG files rule out.
 * @throws {VisualDiffError} When sharp can't be loaded, or a visual diff thread stops mid-comparison.
 */
async function unstableOf(
  visualDiff: VisualDiff,
  item: SnapshotToCapture,
  [first, second, third]: readonly [Uint8Array, Uint8Array, Uint8Array],
): Promise<Disagreement | undefined> {
  if (await capturesAgree(visualDiff, item, second, third)) {
    return undefined
  }

  const result = await compareCaptures(visualDiff, item, first, third)

  return result.outcome === 'passed' ? undefined : { broken: unstableStory, diff: result.diff }
}

/**
 * What a broken snapshot's images are written with: its baseline, copied into them when there is one, and what writes
 * them, `undefined` when nothing does.
 */
interface BrokenImages {
  /**
   * The snapshot's baseline, `undefined` when it's missing.
   */
  baseline: Baseline | undefined
  /**
   * Writes the images, `undefined` when no image is kept.
   */
  writeImages: UpdateTools['writeImages']
}

/**
 * Gives a broken snapshot's result. With `writeImages`, it carries the images written of it: a copy of the baseline,
 * when there is one, and `images`. It has none without `writeImages`, or with no image to write.
 *
 * @throws {ReportError} When an image can't be written.
 */
async function brokenWithImagesOf(
  item: SnapshotToCapture,
  broken: BrokenStory,
  attempts: BrokenAttempts,
  images: Partial<ReportImageBytes>,
  { baseline, writeImages }: BrokenImages,
): Promise<UnjudgedResult> {
  const result = brokenResultOf(broken, attempts)
  const all = { ...(baseline === undefined ? {} : { baseline: baseline.bytes }), ...images }

  if (writeImages === undefined || Object.keys(all).length === 0) {
    return result
  }

  return { ...result, images: await writeImages(item, all) }
}

/**
 * Gives the result of a snapshot whose load came back broken, with the image of its page as its snapshot, when one
 * came with it.
 *
 * @throws {ReportError} When an image can't be written.
 */
async function brokenLoadResultOf(
  item: SnapshotToCapture,
  capture: BrokenCapture,
  attempts: number,
  written: BrokenImages,
): Promise<UnjudgedResult> {
  return await brokenWithImagesOf(
    item,
    capture.broken,
    { attempts, console: capture.console },
    capture.image === undefined ? {} : { snapshot: capture.image },
    written,
  )
}

/**
 * Gives the result of a baseline to write: `written` once `write` wrote `snapshot` to `path`. When the file read at the
 * start holds the same bytes, it writes nothing and gives the baseline `kept`, with the detail `kept: identical`, and
 * ` · flaky` for a flaky snapshot, carrying what `written` carries besides why it was written.
 *
 * @throws {BaselineError} When `write` can't write the baseline, as `writeBaseline` throws it.
 */
async function writtenOrKeptOf(
  baseline: Baseline | undefined,
  path: string,
  snapshot: Uint8Array,
  written: UnjudgedResult,
  write: (path: string, bytes: Uint8Array) => Promise<void>,
): Promise<UnjudgedResult> {
  if (baseline === undefined || Buffer.compare(baseline.bytes, snapshot) !== 0) {
    await write(path, snapshot)

    return written
  }

  const { attempts, completingMs, hosts, flaky, console } = written

  return {
    status: 'kept',
    detail: flaky === true ? 'kept: identical · flaky' : 'kept: identical',
    attempts,
    completingMs,
    hosts,
    ...(flaky === undefined ? {} : { flaky }),
    ...(console === undefined ? {} : { console }),
  }
}

/**
 * Gives why a baseline is written, from the first load's comparison with it: it was missing, it was within tolerance,
 * which only `rewrite` writes, or it differed, with what the report keeps of how. Gives the detail that says so too.
 */
function writtenReasonOf(
  comparison: VisualDiffResult | undefined,
): Pick<SnapshotResult, 'writtenFor' | 'comparison' | 'detail'> {
  if (comparison === undefined) {
    return { writtenFor: 'missing', detail: 'written: missing' }
  }

  if (comparison.outcome === 'passed') {
    return { writtenFor: 'within-tolerance', detail: 'written: within tolerance' }
  }

  return {
    writtenFor: 'differs',
    comparison: reportedComparisonOf(comparison),
    detail: `written: differs: ${comparison.message}`,
  }
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
 * With `rewrite`, as the Storybook addon's Update runs it, a baseline within tolerance of the first capture isn't kept:
 * every snapshot takes the stability checks a missing baseline takes, without the `kept · flaky` of a second load
 * within tolerance, and one within tolerance is written with the detail `written: within tolerance`. In either mode, a
 * snapshot to write whose bytes equal the baseline's leaves the file untouched, `kept: identical`, which only
 * `rewrite` reaches in practice. Baselines are written by `tools.writeBaseline`, `writeBaseline` when not given.
 *
 * With `tools.writeImages`, as `update` runs it, every load asks for an image of the story's page should it break, and
 * a broken snapshot keeps images, each with a copy of the baseline when there is one. A story that changed after its
 * capture keeps its first capture as the one compared, the page captured again as its snapshot, and their visual
 * diff. One none of whose loads agreed keeps the first load as the one compared, the third as its snapshot, and their
 * visual diff; the second isn't kept. A load that broke keeps the image of its page, when one came, as its snapshot.
 * Snapshots written or kept keep no images.
 *
 * @throws {BaselineError} When the baseline can't be read, decoded or written.
 * @throws {ReportError} When a broken snapshot's image can't be written.
 * @throws {SnapshotDecodeError} When a snapshot can't be decoded, which the browser's PNG files rule out.
 * @throws {VisualDiffError} When sharp can't be loaded, or a visual diff thread stops mid-comparison.
 * @throws {Error} When the first load's page wasn't captured again, which the capture session rules out.
 */
export async function updateSnapshot(
  item: SnapshotToCapture,
  captureStory: CaptureStory,
  tools: UpdateTools,
): Promise<UnjudgedResult> {
  const { visualDiff, rewrite = false, writeBaseline: write = writeBaseline, writeImages } = tools
  const path = baselinePathOf(item.storybook.baselines, item.key)
  const bytes = await readBaseline(path)
  const baseline = bytes === undefined ? undefined : { bytes, path }
  const imaged: BrokenImages = { baseline, writeImages }
  const first = await firstLoadOf(item, captureStory, tools, baseline)

  if ('broken' in first) {
    return await brokenLoadResultOf(item, first, 1, imaged)
  }

  const { completingMs, hosts } = first.capture

  if ('kept' in first) {
    return { status: 'kept', detail: 'kept', attempts: 1, completingMs, hosts }
  }

  const { capture: firstCapture, capturedAgain, comparison } = first
  const changed = await changedAfterCaptureOf(visualDiff, item, firstCapture.snapshot, capturedAgain)

  if (changed !== undefined) {
    return await brokenWithImagesOf(
      item,
      changed.broken,
      { attempts: 1, console: firstCapture.console },
      { compared: firstCapture.snapshot, snapshot: capturedAgain, diff: changed.diff },
      imaged,
    )
  }

  const secondCapture = await captureStory(storyOf(item, tools))

  if ('broken' in secondCapture) {
    return await brokenLoadResultOf(item, secondCapture, 2, imaged)
  }

  const keptByBaseline =
    !rewrite &&
    baseline !== undefined &&
    (await compareWithBaseline(visualDiff, item, baseline.bytes, secondCapture.snapshot, path)).outcome === 'passed'

  if (keptByBaseline) {
    return { status: 'kept', detail: 'kept · flaky', attempts: 2, completingMs, hosts, flaky: true }
  }

  const reason = writtenReasonOf(comparison)

  if (await capturesAgree(visualDiff, item, firstCapture.snapshot, secondCapture.snapshot)) {
    return await writtenOrKeptOf(
      baseline,
      path,
      secondCapture.snapshot,
      { status: 'written', attempts: 2, completingMs, hosts, ...reason, console: secondCapture.console },
      write,
    )
  }

  const thirdCapture = await captureStory(storyOf(item, tools))

  if ('broken' in thirdCapture) {
    return await brokenLoadResultOf(item, thirdCapture, 3, imaged)
  }

  const unstable = await unstableOf(visualDiff, item, [
    firstCapture.snapshot,
    secondCapture.snapshot,
    thirdCapture.snapshot,
  ])

  if (unstable === undefined) {
    return await writtenOrKeptOf(
      baseline,
      path,
      thirdCapture.snapshot,
      {
        status: 'written',
        attempts: 3,
        completingMs,
        hosts,
        ...reason,
        detail: `${reason.detail} · flaky`,
        flaky: true,
        console: thirdCapture.console,
      },
      write,
    )
  }

  return await brokenWithImagesOf(
    item,
    unstable.broken,
    { attempts: 3, console: thirdCapture.console },
    { compared: firstCapture.snapshot, snapshot: thirdCapture.snapshot, diff: unstable.diff },
    imaged,
  )
}
