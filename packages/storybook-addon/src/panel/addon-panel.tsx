import React, { type ReactNode, useSyncExternalStore } from 'react'
import { AddonPanel } from 'storybook/internal/components'
import { type LeafEntry, useStorybookApi, useStorybookState } from 'storybook/manager-api'
import type { ManagerState } from '../manager-state/manager-state.js'
import { type PanelStory, PanelView } from './panel-view.js'

/**
 * What `VisualCheckPanel` takes.
 */
interface VisualCheckPanelProps {
  /**
   * Whether the panel is the one that shows.
   */
  active: boolean
  /**
   * The state of this manager.
   */
  state: ManagerState
}

/**
 * Gives what the panel needs of the current entry, or `null` for anything but a story of this Storybook itself.
 */
export function storyOf(entry: LeafEntry | undefined): PanelStory | null {
  if (entry?.type !== 'story' || entry.refId !== undefined) {
    return null
  }

  return { id: entry.id, name: `${entry.title} / ${entry.name}` }
}

/**
 * visual-check's panel, on the story that is selected.
 *
 * @public
 */
export function VisualCheckPanel({ active, state }: VisualCheckPanelProps): ReactNode {
  // The current entry comes from the API, which doesn't render this again when another one is selected. The state does.
  useStorybookState()

  const entry = useStorybookApi().getCurrentStoryData()
  const current = useSyncExternalStore(state.subscribe, state.getState, state.getState)

  return (
    <AddonPanel active={active}>
      <PanelView story={storyOf(entry)} state={current} actions={state} />
    </AddonPanel>
  )
}
