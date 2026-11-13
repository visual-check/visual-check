# Per-story options

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

Everything a project sets for a Storybook, a stories file or a story lives in `parameters.visualCheck`, written through a typed helper. Storybook merges the levels, and visual-check reads the result in the browser before it captures ([ADR 0004](../adr/0004-per-story-options-in-storybook-parameters.md)).

## Where options live

- **Keys:** `modes`, `viewport`, `element`, `masks`, `tolerance`, `wait` and `disable`. Any other key exits 2.
- **Levels:** `preview` for every story of a Storybook, a stories file's meta for that file, and the story.
- The project's config sits beneath `preview`, with defaults for `tolerance`, `viewport` and `maskColor` only. It holds no masks and no modes.
- visual-check reads no tags, not even Storybook's `!test`.
- `play` gets no option. It finishes before the story is ready.

How levels merge, through Storybook's own merging:

| Key | Merge |
|---|---|
| `modes` | The most specific level's list wins |
| `viewport` | Deep-merges, so a story can set `{ width: 375 }` alone |
| `tolerance` | Deep-merges, so a level can set only `color` or only `pixels` |
| `masks` | Merges by name |
| `wait`, `element`, `disable` | The most specific level wins |

## The helper

- `defineVisualCheck` comes from `@visual-check/storybook`.
- `init` writes `<configDir>/visual-check.ts` with `modes: {}` and a commented example ([Config and init](03-config-and-init.md)). The project declares the Storybook's modes there once, for example:

  ```ts
  import { defineVisualCheck } from '@visual-check/storybook'

  export const visualCheck = defineVisualCheck({
    modes: {
      dark: { globals: { theme: 'dark' } },
      mobile: { viewport: { width: 375, height: 667, deviceScaleFactor: 2, touch: true } },
    },
  })
  ```

- `visualCheck({ ... })` takes every option and returns `{ visualCheck: ... }`, to spread into `parameters` in `preview`, a meta or a story.
- Mode names are type-checked against the declaration, and a generic can type `globals`. The package ships no `Parameters` augmentation.
- For options, stories files import the project's `visual-check.ts`, not the package. A stories file that renders the grid also imports `@visual-check/storybook` or one of its subpaths.
- A hand-written `parameters.visualCheck` object works and gets the same validation, but the docs don't show it.
- **What the helper writes for modes:** one entry per declared mode, holding its definition when the level lists it and `null` when it doesn't. Storybook's merging then gives "the most specific list wins" with no merging code of visual-check's own.

## Validation

Every story's merged options are checked before any capture. Each of these exits 2, naming the story and the key:

- an unknown key or a wrong type;
- a bad mode name;
- one mode name with different settings in two stories of the same Storybook. The message names both stories;
- a mode that sets a global the Storybook doesn't declare, which Storybook would silently drop. A global counts as declared when the running Storybook would accept it from the URL: on 9.1 and 10, a key in `initialGlobals` or `globalTypes`;
- a global value with characters other than letters, digits, spaces, `_` and `-`;
- a mode that sets a global the story or its meta pins in its own `globals`, because the pinned value wins and the snapshot would equal the default capture;
- a `pixels` value that isn't a whole number of 0 or more, or a string from `'0%'` to `'100%'`.

## Modes

- A mode is declared once per Storybook. It sets `globals`, a `viewport`, or both. It can't set `tolerance`, `masks`, `element` or args.
- Different Storybooks may reuse a mode name.
- **Picking modes:** `modes: ['dark', 'mobile']` in `preview`, a meta or a story is the exact set for those stories.
  - `modes: []` means the default capture only.
  - A newly declared mode doesn't reach stories that list their own modes.
- **The default capture is always taken.** Each listed mode adds one snapshot. So adding or removing a mode never renames another baseline.
- There's no matrix. A combination such as `dark-mobile` is declared by hand.
- **Names** take lowercase letters, digits and `-`. `chromium`, `webkit` and `firefox` are reserved.
- A mode's globals go into the story's URL.

## Viewport

- `{ width, height, deviceScaleFactor, touch }`, in CSS pixels.
- The config's `viewport` is the default capture's viewport when `preview` sets none. A story's `viewport` sets its own default capture. A mode's viewport merges over it, so the mode wins.
- `touch: true` turns on touch and mobile emulation together: no hover, a coarse pointer and overlay scrollbars.
- Storybook's own viewport global does nothing on a story's page, so visual-check sizes the page itself.
- Nothing changes the scale automatically. The docs recommend phone modes at scale 2.

