import { defineVisualCheck } from '@visual-check/storybook'

/**
 * The globals the test Storybooks declare: `theme`, which `shared-preview.ts` sets to `light` in `initialGlobals` and
 * reads in its decorator.
 */
interface Globals {
  /**
   * The story's theme. `dark` wraps the story in a dark surface. `light` leaves it as it is.
   */
  theme: 'light' | 'dark'
}

/**
 * Writes `parameters.visualCheck` for the test Storybooks, with their four modes declared once:
 *
 * - `narrow` and `wide` set only a viewport, 375 px and 1600 px wide.
 * - `dark` sets only the `theme` global to `dark`. The rules for a mode's globals apply to it: Storybook must declare
 *   `theme`, and a story that lists `dark` mustn't pin `theme` in its own `globals`.
 * - `mobile` sets a 375 × 667 viewport at scale 2, with touch, so the page has no hover and a coarse pointer.
 *
 * @public
 */
export const visualCheck = defineVisualCheck<Globals>()({
  modes: {
    narrow: { viewport: { width: 375 } },
    wide: { viewport: { width: 1600 } },
    dark: { globals: { theme: 'dark' } },
    mobile: { viewport: { width: 375, height: 667, deviceScaleFactor: 2, touch: true } },
  },
})
