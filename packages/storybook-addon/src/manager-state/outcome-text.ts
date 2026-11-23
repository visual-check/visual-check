import type { StoryOutcome } from '../channel-events/events.js'

/**
 * A check that finished.
 */
type CheckedOutcome = Extract<StoryOutcome, { result: 'checked' }>

/**
 * What the text calls one or more snapshots of a status, in its order.
 */
const countLabels: [status: CheckedOutcome['snapshots'][number]['status'], one: string, more: string][] = [
  ['differs', 'visual diff', 'visual diffs'],
  ['missing', 'missing baseline', 'missing baselines'],
  ['broken', 'broken', 'broken'],
]

/**
 * Gives the counts of a check's snapshots that didn't pass, or that every one passed.
 */
function countsTextOf({ snapshots }: CheckedOutcome): string {
  const counts = countLabels.flatMap(([label, one, more]) => {
    const count = snapshots.filter(({ status }) => status === label).length

    return count === 0 ? [] : [`${count} ${count === 1 ? one : more}`]
  })

  return counts.length === 0 ? 'Passed' : counts.join(', ')
}

/**
 * Gives a few words on how a run ended, such as `1 visual diff, 1 missing baseline`.
 *
 * @public
 */
export function outcomeTextOf(outcome: StoryOutcome): string {
  if (outcome.result === 'stopped') {
    return 'Stopped'
  }

  return outcome.disabled ? 'Disabled' : countsTextOf(outcome)
}
