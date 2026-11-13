# Report and output

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

Every `test` leaves a report folder: one JSON document and the images of every snapshot that didn't plainly pass. There's no HTML report, in v1 or later. Reviewing in a browser is the job of the UI planned for after v1.

## The report folder

- **Place:** `<config folder>/.visual-check/report/`, fixed in v1. In a monorepo that's the workspace root, so one report covers every Storybook of the run.
- **Contents:**
  - `report.json`, the same document `--reporter json` prints;
  - `images/<storybook>/<key>.baseline.png`, `.snapshot.png` and `.diff.png` for every listed snapshot.
- A snapshot is stored exactly as the browser returned it.
- Image paths in the JSON are relative to the folder, so it uploads as one artifact.
- It's the only place a CLI run writes snapshots and visual diffs.

When it's written:

- Every `test` replaces the whole folder: passing runs, `test --consistency` and every shard included. An old failing report never lingers.
- On exit 2 it holds the error and no results.
- `update` never writes or touches it.
- With no config found, nothing is written.
- Nothing opens and no server starts. The run's last line is the report's path.

## What the report lists

- Snapshots that differ beyond tolerance, with baseline, snapshot and visual diff.
- Broken stories, with their reason and details.
- Missing baselines, with no image, because `test` never captures them.
- Orphans, with their baseline.
- Flaky snapshots, with the first attempt's images.

Plain passes are only counted. A passed entry has the same shape, so a later tool can list every snapshot without a new report version.

A broken story also carries:

- an image of the page at the moment it broke, when the page still shows something. A crash and a too-tall capture have none;
- its details: the URL it navigated to, `play`'s message and first stack lines, the timeout, the size, the font faces still pending, a grid's width and the viewport's, or a stories file's load error.

Console messages:

- The in-page script collects them from document start: all levels, uncaught errors and unhandled rejections included.
- Each listed entry that was captured keeps the last 50, each cut to 500 characters. They come from the attempt whose images are listed, and they survive a story that navigates away.
- They never fail a run.

## The JSON document

One minified document. Paths use `/` on every OS.

Top level:

| Field             | Holds                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`         | A whole number, starting at 1                                                                                                                                   |
| `visualCheck`     | The CLI's version                                                                                                                                               |
| `command`         | `"test"` or `"update"`                                                                                                                                          |
| `consistencyOnly` | `true` for `test --consistency`                                                                                                                                 |
| `exitCode`        |                                                                                                                                                                 |
| `shard`           | `{ index, total }`, or `null`                                                                                                                                   |
| `selection`       | How stories were picked: `{ by, base, changedFiles, fallback }`, where `by` is `"affected"`, `"all"` or `"filter"` ([Affected stories](11-affected-stories.md)) |
| `reportDir`       | Relative to the config folder                                                                                                                                   |
| `storybooks`      | `[{ name, url }]`                                                                                                                                               |
| `counts`          | For `test`: `{ passed, flaky, differs, broken, missing, orphan }`. For `update`: `{ written, deleted, kept, broken, flaky }`                                    |
| `snapshots`       | The entries                                                                                                                                                     |
| `warnings`        | From `update`: `{ kind: "real-requests" \| "remote-content", host, stories, message }`                                                                          |
| `error`           | On exit 2: `{ message, storybooks: [{ name, url }] }`. Otherwise `null`                                                                                         |

Each entry:

| Field                                    | Holds                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storybook`                              | The Storybook's name                                                                                                                                         |
| `id`                                     | The snapshot's key, unique within a Storybook                                                                                                                |
| `kind`                                   | `"story"`, the only value in v1                                                                                                                              |
| `story`, `importPath`                    | The story's ID and its stories file                                                                                                                          |
| `mode`                                   | `null` for the default capture                                                                                                                               |
| `status`                                 | For `test`: `passed`, `differs`, `broken`, `missing`, `orphan`. For `update`: `written`, `deleted`, `broken`                                                 |
| `reason`                                 | For `differs`: `pixels` or `size`. For `broken`: a code from [Readiness and stability](06-readiness-and-stability.md). For `written`: `missing` or `differs` |
| `message`                                | One line for people                                                                                                                                          |
| `flaky`                                  | `true` when it passed on a retry, or needed a third load in `update`                                                                                         |
| `attempts`                               | How many captures it took                                                                                                                                    |
| `pixels`                                 | `{ differ, allowed, budget, scale }`, with `budget` as written: `20` or `"0.1%"`                                                                             |
| `size`                                   | `null`, or `{ baseline: [w, h], snapshot: [w, h] }` on a size difference                                                                                     |
| `details`                                | `null`, or a broken story's details                                                                                                                          |
| `hints`                                  | `[{ kind: "remote-content", hosts, message }]`                                                                                                               |
| `console`                                | `[{ level, text }]`                                                                                                                                          |
| `baseline`                               | The baseline's path, relative to the config folder                                                                                                           |
| `images`                                 | `{ baseline, snapshot, diff }`, relative to the report folder. A broken story's image is `images.snapshot`                                                   |
| `realRequestHosts`, `remoteContentHosts` | In `update` only                                                                                                                                             |

