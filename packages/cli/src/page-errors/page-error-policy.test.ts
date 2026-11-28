import { describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '../config/resolve-config.js'
import { pageErrorPolicyOf } from './page-error-policy.js'

/**
 * A config that fails on page errors and expects none.
 */
const config = { pageErrors: 'fail', expectedPageErrors: [] } satisfies Pick<
  ResolvedConfig,
  'pageErrors' | 'expectedPageErrors'
>

describe('pageErrorPolicyOf', () => {
  it("takes the config's check and expects nothing when the story sets neither option", () => {
    expect(pageErrorPolicyOf(config, {})).toStrictEqual({ check: 'fail', expected: [], storyExpected: [] })
  })

  it.each(['fail', 'warn', 'off'] as const)("takes the story's check %s over the config's", (pageErrors) => {
    expect(pageErrorPolicyOf({ ...config, pageErrors: 'warn' }, { pageErrors }).check).toBe(pageErrors)
  })

  it("expects the config's entries, then the story's, and keeps the story's apart", () => {
    const pattern = /\/api\/orders/
    const policy = pageErrorPolicyOf(
      { pageErrors: 'off', expectedPageErrors: ['ResizeObserver', /timeout/i] },
      { expectedPageErrors: ['Failed to fetch', pattern] },
    )

    expect(policy).toStrictEqual({
      check: 'off',
      expected: ['ResizeObserver', /timeout/i, 'Failed to fetch', pattern],
      storyExpected: ['Failed to fetch', pattern],
    })
    expect(policy.storyExpected[1]).toBe(pattern)
  })

  it("expects only the config's entries when the story lists none", () => {
    expect(pageErrorPolicyOf({ ...config, expectedPageErrors: ['ResizeObserver'] }, {})).toStrictEqual({
      check: 'fail',
      expected: ['ResizeObserver'],
      storyExpected: [],
    })
  })

  it('copies the lists, so the policy never changes them', () => {
    const configExpected = ['ResizeObserver']
    const storyExpected = ['Failed to fetch']
    const policy = pageErrorPolicyOf(
      { ...config, expectedPageErrors: configExpected },
      { expectedPageErrors: storyExpected },
    )

    expect(policy.expected).not.toBe(configExpected)
    expect(policy.storyExpected).not.toBe(storyExpected)
  })
})
