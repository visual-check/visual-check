# @visual-check/test-storybook-11-angular

One of this repo's own test Storybooks ([PRD 18](../../docs/prd/18-repo-ci.md#this-repos-own-test-storybooks)): a private Storybook on Storybook 11 with Angular 22, through `@storybook/angular`, built by the Angular CLI through `angular.json`, with its committed baselines in `.visual-check/baselines/` and the expected outcome of every snapshot in `expected-outcomes.json`. Until Storybook 11 is stable, it's on the prerelease `11.0.0-beta.3`. The stories compile with TypeScript 6.0, the one Angular 22's compiler takes.

It has no stories of its own. It reads the stories of the [Storybook 10 Angular test Storybook](../storybook-10-angular/README.md), takes its config from that package's `.storybook/test-storybook-config.ts`, and runs [`storybook-10-html`'s `e2e.ts`](../storybook-10-html/README.md#the-end-to-end-check) from its own folder, so its grid stories must give the [React test Storybook](../storybook-10-react/README.md)'s images byte for byte, as that check's three cases say. Its `angular.json` is that package's, and its `.storybook/tsconfig.json` maps `@angular/core` to this package's own install in `paths`, so the shared stories compile and bundle against this package's Angular. `test:type` checks the stories with `.storybook/tsconfig.type-check.json`, which also maps `@storybook/angular` and `storybook/test` to this package's own type files, so they're checked against this version's Storybook types; the build's tsconfig leaves those two out, since webpack applies its `paths` too and would bundle the type files.

## Running the end-to-end check

Until the browser image is published, every run names a locally built image through `TEST_STORYBOOK_IMAGE`, built as [Running the end-to-end check](../storybook-10-react/README.md#running-the-end-to-end-check) says. From the repo root:

```sh
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run e2e --filter @visual-check/test-storybook-11-angular
```

Turbo builds the CLI, `@visual-check/storybook` and the Storybook first.

## Rewriting the baselines

Never write them here with `update`: they must be the React port's images. When a grid baseline of `storybook-10-react` changes, copy it here:

```sh
cp test-storybooks/storybook-10-react/.visual-check/baselines/grid--{every-combination,forced-states,late-styles}.png test-storybooks/storybook-11-angular/.visual-check/baselines/
```
