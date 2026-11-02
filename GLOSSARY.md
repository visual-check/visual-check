# visual-check

Visual regression testing for projects that use Storybook: it tells a developer whether a code change alters how stories look compared to what was approved.

## Language

**Baseline**:
The approved image of a story, the reference every comparison is made against.
_Avoid_: Reference image, golden, expected

**Snapshot**:
The image of a story captured during the current run.
_Avoid_: Screenshot, visual, current image

**Visual diff**:
The pixel comparison of a snapshot against its baseline.
_Avoid_: Diff (unqualified), image diff

**Changed files**:
The files that differ from main, whether uncommitted or committed on the current branch.
_Avoid_: Changes, change set, diff files

**Affected stories**:
The stories whose rendering the changed files can alter, according to the dependency graph.
_Avoid_: Diff stories, relevant stories
