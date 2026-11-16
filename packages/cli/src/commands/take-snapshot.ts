import type { PlannedSnapshot } from './plan-snapshots.js'
import { brokenResultOf, type CaptureStory, type SnapshotResult } from './snapshot-result.js'
import { type TestTools, testSnapshot } from './test-snapshot.js'
import { type UpdateTools, updateSnapshot } from './update-snapshot.js'

/**
 * What each snapshot of a run is taken with, by command: the visual diff both commands compare snapshots with, for
 * `test` alone the report folder it writes the images of each differing snapshot to and how many more times it
 * captures a snapshot that differs, and for `update` alone how long it waits before it captures a snapshot's page
 * again.
 *
 * @public
 */
export type SnapshotTools =
  | (TestTools & {
      /**
       * The command, `test`, which compares each snapshot and reports the ones that differ.
       */
      command: 'test'
    })
  | (UpdateTools & {
      /**
       * The command, `update`, which compares each snapshot and writes the baselines that are missing or differ, once
       * the story renders the same way twice. It never touches the report folder.
       */
      command: 'update'
    })

/**
 * Takes one snapshot: tests it for `test`, else updates its baseline. A story whose stories file didn't load is
 * broken, with no capture and no baseline read.
 *
 * @public
 */
export async function takeSnapshot(
  item: PlannedSnapshot,
  captureStory: CaptureStory,
  tools: SnapshotTools,
): Promise<SnapshotResult> {
  if ('broken' in item) {
    return brokenResultOf(item.broken)
  }

  return tools.command === 'test'
    ? await testSnapshot(item, captureStory, tools)
    : await updateSnapshot(item, captureStory, tools)
}
