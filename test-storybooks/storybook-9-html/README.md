# @visual-check/test-storybook-9-html

One of this repo's own test Storybooks ([PRD 18](../../docs/prd/18-repo-ci.md#this-repos-own-test-storybooks)): a private Storybook on Storybook 9.1 with the html renderer, through `@storybook/html-vite`, with its committed baselines in `.visual-check/baselines/` and the expected outcome of every snapshot in `expected-outcomes.json`. It's on Vite 7, the newest Vite that Storybook 9.1 supports.

It has no stories of its own. It reads the stories of the [Storybook 10 plain-DOM test Storybook](../storybook-10-html/README.md), takes its config from that package's `.storybook/test-storybook-config.ts`, and runs that package's `e2e.ts` from its own folder, so the check's cases are the ones that README lists: its grid stories must give the [React test Storybook](../storybook-10-react/README.md)'s images byte for byte.

## Running the end-to-end check

Until the browser image is published, every run names a locally built image through `TEST_STORYBOOK_IMAGE`, built as [Running the end-to-end check](../storybook-10-react/README.md#running-the-end-to-end-check) says. From the repo root:

```sh
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run e2e --filter @visual-check/test-storybook-9-html
```

Turbo builds the CLI, `@visual-check/storybook` and the Storybook first.

## Rewriting the baselines

Never write them here with `update`: they must be the React port's images. When a grid baseline of `storybook-10-react` changes, copy it here:

```sh
cp test-storybooks/storybook-10-react/.visual-check/baselines/grid--{every-combination,forced-states,late-styles}.png test-storybooks/storybook-9-html/.visual-check/baselines/
```