## Capture area

- **Full page** is the default. The whole document is captured at the viewport's width, beyond the viewport's height, without resizing it.
  - `100vh` stays the viewport's height, and fixed elements are painted once.
  - Dialogs and drawers portaled outside the story are included.
- **`element: '<selector>'`** captures that element's box. `element: null` returns to the full page.
  - Anything portaled outside the box is lost, and anything overlapping it is included.
  - No match, or a box of zero size, makes a broken story (`element-missing`).
- A capture over 32,767 device pixels on either side makes a broken story (`too-tall`). The message says to set `element` or a smaller viewport.

## Leaving stories out

- `disable: true` at any level skips a story or a file. `disable: false` brings one story of a disabled file back.
- A disabled story's baselines become orphans, and `update` deletes them.

## Masks

- `masks: { <name>: { selector: '...' } | { host: '...' } }`.
- Levels merge by name. `<name>: null` drops one inherited mask, and `masks: null` drops them all.
- **A selector mask** covers each matching element's box.
- **A host mask** covers every element that shows remote content from that host:
  - images in any form, CSS images, and cross-origin iframes as their whole rectangle;
  - a remote CSS background masks its whole element, text included.
- **Painting:** an opaque box in `maskColor`, painted in the page just before capture, after the end-state step. It sits in the top layer, so it covers dialogs too.
- Baselines and snapshots both carry the box. So the visual diff needs no mask data, and the byte comparison still works.
- If a masked element grows, shrinks or moves, its box does too, and those pixels count.
- Changing `maskColor` changes every baseline that has a mask.
- Known behaviour: an ancestor's `overflow: hidden` doesn't clip the box, and a mask inside an iframe is clipped to the iframe.

## Tolerance

- `tolerance: { color, pixels }` is the same object in the config, `preview`, a meta and a story. Its units and rules are in [Visual diff](09-visual-diff.md).
- Retries and `update`'s stability checks use each story's own tolerance.

## `wait`

- The `wait` hook is described in [Readiness and stability](06-readiness-and-stability.md).

## How options are read

- The in-page script calls the preview's `loadStory` for each story of the stories files it needs, and gets that story's merged parameters.
- All files load at once, and each loads or fails by itself. A file that fails makes its stories broken stories (`load-failed`) and never stops the others.
- Storybook's `extract()` is never called, and MDX docs files never load.
- Options are read in the browser that captures. Nothing is cached between runs, because `index.json` doesn't change when a file's options do.

| Run | Stories files it loads |
|---|---|
| `test` or `update`, any selection | All of them |
| `test --consistency` | All of them |
| `test --shard k/n` | Only its own |

- Because the consistency check covers every story, a local run of affected stories still loads every file. On a cold dev server, that compiles them all once.

## Not in v1

Each can be added later without breaking anyone:

- a matrix of modes;
- snapshots at steps of `play`;
- an option that ignores anti-aliased pixels;
- ready-made wait helpers, and typing for CSF Next;
- per-mode timezone, locale or colour scheme.

Combined snapshots aren't deferred: they're removed from the design. Stories lay out combinations with the grid instead ([Grid stories](08-grid-stories.md)).

## Sources

- [Per-story options][37], [Reading per-story options][46], [Remote content that differs between machines][35], [Late network requests after storyFinished][25], [Combined snapshots and network paths in v1][47], [Storybook 9 floor and Storybook 11][48], [Config file shape and init wizard][38], [Feature and config landscape][6].
- [ADR 0001](../adr/0001-baseline-key-excludes-platform.md), [ADR 0004](../adr/0004-per-story-options-in-storybook-parameters.md).
- Decided while writing this PRD: what the helper writes for modes, that a mode name means one thing inside a Storybook, and that a mode can't set the timezone, locale or colour scheme.

[6]: https://github.com/visual-check/visual-check/issues/6
[25]: https://github.com/visual-check/visual-check/issues/25
[35]: https://github.com/visual-check/visual-check/issues/35
[37]: https://github.com/visual-check/visual-check/issues/37
[38]: https://github.com/visual-check/visual-check/issues/38
[46]: https://github.com/visual-check/visual-check/issues/46
[47]: https://github.com/visual-check/visual-check/issues/47
[48]: https://github.com/visual-check/visual-check/issues/48
