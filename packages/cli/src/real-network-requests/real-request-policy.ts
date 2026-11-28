import type { RealRequestCheck } from '../config/define-config.js'
import type { ResolvedConfig } from '../config/resolve-config.js'
import type { StoryOptions } from '../config/story-options.js'

/**
 * How `test` checks a snapshot's real network requests, from the config and its story's options. Every snapshot of a
 * story, its modes included, has the same one.
 *
 * @public
 */
export interface RealRequestPolicy {
  /**
   * What a real network request to a host `silenceHosts` doesn't match does: `'fail'` lists it and fails `test`,
   * `'warn'` lists it without failing, and `'off'` doesn't watch the snapshot's requests. The story's `realRequests`,
   * or the config's when the story sets none.
   */
  check: RealRequestCheck
  /**
   * The config's `silenceHosts`: the hosts a story may reach, whose requests are neither failed on nor listed.
   */
  silenceHosts: readonly string[]
}

/**
 * Gives the real network request policy of a story's snapshots: the story's `realRequests`, or the config's, and the
 * config's `silenceHosts`.
 *
 * @public
 */
export function realRequestPolicyOf(
  config: Pick<ResolvedConfig, 'realRequests' | 'silenceHosts'>,
  options: Pick<StoryOptions, 'realRequests'>,
): RealRequestPolicy {
  return { check: options.realRequests ?? config.realRequests, silenceHosts: [...config.silenceHosts] }
}
