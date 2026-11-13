# Agent skill

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

`init` installs one portable Agent Skills folder. It teaches a coding agent when to run visual-check, how to read the result and which fixes to offer. A small Node script starts a Storybook when none is running and stops what it started.

## Files

`.agents/skills/visual-check/`, committed:

| File | Holds |
|---|---|
| `SKILL.md` | The skill, identical for every project. Its frontmatter uses only fields of the Agent Skills format: `name`, `description`, `compatibility` and `metadata.visual-check-version`. It passes `skills-ref validate` |
| `scripts/run.mjs` | The runner script: plain Node with no dependencies |
| `setup.json` | Written by `init` for this project |

- `setup.json` holds:
  - the CLI command for the project's package manager, in a form that never downloads, such as `pnpm exec visual-check`;
  - its working directory;
  - each Storybook's start command, as `<package manager> run <script>` with its package as the working directory.
- `.claude/skills/visual-check` is a link to that folder, because Claude Code reads only its own path. It's a copy on Windows. The link is committed, so on Windows the copy shows as a changed file in git. That's accepted.
- Not used: model choice, `allowed-tools`, runner subagents and images. Users allow the command in their own agent's settings.

## Install and refresh

- `init` installs the skill as one of its questions, yes by default. Running `init` again rewrites the skill files and refreshes `setup.json` from the config.
- When the installed skill was written by another CLI version, a local `test` or `update`:
  - rewrites `SKILL.md` and `run.mjs`, in both places;
  - keeps `setup.json`;
  - prints the rewritten paths on stderr.
- In CI they write nothing.
- If a new version needs a `setup.json` value it can't fill, the run warns to run `init` again.
- There's no postinstall and no `npx skills add` route in v1.

## The runner script

- It runs the CLI from `setup.json` with the caller's command and flags, plus `--reporter json`.
- **When the CLI exits 2 because Storybooks are unreachable,** which the JSON's `error.storybooks` says, it:
  1. starts each one's command, adding `--ci --exact-port`, after `--` under npm. On Windows it starts the command through a shell;
  2. polls `<url>/index.json` for up to 180 s;
  3. runs the CLI again.
- If a Storybook it started prints a URL on another port than the config's, it exits 2 at once and names both ports.
- **It always stops the process trees it started,** also after a failure or an interrupt: `taskkill /T /F` on Windows, the process group elsewhere. It never touches a server it didn't start.
- **Channels:**
  - stdout carries the CLI's JSON, unchanged;
  - stderr carries the start, stop and reuse lines;
  - the exit code is the CLI's. A Storybook that fails to start gives exit 2, with the end of its output on stderr.
- There's no lock between parallel sessions. If another session stops a Storybook mid-run, the run exits 2 and says so. A Storybook already on the port is reused and reported.

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
- After `update`: every written and deleted path.
- On exit 2: the error as printed.
- Any Storybook it reused.

**Images**

- The agent never opens a snapshot, a baseline or a visual diff. The user, or the calling agent, judges whether a visual diff is intended.

**When to troubleshoot**

- Always for broken stories.
- For visual diffs, only when the agent's own change can't explain them. Otherwise it reports them for the user to judge.

**Fixes to offer, in this order**

1. **Exit 2:** relay the error and its fix. Never suggest `host`.
2. **A broken story,** by reason:
   - `changed-after-capture`, `unstable` or `timeout`: a `wait` hook on the story, or in `preview` when many stories share the cause;
   - `navigated-away`, `play-threw` or `load-failed`: the project's code to fix. For a story that navigates away, await the new page before clicking, or render `MemoryRouter` with `useTransitions={false}`;
   - `too-tall`: `element`, or a smaller viewport;
   - a grid that's too wide or too tall: the story to fix, for example by splitting the grid.

   The agent reads the entry's console messages while it troubleshoots.
3. **The remote-content hint, or `update`'s remote-content warning:** serve the image from Storybook, then mock it with MSW, then mask it by host.
4. **A flaky snapshot, or a story that moves:** a mask by selector for timers, spinners and skeletons, or a `wait` hook.

**Rules**

- The agent proposes each fix with its snippet and applies it only once the user agrees.
- It never raises tolerance, disables a story or runs `update` to make a failure pass without the user's explicit OK.

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
