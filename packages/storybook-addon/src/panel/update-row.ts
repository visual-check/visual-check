import type { AddonUpdateSnapshot } from '@visual-check/cli/internal/addon-protocol'
import { detailLinesOf } from './snapshot-row.js'

/**
 * A snapshot of an update as the panel shows it.
 */
export interface UpdateRow {
  /**
   * The snapshot's key, unique among the story's.
   */
  key: string
  /**
   * The mode's name, or `Default` for the default capture.
   */
  label: string
  /**
   * What the update did with the baseline.
   */
  status: AddonUpdateSnapshot['status']
  /**
   * The status for people.
   */
  statusText: 'Written' | 'Untouched' | 'Broken story'
  /**
   * Whether it's a flaky snapshot: it took a third load.
   */
  flaky: boolean
  /**
   * One line for people.
   */
  message: string
  /**
   * The code of why its story is broken, otherwise `null`: the message already says why a baseline was written.
   */
  reason: string | null
  /**
   * The lines of a broken story's details.
   */
  details: string[]
  /**
   * The hints on a failure.
   */
  hints: string[]
  /**
   * The baseline's path, relative to the config's folder.
   */
  path: string
}

/**
 * Each status for people.
 */
const statusTexts = { written: 'Written', kept: 'Untouched', broken: 'Broken story' } as const

/**
 * Gives a snapshot of an update as the panel shows it.
 */
export function updateRowOf(snapshot: AddonUpdateSnapshot): UpdateRow {
  return {
    key: snapshot.id,
    label: snapshot.mode ?? 'Default',
    status: snapshot.status,
    statusText: statusTexts[snapshot.status],
    flaky: snapshot.flaky,
    message: snapshot.message,
    reason: snapshot.status === 'broken' ? snapshot.reason : null,
    details: detailLinesOf(snapshot.details),
    hints: snapshot.hints.map(({ message }) => message),
    path: snapshot.baseline,
  }
}
