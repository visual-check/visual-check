# Grid stories draw their layout and forced states in the story's own code

`@visual-check/storybook` ships a helper for grid stories. One framework-free module works out every combination of the props a story lists, each row's caption and every element's inline styles. Thin ports for React, Vue, Angular and plain DOM draw them. A story may also list states to force, chosen by its developer from `hover`, `active`, `focus-visible`, `focus-within` and `focus`. A utility in the same package then gives every stylesheet rule using one of those states a twin selector under an ancestor class, at the same specificity: `.btn:hover` also matches `.visual-check-hover .btn`. It's adapted from Storybook's pseudo-states addon (MIT). All of it runs in the page as code the story imports, the same way in plain Storybook as under capture. Three alternatives lost ([Cartesian stories helper](https://github.com/visual-check/visual-check/issues/50)):

- **Chrome forcing the states at capture,** through `CSS.forcePseudoState` on the raw CDP driver. It reaches every stylesheet, the browser's default styles included. But a state cell would look like the default cell when the story is opened in Storybook, so the snapshot and the story would disagree. It also forces only the node it's given, and Firefox has no equivalent.
- **Storybook's pseudo-states addon,** with the grid only setting its classes. That ties forced states to Storybook, while capture outside Storybook stays possible. The addon also rewrites the stylesheets of every story on every render, and its rewrite of `:not(:hover)` breaks real hover.
- **A custom element drawing the grid,** with the ports filling it. Its shadow DOM protects captions no better than inline styles that reset inherited ones. It would add a registration guard and framework attribute quirks.

## Consequences

- Only the states a story lists are forced, and only in its state cells. The rewrite starts when a grid with state columns appears, and touches only that page.
- These aren't forced:
  - the browser's default styles, such as its default focus ring;
  - rules with the state inside `:not()`;
  - cross-origin stylesheets without CORS, which log a warning.
- The class names are visual-check's own, never `pseudo-*`. So the utility runs next to Storybook's addon, or a project's own rewriter, without either skipping the other's rules.
- The layout and caption rules are pixels in every grid story's baseline. Changing them, or how states are forced, ships only in a visual-check major.
- Every port draws the same elements with the same styles, and this repo's tests require one grid to give identical images through each.
