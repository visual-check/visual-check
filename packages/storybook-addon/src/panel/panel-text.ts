import type { StoryResult, StoryRun } from '../channel-events/events.js'
import { outcomeTextOf } from '../manager-state/outcome-text.js'

/**
 * Gives the line on how far a run is.
 */
export function runLineOf({ step, finished, total, cancelling }: StoryRun): string {
  if (cancelling) {
    return 'Cancelling…'
  }

  switch (step) {
    case 'preparing':
      return 'Starting…'
    case 'browser':
      return 'Getting the browser…'
    case 'capturing':
      return `Capturing ${Math.min(finished + 1, total)} of ${total}…`
  }
}

/**
 * Gives the line that says the run is another story's.
 */
export function otherStoryLineOf(storyId: string): string {
  return `Another story is being checked: ${storyId}.`
}

/**
 * Gives the line beside the buttons: how far the run in flight is, and whether it's another story's, else what the
 * story's latest result came to, empty without one.
 */
export function statusLineOf(run: StoryRun | null, storyId: string | null, result: StoryResult | undefined): string {
  if (run !== null) {
    return run.storyId === storyId ? runLineOf(run) : `${otherStoryLineOf(run.storyId)} ${runLineOf(run)}`
  }

  if (result === undefined) {
    return ''
  }

  const text = outcomeTextOf(result.outcome)

  return result.stale ? `Stale: ${text}` : text
}

/**
 * What the line beside the buttons is about, and whether it says the latest run was cancelled.
 */
export interface StatusSubject {
  /**
   * The run in flight, or `null`.
   */
  run: StoryRun | null
  /**
   * The current story's ID, or `null` when there is none.
   */
  storyId: string | null
  /**
   * The current story's latest result, or `undefined` when it has none.
   */
  result: StoryResult | undefined
  /**
   * Whether the story's latest run was cancelled, with nothing changed since.
   */
  cancelled: boolean
}

/**
 * Whether the story's latest run was cancelled, with nothing changed since, by what the line was about last. A run that
 * was being cancelled but completed left a result of its own.
 */
export function isCancelled(last: StatusSubject, next: Omit<StatusSubject, 'cancelled'>): boolean {
  const changed =
    next.run !== null ||
    last.storyId !== next.storyId ||
    last.result?.id !== next.result?.id ||
    last.result?.stale !== next.result?.stale

  if (changed) {
    return false
  }

  return last.run === null ? last.cancelled : last.run.cancelling && last.run.storyId === next.storyId
}

/**
 * Gives the text of a run's log, without the empty line that says the line before it is complete.
 */
export function logTextOf(log: readonly string[]): string {
  return (log.at(-1) === '' ? log.slice(0, -1) : log).join('\n')
}
