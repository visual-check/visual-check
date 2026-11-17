/**
 * The mark a snapshot's line starts with: `✓` for a pass, `✗` for a failure, `!` for a broken story.
 *
 * @public
 */
export type SnapshotMark = '✓' | '✗' | '!'

/**
 * The planned snapshots, first in a run's progress stream.
 */
interface PlannedEvent {
  /**
   * What the event is.
   */
  kind: 'planned'
  /**
   * The header, without a newline.
   */
  header: string
  /**
   * The notes printed after the header, each without a newline: that no story is affected, or a shard's, else none.
   */
  notes: string[]
  /**
   * How many snapshots the run takes.
   */
  total: number
  /**
   * How many workers capture at once.
   */
  workers: number
}

/**
 * A worker started taking a snapshot.
 */
interface StartedEvent {
  /**
   * What the event is.
   */
  kind: 'started'
  /**
   * The snapshot's place in planned order.
   */
  index: number
}

/**
 * A snapshot finished.
 */
interface FinishedEvent {
  /**
   * What the event is.
   */
  kind: 'finished'
  /**
   * The snapshot's place in planned order.
   */
  index: number
  /**
   * The mark its line starts with.
   */
  mark: SnapshotMark
  /**
   * Its one printed line, without a newline.
   */
  line: string
}

/**
 * An event of a `test` or `update` run's progress stream, in the order it happens: the planned snapshots, then each
 * snapshot's start and finish.
 *
 * @public
 */
export type RunEvent = PlannedEvent | StartedEvent | FinishedEvent

/**
 * Shows a `test` or `update` run's progress stream as it happens.
 *
 * @public
 */
export interface RunReporter {
  /**
   * Takes the next event of the progress stream.
   */
  event(event: RunEvent): void
  /**
   * Ends what it shows during the run, and resolves once the last of it is written. Called once, also when the run
   * stops with exit 2. It shouldn't reject; if it does while the run throws, the run's error is kept.
   */
  finish(): Promise<void>
}
