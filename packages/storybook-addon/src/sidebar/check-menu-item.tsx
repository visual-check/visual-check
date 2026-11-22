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
 * What `CheckMenuItem` takes.
 */
interface CheckMenuItemProps {
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
 * Gives the menu item's CSS, which makes it look like Storybook's own items.
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
[data-visual-check="menu-check"] {
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
[data-visual-check="menu-check"]:hover:not([aria-disabled="true"]) { background: ${background.hoverable}; }
[data-visual-check="menu-check"]:focus-visible { outline: 2px solid ${barSelectedColor}; outline-offset: -2px; }
[data-visual-check="menu-check"][aria-disabled="true"] { color: ${textMutedColor}; cursor: default; }
`
}

/**
 * Selects the story, shows the panel and asks for a check of the story. Does nothing while a run is in flight.
 */
export function checkFromMenu({ storyId, api, state }: CheckMenuItemProps): void {
  if (state.getState().run !== null) {
    return
  }

  api.selectStory(storyId)
  openPanel(api)
  state.check(storyId)
}

/**
 * The item of a story's menu that checks it. It's disabled while a run is in flight, and keeps the focus.
 */
export function CheckMenuItem(props: CheckMenuItemProps): ReactNode {
  const { subscribe, getState } = props.state
  const { run } = useSyncExternalStore(subscribe, getState, getState)

  return (
    <>
      <style>{menuItemCssOf(useTheme() as StorybookTheme)}</style>
      <button
        type="button"
        data-visual-check="menu-check"
        aria-disabled={run !== null}
        onClick={() => checkFromMenu(props)}
      >
        Check with visual-check
      </button>
    </>
  )
}
