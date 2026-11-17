# visual-check

Visual regression testing for projects that use Storybook: it tells a developer whether a code change alters how stories look compared to what was approved.

## Language

**Storybook**:
One Storybook the config lists by name, with its own stories, URL and baselines. A project can have several.
_Avoid_: Project, instance, target, app

**Story**:
One state of a component that a Storybook lists and renders on its own. The docs pages and tests a Storybook also lists aren't stories.
_Avoid_: Entry, test, example

**Grid story**:
A story that lays out combinations of one component's props, and maybe forced states, as captioned cells in one snapshot.
_Avoid_: Combined snapshot, contact sheet, cartesian story, matrix, variants

**Forced state**:
An interaction state, such as hover or keyboard focus, that a cell of a grid story shows without a pointer or a keyboard.
_Avoid_: Pseudo state, simulated hover

**Baseline**:
The approved image of a story in its default capture or one of its modes, the reference every comparison is made against.
_Avoid_: Reference image, golden, expected

**Missing baseline**:
A snapshot the current stories and config call for that has no baseline yet.
_Avoid_: New story, new snapshot

**Orphan**:
A baseline that nothing in the current stories and config would capture any more.
_Avoid_: Stale baseline, obsolete baseline

**Consistency check**:
Comparing the baselines the current stories and config call for with the ones that exist, which finds missing baselines and orphans without capturing anything.
_Avoid_: Integrity check, baseline check

**Shard**:
One of several CI jobs a test run is split across, and the share of snapshots it captures.
_Avoid_: Worker, partition, chunk

**Snapshot**:
The image of a story in its default capture or one of its modes, captured during the current run.
_Avoid_: Screenshot, visual, current image

**End state**:
How a snapshot shows anything that moves: every finite animation and transition as if it had already finished, and infinite animations and media on their first frame.
_Avoid_: Frozen frame, final frame, paused animation

**Mode**:
A named set of globals and viewport, declared once per Storybook, that a story can be captured in besides its default capture, which has no mode.
_Avoid_: Variant, configuration, breakpoint, extra shot

**Per-story options**:
What a project sets for a Storybook, a stories file or a story in `parameters.visualCheck`: modes, viewport, capture element, masks, tolerance, `wait` and `disable`. Storybook merges the levels, and visual-check reads the result before it captures.
_Avoid_: Story config, story settings, visual-check parameters

**Visual diff**:
The pixel comparison of a snapshot against its baseline, and the image it draws of where they differ.
_Avoid_: Diff (unqualified), image diff

**Tolerance**:
How much a snapshot may differ from its baseline and still pass: how far a pixel's colour may move before the pixel counts as differing, and how many differing pixels are allowed.
_Avoid_: Threshold, diff threshold, mismatch budget, maxDiffPixels

**Mask**:
A part of a story painted over in both the baseline and the snapshot, chosen by selector or by host, so its content doesn't count in the visual diff but its size and position do.
_Avoid_: Ignore region, hidden element

**Remote content**:
What a story shows from an origin other than its Storybook's: images and embedded pages.
_Avoid_: External assets, third-party content, CDN images

**Real network request**:
A `fetch`, XHR, WebSocket or EventSource request a story sends to an origin other than its Storybook's that goes over the network or to the HTTP cache, not one a service worker answers itself.
_Avoid_: External request, live request, unmocked request, third-party request

**Broken story**:
A story that can't be captured: its stories file fails to load, or it errors, crashes its page, is in flight when the browser exits, never becomes ready, navigates away, or doesn't render the same way twice.
_Avoid_: Failed story, errored story

**Flaky snapshot**:
A snapshot whose captures didn't agree within one run but settled on another try, so it still passed, was kept or was written.
_Avoid_: Unstable snapshot, intermittent, passed on recapture

**Console message**:
What a story's page logged to its console, or an uncaught error or unhandled rejection it raised, kept with the snapshot for review.
_Avoid_: Page message, log, console output

**Report**:
A run's account of its snapshots: the counts, and every snapshot that needs a look, with its outcome and reason. Every `test` leaves one in the report folder, each shard its own, and `update` prints its own on request. After a run error it holds only the error.
_Avoid_: Results, output, HTML report

**Report folder**:
Where every `test` leaves its report, with the images of every snapshot the report lists. Each `test` replaces it whole.
_Avoid_: Output folder, results folder, artifacts

**Hint**:
A note on a failure, or on a run, that points to a likely cause and its fix, such as remote content to mask.
_Avoid_: Tip, suggestion

**Warning**:
A note about something in the project or the run that may make baselines or the selection wrong but fails nothing, such as real network requests `update` saw.
_Avoid_: Notice, alert

**Reporter**:
The form a command's terminal output takes: `live` for a terminal, `log` for CI, or `json`, which prints the report.
_Avoid_: Output format, formatter, output mode

**Step summary**:
The Markdown page GitHub Actions shows for a job step, where every `test` and `update` writes its shard, counts, flaky snapshots and failures, or its run error.
_Avoid_: Job summary, check summary, annotations

**Run error**:
A problem outside any story that stops a run before it has results, such as an invalid config or an unreachable Storybook. It exits 2, unlike a broken story.
_Avoid_: Fatal error, crash

**Base**:
The commit changed files are measured from: where the current branch split from the branch it targets.
_Avoid_: Base ref (for the commit itself), main, target

**Changed files**:
The files that differ from the base, whether uncommitted or committed on the current branch.
_Avoid_: Changes, change set, diff files

**Affected stories**:
The stories whose rendering the changed files can alter. When that can't be determined, every story counts as affected.
_Avoid_: Diff stories, relevant stories

**Browser**:
What a snapshot is rendered in: one exact Chromium build, which the project chooses.
_Avoid_: Browser engine, Safari

**Container**:
The Docker container the browser runs in, so every machine renders a snapshot with the same fonts and libraries.
_Avoid_: Sandbox, VM

**Platform**:
The OS and CPU architecture a snapshot is rendered on. A baseline and a snapshot from different platforms can differ even when nothing changed.
_Avoid_: Environment, arch, machine
