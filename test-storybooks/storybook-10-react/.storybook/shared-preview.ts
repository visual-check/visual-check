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
