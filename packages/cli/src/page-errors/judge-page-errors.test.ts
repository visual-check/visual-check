import { describe, expect, it } from 'vitest'
import type { PageError } from '../capture/driver/driver.js'
import { judgePageErrors } from './judge-page-errors.js'
import type { PageErrorPolicy } from './page-error-policy.js'

/**
 * A `console.error` a page logged.
 */
const logged: PageError = { kind: 'console.error', text: 'TypeError: Failed to fetch' }

/**
 * An uncaught error a page raised.
 */
const thrown: PageError = { kind: 'error', text: 'Uncaught Error: Request timeout after 30s' }

/**
 * A load of a file that got an HTTP 500.
 */
const failedLoad: PageError = { kind: 'load', text: 'http://web.test/api/orders?page=2', loadError: 'HTTP 500' }

/**
 * Gives a policy that fails on page errors, expecting the config's `expected` and the story's `storyExpected`.
 */
function policyOf(
  storyExpected: (string | RegExp)[] = [],
  expected: (string | RegExp)[] = [],
  check: PageErrorPolicy['check'] = 'fail',
): PageErrorPolicy {
  return { check, expected: [...expected, ...storyExpected], storyExpected }
}

/**
 * A snapshot that isn't broken.
 */
const notBroken = { broken: false }

describe('judgePageErrors', () => {
  it('lists every page error that fails, in order, when none is expected', () => {
    expect(judgePageErrors([logged, thrown, failedLoad], policyOf(), notBroken)).toStrictEqual({
      pageErrors: [
        { ...logged, severity: 'fail' },
        { ...thrown, severity: 'fail' },
        { ...failedLoad, severity: 'fail' },
      ],
      staleExpectedPageErrors: [],
    })
  })

  it("lists them as warnings by the policy's 'warn'", () => {
    expect(judgePageErrors([logged], policyOf([], [], 'warn'), notBroken).pageErrors).toStrictEqual([
      { ...logged, severity: 'warn' },
    ])
  })

  it("lists nothing by the policy's 'off', not even a stale entry", () => {
    expect(judgePageErrors([logged], policyOf(['never raised'], [], 'off'), notBroken)).toStrictEqual({
      pageErrors: [],
      staleExpectedPageErrors: [],
    })
  })

  it("drops a page error whose message contains a string entry, the config's or the story's", () => {
    expect(judgePageErrors([logged, thrown], policyOf([], ['Failed to fetch']), notBroken).pageErrors).toStrictEqual([
      { ...thrown, severity: 'fail' },
    ])
    expect(judgePageErrors([logged, thrown], policyOf(['timeout']), notBroken).pageErrors).toStrictEqual([
      { ...logged, severity: 'fail' },
    ])
  })

  it('matches a string entry case-sensitively, as written', () => {
    expect(judgePageErrors([logged], policyOf(['failed to fetch']), notBroken).pageErrors).toHaveLength(1)
  })

  it("matches a load's URL, not its load error", () => {
    expect(judgePageErrors([failedLoad], policyOf(['/api/orders']), notBroken).pageErrors).toStrictEqual([])
    expect(judgePageErrors([failedLoad], policyOf(['HTTP 500']), notBroken).pageErrors).toHaveLength(1)
  })

  it('drops a page error a regular expression matches anywhere in its text', () => {
    expect(judgePageErrors([logged, thrown], policyOf([/TIMEOUT/i]), notBroken).pageErrors).toStrictEqual([
      { ...logged, severity: 'fail' },
    ])
    expect(judgePageErrors([failedLoad], policyOf([], [/\/api\/orders\?page=\d/]), notBroken).pageErrors).toEqual([])
  })

  it('gives a regular expression with a g flag the same answer on every page error and every call', () => {
    const global = /fetch/g
    const errors = [logged, { ...logged, text: 'Failed to fetch again' }]

    expect(judgePageErrors(errors, policyOf([global]), notBroken)).toStrictEqual({
      pageErrors: [],
      staleExpectedPageErrors: [],
    })
    expect(judgePageErrors(errors, policyOf([global]), notBroken).pageErrors).toStrictEqual([])
    expect(global.lastIndex).toBe(0)
  })

  it('gives a regular expression with a y flag the same answer on every call, matching at the start', () => {
    const sticky = /Uncaught/y

    sticky.lastIndex = 5

    for (const _call of [1, 2]) {
      expect(judgePageErrors([thrown, logged], policyOf([sticky]), notBroken).pageErrors).toStrictEqual([
        { ...logged, severity: 'fail' },
      ])
    }
  })

  it('drops every page error one entry matches, and keeps the same page error listed twice as it came', () => {
    const again: PageError = { ...logged, text: 'Failed to fetch, again' }

    expect(judgePageErrors([logged, again, thrown], policyOf(['fetch']), notBroken).pageErrors).toStrictEqual([
      { ...thrown, severity: 'fail' },
    ])
    expect(judgePageErrors([thrown, thrown], policyOf(), notBroken).pageErrors).toHaveLength(2)
  })

  it("gives the story's entries that matched nothing as stale, a string as JSON and a RegExp as its literal", () => {
    const judged = judgePageErrors([logged], policyOf(['Failed to fetch', 'Not raised', /timeout/i, /"quoted"/]), {
      broken: false,
    })

    expect(judged.staleExpectedPageErrors).toStrictEqual(['"Not raised"', '/timeout/i', '/"quoted"/'])
  })

  it('escapes a stale string entry as JSON', () => {
    expect(judgePageErrors([], policyOf(['say "hi"']), notBroken).staleExpectedPageErrors).toStrictEqual([
      '"say \\"hi\\""',
    ])
  })

  it('keeps a stale entry that is the same as another, once per entry', () => {
    expect(judgePageErrors([], policyOf(['gone', 'gone']), notBroken).staleExpectedPageErrors).toStrictEqual([
      '"gone"',
      '"gone"',
    ])
  })

  it("never gives the config's entries as stale", () => {
    expect(judgePageErrors([], policyOf([], ['ResizeObserver', /timeout/]), notBroken)).toStrictEqual({
      pageErrors: [],
      staleExpectedPageErrors: [],
    })
  })

  it("doesn't give a story entry as stale when it matched a page error the config's entry also expects", () => {
    expect(judgePageErrors([logged], policyOf(['fetch'], ['Failed']), notBroken)).toStrictEqual({
      pageErrors: [],
      staleExpectedPageErrors: [],
    })
  })

  it('gives nothing stale for a broken snapshot, and still lists its page errors', () => {
    expect(judgePageErrors([logged], policyOf(['Not raised']), { broken: true })).toStrictEqual({
      pageErrors: [{ ...logged, severity: 'fail' }],
      staleExpectedPageErrors: [],
    })
  })

  it('gives nothing when there are no page errors and nothing is expected', () => {
    expect(judgePageErrors([], policyOf(), notBroken)).toStrictEqual({ pageErrors: [], staleExpectedPageErrors: [] })
  })
})
