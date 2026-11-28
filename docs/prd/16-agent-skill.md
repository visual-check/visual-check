# Agent skill

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

`init` installs one portable Agent Skills folder. It teaches a coding agent when to run visual-check, how to read the result and which fixes to offer. A small Node script starts a Storybook when none is running and stops what it started.

## Files

`.agents/skills/visual-check/`, committed:

| File              | Holds                                                                                                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SKILL.md`        | The skill, identical for every project. Its frontmatter uses only fields of the Agent Skills format: `name`, `description`, `compatibility` and `metadata.visual-check-version`. It passes `agentskills validate` |
| `scripts/run.mjs` | The runner script: plain Node with no dependencies                                                                                                                                                                |
| `setup.json`      | Written by `init` for this project                                                                                                                                                                                |

- `setup.json` holds:
  - `cli`: `{ command, cwd }`, the CLI command for the project's package manager in a form that never downloads, such as `["pnpm", "exec", "visual-check"]`, run from the workspace root;
  - `storybooks`: for each Storybook, keyed by its config name, `{ command, cwd }`, its start command as `["<package manager>", "run", "<script>"]` with its package as the working directory.
- Each `command` is a list of words, the program first, so no word is ever split, and the script quotes each word for its system. Each `cwd` is relative to the folder holding `setup.json`:

  ```json
  {
    "cli": { "command": ["pnpm", "exec", "visual-check"], "cwd": "../../.." },
    "storybooks": {
      "web": { "command": ["pnpm", "run", "storybook"], "cwd": "../../../apps/web" }
    }
  }
  ```

- The CLI command is the package manager's form that runs only what's installed: `pnpm exec visual-check`, `npx --no-install visual-check` under npm and Yarn 1, `yarn exec visual-check` under Yarn 2 and later, and `bunx --no-install visual-check` under Bun, which needs a Bun recent enough to honour `--no-install`.
- A Storybook no script starts gets a command too, in the same never-downloading form: an Nx target as `nx run <project>:<target>` from the workspace root, and a Storybook with no start found as `storybook dev -p <its URL's port>`, with `-c` when its config folder isn't `.storybook`, from its `dir`.
- `SKILL.md`'s `metadata.visual-check-version` names the CLI version that wrote it. The package ships the skill's source in `skill/`.
- `init` writes every Storybook of the config. When a run needs a Storybook `setup.json` has no start command for, the script exits 2 and asks to run `init` again.
- `.claude/skills/visual-check` is a link to that folder, because Claude Code reads only its own path. It's a copy on Windows. The link is committed, so on Windows the copy shows as a changed file in git. That's accepted. When git ignores the folder or the link, `init` warns, naming the rule; it never edits `.gitignore`.
- Not used: model choice, `allowed-tools`, runner subagents and images. Users allow the command in their own agent's settings.

## Install and refresh

- `init` installs the skill as one of its questions, yes by default. Running `init` again rewrites the skill files and refreshes `setup.json` from the config.
- The skill counts as installed when `.agents/skills/visual-check/SKILL.md` sits beside the config.
- When the installed skill was written by another CLI version, a local `test` or `update`:
  - rewrites `SKILL.md` and `run.mjs`, in both places, though in `.claude` only where it's a copy: a link shares the files. The `.claude` copy goes first and `.agents/skills/visual-check/SKILL.md` last, so a refresh that fails is tried again on the next run;
  - keeps `setup.json`;
  - prints `visual-check <version> rewrote the agent skill, which another version wrote:` on stderr, then each path.
- In CI they read and write nothing.
- If `setup.json` is missing, isn't JSON, or lacks a top-level key the new runner script reads, that run warns to run `init` again. The script checks the values itself when it runs.
- A write that fails warns `visual-check couldn't rewrite the agent skill in <folder>: <reason>. Run visual-check init again to rewrite it.` It never changes the run's result.
- There's no postinstall and no `npx skills add` route in v1.

## The runner script

- It runs the CLI from `setup.json` with the caller's command and flags, plus `--reporter json`. The CLI runs at most twice.
- **When the CLI exits 2 because Storybooks are unreachable,** which the JSON's `error.storybooks` says, it handles only those. In a local affected run that list holds only the required Storybooks that are down ([Affected stories](11-affected-stories.md#required-storybooks)). It:
  1. starts each one's command, adding `--ci --exact-port`, after `--` under npm. Several start in parallel, and the first that fails stops the others;
  2. polls `<url>/index.json` for up to 180 s, until it answers with a Storybook index;
  3. runs the CLI again.
- If a Storybook it started prints a URL on another port than the config's, it exits 2 at once and names both ports.
- If a Storybook it started exits before it answers while something still holds its port, it keeps polling. A Storybook that answers there is reused.
- **It always stops the process trees it started,** also after a failure or an interrupt: `taskkill /T /F` on Windows, the process group elsewhere. It never touches a server it didn't start, beyond asking for its `index.json`.
- **Each tree runs under a keeper,** the CLI's and each Storybook's: the script itself, run again, which stops its tree when the script tells it to, or when the script ends in any way, killed included.
- **Reuse:** after a run with no run error, it reports as reused each Storybook of the last run's report that it didn't start. A Storybook already on the port is reused that way and left running.
- **Mid-run check:** there's no lock between parallel sessions. After a last run that exits 1, it asks each Storybook of the run for its index once. One that refuses the connection stopped mid-run, so the script says so and exits 2. It does the same when the second run names as unreachable a Storybook it had just started or found answering.
- **Interrupts:** on SIGINT, SIGTERM or SIGHUP, and SIGBREAK on Windows, it stops everything it started and exits with 128 plus the signal's number, such as 130 for SIGINT. stdout gets whatever the last CLI run printed so far.
- **Windows:** every command runs through `cmd.exe`, each argument in double quotes, and the program too unless it is a bare name such as `npm`, since a `.cmd` shim called by a quoted bare name can't find its own folder. An argument that holds a double quote, a line break or a `%name%` can't pass safely, so the script exits 2 without starting that command, or any Storybook.
- **Channels:**
  - stdout carries the last CLI run's JSON, unchanged, written after every stderr line;
  - stderr carries the start, ready, stop and reuse lines, and the CLI's own stderr;
  - the exit code is the last CLI run's, except that a failure of the script exits 2: a missing or invalid `setup.json`, a missing start command, a Windows argument it can't pass, a Storybook that fails to start, with the end of its output on stderr, a port mismatch, or a Storybook stopped mid-run.

