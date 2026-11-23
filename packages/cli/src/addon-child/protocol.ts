import type { CheckOutcome } from '../commands/check-story.js'
import type { StoryProgress } from '../commands/story-run.js'
import type { TestReportEntry } from '../report/report-document.js'

/**
 * One snapshot of a check, in the report's shape. Its image paths are relative to the outcome's `imagesFolder`, with
 * `/` on every OS.
 *
 * @public
 */
export type AddonSnapshot = TestReportEntry

/**
 * How far a check is.
 *
 * @public
 */
export type AddonProgress = StoryProgress

/**
 * How a check ended.
 *
 * @public
 */
export type AddonOutcome = CheckOutcome

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
 * Cancels a check. Ignored when it isn't the one running.
 *
 * @public
 */
export interface CancelRequest {
  /**
   * What the request asks for.
   */
  kind: 'cancel'
  /**
   * The check's ID.
   */
  id: string
}

/**
 * What goes in to the child.
 *
 * @public
 */
export type AddonRequest = CheckRequest | CancelRequest

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
 * Says how far a check is.
 *
 * @public
 */
export interface ProgressMessage {
  /**
   * What the message says.
   */
  kind: 'progress'
  /**
   * The check's ID.
   */
  id: string
  /**
   * How far it is.
   */
  progress: AddonProgress
}

/**
 * Says how a check ended. Sent exactly once for each request for a check.
 *
 * @public
 */
export interface FinishedMessage {
  /**
   * What the message says.
   */
  kind: 'finished'
  /**
   * The check's ID.
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
