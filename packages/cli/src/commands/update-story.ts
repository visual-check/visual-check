import { dirname } from 'node:path'
import { baselinePathOf, writeBaseline } from '../baselines/baseline-files.js'
import { isCi } from '../config/is-ci.js'
import type { ReportWarning } from '../report/report-document.js'
import { networkWarningsOf } from './network-warning.js'
import { type StoryUpdateEntry, storyUpdateEntryOf } from './report-entries.js'
import { type CancelledStory, runStory, type StoppedStory, type StoryRunOptions } from './story-run.js'
import { ciUpdateRefusal } from './update-baselines.js'
import { defaultRecaptureDelayMs } from './update-snapshot.js'

/**
 * How an update of one story ended.
 *
 * @public
 */
export type UpdateOutcome =
  | {
      /**
       * The update finished, whatever its snapshots came to.
       */
      result: 'updated'
      /**
       * The name the config gives the Storybook.
       */
      storybook: string
      /**
       * The story's snapshots in the report's shape: its default capture, then its modes in order.
       */
      snapshots: StoryUpdateEntry[]
      /**
       * Whether the story is disabled, so the update took no snapshot.
       */
      disabled: boolean
      /**
       * What else the update says: the address CLI runs check, the warnings, and that the browser exited.
       */
      notices: string[]
      /**
       * The warnings by host: the hosts the story sent real network requests to, then those whose remote content it
       * shows, without the config's `silenceHosts`.
       */
      warnings: ReportWarning[]
    }
  | StoppedStory
  | CancelledStory

/**
 * An update of one story of a running Storybook.
 *
 * @public
 */
export interface StoryUpdate extends StoryRunOptions {
  /**
   * How long after its first capture a snapshot's page is captured again, to check it isn't still changing, in ms.
   * `defaultRecaptureDelayMs` by default.
   */
  recaptureDelayMs?: number
  /**
   * Writes a baseline once every snapshot is taken. `writeBaseline` by default. A test gives its own.
   */
  writeBaseline?: (path: string, bytes: Uint8Array) => Promise<void>
}

/**
 * Updates the baselines of one story of a running Storybook: its default capture and each mode it lists, those within
 * tolerance of their baseline too. Each snapshot takes the stability checks `update` gives a missing baseline: its page
 * captured again a moment later, a second load, and a third when those two disagree. A story that isn't stable writes
 * nothing, and is broken with the reason. A baseline whose bytes equal what would be written stays untouched. The
 * entries are in the report's shape. No orphan is deleted, and no other story is captured.
 *
 * It goes through what a check of the story goes through, in the same order, with the same notices and stops. With the
 * CI environment variable set, it stops at once with `update`'s message, and reads, launches and tells nothing.
 *
 * The baselines are written once every snapshot is taken. Until then, a signal that aborts ends the update cancelled
 * and writes nothing. An abort after that comes too late. A write that fails stops the update with the CLI's message,
 * and may leave the story's baselines written before it. The warnings by host leave out the config's `silenceHosts`.
 * It never throws.
 *
 * @public
 */
export async function updateStory(update: StoryUpdate): Promise<UpdateOutcome> {
  if (isCi(update.environment)) {
    return { result: 'stopped', cause: 'run', message: ciUpdateRefusal, notices: [] }
  }

  const pending = new Map<string, Uint8Array>()
  const write = update.writeBaseline ?? writeBaseline

  return await runStory(update, {
    toolsOf: (visualDiff) => ({
      command: 'update',
      visualDiff,
      recaptureDelayMs: update.recaptureDelayMs ?? defaultRecaptureDelayMs,
      rewrite: true,
      writeBaseline: (path, bytes) => {
        pending.set(path, bytes)

        return Promise.resolve()
      },
    }),
    finish: async ({ config, storybook, story, snapshots, notices }) => {
      for (const { snapshot } of snapshots.filter(({ result }) => result.status === 'written')) {
        const path = baselinePathOf(snapshot.storybook.baselines, snapshot.key)
        const bytes = pending.get(path)

        if (bytes === undefined) {
          throw new Error(`The written snapshot ${snapshot.key} has no bytes to write.`)
        }

        await write(path, bytes)
      }

      const taken = snapshots.flatMap(({ result: { hosts } }) =>
        hosts === undefined ? [] : [{ storybook: storybook.name, storyId: story.id, hosts }],
      )

      return {
        result: 'updated',
        storybook: storybook.name,
        snapshots: snapshots.map(({ snapshot, result }) => storyUpdateEntryOf(snapshot, result, dirname(config.path))),
        disabled: snapshots.length === 0,
        notices,
        warnings: networkWarningsOf(taken, config.silenceHosts),
      }
    },
  })
}
