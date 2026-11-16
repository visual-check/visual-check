import type { ResolvedStorybook } from '../config/resolve-config.js'
import { clearReport } from '../report/report-folder.js'
import { type ConsistencyCheck, checkConsistency, type StorybookBaselines } from './consistency-check.js'
import { consistencyOutputOf } from './consistency-output.js'
import type { PlannedSnapshot } from './plan-snapshots.js'

/**
 * What `test` needs to plan what it takes.
 */
export interface TestPlanOptions {
  /**
   * The CLI's version, for the consistency output's header.
   */
  version: string
  /**
   * The folder the CLI runs in. Printed paths are relative to it.
   */
  cwd: string
  /**
   * Whether the run is in CI, where `test` stops before capturing when the consistency check finds anything.
   */
  ci: boolean
  /**
   * Whether the run is `test --consistency`: it runs the consistency check and captures nothing.
   */
  consistencyOnly: boolean
  /**
   * The Storybooks in the run, in config order, whose baselines folders the check lists.
   */
  storybooks: readonly ResolvedStorybook[]
}

/**
 * What a run takes once the snapshots are planned, or what it prints when it stops there. `test` and `update` share
 * it: `test-plan.ts` defines it because `runSnapshots` imports this file, so it can't import it back.
 */
export type Taking =
  | {
      /**
       * The snapshots it takes, in planned order.
       */
      taken: PlannedSnapshot[]
      /**
       * Each Storybook's baselines folder, in config order, with its orphans: the ones `test` reports and `update`
       * deletes.
       */
      baselines: StorybookBaselines[]
    }
  | {
      /**
       * A run that stops before capturing: its exit code and stdout. Its stderr comes from `runSnapshots`.
       */
      stopped: {
        /**
         * The process exit code.
         */
        exitCode: number
        /**
         * Text for standard output.
         */
        stdout: string
      }
    }

/**
 * The line that follows the consistency output of a CI `test` that stopped before capturing.
 */
const ciStopLine = 'In CI, test stops before capturing when the consistency check finds anything.'

/**
 * Gives the snapshots a `test` takes, in planned order: every selected one, and every one outside the selection that
 * the consistency check finds, whose baseline is missing or whose stories file failed to load. So each finding gets
 * its line, whatever the selection.
 */
function testSnapshotsOf(planned: readonly PlannedSnapshot[], check: ConsistencyCheck): PlannedSnapshot[] {
  return planned.filter((item) => item.selected || 'broken' in item || check.missing.has(item))
}

/**
 * Plans what `test` takes. Every `test` runs the consistency check once the snapshots are planned, before it clears the
 * report folder: it lists each Storybook's baselines folder, where only `.png` files count, without decoding any. It
 * covers every planned snapshot, selected or not. Its findings are each snapshot whose baseline is missing, each story
 * whose stories file failed to load, and each orphan: a baseline no planned snapshot calls for, apart from any that
 * could belong to a story whose stories file didn't load, and any the file system takes for an expected baseline.
 *
 * Locally, `test` also takes every snapshot outside the selection that is a finding, so its missing or broken line is
 * printed and counted, the header included; a missing one is still never captured. After the snapshot lines, it prints
 * a line for each orphan, in config order then file name order, and its counts end with the orphans', which make it
 * exit 1.
 *
 * In CI, a `test` whose check finds anything captures nothing: once it has cleared the report folder, it stops with
 * exit 1 and prints the consistency output, a header that counts every planned snapshot, then the missing and broken
 * lines in planned order, the orphan lines and the counts of each finding, then a line that says CI stops before
 * capturing. A consistent CI `test` goes on as a local one does.
 *
 * `test --consistency` runs only the check. Once the check has run and the report folder is cleared, it takes no
 * snapshot and prints the consistency output, in CI or not, with no line about CI. It exits 0 when the check finds
 * nothing, else 1. The options read before it still loads every stories file in the browser.
 *
 * A baselines folder that can't be listed stops the run with exit 2, printing nothing on stdout.
 *
 * @throws {BaselineError} When a baselines folder can't be listed, or a baseline's path can't be looked at.
 * @throws {ReportError} When the report folder can't be cleared.
 */
export async function testPlanOf(
  options: TestPlanOptions,
  planned: PlannedSnapshot[],
  reportFolder: string,
): Promise<Taking> {
  const check = await checkConsistency(options.storybooks, planned)

  await clearReport(reportFolder)

  const output = consistencyOutputOf({ version: options.version, cwd: options.cwd, planned, check })

  if (options.consistencyOnly) {
    return { stopped: { exitCode: output.consistent ? 0 : 1, stdout: output.stdout } }
  }

  if (options.ci && !output.consistent) {
    return { stopped: { exitCode: 1, stdout: `${output.stdout}${ciStopLine}\n` } }
  }

  return { taken: testSnapshotsOf(planned, check), baselines: check.storybooks }
}
