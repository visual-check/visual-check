import { dirname } from 'node:path'
import { baselineStemOf } from '../baselines/baseline-files.js'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import type { ReportImages, TestReportEntry } from '../report/report-document.js'
import type { ReportImageBytes } from '../report/report-folder.js'
import { testEntryOf } from './report-entries.js'
import { type CancelledStory, runStory, type StoppedStory, type StoryRunOptions } from './story-run.js'

/**
 * How a check ended.
 *
 * @public
 */
export type CheckOutcome =
  | {
      /**
       * The check finished, whatever its snapshots came to.
       */
      result: 'checked'
      /**
       * The name the config gives the Storybook.
       */
      storybook: string
      /**
       * The folder the snapshots' image paths are relative to.
       */
      imagesFolder: string
      /**
       * The story's snapshots in the report's shape: its default capture, then its modes in order.
       */
      snapshots: TestReportEntry[]
      /**
       * Whether the story is disabled, so the check took no snapshot.
       */
      disabled: boolean
      /**
       * What else the check says: the address CLI runs check, the warnings, and that the browser exited.
       */
      notices: string[]
    }
  | StoppedStory
  | CancelledStory

/**
 * Where a check's images go. A story's images stay until a later check of it has completed, so a check that was
 * cancelled or stopped leaves them as they were.
 *
 * @public
 */
export interface CheckImages {
  /**
   * Gives the folder the snapshots' image paths are relative to.
   */
  folderOf: (storybook: ResolvedStorybook) => string
  /**
   * Gives the paths a snapshot's images will have, as the entry lists them, the stem naming its baseline. Writes
   * nothing.
   */
  pathsOf: (storybook: ResolvedStorybook, stem: string, images: Partial<ReportImageBytes>) => ReportImages
  /**
   * Removes what the last check of this story left and writes these images, by stem.
   *
   * @throws {ReportError} When the old images can't be removed or the new ones can't be written.
   */
  replace: (
    storybook: ResolvedStorybook,
    storyId: string,
    images: ReadonlyMap<string, Partial<ReportImageBytes>>,
  ) => Promise<void>
}

/**
 * A check of one story of a running Storybook.
 *
 * @public
 */
export interface StoryCheck extends StoryRunOptions {
  /**
   * Where the images go.
   */
  images: CheckImages
}

/**
 * Checks one story of a running Storybook: captures its default capture and each mode it lists, those with no baseline
 * too, and compares each snapshot with its baseline as `test` does, with the config's retries. The entries are in the
 * report's shape. It writes no baseline.
 *
 * It goes through what `test` goes through, in the same order: the browser package, the config, read afresh and found
 * from Storybook's config folder, where the browser runs, the Storybook's version and index, the browser. The config's
 * `url` may have none for the current environment: the story is captured at the Storybook's own address, and a notice
 * says when CLI runs check another one. Only this story's options are read and checked, so only its stories file is
 * loaded. A problem stops the check with the CLI's exit-2 message, and an error that is a bug with its stack trace.
 *
 * When the browser exits, the stories in flight are broken and it's relaunched once, with a notice, and a second exit
 * stops the check with the CLI's message. Each check counts its own exits.
 *
 * The images are written once every snapshot is taken, in place of those the story's last check left. Until then, a
 * signal that aborts ends the check cancelled, whatever else came of it: each wait before the browser is abandoned, and
 * the launcher ends the ones on the browser. An abort after that comes too late. It never throws.
 *
 * @public
 */
export async function checkStory(check: StoryCheck): Promise<CheckOutcome> {
  const images = new Map<string, Partial<ReportImageBytes>>()

  return await runStory(check, {
    toolsOf: (visualDiff, config) => ({
      command: 'test',
      visualDiff,
      retries: config.retries,
      captureMissing: true,
      writeImages: async ({ storybook, key }, bytes) => {
        const stem = baselineStemOf(key)

        images.set(stem, bytes)

        return check.images.pathsOf(storybook, stem, bytes)
      },
    }),
    finish: async ({ config, storybook, story, snapshots, notices }) => {
      await check.images.replace(storybook, story.id, images)

      return {
        result: 'checked',
        storybook: storybook.name,
        imagesFolder: check.images.folderOf(storybook),
        snapshots: snapshots.map(({ snapshot, result }) => testEntryOf(snapshot, result, dirname(config.path))),
        disabled: snapshots.length === 0,
        notices,
      }
    },
  })
}
