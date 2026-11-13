# visual-check v1: product requirements

This is the v1 spec for visual-check, the destination of [Map: visual-check v1 spec][1]. It states only final decisions. Each area has one file, precise enough to slice into implementation tickets, and links the tickets and ADRs that hold the reasoning. Terms come from the [glossary](../../GLOSSARY.md), and hard-to-reverse choices are in [docs/adr](../adr/).

## Problem

A project that uses Storybook wants to know whether a code change alters how its stories look, compared with what was approved. Today that takes a hand-built Playwright harness per project: about 2,000 lines in the migration target, with config that differs between projects and no way to check only what a change can affect. The hosted tools need a service, and the open-source one this replaces is no longer maintained.

## Goals

- **Fast capture.** The migration target's CI capture takes 4:45 on 2 vCPUs today. v1 has to beat it from capture speed alone.
- **Easy setup.** One command sets a project up, and a first `update` then `test` passes without editing stories.
- **Same pixels locally and in CI,** by default.
- **Runs locally and in the project's own CI.** No hosted service.

## Users

- **A developer** in a single repo or a monorepo with one or more Storybooks, who runs `test` before pushing and `update` when a change is intended.
- **CI,** which runs `test` on every PR and never writes baselines.
- **A coding agent,** which runs visual-check through the installed skill and reports what changed.
- **A reviewer,** who opens a failed check's report artifact.

## What "v1 is done" means

- The migration target, the app target and the design system target rely on visual-check in CI.
- It's ready for public npm release, as 1.0.0. Until then, packages are `0.x`.
- Storybook 11 is supported, because the migration target moves to 11 once it's stable.
- The docs site is live. It's built last.
- `visual-check/visual-check`, `visual-check/test-apps` and `visual-check/action` are public.

## Areas

| # | Area | Covers |
|---|---|---|
| 1 | [Packages](01-packages.md) | The four npm packages and what each holds |
| 2 | [CLI and commands](02-cli.md) | `init`, `test`, `update`, flags and exit codes |
| 3 | [Config and `init`](03-config-and-init.md) | The config file, its keys, and what `init` detects, asks and writes |
| 4 | [Capture engine](04-capture-engine.md) | The raw CDP driver, pages, hazards, retries and speed |
| 5 | [Browser and platform](05-browser-and-platform.md) | The platform key, Docker, the network path, `host`, the image and the sandbox |
| 6 | [Readiness and stability](06-readiness-and-stability.md) | Supported Storybooks, readiness, the end state, flaky snapshots, broken stories and remote content |
| 7 | [Per-story options](07-per-story-options.md) | `parameters.visualCheck`: modes, viewport, capture area, masks, and how options are read |
| 8 | [Grid stories](08-grid-stories.md) | The grid component, its ports, layout and forced states |
| 9 | [Visual diff](09-visual-diff.md) | `color`, `pixels`, size differences and the visual diff image |
| 10 | [Baselines and update](10-baselines-and-update.md) | Storage, file names, what `update` writes and its stability checks |
| 11 | [Affected stories](11-affected-stories.md) | The base, changed files, the graph and the rules by file |
| 12 | [Sharding and the consistency check](12-sharding-and-consistency.md) | `--shard`, the split, and when the check runs |
| 13 | [Report and output](13-report-and-output.md) | The report folder, the JSON, reporters and the step summary |
| 14 | [GitHub Action](14-github-action.md) | The composite Action and the reusable workflow |
| 15 | [Storybook addon](15-storybook-addon.md) | Check and Update for the current story in `storybook dev` |
| 16 | [Agent skill](16-agent-skill.md) | The skill's files, its runner script and what it tells an agent |
| 17 | [Test apps](17-test-apps.md) | The separate repo of real Storybooks |
| 18 | [CI for this repo](18-repo-ci.md) | PR jobs and this repo's own test Storybooks |
| 19 | [Release process](19-release.md) | Versions, the release steps and the browser package's releases |
| 20 | [Docs site](20-docs-site.md) | The landing page and docs, built last |

