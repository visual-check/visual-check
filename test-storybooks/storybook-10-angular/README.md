# @visual-check/test-storybook-10-angular

One of this repo's own test Storybooks ([PRD 18](../../docs/prd/18-repo-ci.md#this-repos-own-test-storybooks)): a private Storybook on Storybook 10 with Angular 21, through `@storybook/angular`, built by the Angular CLI through `angular.json`. Its grid stories are drawn in Angular with `combinations()` from `@visual-check/storybook/angular`, and must give the [React test Storybook](../storybook-10-react/README.md)'s images byte for byte. Its committed baselines are in `.visual-check/baselines/`, and the expected outcome of every snapshot in `expected-outcomes.json`.

It has no pseudo-states addon and no preview annotations: the React test Storybooks' shared preview changes no grid snapshot.

## The grid stories

`stories/grid.stories.ts` holds the `Grid` stories, with the React grid stories' IDs and DOM, written with standalone `@Component` classes whose inputs are signal inputs. Their chips' looks, CSS and `play` checks come from `storybook-10-react/stories/grid-parts.ts`, so the grid is literally the same.

An accent chip injects its colour through an `InjectionToken`, with a red default; the meta's `moduleMetadata` decorator provides green around every story, so a red chip in a snapshot means the injector didn't reach the grid's cells.

- `EveryCombination` lists two tones, two sizes and two titles: 8 captioned rows, every accent chip green. Its `play` checks each accent chip's computed background is the green accent, so a missed provider fails even before the image is compared.
- `ForcedStates` forces `hover` and `focus-visible` on a chip styled by a `<style>`, inside the `forced-states-theme` wrapper. `play` checks the headers and each cell's computed style.
- `LateStyles` forces `hover`, and its `play` adds the hover rules once the grid is in the page. It's the Angular port's lifecycle check: forcing must stay on after the grid is created.

Angular pulls a template's `<style>` out into the component's scoped styles, so the stories put their CSS in the canvas through `<vc-style>`, a small component that appends a real `<style>` to its host. `ForcedStates` and `LateStyles` wrap the grid's `template` in their own markup, spreading its `props` and `moduleMetadata`.

Each committed baseline is a copy of `storybook-10-react`'s same-named baseline.

## The config

Storybook's Angular framework only builds through the Angular CLI's builders, so the scripts run `ng run test-storybook:build-storybook` and `ng run test-storybook:storybook`, never `storybook build`. `angular.json` turns compodoc off (it isn't installed) and runs zoneless, so no zone.js loads at run time. The dev target's `browserTarget` names the build target, since the start builder has no default for it and Storybook rejects a start without one.

The stories are compiled by the Angular CLI with `.storybook/tsconfig.json`, which pins its own TypeScript 5.9 (the workspace's TypeScript 7 runs no Angular compiler). It includes `grid-parts.ts`, since the Angular compiler needs every compiled file in its program, and maps `@angular/core` to this package's own install in `paths`, so the port's types in `@visual-check/storybook` and the stories share one Angular's types. Relative imports in the stories have no extension: the Angular build accepts neither `allowImportingTsExtensions` nor `rewriteRelativeImportExtensions`.

`.storybook/test-storybook-config.ts` gives webpack this package's `node_modules` first, through `ownModulesFirst`, so Storybook's renderer, the port in `@visual-check/storybook`'s build and the stories share one Angular: with two copies, the meta's providers wouldn't reach the cells.

## The end-to-end check

It runs [`storybook-10-html`'s `e2e.ts`](../storybook-10-html/README.md#the-end-to-end-check) from its own folder, with its three cases: `test --all` passes, the committed baselines are `storybook-10-react`'s, and `update` into an empty folder writes `storybook-10-react`'s baselines, byte for byte.

## Running the end-to-end check

Until the browser image is published, every run names a locally built image through `TEST_STORYBOOK_IMAGE`, built as [Running the end-to-end check](../storybook-10-react/README.md#running-the-end-to-end-check) says. From the repo root:

```sh
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run e2e --filter @visual-check/test-storybook-10-angular
```

Turbo builds the CLI, `@visual-check/storybook` and the Storybook first.

## Rewriting the baselines

Never write them here with `update`: they must be the React port's images. When a grid baseline of `storybook-10-react` changes, copy it here:

```sh
cp test-storybooks/storybook-10-react/.visual-check/baselines/grid--{every-combination,forced-states,late-styles}.png test-storybooks/storybook-10-angular/.visual-check/baselines/
```
