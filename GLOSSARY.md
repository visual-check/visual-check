# visual-check

Visual regression testing for projects that use Storybook: it tells a developer whether a code change alters how stories look compared to what was approved.

## Language

**Baseline**:
The approved image of a story or of a combined snapshot, the reference every comparison is made against.
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

**Mode**:
A named, project-wide set of globals and viewport that a story can be captured in besides its default capture, which has no mode.
_Avoid_: Variant, configuration, breakpoint, extra shot

**Combined snapshot**:
One image that lays out the snapshots of several stories from one stories file, compared as a whole like any other snapshot.
_Avoid_: Contact sheet, sprite, montage, gallery

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
A story that can't be captured: it errors, crashes the browser, never becomes ready, navigates away, or doesn't render the same way twice.
_Avoid_: Failed story, errored story

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
What a snapshot is rendered in: Chromium or WebKit.
_Avoid_: Browser engine, Safari

**Platform**:
The OS and CPU architecture a snapshot is rendered on. A baseline and a snapshot from different platforms can differ even when nothing changed.
_Avoid_: Environment, arch, machine
