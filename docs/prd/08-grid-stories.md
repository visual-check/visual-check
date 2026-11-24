# Grid stories

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

visual-check ships a grid component in `@visual-check/storybook`. A project uses it in a story to render one component in every combination of the props it lists, with captions, and maybe in forced states. "Grid story" is only shorthand for a story that renders the grid: it's an ordinary story with one baseline per mode. Everything runs in the page as code the story imports, the same way in plain Storybook as under capture ([ADR 0009](../adr/0009-grid-stories-draw-everything-in-the-story.md)).

## Ports

| Entry                             | Export           | For                                                      |
| --------------------------------- | ---------------- | -------------------------------------------------------- |
| `@visual-check/storybook/react`   | `<Combinations>` | React 18 and 19                                          |
| `@visual-check/storybook/vue`     | `Combinations`   | Vue 3                                                    |
| `@visual-check/storybook/angular` | `combinations()` | Angular 18 and later                                     |
| `@visual-check/storybook`         | `combinations()` | Plain DOM: Storybook's html and web-components renderers |

- One framework-free module works out the rows, each caption's text and every element's inline styles. Each port only turns that into elements.
- Cells stay in the framework's own tree, so React context, Vue's `provide` and Angular's injector reach them.
- There's no custom element.
- Every port works on Storybook 9.1, 10 and 11, and nothing in the grid depends on Storybook.
- The Vue and Angular ports are v1 work, an exception to "other frameworks come after the migration targets".
- The Angular port returns the story's `template`, `props` and `moduleMetadata`. It's plain TypeScript with no Angular build step, and signal inputs work.

## Inputs

The same in every port:

| Input       | Meaning                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `component` | The component in every cell. The plain-DOM port takes `render` instead: a function that returns a node or HTML |
| `props`     | The values to try for each prop. Every combination is a row                                                    |
| `args`      | Props that every cell shares                                                                                   |
| `states`    | The states to force, one column each: `hover`, `active`, `focus-visible`, `focus-within`, `focus`              |
| `cellWidth` | A fixed width in CSS pixels for every column                                                                   |
| `caption`   | `(props) => string`, called with a row's varying props. It replaces the default caption                        |

## Layout

These rules are pixels in the baseline of every story that renders a grid. They change only in a visual-check major.

- **Rows** are the combinations, in the order the props were declared, with the last prop changing fastest.
- **Columns:** the default state first, then each forced state in the order given.
- **Header row:** with states, one header row names each column: `default`, `:hover`, `:focus-visible`. Without states there's no header row.
- **Captions:** each row's caption appears once, above the row, spanning it. It wraps at the row's width and never widens a column.
- **Spacing:**
  - 16 px between columns;
  - 4 px between a caption and its row's cells;
  - 16 px between rows, and between the header row and the first row;
  - nothing around the grid.
- **Cells** sit at the top-left of their column. With `cellWidth`, each cell is exactly that wide. A column is as wide as its widest cell, or exactly `cellWidth`.
- The grid has no background, border or padding, so the page's background shows through and modes change it.
- The grid never wraps.

### Captions

- **Text:** `key: value` for each prop that varies, joined by `, ` in declaration order. Example: `variant: outline, size: lg, disabled: true`.
- A prop varies when the story lists two or more values for it. A prop with one value is treated like a shared prop and left out.
- Shared `args` never appear.
- Strings appear without quotes. Numbers, booleans, `null` and `undefined` appear as JavaScript prints them. Anything else shows as `…` unless the story passes `caption`.
- A row with no varying props has no caption.
- **Style,** for captions and the header row: 11 px text on 14 px lines, the generic `monospace` font, grey `#737373`.
- Captions and headers reset every inherited style. Cells inherit from the page.

## Forced states

- The story's developer lists the states. Only those are forced, and only in their own columns.
- **How:** every stylesheet rule that uses a listed state gets a twin selector under an ancestor class, at the same specificity. `.btn:hover` also matches `.visual-check-hover .btn`.
- Each state cell sits in a wrapper with that state's class:
  - `visual-check-hover`;
  - `visual-check-active`;
  - `visual-check-focus`;
  - `visual-check-focus-visible`;
  - `visual-check-focus-within`.
- The rewrite starts when a grid with state columns appears, and touches only that page. It runs again when styles are added or changed, CSS-in-JS rules inserted from script included.
- It reaches `<style>` and `<link>` sheets, `adoptedStyleSheets` and sheets in shadow roots.
- A story can force states outside a grid with `forceStates(states)` from `@visual-check/storybook`, and put the class on any ancestor.
- A transition that a forced rule starts is finished by the end state.

What isn't forced:

- the browser's own default styles, such as its default focus ring;
- rules with the state inside `:not()`;
- cross-origin stylesheets without CORS, which log a warning;
- in a shadow root, a selector whose states are all nested in `:is()`, `:where()` or `:has()`, and one that starts with `:host-context()`;
- closed shadow roots attached before the first grid with states or `forceStates` call;
- a sheet pushed onto `adoptedStyleSheets`, rather than assigned, with no change to the DOM after it;
- rules inside `@media (hover: hover)` in a mode that emulates touch, since the media query doesn't match.

