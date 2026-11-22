import { createElement } from 'react'
import { addons, experimental_getStatusStore, experimental_getTestProviderStore, types } from 'storybook/manager-api'
import { createManagerState } from './manager-state/manager-state.js'
import { VisualCheckPanel } from './panel/addon-panel.js'
import { openPanel, panelId } from './sidebar/open-panel.js'
import { startStatusSync } from './sidebar/status-sync.js'
import { statusTypeId } from './sidebar/statuses.js'
import { testProviderOf } from './sidebar/test-provider.js'

/**
 * The ID of the addon.
 */
const addonId = 'visual-check'

/**
 * The ID of the addon's test provider.
 */
const testProviderId = `${addonId}/test-provider`

// A static build has no server to check with, so the addon shows nothing there.
if ((globalThis as { CONFIG_TYPE?: string }).CONFIG_TYPE === 'DEVELOPMENT') {
  addons.register(addonId, (api) => {
    const state = createManagerState(addons.getChannel())
    const statusStore = experimental_getStatusStore(statusTypeId)

    addons.add(panelId, {
      type: types.PANEL,
      title: 'Visual check',
      render: ({ active = false }) => createElement(VisualCheckPanel, { active, state }),
    })
    addons.add(testProviderId, testProviderOf(api, state))
    experimental_getTestProviderStore(testProviderId).onClearAll(state.clear)
    // Storybook tells every tab, and only the one it was selected in has the focus.
    statusStore.onSelect(() => {
      if (document.hasFocus()) {
        openPanel(api)
      }
    })
    startStatusSync(state, statusStore)
  })
}
