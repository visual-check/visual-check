import type { Channel } from 'storybook/internal/channels'
import { PREVIEW_INITIALIZED } from 'storybook/internal/core-events'
import { channelEvents, type VisualCheckState } from '../channel-events/events.js'

/**
 * What this manager knows of the server's state, and what it can ask of the server.
 *
 * @public
 */
export interface ManagerState {
  /**
   * Calls the listener after each change, until the function it gives is called.
   */
  subscribe: (listener: () => void) => () => void
  /**
   * Gives the state: the same object until it changes.
   */
  getState: () => VisualCheckState
  /**
   * Asks for a check of a story. The server ignores it while a run is in flight.
   */
  check: (storyId: string) => void
  /**
   * Cancels the run in flight, if there is one.
   */
  cancel: () => void
  /**
   * Clears every story's result.
   */
  clear: () => void
}

/**
 * Follows the server's state over the channel of this manager. It asks for the state at once, and says that the results
 * are stale each time the preview loads again.
 *
 * @public
 */
export function createManagerState(channel: Pick<Channel, 'on' | 'emit'>): ManagerState {
  let state: VisualCheckState = { run: null, results: {} }
  let isStateKnown = false
  let isPreviewLoaded = false
  const listeners = new Set<() => void>()

  const setState = (next: VisualCheckState): void => {
    state = next

    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        // The other listeners still hear of the change.
        console.error(error)
      }
    }
  }

  channel.on(channelEvents.state, (next: VisualCheckState) => {
    isStateKnown = true
    setState(next)
  })
  channel.on(channelEvents.run, (run: VisualCheckState['run']) => {
    // Until the state comes, the results aren't known, and a run without them would look like a state that has none.
    if (isStateKnown) {
      setState({ ...state, run })
    }
  })
  channel.on(PREVIEW_INITIALIZED, () => {
    if (isPreviewLoaded) {
      channel.emit(channelEvents.stale)
    }

    isPreviewLoaded = true
  })
  channel.emit(channelEvents.getState)

  return {
    subscribe: (listener) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    getState: () => state,
    check: (storyId) => channel.emit(channelEvents.check, { storyId }),
    cancel: () => {
      if (state.run !== null) {
        channel.emit(channelEvents.cancel, { id: state.run.id })
      }
    },
    clear: () => channel.emit(channelEvents.clear),
  }
}
