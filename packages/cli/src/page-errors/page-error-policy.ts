import type { PageErrorCheck } from '../config/define-config.js'
import type { ResolvedConfig } from '../config/resolve-config.js'
import type { StoryOptions } from '../config/story-options.js'

/**
 * How a snapshot checks its page errors, from the config and its story's options. Every snapshot of a story, its modes
 * included, has the same one.
 *
 * @public
 */
export interface PageErrorPolicy {
  /**
   * What a page error that isn't expected does: `'fail'` lists it and fails `test`, `'warn'` lists it without failing,
   * and `'off'` doesn't check page errors. The story's `pageErrors`, or the config's when the story sets none.
   */
  check: PageErrorCheck
  /**
   * Every expected page error of the snapshot: the config's `expectedPageErrors`, then the story's. A string matches a
   * page error whose text contains it, and a regular expression one whose text it matches.
   */
  expected: readonly (string | RegExp)[]
  /**
   * The story's own expected page errors, the last entries of `expected`. Only these can go stale, when they match none
   * of the snapshot's page errors: the config's apply to every story, so most stories raise none of them. After
   * Storybook merges the parameters, the story's own include those its meta or `preview` set, since they can't be told
   * apart.
   */
  storyExpected: readonly (string | RegExp)[]
}

/**
 * Gives the page error policy of a story's snapshots: the story's `pageErrors`, or the config's, and the config's
 * expected page errors, then the story's.
 *
 * @public
 */
export function pageErrorPolicyOf(
  config: Pick<ResolvedConfig, 'pageErrors' | 'expectedPageErrors'>,
  options: Pick<StoryOptions, 'pageErrors' | 'expectedPageErrors'>,
): PageErrorPolicy {
  const storyExpected = [...(options.expectedPageErrors ?? [])]

  return {
    check: options.pageErrors ?? config.pageErrors,
    expected: [...config.expectedPageErrors, ...storyExpected],
    storyExpected,
  }
}
