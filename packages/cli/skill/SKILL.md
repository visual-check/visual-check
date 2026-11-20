---
name: visual-check
description: Checks whether a code change alters how the project's Storybook stories look, by running visual-check, which compares a snapshot of each affected story with its approved baseline. Use after changing UI code, styles or stories, before saying the work is done, and whenever asked whether a change alters how stories look.
compatibility: Needs Node.js 22 or later, and a project that visual-check init set up, with its packages installed.
metadata:
  visual-check-version: "0.0.0"
---

# visual-check

visual-check captures snapshots of a project's Storybook stories and compares each with its approved baseline. Run it through this skill's runner script, never the CLI directly: the script starts the Storybooks a run needs when they aren't running, stops what it started, and prints the run's JSON report.

## When to run

- After changing UI code or stories, before saying the work is done.
- When asked whether a change alters how stories look.

## What to run

From the workspace root, the folder that holds `.agents/`:

```sh
node .agents/skills/visual-check/scripts/run.mjs test
```

- `test` with no flag covers the affected stories: the ones the changed files can alter.
- Add `--all`, `--filter <regex>` or `--storybook <name>` only when asked. `--all` covers every story, `--filter` the stories whose ID matches, and `--storybook` narrows the run to one Storybook.
- Run `update` (`node .agents/skills/visual-check/scripts/run.mjs update`) only when the user asks for it. It writes missing and failing baselines and deletes orphans. Never run it to make a failure pass.
- The script adds `--reporter json`. Don't pass another reporter.

The script prints the run's JSON report on stdout, and its own lines and the CLI's progress on stderr. It exits with the run's code: 0 when everything passes, 1 for a problem in the project, 2 for a tool, config or environment failure.

## What to report

Read the JSON report on stdout and report:

- The pass and fail counts, from `counts`.
- For each failing snapshot, an entry of `snapshots` whose `status` is `differs` or `broken`: its story (`story`), its mode (`mode`, `null` for the default capture), the number of differing pixels (`pixels.differ`) and the visual diff's path, which is `reportDir` joined with `images.diff`. Both are relative to the folder that holds the config.
- Missing baselines (`status: "missing"`), orphans (`status: "orphan"`) and flaky snapshots (`flaky: true`).
- After `update`: every written and deleted path, the `baseline` of each entry whose `status` is `written` or `deleted`.
- On exit 2: the error as printed, `error.message` in the report, or the script's own message on stderr when stdout is empty.
- Any Storybook the script reused, from its `Reused Storybook` line on stderr.

## Images

Never open a snapshot, a baseline or a visual diff. Give their paths instead. The user, or the agent that asked you, judges whether a visual diff is intended.

## When to troubleshoot

- Always for broken stories.
- For visual diffs, only when your own change can't explain them. Otherwise report them for the user to judge.

While you troubleshoot a broken story, read its entry's console messages (`console`) and its `details`.

## Fixes to offer, in this order

1. **Exit 2:** relay the error and the fix it names. Never suggest `platform: 'host'`.
2. **A broken story,** by its `reason`:
   - `changed-after-capture`, `unstable` or `timeout`: a `wait` hook on the story, or in `preview` when many stories share the cause;
   - `navigated-away`, `play-threw` or `load-failed`: the project's code to fix. For a story that navigates away, await the new page before clicking, or render `MemoryRouter` with `useTransitions={false}`;
   - `too-tall`: `element`, or a smaller viewport;
   - a grid that's too wide (`grid-too-wide`) or too tall: the story to fix, for example by splitting the grid into several stories.
3. **The remote-content hint** (a `hints` entry of kind `remote-content`), **or `update`'s remote-content warning:** serve the image from Storybook, then mock it with MSW, then mask it by host.
4. **A flaky snapshot, or a story that moves:** a mask by selector for timers, spinners and skeletons, or a `wait` hook.

Options go in `parameters` through the `visualCheck` helper the project exports from `visual-check.ts` in each Storybook's config folder: on a story, on a stories file's meta, or in `preview` for every story.

```ts
import { visualCheck } from '../.storybook/visual-check'

export const Default = {
  parameters: {
    ...visualCheck({
      // Waits for what the story shows late. It runs in the browser, before the snapshot.
      wait: async ({ canvasElement }) => {
        await canvasElement.querySelector('img')?.decode()
      },
      // Paints over elements by selector, or over everything shown from a host, in the baseline and the snapshot.
      masks: { clock: { selector: '[data-testid="clock"]' }, cdn: { host: 'images.example.com' } },
      // Captures one element instead of the whole page.
      element: '#storybook-root > *',
      // A smaller viewport, in CSS pixels.
      viewport: { width: 375, height: 667 },
    }),
  },
}
```

## Rules

- Propose each fix with its snippet, and apply it only once the user agrees.
- Never raise tolerance, disable a story or run `update` to make a failure pass without the user's explicit OK.
