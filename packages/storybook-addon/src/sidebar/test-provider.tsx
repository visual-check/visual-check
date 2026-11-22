import React, { type ReactNode } from 'react'
import type { Addon_TestProviderType } from 'storybook/internal/types'
import { types } from 'storybook/manager-api'
import { type StorybookTheme, useTheme } from 'storybook/theming'
import type { ManagerState } from '../manager-state/manager-state.js'
import { CheckMenuItem, type MenuItemApi } from './check-menu-item.js'

/**
 * The line that shows among Storybook's test providers.
 */
function ProviderLine(): ReactNode {
  const { textMutedColor, typography } = useTheme() as StorybookTheme

  return (
    <div
      data-visual-check="provider"
      style={{ padding: '8px 10px', color: textMutedColor, fontSize: typography.size.s1 }}
    >
      Check one story at a time, from its Visual check panel or its menu.
    </div>
  )
}

/**
 * Gives the test provider, which adds the item that checks a story to the story's menu. Storybook's "Run tests" button
 * runs nothing of it.
 *
 * @public
 */
export function testProviderOf(api: MenuItemApi, state: ManagerState): Omit<Addon_TestProviderType, 'id'> {
  return {
    type: types.experimental_TEST_PROVIDER,
    render: ProviderLine,
    sidebarContextMenu: ({ context }) =>
      context.type === 'story' ? <CheckMenuItem storyId={context.id} api={api} state={state} /> : null,
    clear: state.clear,
  }
}