## Headline decisions

- Chromium only, on visual-check's own raw CDP driver, in visual-check's own image, pinned by digest through `@visual-check/chromium`.
- The browser runs in a container forced to `linux/amd64` by default, locally and in CI.
- Three commands, one `visual-check.config.ts`, and per-story options in Storybook parameters.
- Baselines are keyed by story and mode. Only a person running `update` locally writes them.
- Storybook 9.1, 10 and 11.
- A JSON report with images, and no HTML report.

## Not in v1

After v1, kept addable:

- **Capture outside Storybook,** such as a URL list or a user's own function: [Capture outside Storybook][22].
- **A UI to run, watch and review,** locally and from CI: [UI to run, watch and review][49].

Out of scope:

- A hosted service or a cloud review dashboard.
- Integrations for CI providers other than GitHub Actions. The CLI still runs anywhere.
- Browsers other than Chromium. Others can follow behind the driver interface, but real Safari is out for good.
- Storybook 7, 8 and 9.0.
- An HTML report.
- CI writing baselines in any form.
- Combined snapshots. Stories lay out combinations with the grid instead.

Smaller things left out of v1 are listed in each area's file.

## Risks

| Risk | What happens then |
|---|---|
| Apple hasn't said whether Linux VMs keep Rosetta after macOS 27 | Projects on Apple Silicon move to `linux/arm64`, which the default tolerance absorbs |
| Storybook's test path and `loadStory` are internals | The adapter absorbs changes. Without the test path, captures are about 100 ms slower and still correct |
| Storybook 11 isn't stable yet | The adapter's reading of 11 is re-checked at stable. The test apps and this repo already run an 11 prerelease |
| The addon relies on Storybook APIs marked experimental | v1 needs it on Storybook 10 only. Storybook 11 is decided later |
| Google hasn't confirmed that its headless shell may ship inside the image | Fall back to a download at run time, or Debian's Chromium, as a new browser package version |
| The launch arguments and font table were measured on one older browser build | The comparison against Playwright is repeated on the first build, and reviewed on every bump |
| The migration target once saw pixel noise at 2 CI workers | Measured again with visual-check as an acceptance check. `workers` can be set to 1 |
| Fallow needs a lot of memory on very large repos | The run falls back to all stories, with a warning |
| The arm64 image can't pin its system packages to a dated snapshot | Each image records its package list, and users always pull by digest |
| release-please's linked versions have old open bugs | A CI check keeps the three versions equal |

## Open questions

None. What the addon does on Storybook 11 is left for after v1 ([Storybook addon](15-storybook-addon.md)).

## Decisions made while writing this PRD

These fill gaps or change earlier tickets. No ticket records them, so this list and the area files are their record.

Config and CLI

- `--all`, `--affected` and `--filter` are exclusive, and `test --consistency` takes none of them.
- New config keys `timezone`, `locale` and `colorScheme`, with defaults `'UTC'`, `'en-US'` and `'light'`.
- A Storybook's `dir` is relative to the config file. Its `configDir` and `baselines` are relative to `dir`.
- Every run checks the Storybook's version, with `init`'s rule.
- Node 22 stays the minimum.
- On Windows, `init`'s no-Docker warning adds that Docker inside WSL means running visual-check inside WSL.

Capture and browser

- The first browser package holds the Stable build current when it's built, and the CLI's range starts there.
- IndexedDB is cleared between captures. Cache Storage and service workers are kept.
- Popups are closed as soon as they open. In the container the browser starts through the image's shell, and the last 50 lines of its stderr are kept for a failed launch or a browser exit.
- The driver interface is designed for several browsers.
- `host` inside visual-check's image uses the image's browser. `host` on Windows on Arm exits 2. On `host`, each OS uses its own font list.
- A machine that can't run `linux/amd64` is recognised from the failed launch. A runtime that gives the container no route to the machine is caught by a check before capturing.
- Names: `VISUAL_CHECK_CHROMIUM_MIRROR`, `VISUAL_CHECK_CACHE_DIR` and the marker file `/etc/visual-check/chromium.json`.

