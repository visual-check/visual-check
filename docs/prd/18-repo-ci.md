# CI for this repo

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

This repo's CI checks the code, runs the built CLI against the repo's own small Storybooks, and calls the test apps on every PR. Runner minutes aren't a constraint: the repos are public, so hosted runners are free.

## On every PR

| Job | Runner | Checks |
|---|---|---|
| Code | Linux, Node 24 | Biome, typecheck, Fallow, unit tests |
| Node 22 | Linux, Node 22 | Unit tests and one end-to-end run, because 22 is the minimum |
| Own Storybooks | Linux | The built CLI against this repo's test Storybooks (below) |
| Setup | Linux | `init` under each package manager (below) |
| Test apps | Linux and Windows | test-apps' reusable workflow, on the packed packages ([Test apps](17-test-apps.md)) |
| macOS without Docker | macOS, Apple Silicon | `init`, affected stories, baseline files, starting and stopping Storybook, the no-Docker error, and one `host` capture |
| Ubuntu `host` | Linux | One `host` capture, where Chromium's sandbox can't start and visual-check relaunches without it |
| Windows skill script | Windows | The agent skill's script starts and stops Storybook. Killing the CLI mid-run leaves no browser container |
| Oldest browser | Linux | A smoke run with the oldest browser package in the CLI's range: it launches and captures, with no image comparison |
| Devcontainer | Linux | A run from a devcontainer that uses the host's Docker |
| arm64 image | Linux arm64 | A pixel run on the arm64 image |
| Lockstep versions | Linux | The three lockstep packages have one version |

- Every job runs Node 24, except the Node 22 job.
- GitHub Actions sets `CI`. Steps that test local-only behaviour run with `CI` unset: the Setup job's `update`, the addon's Update, the affected-stories check and the skill refresh.

Nightly, and not blocking:

- An Intel Mac runs the browser container through Colima, on one small test app. It covers the macOS path: the proxy and process cleanup. It's 6–8 times slower than Linux, and its runner image retires in August 2027.

## This repo's own test Storybooks

Small private workspace packages on Storybook 9.1, 10 and 11. Each version has one React Storybook, which holds the hazard stories and runs the addon, and one small Storybook for each other port: Vue, Angular and plain DOM. Until 11 is stable, it's the same pinned prerelease the test apps use.

They hold:

- **Hazard stories:** animations of every kind the end state handles, late images, fonts that never load, a story that navigates away, stories that break in each way, dialogs, popups, downloads and iframes.
- **One grid story through every port:** React, Vue, Angular and plain DOM.
- **Committed baselines and the expected outcome of every story:** pass, visual diff or broken story with its reason.

What CI checks there:

- The built CLI's `test` gives exactly the expected outcomes.
- Every grid port renders on 9.1, 10 and 11.
- One grid through every port gives identical images.
- A deliberate change is caught.
- **The addon, end to end, on 10:** `storybook dev` with the addon, then Check and Update on one story. The same run on 11 doesn't block a PR until the Storybook 11 question is decided ([Storybook addon](15-storybook-addon.md)).

## Setup under each package manager

- On a tiny Storybook, for each of npm, pnpm, Yarn 1 and Yarn 4: pack the packages, run `init --yes`, install, then run one `update` and one `test`. The packed packages come from a local registry, because `init` installs by version and that version isn't on npm yet.
- A second fixture is a monorepo with two Storybooks on one port, where `init` must warn.

## Other tests this repo needs

- **Fallow contract:** the in-memory graph walk gives the same answer as Fallow's own per-file query, on fixtures that include paths needing escapes.
- **Browser range:** images are compared on the newest browser package only. The oldest in the CLI's range gets the smoke run in the table.
- **Platform support:** setups nobody has run are sorted once:
  - covered by a planned check: OrbStack and Docker Desktop on macOS (by hand, [Release process](19-release.md)), the container network join and the proxy from WSL (test apps);
  - new checks here: the devcontainer run and the arm64 pixel run in the table;
  - listed in the docs as untested: Docker Desktop for Linux, rootless Docker, Podman, and Windows 10 and 11 desktops.

## Checks to repeat as each part is built

These rest on source reading, or on measurements made with Playwright before the driver existed. Each becomes an acceptance check in the ticket that builds that part:

- unchanged snapshots are byte-identical under the raw CDP driver, so the comparison can be skipped;
- the time `update`'s stability checks and request warnings add;
- the cost of searching a large page for remote content;
- loading every stories file on a cold dev server;
- noise at 2 workers on the migration target's CI, which once saw about 1% pixel differences there;
- `storybook add` with an exact version, in a monorepo, under each package manager;
- installing `@visual-check/storybook` with no React, Vue or Angular present;
- the Angular port on Angular 18 to 20;
- Storybook 11's own animation pause followed by visual-check's end state;
- the launch arguments and font table on the first browser build, against Playwright on the 300 real stories.

## Existing setup

- pnpm workspace with Turborepo, TypeScript, Biome, Fallow, Vitest and Lefthook are already in place.
- Lefthook runs Biome before a commit, and Fallow and the tests before a push.

## Sources

- [Test apps repo][34], [Windows and macOS on GitHub Actions][33], [Container runtimes on Windows][36], [Cartesian stories helper][50], [Chromium sandbox in the browser image][51], [Playwright peer dependency and Chromium version][45], [Affected stories rules][14], [Agent skill shape][20], [Combined snapshots and network paths in v1][47].
- Decided while writing this PRD: the repo's own test Storybooks, the Node versions, the setup job, the macOS and Windows jobs, the devcontainer and arm64 checks, and how the oldest browser is tested.

[14]: https://github.com/visual-check/visual-check/issues/14
[20]: https://github.com/visual-check/visual-check/issues/20
[33]: https://github.com/visual-check/visual-check/issues/33
[34]: https://github.com/visual-check/visual-check/issues/34
[36]: https://github.com/visual-check/visual-check/issues/36
[45]: https://github.com/visual-check/visual-check/issues/45
[47]: https://github.com/visual-check/visual-check/issues/47
[50]: https://github.com/visual-check/visual-check/issues/50
[51]: https://github.com/visual-check/visual-check/issues/51
