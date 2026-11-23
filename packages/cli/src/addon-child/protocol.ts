import type { CheckOutcome } from '../commands/check-story.js'
import type { StoryUpdateEntry } from '../commands/report-entries.js'
import type { StoryProgress } from '../commands/story-run.js'
import type { UpdateOutcome } from '../commands/update-story.js'
import type { ReportWarning, TestReportEntry } from '../report/report-document.js'

/**
 * One snapshot of a check, in the report's shape. Its image paths are relative to the outcome's `imagesFolder`, with
 * `/` on every OS.
 *
 * @public
 */
export type AddonSnapshot = TestReportEntry

/**
 * One snapshot of an update, in the report's shape, with the update's own statuses.
 *
 * @public
 */
export type AddonUpdateSnapshot = StoryUpdateEntry

/**
 * A warning by host of an update.
 *
 * @public
 */
export type AddonWarning = ReportWarning

/**
 * How far a check or an update is.
 *
 * @public
 */
export type AddonProgress = StoryProgress

/**
 * How a check or an update ended.
 *
 * @public
 */
export type AddonOutcome = CheckOutcome | UpdateOutcome

/**
 * Asks for a check of one story.
 *
 * @public
 */
export interface CheckRequest {
  /**
   * What the request asks for.
   */
  kind: 'check'
  /**
   * The click's own ID, new each time, which every message about the check carries.
   */
  id: string
  /**
   * The story's ID.
   */
  storyId: string
  /**
   * The absolute path of Storybook's config folder.
   */
  configDir: string
  /**
   * The Storybook's own address.
   */
  url: string
}

/**
 * Asks for an update of one story's baselines.
 *
 * @public
 */
export interface UpdateRequest {
  /**
   * What the request asks for.
   */
  kind: 'update'
  /**
   * The click's own ID, new each time, which every message about the update carries.
   */
  id: string
  /**
   * The story's ID.
   */
  storyId: string
  /**
   * The absolute path of Storybook's config folder.
   */
  configDir: string
  /**
   * The Storybook's own address.
   */
  url: string
}

/**
 * Asks for a check or an update of one story.
 *
 * @public
 */
export type StoryRequest = CheckRequest | UpdateRequest

/**
 * Cancels a check or an update. Ignored when it isn't the one running.
 *
 * @public
 */
export interface CancelRequest {
  /**
   * What the request asks for.
   */
  kind: 'cancel'
  /**
   * The ID of the check or the update.
   */
  id: string
}

/**
 * What goes in to the child.
 *
 * @public
 */
export type AddonRequest = StoryRequest | CancelRequest

/**
 * Says the child takes requests. Sent once, first.
 *
 * @public
 */
export interface ReadyMessage {
  /**
   * What the message says.
   */
  kind: 'ready'
  /**
   * The version of the protocol.
   */
  protocol: 1
  /**
   * The CLI's version.
   */
  version: string
}

/**
 * Says how far a check or an update is.
 *
 * @public
 */
export interface ProgressMessage {
  /**
   * What the message says.
   */
  kind: 'progress'
  /**
   * The ID of the check or the update.
   */
  id: string
  /**
   * How far it is.
   */
  progress: AddonProgress
}

/**
 * Says how a check or an update ended. Sent exactly once for each request for a check or an update.
 *
 * @public
 */
export interface FinishedMessage {
  /**
   * What the message says.
   */
  kind: 'finished'
  /**
   * The ID of the check or the update.
   */
  id: string
  /**
   * How it ended.
   */
  outcome: AddonOutcome
}

/**
 * What comes out of the child. Both sides ignore a message whose `kind` they don't know.
 *
 * @public
 */
export type AddonMessage = ReadyMessage | ProgressMessage | FinishedMessage
