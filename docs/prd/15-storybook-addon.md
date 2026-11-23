# Storybook addon

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

`@visual-check/storybook-addon` adds a "Visual check" panel to `storybook dev`. From it a developer checks the current story against its baselines, or rewrites that story's baselines. It runs the same engine, config and container as the CLI.

## Scope

- It works in `storybook dev`, on Storybook 10.
- It works on the current story only. There's no "run all", no affected stories, and no report read from an earlier CLI run. Storybook shows its own "Run tests" button beside the addon's test provider, which adds the item to the story's menu. That button doesn't run visual-check.
- Runs are manual: Check and Update, from the panel and from the story's menu in the sidebar.
- Every result turns stale, in every tab, and so does the coming one of the check in flight, when:
  - an open preview takes a hot reload;
  - the story index changes;
  - a manager's preview loads again. That's a full reload, and any later preview load counts as one: after a settings page, or of a composed Storybook.
- A stale result stays in the panel, marked stale, and the story's status icon goes. Nothing re-runs by itself.
- It has a manager entry and a preset, and no preview entry.
- v1 needs the addon on Storybook 10 only. What to do about Storybook 11 is decided later, and adding it won't break anyone. Until then `init` skips the addon for a Storybook on 11, with a note.
- It's built on Storybook APIs marked experimental: the test provider, the status store, the server channel and the dev-server hook. It never uses `UniversalStore`, which Storybook 11 makes internal.

## Check

- It captures the story's default capture and every mode the story lists, whatever the toolbar's globals are.
- It reads and checks the current story's options only, so a click loads one stories file. Invalid options on other stories, the mode rules across stories and clashing baselines stay with the CLI.
- One check runs at a time in a Storybook, whatever the tab. Meanwhile every tab shows it, with Cancel, and can't start another.
- A disabled story isn't captured, and the panel says so.
- It captures snapshots with no baseline too, so the developer sees what Update would write. Check writes no baseline.
- The panel shows one row per snapshot:
  - pass;
  - visual diff;
  - missing baseline, with the snapshot;
  - broken story, with its reason and details.
- A row marks a flaky snapshot.
- A row shows the remote-content hint when there is one.
- A checked story gets a status icon in the sidebar: success, a warning for a missing baseline, or an error for a visual diff or a broken story. While the story is checked, the icon says it's pending. A stopped check and a disabled story give no icon.
- A cancelled check leaves the story's earlier result as it was. A cancel that comes too late, once the images are being replaced, ends with the check's result.
- Results are kept in memory, in Storybook's process: a reload of the manager keeps them, and they end with Storybook. It keeps at most 200 stories' results, the latest ones. Clearing Storybook's statuses clears them too.

### Images

- The addon writes its images to `<dir>/.visual-check/snapshots/` and `diffs/`. Only the addon uses those folders. Each Storybook has a folder of its name in both, so two Storybooks with one `dir` stay apart:
  - `snapshots/<name>/` holds `<baseline name>.snapshot.png` and, for a snapshot that differed, `<baseline name>.baseline.png`, a copy of the baseline as it was compared;
  - `diffs/<name>/` holds the visual diff, `<baseline name>.png`.
- A completed check replaces the story's earlier images. A cancelled or stopped one leaves them.
- A child process's first completed check of a Storybook empties that Storybook's two folders, since an earlier child may have left images there. A result whose image is gone says so in the panel.
- Check refuses a config entry whose `baselines` lies in `.visual-check/snapshots/` or `diffs/`.

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
  - the panel lists every written path, the flaky snapshots, and `update`'s warnings by host.
- The panel shows one row per snapshot: Written, Untouched or Broken story, with the baseline's path. A row marks a flaky snapshot and shows the remote-content hint when there is one. A broken story's row gives its reason and details. The warnings by host come below the rows.
- Its result replaces the story's result, and its images. The story's status icon is an error when any snapshot is a broken story, otherwise success. A stale Update says something changed since this update: check or update again.
- A cancel before the baselines are written writes nothing, and the story's earlier result stays. One that comes once they're being written is too late and ends with the result. A write that fails stops the update with the CLI's message, and may leave the baselines it wrote before that one.
- It also runs from the story's menu in the sidebar: "Update baselines with visual-check". It shares Check's one run at a time.
- It never deletes orphans. That stays with the CLI's `update`.
- It works on a dev server with no special handling.

## Process

- On the first Check or Update, the addon's preset forks a child process from an internal entry of `@visual-check/cli`.
  - Check, update and cancel go in. Progress and results come out.
  - The preset relays them over Storybook's server channel.
  - A dev-server route serves the images from `<dir>/.visual-check/`:
    - an image's URL carries its check's ID, which is new for every click;
    - only the images the kept results list are served, and nothing of the request becomes a file path;
    - a request that a browser marks as another origin's (`Sec-Fetch-Site`) is refused, and nothing is cached.
- Results reuse the report's per-snapshot shape.
- **A warm browser:** after the first click, the browser container keeps running until Storybook stops, with no idle timeout. The next click launches another when:
  - the browser has exited;
  - the config or the browser package calls for a different launch;
  - the last click ended without opening a page in it and wasn't cancelled, as when its build isn't the browser package's.
