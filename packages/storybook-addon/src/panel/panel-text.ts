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
 * Gives the text of a run's log, without the empty line that says the line before it is complete.
 */
export function logTextOf(log: readonly string[]): string {
  return (log.at(-1) === '' ? log.slice(0, -1) : log).join('\n')
}
