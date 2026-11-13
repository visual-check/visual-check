# Test apps

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

The public repo `visual-check/test-apps` proves that the packages about to be published install and run in real projects: different Storybook versions, package managers and repo layouts. Behaviour that real projects don't contain is tested in this repo's own Storybooks ([CI for this repo](18-repo-ci.md)).

## The apps

| App                                                                           | Storybook                | Shape                                    | Package manager | Stories  |
| ----------------------------------------------------------------------------- | ------------------------ | ---------------------------------------- | --------------- | -------- |
| [storybookjs/react-inspector](https://github.com/storybookjs/react-inspector) | 9.1                      | Single repo                              | Yarn 4          | About 76 |
| [freeCodeCamp/ui](https://github.com/freeCodeCamp/ui)                         | 10.6                     | Single repo                              | pnpm            | 112      |
| [TrigenSoftware/masonry-grid](https://github.com/TrigenSoftware/masonry-grid) | 9.1                      | Monorepo with 5 Storybooks               | pnpm            | About 14 |
| `sb11`                                                                        | The newest 11 prerelease | A copy of the Storybook 10 app, upgraded | pnpm            | 112      |

- The first three are real open-source projects, each copied at a pinned commit, with every story and no filters. They're MIT or BSD-3, so their baselines can be committed.
- `sb11` exists so visual-check is ready when Storybook 11 turns stable. Its prerelease is pinned and Renovate bumps it. When 11 is stable, it moves to the stable release.
- visual-check comes set up in each app: the config, the per-Storybook files and the baselines are committed. `init` doesn't run here.
- Baselines are written once on Linux amd64 and checked on both OSes. They're rewritten only for a browser bump ([Release process](19-release.md)).
- Each app lists the broken stories it expects, if any.
- The monorepo's five Storybooks each get their own port from the app's config.
- No Vue or Angular app joins, and no app renders the grid.

## A run

1. Pack `@visual-check/cli`, `@visual-check/storybook` and `@visual-check/storybook-addon` once, from one commit.
2. In each app, install those files with the app's package manager. The addon goes into the app on Storybook 10.
3. Build and serve each Storybook.
4. Run `test` against the committed baselines, through the Action and the reusable workflow. One run is sharded, with its consistency job. The run from inside a WSL distro is a plain step, because a composite Action can't run there.

- The browser package comes from npm at the newest version in the CLI's range. In a browser bump's run, its packed file is what's under test.
- Images are compared on that newest browser package only.

## Jobs

| Runner         | Runs                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ubuntu-24.04` | Every app. One app also runs from a `node` job container with the `docker` CLI added, which tests the browser joining that container's network                |
| `windows-2025` | Every app, from the Windows host. The job installs Docker Desktop first. One app also runs from inside a WSL distro, through Docker Desktop's WSL integration |

- There are no macOS jobs here.
- The Windows job's setup takes about 6 minutes: the runner's own Docker service is stopped first, then Docker Desktop is installed and started.

## When they run

- **On every PR of this repo,** through test-apps' reusable workflow, so breakage shows before release day.
- **Before every publish.** The release workflow packs the files, runs the test apps on them, and publishes those same files only when every job passes ([Release process](19-release.md)).
- **On every browser bump's PR,** with the new browser package.

## What this covers for other areas

- The Action and the reusable workflow, which every run goes through ([GitHub Action](14-github-action.md)).
- Windows with Docker Desktop, from the host and from WSL ([Browser and platform](05-browser-and-platform.md)).
- Several Storybooks in one config, which the migration target doesn't exercise.

## Sources

- [Test apps repo][34], [Windows and macOS on GitHub Actions][33], [Container runtimes on Windows][36], [GitHub Action design][40], [Playwright peer dependency and Chromium version][45], [Combined snapshots and network paths in v1][47], [Storybook 9 floor and Storybook 11][48], [Cartesian stories helper][50].
- Decided while writing this PRD: the `sb11` app on a prerelease, every app on Windows, which packages are packed, visual-check set up ahead in each app, and runs going through the Action.

[33]: https://github.com/visual-check/visual-check/issues/33
[34]: https://github.com/visual-check/visual-check/issues/34
[36]: https://github.com/visual-check/visual-check/issues/36
[40]: https://github.com/visual-check/visual-check/issues/40
[45]: https://github.com/visual-check/visual-check/issues/45
[47]: https://github.com/visual-check/visual-check/issues/47
[48]: https://github.com/visual-check/visual-check/issues/48
[50]: https://github.com/visual-check/visual-check/issues/50