- The child exits when its connection to Storybook closes, even when Storybook was killed, and the browser's container goes with it. Closing takes at most 10 s.
- **A child that crashes** stops the check, with its exit and its last output in the panel. The next click starts a new child. Once that one's first check completes, earlier results' images are gone.
- **Cancel** stops a pull, closes the click's pages and abandons every other wait. A `host` download can't be stopped: the click ends, the download finishes into the cache, and the next click waits for it. A child that doesn't end a cancelled check within 10 s is killed, and the check counts as cancelled.
- **Browser exits** are counted per click. Within one Check or Update the browser is relaunched once, and a second exit shows the CLI's error in the panel. The next click starts fresh.

### Which Storybook and URL

- The child searches for the config upward from Storybook's own config folder, with the CLI's rules, and reloads it on every click.
  - Each load runs and validates the config in a worker thread of its own, so a change to the config or to a file it imports counts at the next click.
  - What the config does stays in that thread: a change to `process.env` doesn't reach the check. `process.chdir` doesn't work in a worker thread, so a config that calls it fails to load, with Node's message.
  - Paths in messages are relative to the folder Storybook runs in.
- It uses the first config entry whose `dir` and `configDir` resolve to that folder, with symlinks followed.
- It captures against this Storybook's own address, not the config's `url`, which may have none for the current environment.
  - The address is Storybook's protocol, its `--host` and the port it listens on. With no `--host`, or with `0.0.0.0` or `::`, the host is `127.0.0.1`, or `localhost` over HTTPS.
  - When it differs from the `url` the config gives for the current environment, the panel says that CLI runs check the other one. Loopback names (`localhost`, `127.*` and `::1`) count as one host, and a slash at the end doesn't count.
- No config, no matching entry or an invalid config shows the CLI's own message in the panel, plus "run `visual-check init`".

## Without Docker

- Storybook's start never probes Docker.
- On Check or Update, the panel shows the CLI's exit-2 message as it is, with both fixes. There's no fallback to `host`.
- The first click pulls the image, with progress in the panel. Check and Update can be cancelled.
- `platform: 'host'` works as in the CLI.

## Static builds

- No Node side runs in a static build. The manager detects one with `CONFIG_TYPE === 'PRODUCTION'`.
- On a loopback host (`127.0.0.1`, `localhost` or `::1`), the panel shows the exact `test` and `update` commands for the current story, with copy buttons. The Storybook's name is resolved once per build, through the preset's `env` hook, which does nothing outside a static build. Example: `visual-check update --storybook web --filter '^components-button--primary$' --url http://127.0.0.1:6006`.
- That `update` also writes the Storybook's other missing baselines and deletes its orphans, as every `update` does ([Baselines and update](10-baselines-and-update.md)).
- When the name can't be resolved, the build logs a warning, and the panel says to run `visual-check init` and build again.
- On any other host, the addon shows nothing.

## Versions and install

- The addon and the CLI release in lockstep. The addon peer-depends on exactly its own version of the CLI, and on a mismatch the panel says which package to upgrade.
  - The child says its version first, in its `ready` message. On a mismatch the click's run stops, the panel names the older package to upgrade, or says to install one version of both when the two can't be ordered, and the child is disconnected.
- `init` offers it for each Storybook on 10. It installs it with the package manager's exact add, registers it with `storybook add --skip-install`, then sets its spec back to the exact version ([Config and init](03-config-and-init.md)).
- The addon has no postinstall.

## Tests

- This repo's own test Storybook on 10 runs it end to end ([CI for this repo](18-repo-ci.md)): Check and Update in `storybook dev`, with `CI` unset for Update, an unstable story's Update, Update refused with `CI` set, and a static build's commands on 127.0.0.1 and on another address.

## Kept addable

- "Run all" and affected stories in the panel.
- An engine for static builds, behind an origin check.
- The UI planned after v1 reuses the child process and its protocol ([UI to run, watch and review][49]).

## Sources

- [Storybook addon][41], [Failure report format][39], [Baseline updates without a local capture][42], [Docker's role][13], [Test apps repo][34], [Storybook 9 floor and Storybook 11][48].
- Decided while writing this PRD: the slider view, counting browser exits per click, and v1 needing the addon on Storybook 10 only.
- Decided while building Check: one check at a time, reading the current story's options only, the images' names and when they're replaced, what turns results stale, where results live, the image route's checks, a thread per config load, what Cancel does, the 10 s limits, and the own address's rules.
- Decided while building Update and static builds ([#88][88]): Update's rows and status icon, its result replacing the story's, when a cancel comes too late, running it from the story's menu, reading the version from the child's `ready` message, resolving the name once per build and what the panel says without one.

[13]: https://github.com/visual-check/visual-check/issues/13
[34]: https://github.com/visual-check/visual-check/issues/34
[39]: https://github.com/visual-check/visual-check/issues/39
[41]: https://github.com/visual-check/visual-check/issues/41
[42]: https://github.com/visual-check/visual-check/issues/42
[48]: https://github.com/visual-check/visual-check/issues/48
[49]: https://github.com/visual-check/visual-check/issues/49
[88]: https://github.com/visual-check/visual-check/issues/88
