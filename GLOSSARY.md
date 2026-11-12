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
The approved image of a story, the reference every comparison is made against.
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
The image of a story captured during the current run.
_Avoid_: Screenshot, visual, current image

**End state**:
How a snapshot shows anything that moves: every finite animation and transition as if it had already finished, and infinite animations and media on their first frame.
_Avoid_: Frozen frame, final frame, paused animation

**Mode**:
A named, project-wide set of globals and viewport that a story can be captured in besides its default capture, which has no mode.
_Avoid_: Variant, configuration, breakpoint, extra shot

**Visual diff**:
The pixel comparison of a snapshot against its baseline.
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

**Broken story**:
A story that can't be captured: its stories file fails to load, or it errors, crashes the browser, never becomes ready, navigates away, or doesn't render the same way twice.
_Avoid_: Failed story, errored story

**Report**:
What one `test` run leaves for review: every snapshot that didn't plainly pass, with its reason and images. Each shard has its own.
_Avoid_: Results, output, HTML report

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

**Platform**:
The OS and CPU architecture a snapshot is rendered on. A baseline and a snapshot from different platforms can differ even when nothing changed.
_Avoid_: Environment, arch, machine
