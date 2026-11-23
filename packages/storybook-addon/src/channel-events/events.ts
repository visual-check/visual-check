import type { AddonSnapshot, AddonUpdateSnapshot, AddonWarning } from '@visual-check/cli/internal/addon-protocol'

/**
 * The names of visual-check's events on Storybook's channel.
 *
 * @public
 */
export const channelEvents = {
  /**
   * A manager asks for a check of a story. Payload: `{ storyId: string }`.
   */
  check: 'visual-check/check',
  /**
   * A manager asks for an update of a story's baselines. Payload: `{ storyId: string }`.
   */
  update: 'visual-check/update',
  /**
   * A manager cancels the run. Payload: `{ id: string }`.
   */
  cancel: 'visual-check/cancel',
  /**
   * A manager clears the results. No payload.
   */
  clear: 'visual-check/clear',
  /**
   * A manager says its preview reloaded, so every result is stale. No payload.
   */
  stale: 'visual-check/stale',
  /**
   * A manager asks for the state. No payload.
   */
  getState: 'visual-check/get-state',
  /**
   * The server tells every manager the state. Payload: `VisualCheckState`.
   */
  state: 'visual-check/state',
  /**
   * The server tells every manager how far the run is. Payload: `StoryRun | null`.
   */
  run: 'visual-check/run',
} as const

/**
 * The run in flight.
 *
 * @public
 */
export interface StoryRun {
  /**
   * The click's ID.
   */
  id: string
  /**
   * What runs: a check of the story, or an update of its baselines.
   */
  kind: 'check' | 'update'
  /**
   * The story's ID.
   */
  storyId: string
  /**
   * Where the run is: reading the config, Docker and the index, then getting the browser, then the snapshots.
   */
  step: 'preparing' | 'browser' | 'capturing'
  /**
   * How many snapshots have finished.
   */
  finished: number
  /**
   * How many snapshots the run takes. 0 until it's known.
   */
  total: number
  /**
   * The last 12 lines of the browser's pull or download. An empty one at the end says the line before it is complete.
   */
  log: string[]
  /**
   * Whether the run is being cancelled.
   */
  cancelling: boolean
}

/**
 * How a story's run ended.
 *
 * @public
 */
export type StoryOutcome =
  | {
      /**
       * The check finished, whatever its snapshots came to.
       */
      result: 'checked'
      /**
       * The name the config gives the Storybook.
       */
      storybook: string
      /**
       * The story's snapshots: its default capture, then its modes in order.
       */
      snapshots: AddonSnapshot[]
      /**
       * Whether the story is disabled, so the check took no snapshot.
       */
      disabled: boolean
      /**
       * What else the check says.
       */
      notices: string[]
    }
  | {
      /**
       * The update finished, whatever its snapshots came to.
       */
      result: 'updated'
      /**
       * The name the config gives the Storybook.
       */
      storybook: string
      /**
       * The story's snapshots: its default capture, then its modes in order.
       */
      snapshots: AddonUpdateSnapshot[]
      /**
       * Whether the story is disabled, so the update took no snapshot.
       */
      disabled: boolean
      /**
       * What else the update says.
       */
      notices: string[]
      /**
       * The warnings by host: the hosts the story sent real network requests to, then those whose remote content it
       * shows.
       */
      warnings: AddonWarning[]
    }
  | {
      /**
       * A problem stopped the check or the update.
       */
      result: 'stopped'
      /**
       * Whether the config is what stopped it, or anything else.
       */
      cause: 'config' | 'run'
      /**
       * What the problem is.
       */
      message: string
      /**
       * What else the run says.
       */
      notices: string[]
    }

/**
 * A story's latest result.
 *
 * @public
 */
export interface StoryResult {
  /**
   * The click's ID, which its images' URLs hold.
   */
  id: string
  /**
   * The story's ID.
   */
  storyId: string
  /**
   * Whether it's a stale result.
   */
  stale: boolean
  /**
   * How the run ended.
   */
  outcome: StoryOutcome
}

/**
 * What every manager shows.
 *
 * @public
 */
export interface VisualCheckState {
  /**
   * The run in flight, or `null`.
   */
  run: StoryRun | null
  /**
   * Each story's latest result, by story ID.
   */
  results: Record<string, StoryResult>
}
