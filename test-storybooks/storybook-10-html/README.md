# @visual-check/test-storybook-10-html

One of this repo's own test Storybooks ([PRD 18](../../docs/prd/18-repo-ci.md#this-repos-own-test-storybooks)): a private Storybook on Storybook 10 with the html renderer, through `@storybook/html-vite`. Its grid stories are drawn in plain DOM with `combinations()` from `@visual-check/storybook`, and must give the [React test Storybook](../storybook-10-react/README.md)'s images byte for byte. Its committed baselines are in `.visual-check/baselines/`, and the expected outcome of every snapshot in `expected-outcomes.json`.

It has no pseudo-states addon and no preview annotations: the React test Storybooks' shared preview changes no grid snapshot.

## The grid stories

`stories/grid.stories.ts` holds the `Grid` stories, with the React grid stories' IDs and DOM. Their chips' looks, CSS and `play` checks come from `storybook-10-react/stories/grid-parts.ts`, so the grid is literally the same.

- `EveryCombination` lists two tones, two sizes and two titles: 8 captioned rows, every accent chip green.
- `ForcedStates` forces `hover` and `focus-visible` on a chip styled by a `<style>`, inside the `forced-states-theme` wrapper. `play` checks the headers and each cell's computed style.
- `LateStyles` forces `hover`, and its `play` adds the hover rules once the grid is in the page. It's the plain-DOM port's lifecycle check: forcing must stay on after the grid is drawn.

Each committed baseline is a copy of `storybook-10-react`'s same-named baseline.

## The end-to-end check

`e2e.ts` serves the static build and runs the built CLI against it, in three cases:

1. `test --all` passes every grid story against the committed baselines.
2. The committed baselines are `storybook-10-react`'s, byte for byte.
3. `update` into an empty folder writes `storybook-10-react`'s baselines, byte for byte. When it doesn't, the written baselines are copied to `e2e-output/`.

The checks themselves are pure functions in `e2e-checks.ts`, unit tested in `e2e-checks.test.ts`.

## Running the end-to-end check

Until the browser image is published, every run names a locally built image through `TEST_STORYBOOK_IMAGE`, built as [Running the end-to-end check](../storybook-10-react/README.md#running-the-end-to-end-check) says. From the repo root:

```sh
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run e2e --filter @visual-check/test-storybook-10-html
```

Turbo builds the CLI, `@visual-check/storybook` and the Storybook first.

## Rewriting the baselines

Never write them here with `update`: they must be the React port's images. When a grid baseline of `storybook-10-react` changes, copy it here:

```sh
cp test-storybooks/storybook-10-react/.visual-check/baselines/grid--{every-combination,forced-states,late-styles}.png test-storybooks/storybook-10-html/.visual-check/baselines/
```
