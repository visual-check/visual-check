# @visual-check/test-storybook-10-vue

One of this repo's own test Storybooks ([PRD 18](../../docs/prd/18-repo-ci.md#this-repos-own-test-storybooks)): a private Storybook on Storybook 10 with the Vue 3 renderer, through `@storybook/vue3-vite`. Its grid stories are drawn in Vue with `<Combinations>` from `@visual-check/storybook/vue`, and must give the [React test Storybook](../storybook-10-react/README.md)'s images byte for byte. Its committed baselines are in `.visual-check/baselines/`, and the expected outcome of every snapshot in `expected-outcomes.json`.

It has no pseudo-states addon and no preview annotations: the React test Storybooks' shared preview changes no grid snapshot.

## The grid stories

`stories/grid.stories.ts` holds the `Grid` stories, with the React grid stories' IDs and DOM, written with render functions only. Their chips' looks, CSS and `play` checks come from `storybook-10-react/stories/grid-parts.ts`, so the grid is literally the same.

An accent chip injects its colour with a red default; the meta's decorator provides green around every story, so a red chip in a snapshot means `provide` didn't reach the grid's cells.

- `EveryCombination` lists two tones, two sizes and two titles: 8 captioned rows, every accent chip green. Its `play` checks each accent chip's computed background is the green accent, so a missed `provide` fails even before the image is compared.
- `ForcedStates` forces `hover` and `focus-visible` on a chip styled by a `<style>`, inside the `forced-states-theme` wrapper. `play` checks the headers and each cell's computed style.
- `LateStyles` forces `hover`, and its `play` adds the hover rules once the grid is in the page. It's the Vue port's lifecycle check: forcing must stay on after the grid is mounted.

Each committed baseline is a copy of `storybook-10-react`'s same-named baseline.

## The config

`.storybook/test-storybook-config.ts` turns docgen off: the stories hold no `.vue` file, and docgen would load `vue-component-meta`, which needs TypeScript's JS API, which TypeScript 7 doesn't have. It dedupes `vue` as well as `storybook`, so Storybook's renderer, the port in `@visual-check/storybook`'s build and the stories share one Vue, resolved from this package: with two copies, `provide` wouldn't reach the cells.

## The end-to-end check

It runs [`storybook-10-html`'s `e2e.ts`](../storybook-10-html/README.md#the-end-to-end-check) from its own folder, with its three cases: `test --all` passes, the committed baselines are `storybook-10-react`'s, and `update` into an empty folder writes `storybook-10-react`'s baselines, byte for byte.

## Running the end-to-end check

Until the browser image is published, every run names a locally built image through `TEST_STORYBOOK_IMAGE`, built as [Running the end-to-end check](../storybook-10-react/README.md#running-the-end-to-end-check) says. From the repo root:

```sh
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run e2e --filter @visual-check/test-storybook-10-vue
```

Turbo builds the CLI, `@visual-check/storybook` and the Storybook first.

## Rewriting the baselines

Never write them here with `update`: they must be the React port's images. When a grid baseline of `storybook-10-react` changes, copy it here:

```sh
cp test-storybooks/storybook-10-react/.visual-check/baselines/grid--{every-combination,forced-states,late-styles}.png test-storybooks/storybook-10-vue/.visual-check/baselines/
```
