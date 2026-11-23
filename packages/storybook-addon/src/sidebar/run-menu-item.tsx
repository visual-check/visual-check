import React, { type ReactNode, useSyncExternalStore } from 'react'
import type { API } from 'storybook/manager-api'
import { type StorybookTheme, useTheme } from 'storybook/theming'
import type { ManagerState } from '../manager-state/manager-state.js'
import { openPanel } from './open-panel.js'

/**
 * What the menu item needs of Storybook's API.
 */
export type MenuItemApi = Pick<API, 'selectStory' | 'setSelectedPanel' | 'togglePanel'>

/**
 * What `RunMenuItem` takes.
 */
interface RunMenuItemProps {
  /**
   * What the item runs: a check of the story, or an update of its baselines.
   */
  kind: 'check' | 'update'
  /**
   * The story's ID.
   */
  storyId: string
  /**
   * Storybook's API.
   */
  api: MenuItemApi
  /**
   * The state of this manager.
   */
  state: ManagerState
}

/**
 * Each kind's item: its part's name and its label.
 */
const items = {
  check: { part: 'menu-check', label: 'Check with visual-check' },
  update: { part: 'menu-update', label: 'Update baselines with visual-check' },
} as const

/**
 * Gives the menu items' CSS, which makes them look like Storybook's own items.
 */
function menuItemCssOf({
  appBorderRadius,
  background,
  barSelectedColor,
  color,
  textMutedColor,
  typography,
}: StorybookTheme): string {
  return `
:is([data-visual-check="menu-check"], [data-visual-check="menu-update"]) {
  display: block;
  box-sizing: border-box;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: ${appBorderRadius}px;
  background: transparent;
  color: ${color.defaultText};
  font: inherit;
  font-size: ${typography.size.s1}px;
  text-align: start;
  cursor: pointer;
}
:is([data-visual-check="menu-check"], [data-visual-check="menu-update"]):hover:not([aria-disabled="true"]) {
  background: ${background.hoverable};
}
:is([data-visual-check="menu-check"], [data-visual-check="menu-update"]):focus-visible {
  outline: 2px solid ${barSelectedColor};
  outline-offset: -2px;
}
:is([data-visual-check="menu-check"], [data-visual-check="menu-update"])[aria-disabled="true"] {
  color: ${textMutedColor};
  cursor: default;
}
`
}

/**
 * Selects the story, shows the panel and asks for a check of the story or an update of its baselines. Does nothing
 * while a run is in flight.
 */
export function runFromMenu({ kind, storyId, api, state }: RunMenuItemProps): void {
  if (state.getState().run !== null) {
    return
  }

  api.selectStory(storyId)
  openPanel(api)
  state[kind](storyId)
}

/**
 * The item of a story's menu that checks it or updates its baselines. It's disabled while a run is in flight, and keeps
 * the focus.
 */
function RunMenuItem(props: RunMenuItemProps): ReactNode {
  const { subscribe, getState } = props.state
  const { run } = useSyncExternalStore(subscribe, getState, getState)
  const { part, label } = items[props.kind]

  return (
    <button type="button" data-visual-check={part} aria-disabled={run !== null} onClick={() => runFromMenu(props)}>
      {label}
    </button>
  )
}

/**
 * The items of a story's menu: the one that checks it, then the one that updates its baselines, with their CSS once.
 */
export function RunMenuItems(props: Omit<RunMenuItemProps, 'kind'>): ReactNode {
  return (
    <>
      <style>{menuItemCssOf(useTheme() as StorybookTheme)}</style>
      <RunMenuItem kind="check" {...props} />
      <RunMenuItem kind="update" {...props} />
    </>
  )
}
