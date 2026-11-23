import type { Status, StatusStoreByTypeId } from 'storybook/internal/types'
import type { ManagerState } from '../manager-state/manager-state.js'
import { statusesOf, statusTypeId } from './statuses.js'

/**
 * What the store's error says while it waits for the server's statuses.
 */
const notReadyText = 'before store is ready'

/**
 * Writes what the store has otherwise than the statuses: unsets the stories no longer listed, and sets the others.
 */
function writeStatuses(statuses: Status[], store: Pick<StatusStoreByTypeId, 'getAll' | 'set' | 'unset'>): void {
  const all = store.getAll()
  const listed = new Set(statuses.map(({ storyId }) => storyId))
  const gone = Object.keys(all).filter((storyId) => all[storyId]?.[statusTypeId] && !listed.has(storyId))
  const changed = statuses.filter(({ storyId, value, description }) => {
    const current = all[storyId]?.[statusTypeId]

    return current?.value !== value || current.description !== description
  })

  if (gone.length > 0) {
    store.unset(gone)
  }

  if (changed.length > 0) {
    store.set(changed)
  }
}

/**
 * Keeps Storybook's statuses of visual-check as the state has them, from its first change on. It writes only what
 * changed, since each write goes to every tab and a run's progress changes no status.
 *
 * The store follows the server's, and throws on a write until it has the server's statuses. What it couldn't write is
 * written when they come, or at the state's next change. Any other error of it is logged.
 *
 * @public
 */
export function startStatusSync(
  state: Pick<ManagerState, 'subscribe' | 'getState'>,
  store: Pick<StatusStoreByTypeId, 'getAll' | 'set' | 'unset' | 'onAllStatusChange'>,
): void {
  let isWriteMissed = false

  const sync = (): void => {
    const statuses = statusesOf(state.getState())

    isWriteMissed = false

    try {
      writeStatuses(statuses, store)
    } catch (error) {
      isWriteMissed = String(error).includes(notReadyText)

      if (!isWriteMissed) {
        console.error(error)
      }
    }
  }

  state.subscribe(sync)
  // The one sign in the public API that the server's statuses came.
  store.onAllStatusChange(() => {
    if (isWriteMissed) {
      sync()
    }
  })
}