Rules:

- There's no `browser` field in v1.
- An entry is identified by `storybook`, `id` and `kind` together. That leaves room for capture outside Storybook to add a new `kind`.
- In a consistency-only report, each story of a stories file that failed to load is a `broken` entry with `load-failed`.
- On exit 2, `error` names the unreachable Storybooks and their URLs. The agent skill depends on that.
- The types are exported from `@visual-check/cli`.

### Versioning

- Additive changes don't bump `version`: new fields, and new `reason`, hint, warning or `kind` values. Readers ignore what they don't know.
- Every entry, hint and warning carries a `message` for people.
- Removing or renaming a field, changing what a field means, or adding a `status` value bumps `version`. That only happens in a CLI major.

## Reporters

| Reporter | For                                | Output                                         |
| -------- | ---------------------------------- | ---------------------------------------------- |
| `live`   | A terminal. The default with a TTY | One progress line, and failures as they happen |
| `log`    | CI. Chosen with `CI` set or no TTY | One line per snapshot, append-only             |
| `json`   | Tools and the agent skill          | The JSON document on stdout at exit            |

### Header

- `visual-check <version> · <command> · <n> snapshots · <w> workers`.
- A shard's header shows its own share: `visual-check 0.1.0 · test · shard 2/4 · 12 stories files · 251 snapshots · 2 workers`.

### `log`

One line per snapshot as it finishes:

- `✓ web  button--primary  142 ms` for a pass;
- `✗ web  button--primary  dark  differs: 84 differ, 80 allowed (20 at scale 2)` for a visual diff;
- `! web  checkout--flow  broken: navigated away to /categories/burgers. Await the new page before clicking.` for a broken story.

### `live`

- It's built on a terminal UI library such as Ink, loaded only for `live`.
- One progress line shows done and total, workers and elapsed time. It's fed by the engine's progress stream: the planned snapshots first, then each snapshot's start and result.
- `✗` and `!` lines print above it as they happen. Passes print nothing.

### The end of every `test`

Both `log` and `live` end with the same block:

1. `── N failures ──`, then for each failure: the Storybook, story and mode, then `differs: …` or `broken: …`. A visual diff adds its `diff:` path and any `hint:`. A broken story adds up to 5 console error and warning lines.
2. The flaky snapshots, by name.
3. The counts, for example `248 passed (2 flaky) · 1 differs · 1 broken · 3m 12s`.
4. `Report: .visual-check/report/report.json`.

`update` ends with its own block, which has no report line ([Baselines and update](10-baselines-and-update.md)).

## Hints and warnings

- **Remote content:** a failure that differs only inside remote content carries a hint that names the hosts, shows the mask line and links the docs page.
- **No changed files:** a hint about `--all`.
- **Selection couldn't be worked out:** a warning that every story was selected.
- **Storybook's test path is off:** one warning per Storybook at the end of the run.
- **`update`'s warnings** are in [Baselines and update](10-baselines-and-update.md).

## GitHub step summary

- The CLI writes it whenever `GITHUB_STEP_SUMMARY` is set, under any reporter. It works from a plain `run:` step, the Action and the reusable workflow alike.
- It holds the shard, the counts, the flaky snapshots and a table of failures: Storybook, story, mode, status and message. The table is cut to stay under GitHub's 1 MiB per step.
- On exit 2 it holds the error.
- It has no images, because a summary only shows images from public URLs.
- v1 writes no `::error` annotations.

## Kept addable

For the UI planned after v1 ([UI to run, watch and review][49]), v1 already provides:

- the versioned JSON, the passed entry's shape and each entry's baseline path;
- snapshots' exact bytes, which a later approval can commit as baselines;
- console messages and broken stories' images;
- the engine's progress stream.

## Sources

- [Failure report format][39], [CLI commands and output][17], [Sharding across CI jobs][27], [Remote content that differs between machines][35], [Visual diff rules: size, anti-aliasing and pixel budget][43], [Reading per-story options][46], [Playwright peer dependency and Chromium version][45], [GitHub Action design][40].
- Decided while writing this PRD: no `browser` field, the `selection` field, the `flaky` and `attempts` fields and the flaky counts, the remaining field names and the header line.

[17]: https://github.com/visual-check/visual-check/issues/17
[27]: https://github.com/visual-check/visual-check/issues/27
[35]: https://github.com/visual-check/visual-check/issues/35
[39]: https://github.com/visual-check/visual-check/issues/39
[40]: https://github.com/visual-check/visual-check/issues/40
[43]: https://github.com/visual-check/visual-check/issues/43
[45]: https://github.com/visual-check/visual-check/issues/45
[46]: https://github.com/visual-check/visual-check/issues/46
[49]: https://github.com/visual-check/visual-check/issues/49