Other notes:

- The class names are visual-check's own, never `pseudo-*`. So the utility runs beside Storybook's pseudo-states addon, or a project's own rewriter, and neither skips the other's rules.
- The utility is adapted from Storybook's pseudo-states addon (MIT). The package carries its notice.

## What capture checks

Capture finds every grid by its `data-visual-check-grid` attribute in the top document, after the end state.

- **Too wide:** a story whose grid is wider than the viewport is a broken story (`grid-too-wide`). A grid's width is its border box's, rounded up to whole CSS pixels, against the snapshot's viewport width. The rule holds whatever the capture area is, `element` included. Its details carry the grid's width and the viewport's.
  - The message names three fixes: give the story its own `viewport` width, list `modes` without the narrow ones, or set a smaller `cellWidth`.
  - A mode's viewport wins over the story's. So in a phone mode, the fix is to leave that mode out.
  - visual-check never widens the viewport by itself.
  - The story gets an image of its page, like `element-missing`.
- **Too tall:** a grid whose own box, at the viewport's scale, is over 32,767 device pixels on a side is a broken story (`too-tall`), whatever the capture area is. The message ends "Split the grid into several stories." Nothing is captured. At scale 2 that's about 16,383 CSS pixels. A grid too wide is reported as too wide, never as too tall.
- There's no cap on the number of cells.

## Tests in this repo

- One grid rendered through every port must give identical images.
- Every port must render on Storybook 9.1, 10 and 11 ([CI for this repo](18-repo-ci.md)).
- The test apps get no grid and no Vue or Angular app.

## Sources

- [Cartesian stories helper][50], [Combined snapshots and network paths in v1][47], [Storybook 9 floor and Storybook 11][48].
- [ADR 0002](../adr/0002-capture-on-storybook-test-path.md), [ADR 0009](../adr/0009-grid-stories-draw-everything-in-the-story.md).
- Decided while writing this PRD: the header row's style and gap, when a prop varies, the `caption` signature, `forceStates`, the class names, and the width rule with `element`.
- Decided while building the grid (#89):
  - the width rule uses the grid's own width, not its right edge;
  - a grid too tall breaks the story by the grid's own size, whatever the capture area;
  - a prop listed with no values throws, so the story is a broken story (`error`); a value list given as `undefined` counts as not listed;
  - every prop the component requires comes from `args` or `props`;
  - with `cellWidth`, each cell is exactly that wide; without it, each cell keeps its own width at its column's left;
  - React 18 runs in the React port's unit tests, and this repo's test Storybooks run React 19;
  - the React port's types need TypeScript 5.4 or later;
  - the root entry also exports the framework-free module: `gridLayoutOf`, `gridAttribute` and their types.
- Decided while building forced states (#90):
  - twins rewrite in place as `:is(.visual-check-<state> *)`, so `.btn:hover` gets `.btn:is(.visual-check-hover *)`, at the same specificity; a state after a pseudo-element moves in front of it;
  - in shadow roots, twins put the condition on the host, as `:host(:where(.visual-check-<state>)) …` or `:host(.visual-check-<state>)`, and every shadow host inside a state cell gets that state's class;
  - these aren't forced through the host: a shadow-root selector whose states are all nested in `:is()`, `:where()` or `:has()`, and one that starts with `:host-context()`;
  - a selector with several listed states gets one twin with all of them forced;
  - the listed states are the union of every grid and `forceStates` call on the page;
  - twins stay after the grid unmounts, and are inert;
  - hooks are installed on the first request and kept, inert. Closed shadow roots attached before then aren't reached. A sheet pushed onto `adoptedStyleSheets`, rather than assigned, is reached only on the next change to the DOM;
  - `forceStates` returns the function that stops it, and does nothing without a DOM;
  - a header never widens a column;
  - an unknown or repeated state throws;
  - the React port forces states in `useInsertionEffect`;
  - the rewrite edits `selectorText` in place, so other rewriters' rule objects and indexes survive.
- Decided while building the plain-DOM port (#91):
  - `combinations()` gives the grid's element, a `<div>`, for the story to return or place. It needs a DOM, and throws without one;
  - `render` is called once per cell, in document order, with the row's props. It returns a new node or a string of HTML, which becomes the cell's content. The same node for two cells, or anything other than a node or a string, throws;
  - styles are set property by property, in the layout's order;
  - a lit template isn't a node, so `render` throws on one. With web components, it renders the template into an element first;
  - the plain-DOM port forces its states from the call, before any cell is rendered, until the grid, once in the page, leaves it. A grid that never enters the page keeps them forced. If `render` throws, or watching the page fails, forcing stops;
  - the test Storybooks use Storybook's html renderer (`test-storybooks/storybook-<major>-html/`). The web-components renderer mounts a returned node the same way and has no test Storybook here;
  - the plain-DOM Storybooks hold `EveryCombination`, `ForcedStates` and `LateStyles`, and their `update` must write the React Storybook's baselines byte for byte.

[47]: https://github.com/visual-check/visual-check/issues/47
[48]: https://github.com/visual-check/visual-check/issues/48
[50]: https://github.com/visual-check/visual-check/issues/50
