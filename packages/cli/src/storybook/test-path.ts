/**
 * What every page's user agent ends in. It puts Storybook 9.1 and later on its test path: a user agent that contains
 * `StorybookTestRunner` makes Storybook skip a fixed 100 ms wait per story.
 *
 * @public
 */
export const testPathUserAgentSuffix = ' StorybookTestRunner'

/**
 * The median time of Storybook's `completing` render step, in ms, from which a Storybook seems to ignore the test path.
 * On the test path the step takes about 0 ms; off it, Storybook waits a fixed 100 ms or more.
 */
const offTestPathMedianMs = 50

/**
 * Gives the middle value of `values`, or the mean of the two middle ones for an even count. `values` must hold at least
 * one value, and isn't changed.
 */
function medianOf(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle] ?? 0

  if (sorted.length % 2 === 1) {
    return upper
  }

  return ((sorted[middle - 1] ?? 0) + upper) / 2
}

/**
 * Warns that a Storybook seems to ignore the `StorybookTestRunner` user agent, from how long Storybook's `completing`
 * render step took for each of its stories captured in the run. Gives `undefined` without samples, or when their median
 * is below 50 ms. The warning names the Storybook and the version of its installed `storybook`, when known.
 *
 * @public
 */
export function testPathWarningOf(
  storybook: { name: string; version: string | undefined },
  completingMs: readonly number[],
): string | undefined {
  if (completingMs.length === 0) {
    return undefined
  }

  const median = medianOf(completingMs)

  if (median < offTestPathMedianMs) {
    return undefined
  }

  const version =
    storybook.version === undefined ? 'its storybook version is unknown' : `storybook ${storybook.version}`

  return (
    `Warning: Storybook ${storybook.name} (${version}) seems to ignore visual-check's ` +
    `${testPathUserAgentSuffix.trim()} user agent: ` +
    `its "completing" render step took a median of ${Math.round(median)} ms, ` +
    'so each capture takes at least 100 ms longer. Snapshots stay correct.'
  )
}
