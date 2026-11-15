# @visual-check/test-storybook-9-react

One of this repo's own test Storybooks ([PRD 18](../../docs/prd/18-repo-ci.md#this-repos-own-test-storybooks)): a private React Storybook on Storybook 9.1, with its committed baselines in `.visual-check/baselines/` and the expected outcome of every snapshot, modes included, in `expected-outcomes.json`. It's on Vite 7, the newest Vite that Storybook 9.1 supports.

It has no stories of its own. It reads the stories of the [Storybook 10 test Storybook](../storybook-10-react/README.md), takes its config from that package's `.storybook/test-storybook-config.ts`, and runs that package's `e2e.ts` from its own folder, so the check's cases are the ones that README lists.

## Running the end-to-end check

Until the browser image is published, every run names a locally built image through `TEST_STORYBOOK_IMAGE`, built as [Running the end-to-end check](../storybook-10-react/README.md#running-the-end-to-end-check) says. From the repo root:

```sh
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run e2e --filter @visual-check/test-storybook-9-react
```

Turbo builds the CLI, `@visual-check/storybook` and the Storybook first.

## Rewriting the baselines

Follow [Rewriting the baselines](../storybook-10-react/README.md#rewriting-the-baselines) from this folder, building with `--filter @visual-check/test-storybook-9-react...`. The broken stories' baselines are copies of the Storybook 10 test Storybook's, since the stories are the same.
