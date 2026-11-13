# Baselines and update

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

Baselines are PNG files in one folder per Storybook. Only `update`, run locally by a person, writes them. `test` never does, and neither does CI.

## Storage

- One flat folder of PNG files per Storybook, `<dir>/.visual-check/baselines` by default.
- visual-check owns that folder:
  - every `.png` in it is a baseline or an orphan;
  - other files are ignored;
  - a `.png` that can't be decoded exits 2;
  - snapshots and visual diffs are never stored there.
- A baseline is stored exactly as the browser returned it.
- Left to the project: how the folder is stored (git, LFS or anything else), who runs `update` and when, how baseline changes are reviewed, and how merge conflicts are resolved.

## File names

- A snapshot's key is `<story-id>[.<mode>]`, and its baseline is `<key>.png`. Examples: `components-button--primary.png`, `components-button--primary.dark.png`.
- The default capture has no mode part.
- Chromium never adds a browser part. A browser added later always will, so nothing gets renamed ([ADR 0001](../adr/0001-baseline-key-excludes-platform.md)).
- The platform, the image digest and the browser version aren't in the name, and no file records them. A baseline from another platform or browser build shows as a visual diff.

### Long and clashing names

All names are known before anything is captured, so these are checked first:

- **A key over 240 bytes is shortened.** It keeps its first 223 bytes, then `-`, then the first 16 hex characters of the full key's SHA-256. The limit leaves room for the report's longest image suffix inside a 255-byte file name.
- **Two snapshots that map to one file exit 2,** naming both stories. That can happen on macOS when two story names differ only in how an accented letter is encoded.
- **On Windows, `update` warns** when a path it writes passes 260 characters, and names the git setting that allows it (`core.longpaths`).

## Who writes

- Only `update` writes baselines. `update` with `CI` set exits 2 at once.
- No CI job writes baselines, and the Action never runs `update`. There's no `update --from <report>`.
- A bot's or a fork's PR that needs new baselines stays red until a developer checks it out and runs `update`.
- A browser bump is the project's own PR: Renovate bumps `@visual-check/chromium`, many stories fail at once, and a developer runs `update` on that PR.

## What `update` writes and deletes

| What | Scope |
|---|---|
| A failing baseline | Stories the run selected |
| A missing baseline | Every story of the Storybooks in the run, whatever the selection |
| An orphan (deleted) | Every orphan of the Storybooks in the run, whatever the selection |

- A baseline within tolerance stays untouched. There's no `--force`: to rewrite a baseline, delete the file and run `update`.
- A snapshot that fails and then passes on its second load is flaky, not failing. Its baseline stays untouched too.
- `--storybook` narrows all three rows. `--filter` and affected stories narrow only the first.
- So a consistency check passes straight after an `update` that wrote everything.
- The baselines of a stories file that fails to load are never orphans and are never deleted.
- `update` loads every stories file, as `test` does.
- The addon's Update is the one exception to "within tolerance stays untouched" ([Storybook addon](15-storybook-addon.md)).

## Stability checks before writing

Each check uses the story's own tolerance, and a size difference counts as a difference.

1. **One second later, the same page.** `update` captures the same page again a second after the first capture. If the two differ, nothing is written and the story is a broken story (`changed-after-capture`). The message points to the `wait` hook.
2. **A second load.** `update` loads the story again and the two loads must agree.
   - For a failing baseline, the second load is the same one that decides whether it's flaky. For a missing baseline, it's one extra load.
   - `update` never makes more than three loads, whatever `retries` says.
   - If they differ, it captures a third load and the majority wins.
   - The baseline is the later capture of the two that agree.
   - If no two agree, nothing is written and the story is a broken story (`unstable`).

Notes:

- The one-second check runs once, on the first load. It's a check and not a wait: the capture itself isn't delayed.
- A snapshot that needed the third load is flaky, and `update` lists it at the end. `update` never fails because of flaky snapshots.
- A missing baseline costs about 1 s, two loads and three captures. `test` and CI pay none of this.
- When a story's capture fails or isn't stable, nothing is written for it, its old baseline stays, and `update` exits 1.

## Warnings at the end of `update`

One block on stderr, grouped by host. Nothing fails on either warning, and `silenceHosts` silences both.

**Real network requests**

- Counted between `goto` and the capture: a `fetch`, XHR, WebSocket or EventSource request to an origin other than the Storybook's.
- A response mocked by a service worker, such as MSW's, doesn't count. A cached response does, and so does one a service worker passes on to the internet.
- Fonts, stylesheets, images and scripts never count.
- Example: "api.example.com: 114 stories (first IDs…). These stories make real network requests and may be unreliable."

**Remote content**

- Example: "images.unsplash.com: 11 stories show remote content. A CDN can serve it differently on another machine, so CI may fail."
- A story that masks a host isn't listed for it.

How they're found:

- Only `update` turns on the Network domain and attaches to service workers. It costs about 5%, and `test` never pays it.

## Output

- **Terminal:** counts of written, deleted and kept baselines, every written and deleted path, then the flaky snapshots and the warnings.
- **JSON:** `update`'s document is in [Report and output](13-report-and-output.md). `update` writes no images and never touches the report folder.

## Special cases

- **Dev servers:** `update` doesn't detect `storybook dev` and neither warns nor refuses on it.
- **Machines that can't run the amd64 container:** the project's way out is `platform: 'linux/arm64'`.

## Sources

- [Baseline storage and update flow][12], [Baseline updates without a local capture][42], [Late network requests after storyFinished][25], [Remote content that differs between machines][35], [Sharding across CI jobs][27], [Reading per-story options][46], [Visual diff rules: size, anti-aliasing and pixel budget][43], [Config file shape and init wizard][38], [Windows and macOS on GitHub Actions][33].
- [ADR 0001](../adr/0001-baseline-key-excludes-platform.md).
- Decided while writing this PRD: two stability checks with a majority of three, `update` writing every missing baseline, shortening long names, the clash check and flaky snapshots.

[12]: https://github.com/visual-check/visual-check/issues/12
[25]: https://github.com/visual-check/visual-check/issues/25
[27]: https://github.com/visual-check/visual-check/issues/27
[33]: https://github.com/visual-check/visual-check/issues/33
[35]: https://github.com/visual-check/visual-check/issues/35
[38]: https://github.com/visual-check/visual-check/issues/38
[42]: https://github.com/visual-check/visual-check/issues/42
[43]: https://github.com/visual-check/visual-check/issues/43
[46]: https://github.com/visual-check/visual-check/issues/46
