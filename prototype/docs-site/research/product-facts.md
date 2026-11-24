# visual-check: product facts for landing-page demos

Sources: `visual-check/visual-check` @ `76e1a41`, `visual-check/action`, `visual-check/test-apps`, and the public CI
logs of `visual-check/test-apps` (run 45206620397 on 23 Nov 2026; update run 44950586000 on 21 Nov 2026).

Tags: **[real]** a CI log · **[test]** a string a unit test asserts · **[src]** a string in source · **[PRD]**
specified in `docs/prd`, not checked in code · **[inferred]** put together by me, so check it before quoting.

## 0. Status: read this before making claims

- **Not on npm yet.** `npm view @visual-check/cli` gives 404. Every package is `0.0.0`, there are no git tags, and CI
  prints `visual-check 0.0.0`. The plan is `0.x` releases, then `1.0.0` when v1 is done.
- **Not built or published yet:**
  - the browser image: `chromium.json` holds a placeholder digest, and the test apps build their own (#95);
  - the docs site, though the CLI already links to `https://visual-check.vercel.app/docs/<page>` [src];
  - grid stories (`Combinations`), which exist only in the PRD. `@visual-check/storybook` exports only
    `defineVisualCheck`.
- **"Beats 4:45" isn't proven.** Issue #97, "The migration target runs visual-check in CI", is open and that box is
  unticked.
- **Public repos:** github.com/visual-check/visual-check, /action and /test-apps.

## 1. Install and `init`

**Command:** `pnpm dlx @visual-check/cli init`, from the PRD and the placeholder README. The PRD allows "the package
manager's equivalent" (`npx @visual-check/cli init` [inferred form]).
- There's no separate install step: `init` installs the packages.
- The binary is `visual-check`; `vc` was ruled out because Vercel's CLI uses it.
- `--yes` takes every default.

**It installs** `@visual-check/cli` (exact) and `@visual-check/chromium@^157.0.0` (the browser data peer) at the root,
and `@visual-check/storybook` plus the optional `@visual-check/storybook-addon` per Storybook package. The step runs
[test] `pnpm add --save-dev @visual-check/cli@0.0.0 @visual-check/chromium@^157.0.0 @…`. The unscoped npm name
`visual-check` is only a README placeholder.

**It detects** [PRD] workspaces (pnpm, npm, Yarn, Bun, Lerna, Nx, Rush), the package manager (npm, pnpm, Yarn 1, Yarn
4.17.1+, Bun), each `.storybook/main.*` with its start script and port, Docker, and each Storybook's version. URLs are
always `http://127.0.0.1:<port>`, never `localhost`.

**Prompts** [src]. Each shows `? Prompt`, then a dim hint, then `› default`:

| Prompt | Hint |
|---|---|
| `Package manager` (only when undetected) | `No lockfile or packageManager field names one.` |
| `Storybooks to set up` (checklist, when there are several) | `The ones ticked go in the config.` |
| `Name of the Storybook in apps/web` | `What the config and the report call this Storybook.` |
| `URL of web` | `Where visual-check opens it, locally and in CI. Use 127.0.0.1, not localhost.` |
| `Command that starts web` (only when no script starts it) | `No script starts this Storybook. The next steps show this command.` |
| `Name of the script that runs visual-check test` (`visual:check`) | `Compares each story with its baseline.` |
| `Name of the script that runs visual-check update` (`visual:update`) | `Writes the baselines.` |
| `Install the agent skill?` (Yes) | `Teaches a coding agent to run visual-check and report what changed.` |
| `Add the Storybook addon to web?` (Yes; Storybook 10 only) | `Check and update the open story from inside Storybook.` |

**Terminal UI** [test]:
- Header: `✓✓ visual-check init · v1.2.3`. The first `✓` is cyan `#00b4d8`, the second magenta `#ff2d87`, and the rest is
  dim.
- Progress: `━━━━━━━━━━────────── Step 3 of 4`.
- A question reads `? Add the scripts?` over `› ● Yes  ○ No`, and once answered it collapses to
  `✓ Package manager pnpm`.

The setup steps [test]:
```
━━━━━━━───────────── 1/3 · 3.0s
✓ Write the files and scripts 0.0s
⠋ Install visual-check's packages 3.0s
  pnpm add --save-dev @visual-check/cli@0.0.0 @visual-check/chromium@^157.0.0 @…
  │ Progress: resolved 1, reused 0, downloaded 0, added 0
○ Check for unlisted dependencies
```
- Other steps: `Install the browser package` and `Add the Storybook addon to <name>`.
- Marks: `✓` done, `▲` caution, `✕` failed, `○` pending, `−` skipped.

**It writes:**
- `visual-check.config.ts` and each `<configDir>/visual-check.ts` (§3).
- `.visual-check/.gitignore` files (`/*`, `!/baselines/`, `!/.gitignore`).
- Scripts: `visual:check` (`visual-check test`) and `visual:update` (`visual-check update`), plus `--storybook <name>`
  versions per package.
- The skill in `.agents/skills/visual-check/` (`SKILL.md`, `scripts/run.mjs`, `setup.json`), with a committed
  `.claude/skills/visual-check` symlink (a copy on Windows).

It writes **no GitHub workflow**, only a link to the CI docs. It never edits `preview.*` or the root `.gitignore`.

**Closing message** [test, `summary.test.tsx`]:
```
✓ visual-check is set up
  Replaced the scripts visual:check and visual:update in package.json.

Next
  1  pnpm storybook       Start Storybook, and keep it running
  2  pnpm visual:update   Write the first baselines
  3  pnpm visual:check    Check the stories against the baselines
  4  Commit the changes, baselines included

To set options for every story, see .storybook/visual-check.ts.
To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.
```
- Without a TTY, it opens with `visual-check is set up. Next:`.
- In a monorepo, the heading is `Next, from acme-monorepo` and adds
  `To check only one Storybook, run the scripts in its package: apps/a and apps/b.`

## 2. CLI output (`test` / `update`)

**Commands** [src, `--help`]: `init` `Set up visual-check in this project` · `test`
`Capture snapshots and compare them with baselines` · `update`
`Write missing and failing baselines and delete orphans (local only)`.

**Flags:** `--affected`, `--all`, `--filter <regex>`, `--base <ref>`, `--storybook <name>`, `--url`, `--config`,
`--consistency`, `--workers <n>`, `--shard <k>/<n>`, `--reporter live|log|json`.

**Reporters** [src]:
- `live` (the default in a terminal): one spinner line, `⠋ 9/14 snapshots · 4 workers · 2.1s` [test format]. Only `✗`
  and `!` lines print above it.
- `log` (the default in CI or without a TTY): every line, append-only.
- `json`: the report on stdout.

**Header** [src]: `visual-check <ver> · <test|update> · <n> snapshots · <w> workers`. A shard adds
` · shard 2/3 · 9 stories files`.

**Snapshot lines** [src/test]: a mark, then Storybook, story ID, mode (if any) and detail, two spaces apart. A flaky
pass appends ` · flaky`. The ms are raw, as in `1129 ms` [real].
```
✓ web  button--primary  142 ms
✗ web  button--primary  dark  differs: 84 differ, 80 allowed (20 at scale 2)
✗ web  a  differs: size changed: 10×10 → 10×12
✗ web  card--new  missing: no baseline yet; run visual-check update to write it
✗ web  old--story  orphan: no story calls for .visual-check/baselines/old--story.png; run visual-check update to delete it
! web  checkout--flow  broken: The story navigated away to /categories/burgers. Await the new page before clicking.
✓ web  c  written: differs: 100 differ, 20 allowed          (update; also "written: missing", "kept")
```

**`test` end block** [src], in order:
1. `── 2 failures ──`.
2. Each failure: a name line, then indented `differs: …`, `diff: <path>`, `hint: …` and up to 5 `console error:` lines.
3. `Flaky snapshots, which passed on a retry:`.
4. Counts, such as `248 passed (2 flaky) · 1 differs · 1 broken · 3m 12s`. Zero counts are left out, except `passed`.
   Durations read `142 ms`, `12.3s` or `3m 12s`.
5. `Report: .visual-check/report/report.json`.

**Affected stories:** there's no "N affected" line; the header's count is the selection. The only notes are [src]:
- `No files changed since abc1234, so no story is affected. Run with --all to cover every story.`
- `Storybook docs is left out, since no changed file reaches it.`

**Exit codes:** `0` pass · `1` a project problem (visual diff, broken, missing, orphan) · `2` a tool, config or
environment failure. Example [src; the bracketed cause is inferred]:
`Storybook web doesn't answer at http://127.0.0.1:6006/index.json (ECONNREFUSED). Start it, or set its URL in the config or with --url.`

### Transcript A: clean pass in CI (`log`)

[real] sb11 test app, through the Action on ubuntu-24.04 (4 vCPU). Cut down from 108 lines; the first line is the
Action's.
```
visual-check: running …/apps/sb11/node_modules/@visual-check/cli 0.0.0: visual-check test
visual-check 0.0.0 · test · 108 snapshots · 4 workers
✓ sb11  components-alert--warning  821 ms
✓ sb11  components-alert--success  835 ms
✓ sb11  components-button--default  294 ms
✓ sb11  wip-togglebutton--checked  211 ms
✓ sb11  design-system-typography--typography-system  223 ms
108 passed · 10.8s
Report: .visual-check/report/report.json
```
Other real lines: `76 passed · 9.1s` (react-inspector), `110 passed · 19.1s` (dnd-kit, 5 Storybooks such as
`stories-vue`), `108 passed · 16.9s` (Windows).
- A shard: `visual-check 0.0.0 · test · shard 2/3 · 9 stories files · 36 snapshots · 4 workers`, then
  `Missing baselines and orphans are left to test --consistency.`, then `36 passed · 5.6s`.
- A consistency job: `visual-check 0.0.0 · test · consistency · 108 snapshots`, then
  `Consistent: every baseline the stories call for is there, and none is an orphan.`

### Transcript B: 2 changed stories (`log`)

[inferred] Built from the source grammar; the story IDs are real freecodecamp-ui stories.
```
visual-check 0.1.0 · test · 108 snapshots · 4 workers
✓ web  components-alert--warning  821 ms
✗ web  components-button--default  differs: 312 differ, 20 allowed
✓ web  components-button--danger  265 ms
✗ web  components-modal--default  mobile  differs: 1904 differ, 80 allowed (20 at scale 2)
✓ web  components-tabs--default  268 ms
── 2 failures ──
web  components-button--default
  differs: 312 differ, 20 allowed
  diff: .visual-check/report/images/web/components-button--default.diff.png
web  components-modal--default  mobile
  differs: 1904 differ, 80 allowed (20 at scale 2)
  diff: .visual-check/report/images/web/components-modal--default.mobile.diff.png
106 passed · 2 differs · 11.4s
Report: .visual-check/report/report.json
```
- It exits 1. Under `live`, the `✓` lines are hidden.
- An optional hint [src]: `  hint: Differs only inside remote content from images.example.com. A CDN can serve
  different bytes to different machines. Mask it by host: { host: 'images.example.com' }. See
  https://visual-check.vercel.app/docs/remote-content`

### Transcript C: `update`

[real] From the test-apps baseline job, cut down. The last line goes to stderr.
```
visual-check 0.0.0 · update · 108 snapshots · 4 workers
✓ freecodecamp-ui  components-alert--info  written: missing
✓ freecodecamp-ui  design-system-color--color-system  written: missing
108 written
written .visual-check/baselines/components-alert--info.png
…
s3.amazonaws.com: 2 stories (components-image--default, components-image--responsive) show remote content. A CDN can serve it differently on another machine, so CI may fail.
```
A local `update` with a change [test, `run-cli.test.ts`]:
```
visual-check 0.1.0 · update · 4 snapshots · 1 worker
✓ web  a  kept
✓ web  b  kept
✓ web  c  written: differs: 100 differ, 20 allowed
✓ web  d  written: missing
2 written · 2 kept
written .visual-check/baselines/c.png
written .visual-check/baselines/d.png
```
- The counts read `written · deleted · kept · broken`, followed by any `deleted <path>` lines.
- The flaky block: `Flaky snapshots, whose loads disagreed:`.
- A request warning [test]:
  `api.example.com: 2 stories (data--a, data--b). These stories make real network requests and may be unreliable.`
- `update` with `CI` set exits 2.

## 3. Config and the story helper

`visual-check.config.ts` as `init` writes it [real, test-apps, minus its image override]:
```ts
import { defineConfig } from '@visual-check/cli'

export default defineConfig({
  storybooks: {
    'freecodecamp-ui': { url: 'http://127.0.0.1:6006' },
  },
})
```
- A monorepo entry [PRD]:
  `ui: { dir: 'packages/ui', url: { local: 'http://127.0.0.1:2137', ci: 'http://127.0.0.1:6007' } }`.
  Only `url`, `workers` and `readyTimeout` can differ between local and CI.
- Defaults [PRD/src]: `platform: 'linux/amd64'` (or `'linux/arm64'` or `'host'`), `tolerance: { color: 0.01, pixels: 20 }`,
  `viewport: { width: 1280, height: 720, deviceScaleFactor: 1 }`, `maskColor: '#FF00FF'`, `timezone: 'UTC'`,
  `locale: 'en-US'`, `colorScheme: 'light'`, `workers: 'auto'`, `readyTimeout: 10_000`, `retries: 1`.

`.storybook/visual-check.ts`, exactly as `init` writes it [src]:
```ts
import { defineVisualCheck } from '@visual-check/storybook'

// To set options for every story, spread visualCheck into the parameters in your preview file:
//   import { visualCheck } from './visual-check'
//   parameters: { ...visualCheck({}) },
export const visualCheck = defineVisualCheck({
  modes: {
    // Each mode a story lists adds one snapshot besides its default capture. For example:
    // mobile: { viewport: { width: 375, height: 667, deviceScaleFactor: 2, touch: true } },
  },
})
```
- Filled in [PRD]:
  `modes: { dark: { globals: { theme: 'dark' } }, mobile: { viewport: { width: 375, height: 667, deviceScaleFactor: 2, touch: true } } }`.
- Typed globals: `defineVisualCheck<Globals>()({ modes })`.

A story [combined from real patterns in `test-storybooks/storybook-10-react/stories/*.stories.tsx`]:
```tsx
import type { Meta, StoryObj } from '@storybook/react-vite'
import { visualCheck } from '../.storybook/visual-check'

const meta = { title: 'Components/Card', parameters: { ...visualCheck({ modes: ['dark'] }) } } satisfies Meta
export default meta

export const Default: StoryObj<typeof meta> = {
  parameters: {
    ...visualCheck({
      modes: ['dark', 'mobile'],
      masks: { clock: { selector: '[data-clock]' }, cdn: { host: 'images.example.com' } },
      wait: async ({ canvas }) => {
        await canvas.findByText('Late content')
      },
    }),
  },
}
```
- **Keys:** `modes`, `viewport`, `element`, `masks`, `tolerance`, `wait`, `disable`. For example,
  `visualCheck({ disable: true })` and `visualCheck({ element: '[data-capture-me]' })`.
- **Pixel budget:** `pixels` counts CSS pixels, so 20 allows 80 at scale 2. A share such as `'0.1%'` works too.
- **Baseline files** [PRD]: `<dir>/.visual-check/baselines/components-button--primary.png` and
  `components-button--primary.dark.png`.

## 4. Storybook addon (`@visual-check/storybook-addon`, Storybook 10 only)

All strings are [src].
- **Panel:** titled `Visual check`, with the buttons `Check`, `Update`, and `Cancel` while a run is going.
- **Status line:** `Starting…`, `Getting the browser…` (with the pull log), `Capturing 3 of 4…`, `Updating 3 of 4…`,
  `Cancelling…`, `Cancelled`, `Another story is being checked: <id>.`; after a run `Passed`,
  `1 visual diff, 1 missing baseline`, `2 visual diffs`, `1 broken`, `2 written, 1 untouched`, `Disabled`, `Stopped`,
  `Stale: Passed`.
- **Empty states:** `Select a story to check it.` and `This story isn't checked yet.`
- **Check rows:** the mode or `Default`, an optional `Flaky` tag, then `Passed`, `Visual diff`, `Missing baseline` or
  `Broken story`. Notes: `Reason: <code>`, `URL: …`, `Timeout: 10000 ms`, `Page size: 1280 × 40000 device pixels`,
  `Hint: …`. The first failing row starts selected.
- **Image viewer:** a toggle between `Slider` and `Visual diff`, the caption `Left: baseline  Right: snapshot`, and a
  range slider, `Wipe between the baseline and the snapshot`, starting at 50%. A missing baseline shows the snapshot
  alone.
- **Update rows:** `Written`, `Untouched` or `Broken story`, with the baseline's path.
  - Messages: `Written: missing`, `Written: differs: 312 differ, 20 allowed`, `Untouched: identical, byte for byte`.
  - Warnings: `Warning: <host>: …`.
- **Other messages:** `Stale: something changed since this check. Check or update again.` ·
  `parameters.visualCheck disables this story, so visual-check doesn't capture it.` ·
  `Run visual-check init to set this Storybook up.`
- **Sidebar:** menu items `Check with visual-check` and `Update baselines with visual-check`. A status icon (success,
  warning for missing, error) reads `Checking…`/`Updating…` while running and `Stale` once stale. Provider line:
  `Check or update one story at a time, from its Visual check panel or its menu.`
- **Static build, on a loopback host:**
  - `This is a static build, so the panel can't run visual-check. With the build served here, run these in the project:`
  - `Check this story:` and `Rewrite its baselines:`, each with `Copy`, which turns into `Copied`;
  - example [PRD]: `visual-check update --storybook web --filter '^components-button--primary$' --url http://127.0.0.1:6006`
- **Behaviour** [PRD]: the current story only, with every listed mode; one run at a time; the browser stays warm after
  the first click.

## 5. GitHub Action and the reusable workflow (`visual-check/action`)

Minimal workflow [real README]:
```yaml
jobs:
  visual:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npx storybook build
      - run: npx http-server storybook-static -p 6006 -a 127.0.0.1 --silent &
      - run: npx wait-on tcp:127.0.0.1:6006
      - uses: visual-check/action@v1
```
- **Sharded:** `uses: visual-check/action/.github/workflows/test.yml@v1` with `secrets: inherit` and
  `with: { shards: 4, setup: <install, build and serve script> }`. Real job names: `Plan`, `Consistency check`,
  `Shard 2 of 3`.
- **Inputs:** `storybook`, `shard`, `affected`, `consistency`, `working-directory`, `args`, `retention-days`. **Outputs:**
  `exit-code`, `report-dir`, `artifact-url`. **Branding:** icon `eye`, colour `purple`.
- **Behaviour:** it needs only `contents: read`, so it works on fork PRs. No annotations, no cache, never `update`.
  `v1` accepts CLI `0.x` up to, but not including, 2.0.
- **Artifact:** `visual-check-report[-<storybook>][-<k>-of-<n>]`, or `visual-check-consistency[-<storybook>]`, uploaded
  only on exit 1 or 2. Real run env: `VISUAL_CHECK_ARTIFACT_NAME: visual-check-report`.

Step summary, written by the CLI [test, `step-summary.test.ts`]:
```md
### visual-check 0.1.0 · test · shard 2/4

3 passed (2 flaky) · 1 differs · 1 broken · 1 missing · 1 orphan

**Flaky snapshots**

- web · button--secondary
- web · a · dark

**Failures**

| Storybook | Story | Mode | Status | Message |
| --- | --- | --- | --- | --- |
| web | button--primary | dark | differs | 84 differ, 80 allowed (20 at scale 2) |
| web | checkout--flow |  | broken | Navigated away. |
```
- A passing run's summary: `### visual-check 0.1.0 · test`, then `2 passed`. There are no images.
- The Action then appends [src]: `**Report:** [visual-check-report](<url>) (zipped `report.json` and images)`.
- The job log ends with `Summary: <run url>` and `Report: <artifact url> (artifact visual-check-report)`.

## 6. Agent skill

- **Name:** `visual-check`, in `.agents/skills/visual-check/`, linked from `.claude/skills/visual-check`.
- **Description** [src]: "Checks whether a code change alters how the project's Storybook stories look, by running
  visual-check, which compares a snapshot of each affected story with its approved baseline. Use after changing UI code,
  styles or stories, before saying the work is done, and whenever asked whether a change alters how stories look."
- **Runner:** `node .agents/skills/visual-check/scripts/run.mjs test`. Plain Node with no dependencies, it adds
  `--reporter json`. When a Storybook is down (exit 2), it starts it from `setup.json`, polls `index.json` for up to
  180 s and reruns. It always stops what it started.
- **Runner stderr** [src format]: `Starting Storybook web in apps/web: pnpm run storybook --ci --exact-port` ·
  `Storybook web answers at http://127.0.0.1:6006 after 7.4s.` ·
  `Reused Storybook web, which was already running at http://127.0.0.1:6006.` · `Stopped Storybook web.`
- **`setup.json`** [test]:
  `{"cli":{"command":["pnpm","exec","visual-check"],"cwd":"../../.."},"storybooks":{"web":{"command":["pnpm","run","storybook"],"cwd":"../../../apps/web"}}}`
- **SKILL.md tells the agent:**
  - Run after UI changes, before saying the work is done. Run `update` only when asked.
  - Report the counts, plus each `differs` or `broken` story with its mode, `pixels.differ` and diff path. Also report
    missing baselines, orphans, flaky snapshots and any reused Storybook.
  - Offer fixes in this order: exit 2, broken stories by `reason`, remote content (serve locally, then MSW, then mask by
    host), flaky snapshots (a mask or `wait`).
- **Quotes** [src]: "Never open a snapshot, a baseline or a visual diff. Give their paths instead." · "Propose each
  fix with its snippet, and apply it only once the user agrees." · "Never raise tolerance, disable a story or run
  `update` to make a failure pass without the user's explicit OK."

Example agent reply [inferred, in the shape SKILL.md asks for]:
> visual-check ran on 14 affected snapshots: 12 passed and 2 differ.
> - `components-button--default` (default capture): 312 pixels differ. Diff:
>   `.visual-check/report/images/web/components-button--default.diff.png`
> - `components-modal--default` (mobile): 1904 pixels differ. Diff: `…/components-modal--default.mobile.diff.png`
>
> Both come from my padding change in `Button.css`. If they're intended, run `pnpm visual:update`; I won't run it
> without your OK. There are no missing baselines, orphans or flaky snapshots. I reused Storybook web at
> http://127.0.0.1:6006.

## 7. Report JSON (`.visual-check/report/report.json`)

Minified on disk. The field order is the source's. The entry is from `run-cli-report.test.ts` with its IDs swapped
[inferred]. With the default `retries: 1`, a diff has `attempts: 2` [inferred].
```json
{
  "version": 1, "visualCheck": "0.1.0", "command": "test", "consistencyOnly": false, "exitCode": 1, "shard": null,
  "selection": { "by": "affected", "base": "3f9c2e1…", "changedFiles": 3, "fallback": null },
  "reportDir": ".visual-check/report",
  "storybooks": [{ "name": "web", "url": "http://127.0.0.1:6006" }],
  "counts": { "passed": 12, "flaky": 0, "differs": 2, "broken": 0, "missing": 0, "orphan": 0 },
  "snapshots": [{
    "storybook": "web", "id": "components-button--default", "kind": "story",
    "story": "components-button--default", "importPath": "./src/button/button.stories.tsx", "mode": null,
    "status": "differs", "reason": "pixels", "message": "312 differ, 20 allowed", "flaky": false, "attempts": 2,
    "pixels": { "differ": 312, "allowed": 20, "budget": 20, "scale": 1 }, "size": null, "details": null,
    "hints": [], "console": [],
    "baseline": ".visual-check/baselines/components-button--default.png",
    "images": {
      "baseline": "images/web/components-button--default.baseline.png",
      "snapshot": "images/web/components-button--default.snapshot.png",
      "diff": "images/web/components-button--default.diff.png"
    }
  }],
  "warnings": [], "error": null
}
```
Passes are only counted, unless flaky. `test` statuses: `passed`, `differs`, `broken`, `missing`, `orphan`. `update`:
`written`, `deleted`, `broken`, with counts `{ written, deleted, kept, broken, flaky }`. Broken reasons: `load-failed`,
`error`, `play-threw`, `timeout`, `fonts-not-loaded`, `wait-threw`, `navigated-away`, `element-missing`, `too-tall`,
`grid-too-wide`, `crashed`, `browser-exited`, `changed-after-capture`, `unstable`. There's no HTML report, by design.

## 8. Numbers and claims we can honestly make

**Measured in public CI** [real]. GitHub-hosted runners on a public repo, so 4 vCPU, 4 workers; times from the counts
line.

| App | Snapshots | Time |
|---|---|---|
| react-inspector (Storybook 9.1) | 76 | 9.1s |
| sb11 (Storybook 11 beta) | 108 | 10.8s |
| dnd-kit (5 Storybooks: React, vanilla, Vue, Solid, Svelte) | 110 | 19.1s |
| freecodecamp-ui, Windows with Docker Desktop | 108 | 16.9s |
| freecodecamp-ui, shard 2/3 | 36 | 5.6s |

- Most snapshot lines read about 170–300 ms; the first few, warming up, about 800–1100 ms.
- That's about 10 snapshots/s [inferred: 108 in 10.8 s]. The whole Action step took 11 s.

**From the PRD's research** (2 workers on 2-vCPU runners, over 300 real stories):
- 3.30 captures/s, against 2.71 for Playwright's `run-server`. Raw CDP is 18–24% faster than `run-server` (#28).
- The browser launches in 0.39 s, `docker run` included. A fresh runner takes about 8 s. Each worker uses about 1 GiB.
- A story is "ready in 80 ms instead of 170 ms" (ADR 0002).

**The 4:45 goal** [PRD]: "The migration target's CI capture takes 4:45 on 2 vCPUs today. v1 has to beat it from capture
speed alone." It's unmeasured (#97), so present it only as a goal.

**`update`** [PRD]: about 1 s per missing baseline. 66 baselines took 64.6 s with the stability checks and 25.8 s
without (2 workers, emulated amd64 on an arm64 Mac).

**Visual diff** [PRD]: identical bytes skip decoding, which "fired 98–99% of the time". The defaults catch "89–100%
of small deliberate changes". Counting anti-aliased pixels caught 259 of 260 hidden icons, against 118 when they were
ignored. Diff colours: magenta `#FF2D87`, plus cyan `#00B4D8` for size padding.

**Support:**
- Storybook 9.1, 10 and 11 (the addon: 10 only; 7, 8 and 9.0 never). Node `>=22.17.0`. npm, pnpm, Yarn 1 and Yarn
  4.17.1+; Bun "works".
- Chromium `157.0.8103.78` only, in `ghcr.io/visual-check/chromium:157.0.0`, pinned by digest. Runs in Docker,
  `linux/amd64` by default; `linux/arm64` and `host` are opt-in. CI runs on Linux and Windows.
- GitHub Actions is the only CI integration, but the CLI runs anywhere. No hosted service, no account, no Playwright.
- **License:** MIT, "Copyright (c) 2026 Bartek Czyż". The Action and test-apps are MIT too.

**Brand** (`assets/logo/README.md`): cyan `#00B4D8`, magenta `#FF2D87`, ink `#15133C`, paper `#F4F2FF`. The logo is
"A check printed twice, off register."

## 9. Glossary: use, and avoid

| Use | Avoid | Use | Avoid |
|---|---|---|---|
| Storybook | project, instance, app | Story | entry, test, example |
| Snapshot | screenshot, current image | Baseline | reference image, golden |
| Missing baseline | new snapshot | Orphan | stale or obsolete baseline |
| Visual diff | an unqualified "diff", image diff | Tolerance | threshold, maxDiffPixels |
| Mode | variant, breakpoint | Mask | ignore region |
| Broken story | failed or errored story | Flaky snapshot | unstable, intermittent |
| Report (folder) | results, HTML report, artifacts | Reporter | output format |
| Step summary | job summary, annotations | Agent skill | plugin, agent rules or prompt |
| Affected stories | diff stories, relevant stories | Changed files | change set |
| Shard | worker, partition | Check (the addon's) | test, run |
| Stale result | outdated | Container | sandbox, VM |
| Platform | environment, arch | Run error | fatal error, crash |
| Hint | tip, suggestion | Warning | notice, alert |
| Remote content | external assets, CDN images | End state | frozen frame |
