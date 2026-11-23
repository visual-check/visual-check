import type { AddonOutcome, AddonProgress } from '@visual-check/cli/internal/addon-protocol'
import type { StoryOutcome, StoryResult, StoryRun, VisualCheckState } from '../channel-events/events.js'

/**
 * How many lines of the browser's pull or download a run keeps.
 */
const keptLogLines = 12

/**
 * How many of their last characters a run keeps.
 */
const keptLogCharacters = 16_000

/**
 * How many stories' results are kept.
 */
const keptResults = 200

/**
 * What the relay knows.
 */
export interface RelayState extends VisualCheckState {
  /**
   * Whether the story may have changed since the run in flight started, so its result will be stale.
   */
  runStaled: boolean
}

/**
 * What happens to the state.
 */
export type RelayAction =
  | {
      /**
       * A manager asked for a check. Ignored while a run is in flight.
       */
      type: 'requested'
      /**
       * The click's ID.
       */
      id: string
      /**
       * The story's ID.
       */
      storyId: string
    }
  | {
      /**
       * A run got further.
       */
      type: 'progress'
      /**
       * The run's ID.
       */
      id: string
      /**
       * How far it is.
       */
      progress: AddonProgress
    }
  | {
      /**
       * A manager cancelled a run.
       */
      type: 'cancelling'
      /**
       * The run's ID.
       */
      id: string
    }
  | {
      /**
       * A run ended. A cancelled one leaves the story's earlier result as it was.
       */
      type: 'finished'
      /**
       * The run's ID.
       */
      id: string
      /**
       * How it ended.
       */
      outcome: AddonOutcome
    }
  | {
      /**
       * The stories may have changed.
       */
      type: 'staled'
    }
  | {
      /**
       * A manager cleared the results. The run in flight stays.
       */
      type: 'cleared'
    }

/**
 * The state when Storybook starts.
 */
export const emptyState: RelayState = { run: null, results: {}, runStaled: false }

/**
 * Adds a chunk of output to a log of its last lines. The chunk goes on with the log's last line, so a log whose last line
 * is complete ends with an empty one, which comes on top of the lines kept.
 */
export function appendLog(log: readonly string[], text: string): string[] {
  const added = `${log.at(-1) ?? ''}${text}`.slice(-keptLogCharacters).split(/\r?\n/)
  const lines = [...log.slice(0, -1), ...added]
  const kept = lines.slice(lines.at(-1) === '' ? -keptLogLines - 1 : -keptLogLines)
  const length = kept.reduce((sum, line) => sum + line.length, 0)

  return length <= keptLogCharacters ? kept : kept.join('\n').slice(-keptLogCharacters).split('\n')
}

/**
 * Gives the run with its progress.
 */
function withProgress(run: StoryRun, progress: AddonProgress): StoryRun {
  switch (progress.step) {
    case 'preparing':
      return { ...run, step: 'preparing' }
    case 'browser':
      return { ...run, step: 'browser', log: appendLog(run.log, progress.text) }
    case 'capturing':
      return { ...run, step: 'capturing', finished: progress.finished, total: progress.total }
  }
}

/**
 * Gives what managers get of an outcome, or `undefined` for a cancelled one.
 */
function storyOutcomeOf(outcome: AddonOutcome): StoryOutcome | undefined {
  switch (outcome.result) {
    case 'checked': {
      const { result, storybook, snapshots, disabled, notices } = outcome

      return { result, storybook, snapshots, disabled, notices }
    }
    case 'stopped':
      return outcome
    case 'cancelled':
      return undefined
  }
}

/**
 * Gives the results with a new one, which replaces its story's earlier one and is the latest of all. The oldest go when
 * there are too many.
 */
function withResult(results: Record<string, StoryResult>, result: StoryResult): Record<string, StoryResult> {
  const others = Object.entries(results).filter(([storyId]) => storyId !== result.storyId)

  return Object.fromEntries([...others.slice(1 - keptResults), [result.storyId, result]])
}

/**
 * Ends the run in flight.
 */
function withEnd(state: RelayState, { id, storyId }: StoryRun, outcome: AddonOutcome): RelayState {
  const storyOutcome = storyOutcomeOf(outcome)
  const ended: RelayState = { ...state, run: null, runStaled: false }

  if (storyOutcome === undefined) {
    return ended
  }

  const result: StoryResult = { id, storyId, stale: state.runStaled, outcome: storyOutcome }

  return { ...ended, results: withResult(state.results, result) }
}

/**
 * Marks every result stale, the coming one of the run in flight too.
 */
function staled(state: RelayState): RelayState {
  const entries = Object.entries(state.results)
  const runStaled = state.run !== null

  if (runStaled === state.runStaled && entries.every(([, { stale }]) => stale)) {
    return state
  }

  return {
    ...state,
    runStaled,
    results: Object.fromEntries(entries.map(([storyId, result]) => [storyId, { ...result, stale: true }])),
  }
}

/**
 * Applies an action about the run in flight.
 */
function reduceRun(
  state: RelayState,
  run: StoryRun,
  action: RelayAction & { type: 'progress' | 'cancelling' | 'finished' },
): RelayState {
  switch (action.type) {
    case 'progress':
      return { ...state, run: withProgress(run, action.progress) }
    case 'cancelling':
      return run.cancelling ? state : { ...state, run: { ...run, cancelling: true } }
    case 'finished':
      return withEnd(state, run, action.outcome)
  }
}

/**
 * Starts a run, unless one is in flight.
 */
function withRun(state: RelayState, id: string, storyId: string): RelayState {
  if (state.run !== null) {
    return state
  }

  const run: StoryRun = {
    id,
    kind: 'check',
    storyId,
    step: 'preparing',
    finished: 0,
    total: 0,
    log: [],
    cancelling: false,
  }

  return { ...state, run }
}

/**
 * Gives the state after an action: the same object when the action changes nothing, as one about another run than the
 * one in flight.
 */
export function reduce(state: RelayState, action: RelayAction): RelayState {
  switch (action.type) {
    case 'requested':
      return withRun(state, action.id, action.storyId)
    case 'staled':
      return staled(state)
    case 'cleared':
      return Object.keys(state.results).length === 0 ? state : { ...state, results: {} }
    default:
      return state.run?.id === action.id ? reduceRun(state, state.run, action) : state
  }
}
