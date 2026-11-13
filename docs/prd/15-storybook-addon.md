# Storybook addon

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

`@visual-check/storybook-addon` adds a "Visual check" panel to `storybook dev`. From it a developer checks the current story against its baselines, or rewrites that story's baselines. It runs the same engine, config and container as the CLI.

## Scope

- It works in `storybook dev`, on Storybook 10 and later.
- It works on the current story only. There's no "run all", no affected stories, and no report read from an earlier CLI run. Storybook's own "Run all" button doesn't run visual-check.
- Runs are manual: Check and Update, from the panel and from the story's menu in the sidebar.
- A hot reload or a change to the story index marks earlier results stale. Nothing re-runs by itself.
- It has a manager entry and a preset, and no preview entry.
- Whether the addon must work on Storybook 11 before v1 is done is decided when 11 is stable. It's built on Storybook APIs marked experimental: the test provider, the status store, the server channel and the dev-server hook. It never uses `UniversalStore`, which Storybook 11 makes internal.

## Check

- It captures the story's default capture and every mode the story lists, whatever the toolbar's globals are.
- It captures snapshots with no baseline too, so the developer sees what Update would write. Check writes no baseline.
- The panel shows one row per snapshot:
  - pass;
  - visual diff;
  - missing baseline, with the snapshot;
  - broken story, with its reason and details.
- A row marks a flaky snapshot.
- A row shows the remote-content hint when there is one.
- A checked story gets a status icon in the sidebar.
- The addon writes its images to `<dir>/.visual-check/snapshots/` and `diffs/`. Only the addon uses those folders.

### Viewing a visual diff

- One image area with a slider that wipes between the baseline and the snapshot.
- An option switches the area to the visual diff alone.

## Update

- It rewrites the current story's baselines from a fresh capture, whether or not Check ran.
- It covers every snapshot of the story, those within tolerance included. That's "delete the files and run `update`" for one story.
- It keeps `update`'s guarantees:
  - the stability checks always run, and a snapshot that isn't stable writes nothing, with the reason in the panel;
  - a capture identical to the file, byte for byte, leaves the file untouched;
  - with `CI` set it's refused;
  - the panel lists every written path, the snapshots that needed a third load, and `update`'s warnings by host.
- It never deletes orphans. That stays with the CLI's `update`.
- It works on a dev server with no special handling.

## Process

- On the first Check or Update, the addon's preset forks a child process from an internal entry of `@visual-check/cli`.
  - Check, update and cancel go in. Progress and results come out.
  - The preset relays them over Storybook's server channel.
  - A dev-server route serves the images from `<dir>/.visual-check/`.
- Results reuse the report's per-snapshot shape.
- **A warm browser:** after the first click, the browser container keeps running until Storybook stops, with no idle timeout.
- The child exits when its connection to Storybook closes, even when Storybook was killed, and the browser's container goes with it.
- **Browser exits** are counted per click. Within one Check or Update the browser is relaunched once, and a second exit shows the CLI's error in the panel. The next click starts fresh.

### Which Storybook and URL

- The child searches for the config upward from Storybook's own config folder, with the CLI's rules, and reloads it on every click.
- It uses the config entry whose `dir` and `configDir` resolve to that folder.
- It captures against this Storybook's own address, not the config's `url`. When the two differ, the panel says that CLI runs check the other one.
- No config, no matching entry or an invalid config shows the CLI's own message in the panel, plus "run `visual-check init`".

## Without Docker

- Storybook's start never probes Docker.
- On Check or Update, the panel shows the CLI's exit-2 message as it is, with both fixes. There's no fallback to `host`.
- The first click pulls the image, with progress in the panel. Check and Update can be cancelled.
- `platform: 'host'` works as in the CLI.

## Static builds

- No Node side runs in a static build. The manager detects one with `CONFIG_TYPE === 'PRODUCTION'`.
- On a loopback host (`127.0.0.1`, `localhost` or `::1`), the panel shows the exact `test` and `update` commands for the current story, with copy buttons. The Storybook's name is resolved at build time, through the preset's `env` hook. Example: `visual-check update --storybook web --filter '^components-button--primary$' --url http://127.0.0.1:6006`.
- That `update` also writes the Storybook's other missing baselines and deletes its orphans, as every `update` does ([Baselines and update](10-baselines-and-update.md)).
- On any other host, the addon shows nothing.

## Versions and install

- The addon and the CLI release in lockstep. The addon peer-depends on exactly its own version of the CLI, and on a mismatch the panel says which package to upgrade.
- `init` offers it for each Storybook on 10 or later, and installs it with `storybook add` ([Config and init](03-config-and-init.md)).
- The addon has no postinstall.

## Tests

- This repo's own test Storybooks run it end to end: `storybook dev` with the addon, then Check and Update on one story ([CI for this repo](18-repo-ci.md)).

## Kept addable

- "Run all" and affected stories in the panel.
- An engine for static builds, behind an origin check.
- The UI planned after v1 reuses the child process and its protocol ([UI to run, watch and review][49]).

## Sources

- [Storybook addon][41], [Failure report format][39], [Baseline updates without a local capture][42], [Docker's role][13], [Test apps repo][34], [Storybook 9 floor and Storybook 11][48].
- Decided while writing this PRD: the slider view, counting browser exits per click, and deferring the Storybook 11 question.

[13]: https://github.com/visual-check/visual-check/issues/13
[34]: https://github.com/visual-check/visual-check/issues/34
[39]: https://github.com/visual-check/visual-check/issues/39
[41]: https://github.com/visual-check/visual-check/issues/41
[42]: https://github.com/visual-check/visual-check/issues/42
[48]: https://github.com/visual-check/visual-check/issues/48
[49]: https://github.com/visual-check/visual-check/issues/49
