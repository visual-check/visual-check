# CLI and commands

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

The CLI has three commands with fixed names: `init`, `test` and `update`. It connects to Storybooks that are already running and never starts or builds one.

## Commands

| Command               | Does                                                                         | Detail                                                                          |
| --------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `visual-check init`   | Detects the project, asks its questions and writes the setup                 | [Config and init](03-config-and-init.md)                                        |
| `visual-check test`   | Captures snapshots and compares them with baselines. Never writes a baseline | This file, [Sharding and the consistency check](12-sharding-and-consistency.md) |
| `visual-check update` | Writes missing and failing baselines and deletes orphans. Local only         | [Baselines and update](10-baselines-and-update.md)                              |

- Setup is `pnpm dlx @visual-check/cli init`, or the package manager's equivalent. There's no postinstall step: pnpm blocks them, and they can't prompt or tell CI from a person.
- Sharding and the consistency check are flags of `test`, not commands.
- Only the npm script names that `init` suggests are configurable.

## Which stories a run covers

`test` and `update` take the same selection flags.

| Flag                 | Covers                                                   |
| -------------------- | -------------------------------------------------------- |
| None, `CI` unset     | Affected stories                                         |
| None, `CI` set       | All stories                                              |
| `--affected`         | Affected stories, even in CI                             |
| `--all`              | Every story                                              |
| `--filter <regex>`   | Every story whose ID matches, whatever the changed files |
| `--storybook <name>` | Narrows any of the above to one Storybook                |
| `--base <ref>`       | Sets the ref the base is worked out from                 |

- Only the `CI` env var counts as CI. A missing TTY doesn't.
- `--all`, `--affected` and `--filter` are exclusive. Two of them together exit 2.
- `test --consistency` takes none of the three.
- With `--shard` and no selection flag, a run covers all stories even when `CI` is unset.
- Selection narrows what's captured. The consistency check still covers every story ([Sharding and the consistency check](12-sharding-and-consistency.md)).
- The rules for affected stories are in [Affected stories](11-affected-stories.md).

## Other flags

| Flag                         | On               | Does                                                                          |
| ---------------------------- | ---------------- | ----------------------------------------------------------------------------- |
| `--url <url>`                | `test`, `update` | Overrides the Storybook's URL. With several Storybooks it needs `--storybook` |
| `--config <path>`            | `test`, `update` | Overrides the config search                                                   |
| `--workers <n>`              | `test`, `update` | Overrides `workers` for one run                                               |
| `--reporter live\|log\|json` | `test`, `update` | Picks the output ([Report and output](13-report-and-output.md))               |
| `--shard <k>/<n>`            | `test`           | Runs one shard's share                                                        |
| `--consistency`              | `test`           | Runs only the consistency check                                               |
| `--yes`                      | `init`           | Takes every default                                                           |

Not in v1: `--force`, `update --from <report>`, `--project`, and any flag for the platform, which is a config key only.

## Exit codes

| Code | Meaning                               |
| ---- | ------------------------------------- |
| `0`  | Pass                                  |
| `1`  | A problem in the project              |
| `2`  | A tool, config or environment failure |

Exit 1 covers:

- a visual diff beyond tolerance, or a size difference;
- a broken story, including one whose stories file fails to load;
- a missing baseline;
- an orphan;
- an `update` capture that fails or isn't stable.

Broken stories and visual diffs never stop a run: it finishes, then exits 1. The one early stop is a CI `test` whose consistency check finds something. It exits 1 before capturing ([Sharding and the consistency check](12-sharding-and-consistency.md)).

## What exits 2

Each message names what failed and the fix.

**Storybook**

- Nothing answers at `<url>/index.json`. The run fails at once, with no wait and no retry, naming the Storybook and its URL.
- One of several Storybooks is down. The message suggests `--storybook`.
- A Storybook is down even when there are no changed files.
- `index.json` fails, or the preview fails to load. On a dev server, a stories file that doesn't parse breaks `index.json`.
- `index.json` lists a stories file that isn't on disk.
- A Storybook is below 9.1.

**Config and options**

- No config found. The message points to `visual-check init`.
- Unknown config keys or wrong types.
- Invalid per-story options, naming the story and the key.
- A Storybook with no URL for the current environment.
- Two Storybooks whose baselines resolve to one folder.
- Two snapshots whose baselines would be one file.

**Flags**

- `update` with `CI` set, at once.
- An invalid `--base`.
- An invalid `--shard` value: `0/4`, `5/4` or a non-integer.
- Two of `--all`, `--affected` and `--filter` together.
- `--consistency` with any of those three.
- `--shard` with `--affected`, or with `--consistency`.
- `--shard` on `update`.
- `--url` with several Storybooks and no `--storybook`.

**Baselines**

- A `.png` in a baselines directory that can't be decoded.

**Browser and Docker**

- The browser package is missing or outside the CLI's range.
- The browser that answers isn't the browser package's build. The message names both versions, and no option accepts a mismatch.
- With a container platform: no `docker` CLI, the daemon isn't running or the user can't reach its socket, the pull fails, Docker runs Windows containers, the machine can't run the platform, or the container can't reach the machine. There's never a fallback to `host`.
- Inside visual-check's image: the marker's version or CPU architecture doesn't match the installed browser package or the configured platform.
- With `host`: the download's SHA-256 doesn't match, Linux libraries are missing, or the machine is Windows on Arm.
- The browser exits a second time in one run, or a relaunch fails.

**`init`**

- Its own checks are in [Config and init](03-config-and-init.md).

## Streams

- `--reporter json` prints one document on stdout, so everything else goes to stderr:
  - image pull and `host` download progress;
  - `update`'s end-of-run warnings;
  - the paths of a refreshed agent skill.
- Terminal paths are relative to the current folder.

## Skill refresh on local runs

- A local `test` or `update` rewrites the agent skill's files when the installed skill was written by another CLI version. In CI it writes nothing ([Agent skill](16-agent-skill.md)).

## Sources

- [CLI commands and output][17], [Affected stories rules][14], [Storybook target modes][15], [Baseline storage and update flow][12], [Sharding across CI jobs][27], [Config file shape and init wizard][38], [Reading per-story options][46], [Playwright peer dependency and Chromium version][45], [Docker's role][13], [Agent skill shape][20].
- [ADR 0003](../adr/0003-render-in-container-on-amd64.md).
- Decided while writing this PRD: exclusive selection flags, the run-time Storybook version check, and the exit code for clashing baseline names.

[12]: https://github.com/visual-check/visual-check/issues/12
[13]: https://github.com/visual-check/visual-check/issues/13
[14]: https://github.com/visual-check/visual-check/issues/14
[15]: https://github.com/visual-check/visual-check/issues/15
[17]: https://github.com/visual-check/visual-check/issues/17
[20]: https://github.com/visual-check/visual-check/issues/20
[27]: https://github.com/visual-check/visual-check/issues/27
[38]: https://github.com/visual-check/visual-check/issues/38
[45]: https://github.com/visual-check/visual-check/issues/45
[46]: https://github.com/visual-check/visual-check/issues/46