Readiness and stories

- `readyTimeout` covers everything up to the capture.
- A failing snapshot is retried a set number of times, the same for every story. The config key is `retries`, `1` by default. A snapshot that passes on a retry is flaky: it's listed everywhere and never fails a run.
- Reason codes for every broken-story cause.
- The test-path warning comes once per Storybook, at the end of a run, when the median gap is 50 ms or more.
- The helper writes one entry per declared mode: its definition, or `null`.
- The grid's header row, the caption function, `forceStates` and the class names. A grid prop varies when the story lists two or more values for it. A grid wider than the viewport is a broken story whatever the capture area.
- A mode name means one thing inside a Storybook. A global counts as declared when the running Storybook would accept it from the URL.

Visual diff and baselines

- A percent budget rounds down, the neighbourhood filter stays off, and the visual diff uses the logo's magenta and cyan.
- `update` makes two stability checks, with a majority of three loads. It writes every missing baseline and deletes every orphan, whatever is selected. On Windows it warns about paths over 260 characters.
- Images are compared in a pool of half the CPUs, at least 1 and at most 4.
- A baseline name that's too long is shortened with a hash. Two snapshots that map to one file exit 2.
- Any edit to visual-check's config selects every story.

Report, addon and skill

- No `browser` field. A run-level `selection` field replaces a reason per story.
- One header line for every run, with a shard's share inside it.
- The remaining report names: a broken story's image in `images.snapshot`, `update`'s counts, `realRequestHosts` and `remoteContentHosts`, and `load-failed` entries in a consistency-only report.
- The addon's panel shows one image with a slider, and counts browser exits per click. v1 needs the addon on Storybook 10 only.
- The skill's `.claude` link is committed. The skill no longer suggests the reduced-motion preference.

Tests, CI and release

- The test apps add `sb11` on a Storybook 11 prerelease and run every app on Windows. visual-check comes set up in each.
- This repo holds its own test Storybooks and a setup job for four package managers.
- CI runs Node 24, plus one Node 22 job.
- PR jobs for macOS without Docker, an Ubuntu `host` capture, the skill script on Windows, a devcontainer and the arm64 image. An Intel Mac runs nightly.
- The test apps install the three lockstep packages packed from one commit, and run through the Action and the reusable workflow.
- Images are compared on the newest browser package only. The oldest gets a smoke run.
- Packages are `0.x` for now, released with release-please. Checks by hand run before releases that touch their area, and once more before 1.0.0.
- A release packs once, runs the test apps on those files and publishes the same files through npm's trusted publishing.
- The browser job runs every two weeks and stops at a PR. When a bump moves pixels, the test apps' baselines are rewritten on a branch that the bump's PR tests against.
- The CLI builds every docs link from one base address.
- Action `v1` accepts CLIs from the first `0.x` up to, but not including, 2.0.
- The docs site is one Next.js app with Fumadocs on Vercel: the landing page at the home page, the docs under `/docs`. It updates on release.

## Slicing into tickets

- Each area file is the spec for its tickets. A ticket links the file and the section it implements.
- The "checks to repeat" in [CI for this repo](18-repo-ci.md) become acceptance checks of the ticket that builds each part.
- A workable order: packages and config, the browser package and image, the driver, readiness, per-story options, visual diff, baselines and `update`, the consistency check and sharding, the report, affected stories, `init`, the agent skill, the Action, the test apps, the addon, the grid, release, then the docs site.

[1]: https://github.com/visual-check/visual-check/issues/1
[22]: https://github.com/visual-check/visual-check/issues/22
[49]: https://github.com/visual-check/visual-check/issues/49
