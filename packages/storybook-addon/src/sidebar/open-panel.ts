import type { API } from 'storybook/manager-api'

/**
 * The ID of visual-check's panel.
 *
 * @public
 */
export const panelId = 'visual-check/panel'

/**
 * Shows visual-check's panel, whether the panels are hidden or show another one.
 *
 * @public
 */
export function openPanel(api: Pick<API, 'setSelectedPanel' | 'togglePanel'>): void {
  api.setSelectedPanel(panelId)
  api.togglePanel(true)
}
