# Docs site

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

One Next.js app in this repo holds the landing page and the docs. It's built last, once the behaviour it describes exists. It also holds the clean examples for users, so there are no separate example repos.

## Setup

- A private workspace package in this repo: one Next.js app with Fumadocs.
- The home page (`/`) is the landing page. The docs live under `/docs`.
- Hosted on Vercel, on Vercel's free domain for now. The owner sets up the Vercel project.
- The live site updates on each release, so it never describes unreleased behaviour. Each PR gets a preview.
- The CLI links to docs pages from the remote-content hint, `update`'s warnings and `init`'s closing message. It builds every link from one base address plus `/docs`, set when the Vercel project exists. If the site moves to its own domain later, the old address redirects.
- The logo and its colours are in `assets/logo/`.
- Examples use the `visualCheck(...)` helper. Hand-written `parameters.visualCheck` objects aren't shown.
- The docs never show branching on `process.env` in the config.

## Docs pages

All under `/docs`.

**Getting started**

- Install and `init`, then `update`, then `test`.
- It says up front that readiness never waits for the network. A failure on the first `test` means a story needs tuning: a `wait` hook, a mask or its animations.

**Config**

- Every key and its default.
- tsconfig `paths` don't work in the config.
- `init` under Rush.
- `timezone`, `locale` and `colorScheme`.

**Modes**

- Declaring modes in code and picking them by exact list. `modes: []`.
- Moving from a list of breakpoint widths.
- Phone modes are recommended at scale 2.

**Full page and `element`**

- What each captures, and what happens to portaled content.

**`color` and `pixels`**

- The two parts of tolerance: "did this pixel change?" and "how many changed pixels are allowed?".
- A worked example with ten pixels, and the measured table behind the defaults.
- Percent strings.
- CSS pixels: at scale 2, a count of 20 allows 80 image pixels.
- Why anti-aliased pixels count, and why a lower `color` isn't stricter.

**Grid stories**

- An example for each port.
- The caption rules.
- Forced states, and what they can't force.
- Running beside Storybook's pseudo-states addon.
- Fixes for a grid that's too wide or too tall.

**Animations**

- What a snapshot shows: the end state.
- What's left to the project, with a mask or a `wait` hook for it.
- `play` runs as in Storybook.
- Capture reports no preference for reduced motion.

**The `wait` hook**

- For every story, for one file, for one story, and turning it off.

**Remote content**

- Linked from the hint and from `update`'s warning.
- Why a CDN's bytes differ by machine.
- Three fixes, in order: serve the image from Storybook through `staticDirs` or an import, mock it with MSW, mask it by host.
- For MSW: use `mswLoader`, so the worker controls the page before images load. CDN URLs with no file extension warn as unhandled.

**Flaky snapshots**

- What makes a snapshot flaky, where flaky snapshots are listed, and the `retries` setting.

**Stories that break**

- Each reason and its fix.
- A stories file that fails to load.
- A story that navigates away: await the new page before clicking, or render `MemoryRouter` with `useTransitions={false}`.

**Baselines**

- Who writes them and how to review them.
- Bot PRs: pushing baselines to a bot's PR stops Dependabot rebasing it, and Renovate marks it as edited. `@dependabot recreate`, or Renovate's rebase checkbox, regenerates the branch and drops those commits.
- Long file names are shortened with a hash.

**Browser**

- A browser bump is a Renovate PR plus `update`.
- Building a custom image from the browser package's image.
- `host`: its cache folder, the proxy and mirror variables, and the Linux libraries and font package it needs. `host` baselines only match on the same OS.

**Platforms and Docker**

- The two ways to get parity: stay on `linux/amd64`, or use `linux/arm64` with the default tolerance.
- `host` gives no parity across machines. It suits a project with no CI, or one where no machine can run Docker.
- macOS: runtimes that use Rosetta, Docker Desktop's default memory and the worker count.
- Windows: Docker Desktop, running inside WSL with Docker Engine, and Docker Desktop's licence threshold.
- Setups that are untested and may work.

**CI**

- The Action and the reusable workflow: build, serve, wait, run.
- Why Linux runners only.
- Sharding: both matrix shapes, `fail-fast: false`, and shard jobs waiting for the consistency job.
- Each shard building its own Storybook, building once and passing the build along, or pointing at a deployed Storybook.
- From a failed check to the report artifact.
- A job container on visual-check's image, a job container on another image, and devcontainers that use the host's Docker.
- In a job container, that container is the only boundary, with the checkout and any stored token inside it.

**Security**

- What visual-check trusts: the stories' code. What it doesn't: remote content, and a pinned browser that gets old, so take browser package bumps.
- Where the browser runs and what the boundary is in each case.
- There are no setup steps and no flags.

**Storybook addon**

- Installing it, Check and Update, that Update's baselines come from the dev server, the panel in a static build, and that it needs Storybook 10.

**Agent skill**

- What `init` writes, how the skill refreshes after an upgrade, and allowing the command in the agent's own settings.

**Supported Storybooks**

- 9.1, 10 and 11, and when a major is dropped.
- The test-path warning.
- `.test()` entries aren't captured. An end screen worth a baseline is written as a story with `play`.

**JSON reference**

- Every field of the report, the `status`, `reason` and `kind` values, what each path is relative to, and the versioning rules.

## Landing page

- The app's home page: what visual-check is, the three commands, and a link into Getting started.

## Sources

- The map's notes for this area ([Map: visual-check v1 spec][1]), [Test apps repo][34], and the docs items of every ticket linked from the other files.
- Decided while writing this PRD: Next.js with Fumadocs, Vercel, the landing page at the home page with the docs under `/docs`, updating the live site on release, and one base address for the CLI's docs links.

[1]: https://github.com/visual-check/visual-check/issues/1
[34]: https://github.com/visual-check/visual-check/issues/34
