import { defineVisualCheck } from '@visual-check/storybook'

/**
 * Writes `parameters.visualCheck` for the test Storybooks, with their two modes declared once. Each mode sets only a
 * viewport, so no rule for a mode's globals ever applies to them.
 *
 * @public
 */
export const visualCheck = defineVisualCheck({
  modes: {
    narrow: { viewport: { width: 375 } },
    wide: { viewport: { width: 1600 } },
  },
})
