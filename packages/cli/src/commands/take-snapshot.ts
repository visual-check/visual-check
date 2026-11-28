import type { RealRequestPolicy } from '../real-network-requests/real-request-policy.js'
import type { PlannedSnapshot } from './plan-snapshots.js'
import {
  brokenResultOf,
  type CaptureStory,
  type SnapshotResult,
  withJudgedLoads,
  withNothingJudged,
} from './snapshot-result.js'
import { type TestTools, testSnapshot } from './test-snapshot.js'
import { type UpdateTools, updateSnapshot } from './update-snapshot.js'

/**
 * What each snapshot of a run is taken with, by command: the visual diff both commands compare snapshots with and what
 * writes a snapshot's images, for `test` alone how many more times it captures a snapshot that differs and whether it
 * captures one with no baseline, and for `update` alone how long it waits before it captures a snapshot's page again.
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
       * the story renders the same way twice. A broken snapshot's images go to the report folder when it's given
       * `writeImages`, as `update` is; the addon's Update isn't.
       */
      command: 'update'
    })

/**
 * The real network request policy of `update`, which checks none: it warns about the hosts of every story instead,
 * whatever `realRequests` says.
 */
const unchecked: RealRequestPolicy = { check: 'off', silenceHosts: [] }

/**
 * Takes one snapshot: tests it for `test`, else updates its baseline, gathering the page errors of every capture it
 * asked for and judging them by the snapshot's page error policy, and for `test` the hosts of their real network
 * requests, judged by its real network request policy. A story whose stories file didn't load is broken, with no
 * capture, no baseline read and nothing judged.
 */
export async function takeSnapshot(
  item: PlannedSnapshot,
  captureStory: CaptureStory,
  tools: SnapshotTools,
): Promise<SnapshotResult> {
  if ('broken' in item) {
    return withNothingJudged(brokenResultOf(item.broken, { attempts: 0 }))
  }

  const policies = {
    pageErrors: item.pageErrorPolicy,
    realRequests: tools.command === 'test' ? item.realRequestPolicy : unchecked,
  }

  return await withJudgedLoads(captureStory, policies, (gathering) =>
    tools.command === 'test' ? testSnapshot(item, gathering, tools) : updateSnapshot(item, gathering, tools),
  )
}
