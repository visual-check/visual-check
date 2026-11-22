import type { Status, StatusValue } from 'storybook/internal/types'
import type { StoryOutcome, StoryResult, VisualCheckState } from '../channel-events/events.js'
import { outcomeTextOf } from '../manager-state/outcome-text.js'

/**
 * The type ID of visual-check's statuses.
 *
 * @public
 */
export const statusTypeId = 'visual-check'

/**
 * What a status says of a story.
 */
type Verdict = Pick<Status, 'value' | 'description'>

/**
 * Gives the value of how a run ended: of its most severe snapshot. One that isn't known has no icon.
 */
function valueOfOutcome(outcome: StoryOutcome): StatusValue {
  if (outcome.result === 'stopped' || outcome.disabled) {
    return 'status-value:unknown'
  }

  const statuses = outcome.snapshots.map(({ status }) => status)

  if (statuses.includes('differs') || statuses.includes('broken')) {
    return 'status-value:error'
  }

  return statuses.includes('missing') ? 'status-value:warning' : 'status-value:success'
}

/**
 * Gives what a status says of a result.
 */
function verdictOf({ stale, outcome }: StoryResult): Verdict {
  return stale
    ? { value: 'status-value:unknown', description: 'Stale' }
    : { value: valueOfOutcome(outcome), description: outcomeTextOf(outcome) }
}

/**
 * Gives the status of every story that has a result or is checked now.
 */
export function statusesOf({ run, results }: VisualCheckState): Status[] {
  const verdicts = new Map<string, Verdict>(
    Object.values(results).map((result) => [result.storyId, verdictOf(result)] as const),
  )

  if (run !== null) {
    verdicts.set(run.storyId, { value: 'status-value:pending', description: 'Checking…' })
  }

  return [...verdicts].map(([storyId, verdict]) => ({
    ...verdict,
    typeId: statusTypeId,
    storyId,
    title: 'Visual check',
  }))
}