## What `SKILL.md` tells the agent

**When to run**

- After changing UI code or stories, before saying the work is done.
- When asked whether a change alters how stories look.

**What to run**

- `test`, which covers affected stories with no flag.
- `--all`, `--filter` or `--storybook` when asked.
- `update` only when the user asks for it, never to make a failure pass.

**What to report**

- The pass and fail counts.
- For each failing snapshot: the story, the mode, the number of differing pixels and the visual diff's path, which is `reportDir` joined with `images.diff`.
- Missing baselines, orphans and flaky snapshots.
- Page errors, whatever the snapshot's status: each one's kind, text, load error and severity, and the stale expected page errors. One that fails makes `test` exit 1 even when every snapshot passed.
- After `update`: every written and deleted path.
- On exit 2: the error as printed.
- Any Storybook it reused.

**Images**

- The agent never opens a snapshot, a baseline or a visual diff. The user, or the calling agent, judges whether a visual diff is intended.

**When to troubleshoot**

- Always for broken stories.
- Always for page errors that fail the run.
- For visual diffs, only when the agent's own change can't explain them. Otherwise it reports them for the user to judge.

**Fixes to offer, in this order**

1. **Exit 2:** relay the error and its fix. Never suggest `host`.
2. **A broken story,** by reason:
   - any reason, with a `failed-loads` hint: the server that serves Storybook dropped its files, not the story. Serve it with a server that takes many connections, or lower `--workers`; never a `wait` hook for it;
   - `changed-after-capture`, `unstable` or `timeout`: a `wait` hook on the story, or in `preview` when many stories share the cause;
   - `navigated-away`, `play-threw` or `load-failed`: the project's code to fix. For a story that navigates away, await the new page before clicking, or render `MemoryRouter` with `useTransitions={false}`;
   - `too-tall`: `element`, or a smaller viewport;
   - a grid that's too wide or too tall: the story to fix, for example by splitting the grid;
   - `overflows`: first the layout, then a wider viewport or modes without the narrow ones for the full page, or an element that holds the content; last, and only when the user says the cut is intended, `allowOverflow: true`.

   The agent reads the entry's console messages and page errors while it troubleshoots.
3. **A page error,** by kind and text:
   - a `console.error`, an uncaught error or an unhandled rejection: the project's code to fix;
   - a failed load: the file or the request to fix, or a mock for a request the story needs;
   - one the story raises on purpose, such as an error-state story's mocked error response: an `expectedPageErrors` entry on that story;
   - a stale expected page error: the entry to remove, or the story to fix when it should still raise it.
4. **The remote-content hint, or `update`'s remote-content warning:** serve the image from Storybook, then mock it with MSW, then mask it by host.
5. **A flaky snapshot, or a story that moves:** a mask by selector for timers, spinners and skeletons, or a `wait` hook.

**Rules**

- The agent proposes each fix with its snippet and applies it only once the user agrees.
- It never raises tolerance, disables a story, sets `allowOverflow` or runs `update` to make a failure pass without the user's explicit OK.
- It never sets `pageErrors` to `'warn'` or `'off'`, or declares an expected page error the story doesn't raise on purpose, to make a failure pass without the user's explicit OK.

## Checks by hand

Before a release that changes the skill, and once more before 1.0.0, someone runs it in Claude Code, Codex, Cursor, Copilot and Antigravity ([Release process](19-release.md)):

- the skill is listed once, since some tools read both `.agents/` and `.claude/`;
- the agent runs it, and the script starts and stops Storybook.

## Sources

- [Agent skill formats][9], [Agent skill shape][20], [Config file shape and init wizard][38], [Failure report format][39], [Remote content that differs between machines][35], [Animations frozen at their end state][44], [Reading per-story options][46], [Cartesian stories helper][50], [Self-navigating stories under raw CDP][31], [Windows and macOS on GitHub Actions][33].
- Decided while writing this PRD: the link is committed, the skill reports flaky snapshots, and it no longer suggests the reduced-motion preference.

[9]: https://github.com/visual-check/visual-check/issues/9
[20]: https://github.com/visual-check/visual-check/issues/20
[31]: https://github.com/visual-check/visual-check/issues/31
[33]: https://github.com/visual-check/visual-check/issues/33
[35]: https://github.com/visual-check/visual-check/issues/35
[38]: https://github.com/visual-check/visual-check/issues/38
[39]: https://github.com/visual-check/visual-check/issues/39
[44]: https://github.com/visual-check/visual-check/issues/44
[46]: https://github.com/visual-check/visual-check/issues/46
[50]: https://github.com/visual-check/visual-check/issues/50
