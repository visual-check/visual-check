import type { AddonSnapshot, AddonUpdateSnapshot } from '@visual-check/cli/internal/addon-protocol'
import type { StoryOutcome, StoryResult, StoryRun, VisualCheckState } from './events.js'

/**
 * Builds a snapshot of `card--default`, its default capture, which passed, with the fields given.
 *
 * @public
 */
export function snapshotWith(fields: Partial<AddonSnapshot> = {}): AddonSnapshot {
  return {
    storybook: 'web',
    id: 'card--default',
    kind: 'story',
    story: 'card--default',
    importPath: './card.stories.tsx',
    mode: null,
    status: 'passed',
    reason: null,
    message: 'Passed.',
    flaky: false,
    attempts: 1,
    pixels: null,
    size: null,
    details: null,
    hints: [],
    console: [],
    pageErrors: [],
    staleExpectedPageErrors: [],
    baseline: '.visual-check/baselines/card--default.png',
    images: { baseline: null, snapshot: null, diff: null },
    realRequests: [],
    ...fields,
  } as AddonSnapshot
}

/**
 * Builds the run in flight, a check of `card--default` that starts, with the fields given.
 *
 * @public
 */
export function runWith(fields: Partial<StoryRun> = {}): StoryRun {
  return {
    id: 'click-2',
    kind: 'check',
    storyId: 'card--default',
    step: 'preparing',
    finished: 0,
    total: 0,
    log: [],
    cancelling: false,
    ...fields,
  }
}

/**
 * Builds the outcome of a check that finished with the snapshots and the fields given.
 *
 * @public
 */
export function checkedWith(
  snapshots: AddonSnapshot[],
  fields: Partial<StoryOutcome & { result: 'checked' }> = {},
): StoryOutcome {
  return { result: 'checked', storybook: 'web', snapshots, disabled: false, notices: [], ...fields }
}

/**
 * The status and the reason of an update's snapshot, as one of the pairs it may have.
 */
type UpdateVerdict = AddonUpdateSnapshot extends infer Snapshot
  ? Snapshot extends AddonUpdateSnapshot
    ? Pick<Snapshot, 'status' | 'reason'>
    : never
  : never

/**
 * Builds a snapshot of an update of `card--default`, its default capture, with the fields and the verdict given: by
 * default, its missing baseline was written.
 *
 * @public
 */
export function updateSnapshotWith(
  fields: Partial<Omit<AddonUpdateSnapshot, 'status' | 'reason'>> = {},
  verdict: UpdateVerdict = { status: 'written', reason: 'missing' },
): AddonUpdateSnapshot {
  return {
    storybook: 'web',
    id: 'card--default',
    kind: 'story',
    story: 'card--default',
    importPath: './card.stories.tsx',
    mode: null,
    message: 'Written: missing',
    flaky: false,
    attempts: 2,
    pixels: null,
    size: null,
    details: null,
    hints: [],
    console: [],
    pageErrors: [],
    staleExpectedPageErrors: [],
    baseline: '.visual-check/baselines/card--default.png',
    images: { baseline: null, snapshot: null, diff: null },
    realRequestHosts: [],
    remoteContentHosts: [],
    ...fields,
    ...verdict,
  }
}

/**
 * Builds the outcome of an update that finished with the snapshots and the fields given.
 *
 * @public
 */
export function updatedWith(
  snapshots: AddonUpdateSnapshot[],
  fields: Partial<StoryOutcome & { result: 'updated' }> = {},
): StoryOutcome {
  return { result: 'updated', storybook: 'web', snapshots, disabled: false, notices: [], warnings: [], ...fields }
}

/**
 * Builds the outcome of a check that a problem stopped, with the fields given.
 *
 * @public
 */
export function stoppedWith(fields: Partial<StoryOutcome & { result: 'stopped' }> = {}): StoryOutcome {
  return { result: 'stopped', cause: 'run', message: 'Docker is not running.', notices: [], ...fields }
}

/**
 * Builds a state that holds one result, of `card--default`, with the fields given, and no run.
 *
 * @public
 */
export function stateWith(outcome: StoryOutcome, fields: Partial<StoryResult> = {}): VisualCheckState {
  const result: StoryResult = { id: 'click-1', storyId: 'card--default', stale: false, outcome, ...fields }

  return { run: null, results: { [result.storyId]: result } }
}
