import { durationOf } from '../reporter/duration.js'
import type { RunEvent, SnapshotMark } from '../reporter/run-event.js'

/**
 * A line the live view prints above its progress line, which never changes once printed.
 */
interface PrintedLine {
  /**
   * The line's key, unique within the view: its place among the printed lines.
   */
  id: number
  /**
   * The mark a snapshot's line starts with, drawn in its colour. None for the header and the notes.
   */
  mark: SnapshotMark | undefined
  /**
   * The line, after its mark when it has one.
   */
  text: string
}

/**
 * What the live view shows.
 */
export interface LiveViewState {
  /**
   * The lines printed above the progress line, in order: the header, the notes, then each `✗` and `!` line as its
   * snapshot finishes. Never changed in place: a change makes a new array.
   */
  printed: PrintedLine[]
  /**
   * How many snapshots have finished.
   */
  done: number
  /**
   * How many snapshots the run takes.
   */
  total: number
  /**
   * How many workers capture at once.
   */
  workers: number
  /**
   * Whether the run has been planned, so the view draws.
   */
  planned: boolean
  /**
   * Whether the view was finished, so the progress line is gone.
   */
  closed: boolean
}

/**
 * The state the live view starts in: nothing to draw until the run is planned.
 */
export const initialLiveViewState: LiveViewState = {
  printed: [],
  done: 0,
  total: 0,
  workers: 0,
  planned: false,
  closed: false,
}

/**
 * Adds lines to print, each with the next key.
 */
function withPrinted(state: LiveViewState, added: readonly Omit<PrintedLine, 'id'>[]): LiveViewState {
  const keyed = added.map((line, index) => ({ ...line, id: state.printed.length + index }))

  return { ...state, printed: [...state.printed, ...keyed] }
}

/**
 * Gives what the live view shows after `event`: at `planned` the header and the notes to print, the total and the
 * workers; at each `finished` one more done, and the line to print unless the snapshot passed. A start changes nothing.
 */
export function liveViewStateOf(state: LiveViewState, event: RunEvent): LiveViewState {
  switch (event.kind) {
    case 'planned':
      return {
        ...withPrinted(
          state,
          [event.header, ...event.notes].map((text) => ({ mark: undefined, text })),
        ),
        total: event.total,
        workers: event.workers,
        planned: true,
      }
    case 'started':
      return state
    case 'finished': {
      const counted = { ...state, done: state.done + 1 }

      if (event.mark === '✓') {
        return counted
      }

      // The line starts with its mark, as `snapshotLineOf` builds it.
      return withPrinted(counted, [{ mark: event.mark, text: event.line.slice(event.mark.length) }])
    }
  }
}

/**
 * Gives the progress line's text, after its spinner: the snapshots done of the total, the workers, and how long the
 * run has taken, such as `12/251 snapshots · 2 workers · 14.2s`.
 */
export function progressLineOf(state: LiveViewState, elapsedMs: number): string {
  const snapshots = state.total === 1 ? 'snapshot' : 'snapshots'
  const workers = state.workers === 1 ? 'worker' : 'workers'

  return `${state.done}/${state.total} ${snapshots} · ${state.workers} ${workers} · ${durationOf(elapsedMs)}`
}
