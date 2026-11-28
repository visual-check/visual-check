# Overflow breaks a story

A story whose capture would cut content its page shows, past the viewport's right edge for the full page, past the `element` box where the element doesn't clip it, or past the page's top or left edge, is a broken story with the reason `overflows`, unless it sets `allowOverflow: true` ([#179](https://github.com/visual-check/visual-check/issues/179)). A warning lost because a cut baseline matches a cut snapshot: `test` would never see a difference, and `update`, the only command with warnings, would keep approving cut baselines. A note on the snapshot that fails nothing, as page errors are, lost for the same reason. Counting content a page draws outside its element through a portal, a popover or `position: fixed` lost because it can't be measured reliably and usually sits in a layer of its own, which the story can capture with its own `element`.

## Consequences

- Content the page clips itself, by `overflow` other than `visible` on the root, on `body` or on the element, isn't overflow. One whole CSS pixel past the capture, after rounding as the capture box is rounded, is.
- A full-page capture is never cut at the bottom, since it takes the content's height, so only its right edge counts.
- Other reasons win over `overflows`: `element-missing`, `grid-too-wide` and a grid's `too-tall`, whose fixes are more specific.
- It ships as a feature, not a breaking change: it writes no baseline and changes no snapshot. A story it breaks was already being cut; the fix is the layout, a wider viewport or element, or `allowOverflow: true` when the cut is intended.
