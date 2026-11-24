# @visual-check/test-storybook-11-vue

One of this repo's own test Storybooks ([PRD 18](../../docs/prd/18-repo-ci.md#this-repos-own-test-storybooks)): a private Storybook on Storybook 11 with the Vue 3 renderer, through `@storybook/vue3-vite`, with its committed baselines in `.visual-check/baselines/` and the expected outcome of every snapshot in `expected-outcomes.json`. Until Storybook 11 is stable, it's on the prerelease `11.0.0-beta.3`. Its build warns that TypeScript 7 lacks the compiler API Storybook reads component types with; docgen is off, so nothing reads them, and the snapshots don't depend on it.

It has no stories of its own. It reads the stories of the [Storybook 10 Vue test Storybook](../storybook-10-vue/README.md), takes its config from that package's `.storybook/test-storybook-config.ts`, and runs [`storybook-10-html`'s `e2e.ts`](../storybook-10-html/README.md#the-end-to-end-check) from its own folder, so its grid stories must give the [React test Storybook](../storybook-10-react/README.md)'s images byte for byte, as that check's three cases say.

## Running the end-to-end check

Until the browser image is published, every run names a locally built image through `TEST_STORYBOOK_IMAGE`, built as [Running the end-to-end check](../storybook-10-react/README.md#running-the-end-to-end-check) says. From the repo root:

```sh
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run e2e --filter @visual-check/test-storybook-11-vue
```

Turbo builds the CLI, `@visual-check/storybook` and the Storybook first.

## Rewriting the baselines

Never write them here with `update`: they must be the React port's images. When a grid baseline of `storybook-10-react` changes, copy it here:

```sh
cp test-storybooks/storybook-10-react/.visual-check/baselines/grid--{every-combination,forced-states,late-styles}.png test-storybooks/storybook-11-vue/.visual-check/baselines/
```
