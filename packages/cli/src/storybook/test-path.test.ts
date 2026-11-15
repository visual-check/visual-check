import { describe, expect, it } from 'vitest'
import { testPathWarningOf } from './test-path.js'

/**
 * A Storybook named `web` that runs storybook 9.1.2.
 */
const web = { name: 'web', version: '9.1.2' }

describe('testPathWarningOf', () => {
  it('gives nothing without samples', () => {
    expect(testPathWarningOf(web, [])).toBeUndefined()
  })

  it('gives nothing when the median is below 50 ms', () => {
    expect(testPathWarningOf(web, [0, 1, 120])).toBeUndefined()
    expect(testPathWarningOf(web, [49.9])).toBeUndefined()
  })

  it('warns from 50 ms, naming the Storybook, its version and the median', () => {
    expect(testPathWarningOf(web, [50])).toBe(
      "Warning: Storybook web (storybook 9.1.2) seems to ignore visual-check's StorybookTestRunner user agent: " +
        'its "completing" render step took a median of 50 ms, so each capture takes at least 100 ms longer. ' +
        'Snapshots stay correct.',
    )
  })

  it('takes the middle value of an odd count, in any order', () => {
    expect(testPathWarningOf(web, [130, 2, 101])).toContain('a median of 101 ms')
  })

  it('takes the mean of the two middle values of an even count', () => {
    expect(testPathWarningOf(web, [0, 120, 104, 1])).toContain('a median of 53 ms')
    expect(testPathWarningOf(web, [0, 99, 1, 0])).toBeUndefined()
  })

  it('rounds the median to whole ms', () => {
    expect(testPathWarningOf(web, [100.5])).toContain('a median of 101 ms')
    expect(testPathWarningOf(web, [50, 51])).toContain('a median of 51 ms')
    expect(testPathWarningOf(web, [102.4])).toContain('a median of 102 ms')
  })

  it("says so when the Storybook's version is unknown", () => {
    expect(testPathWarningOf({ name: 'docs', version: undefined }, [110])).toMatch(
      /^Warning: Storybook docs \(its storybook version is unknown\) seems to ignore visual-check's StorybookTestRunner /,
    )
  })

  it('leaves the samples as they were', () => {
    const samples = [120, 0, 101, 3]

    testPathWarningOf(web, samples)
    expect(samples).toEqual([120, 0, 101, 3])
  })
})
