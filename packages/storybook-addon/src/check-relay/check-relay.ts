import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AddonOutcome } from '@visual-check/cli/internal/addon-protocol'
import type { Channel } from 'storybook/internal/channels'
import { STORY_HOT_UPDATED, STORY_INDEX_INVALIDATED } from 'storybook/internal/core-events'
import { channelEvents, type StoryRun, type VisualCheckState } from '../channel-events/events.js'
import { readCancelPayload, readStoryPayload } from '../channel-events/read-payload.js'
import type { EngineProcess } from '../engine-process/engine-process.js'
import { emptyState, type RelayAction, reduce } from './state.js'

/**
 * What the relay runs with.
 */
interface CheckRelayOptions {
  /**
   * Storybook's channel on the server, which every manager and preview is on.
   */
  channel: Pick<Channel, 'on' | 'emit'>
  /**
   * The absolute path of Storybook's config folder.
   */
  configDir: string
  /**
   * Storybook's own address.
   */
  address: string
  /**
   * Runs the checks and the updates.
   */
  engine: EngineProcess
  /**
   * Makes a click's ID. A random UUID by default. A test gives its own.
   */
  newId?: () => string
}

/**
 * The relay between Storybook's channel and the CLI's child process.
 *
 * @public
 */
export interface CheckRelay {
  /**
   * Gives the absolute path of a result's image, by the result's ID and the path its snapshot lists, or `undefined` when
   * it lists no such image.
   */
  imageAt: (id: string, path: string) => string | undefined
}

/**
 * Gives the absolute path of each image a check's snapshots list, by the path they list. An update lists none.
 */
function imagesOf(outcome: AddonOutcome): Map<string, string> {
  const images = new Map<string, string>()

  if (outcome.result === 'checked') {
    const paths = outcome.snapshots.flatMap((snapshot) => Object.values(snapshot.images))

    for (const path of paths.filter((path) => path !== null)) {
      images.set(path, join(outcome.imagesFolder, ...path.split('/')))
    }
  }

  return images
}

/**
 * Starts the relay. It holds the run in flight and the results for as long as Storybook runs, takes what managers ask
 * for, and tells every manager what changes.
 *
 * @public
 */
export function startCheckRelay({
  channel,
  configDir,
  address,
  engine,
  newId = randomUUID,
}: CheckRelayOptions): CheckRelay {
  let state = emptyState
  // The images of each result, by its ID.
  const imagesById = new Map<string, Map<string, string>>()

  const emitState = (): void => {
    const { run, results } = state

    channel.emit(channelEvents.state, { run, results } satisfies VisualCheckState)
  }

  const dispatch = (action: RelayAction): void => {
    const previous = state

    state = reduce(state, action)

    if (state === previous) {
      return
    }

    if (action.type === 'progress') {
      channel.emit(channelEvents.run, state.run)
    } else {
      emitState()
    }
  }

  const dropOldImages = (): void => {
    const kept = new Set(Object.values(state.results).map(({ id }) => id))

    for (const id of imagesById.keys()) {
      if (!kept.has(id)) {
        imagesById.delete(id)
      }
    }
  }

  const finish = (id: string, outcome: AddonOutcome): void => {
    // The images are there before a manager hears of them.
    imagesById.set(id, imagesOf(outcome))
    dispatch({ type: 'finished', id, outcome })
    dropOldImages()
  }

  const start = (kind: StoryRun['kind'], storyId: string): void => {
    if (state.run !== null) {
      return
    }

    const id = newId()

    dispatch({ type: 'requested', kind, id, storyId })
    engine.run(
      { kind, id, storyId, configDir, url: address },
      {
        progress: (progress) => dispatch({ type: 'progress', id, progress }),
        finished: (outcome) => finish(id, outcome),
      },
    )
  }

  const cancel = (id: string): void => {
    if (state.run?.id === id) {
      dispatch({ type: 'cancelling', id })
      engine.cancel(id)
    }
  }

  const markStale = (): void => dispatch({ type: 'staled' })

  for (const kind of ['check', 'update'] as const) {
    channel.on(channelEvents[kind], (payload: unknown) => {
      const request = readStoryPayload(payload)

      if (request !== undefined) {
        start(kind, request.storyId)
      }
    })
  }

  channel.on(channelEvents.cancel, (payload: unknown) => {
    const request = readCancelPayload(payload)

    if (request !== undefined) {
      cancel(request.id)
    }
  })
  channel.on(channelEvents.clear, () => {
    dispatch({ type: 'cleared' })
    dropOldImages()
  })
  channel.on(channelEvents.getState, emitState)

  for (const event of [channelEvents.stale, STORY_INDEX_INVALIDATED, STORY_HOT_UPDATED]) {
    channel.on(event, markStale)
  }

  return { imageAt: (id, path) => imagesById.get(id)?.get(path) }
}
