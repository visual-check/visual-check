import type { Decorator } from '@storybook/react-vite'
import { createElement } from 'react'
import { visualCheck } from './visual-check.ts'

/**
 * The parameters every React test Storybook's preview adds, through `previewAnnotations` in `testStorybookConfig`, so
 * every story inherits a preview-level `parameters.visualCheck`. None of it changes a snapshot:
 *
 * - `tolerance: { color: 0.01 }` is the default color tolerance.
 * - The mask `e2e-never` covers `[data-visual-check-e2e-never]`, which no story has.
 * - The `wait` hook sets the text of the story's `[data-wait-target]` element, when it has one, to `preview wait ran`,
 *   and does nothing else. Only the wait stories have that element.
 */
export const parameters = {
  ...visualCheck({
    tolerance: { color: 0.01 },
    masks: { 'e2e-never': { selector: '[data-visual-check-e2e-never]' } },
    wait: ({ canvasElement }) => {
      const target = canvasElement.querySelector('[data-wait-target]')

      if (target !== null) {
        target.textContent = 'preview wait ran'
      }
    },
  }),
}

/**
 * The globals every React test Storybook declares, with their starting values. Declaring `theme` here lets the `dark`
 * mode set it in the story's URL, since Storybook drops a global it doesn't declare.
 */
export const initialGlobals = { theme: 'light' }

/**
 * The look of the dark surface the `dark` theme wraps a story in.
 */
const darkSurfaceStyle = { padding: 16, background: '#111', color: '#eee' }

/**
 * Wraps the story in a dark surface when the `theme` global is `dark`. With any other theme, `light` included, it
 * renders the story as it is, so no snapshot outside the `dark` mode changes.
 */
const withTheme: Decorator = (Story, context) => {
  if (context.globals.theme !== 'dark') {
    return createElement(Story)
  }

  return createElement('div', { style: darkSurfaceStyle }, createElement(Story))
}

/**
 * The decorators every React test Storybook's preview adds.
 */
export const decorators = [withTheme]
