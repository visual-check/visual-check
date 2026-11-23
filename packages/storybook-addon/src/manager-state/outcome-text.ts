import type { StoryOutcome } from '../channel-events/events.js'

/**
 * A check or an update that finished.
 */
type FinishedOutcome = Exclude<StoryOutcome, { result: 'stopped' }>

/**
 * The statuses of the snapshots of a run that finished with `Result`.
 */
type StatusOf<Result extends FinishedOutcome['result']> = Extract<
  FinishedOutcome,
  { result: Result }
>['snapshots'][number]['status']

/**
 * What the text calls one or more snapshots of a status, in its order, by the run that took them.
 */
const countLabels: {
  [Result in FinishedOutcome['result']]: [status: StatusOf<Result>, one: string, more: string][]
} = {
  checked: [
    ['differs', 'visual diff', 'visual diffs'],
    ['missing', 'missing baseline', 'missing baselines'],
    ['broken', 'broken', 'broken'],
  ],
  updated: [
    ['written', 'written', 'written'],
    ['kept', 'untouched', 'untouched'],
    ['broken', 'broken', 'broken'],
  ],
}

/**
 * Gives the counts of a run's snapshots by status: of a check, those that didn't pass, or that every one passed.
 */
function countsTextOf({ result, snapshots }: FinishedOutcome): string {
  const labels: [status: string, one: string, more: string][] = countLabels[result]
  const counts = labels.flatMap(([label, one, more]) => {
    const count = snapshots.filter(({ status }) => status === label).length

    return count === 0 ? [] : [`${count} ${count === 1 ? one : more}`]
  })

  return counts.length === 0 ? 'Passed' : counts.join(', ')
}

/**
 * Gives a few words on how a run ended, such as `1 visual diff, 1 missing baseline` or `2 written, 1 untouched`.
 *
 * @public
 */
export function outcomeTextOf(outcome: StoryOutcome): string {
  if (outcome.result === 'stopped') {
    return 'Stopped'
  }

  return outcome.disabled ? 'Disabled' : countsTextOf(outcome)
}
