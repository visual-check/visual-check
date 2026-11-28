import { describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '../config/resolve-config.js'
import { realRequestPolicyOf } from './real-request-policy.js'

/**
 * A config that doesn't check real network requests and silences one host.
 */
const config = { realRequests: 'off', silenceHosts: ['fonts.example.com'] } satisfies Pick<
  ResolvedConfig,
  'realRequests' | 'silenceHosts'
>

describe('realRequestPolicyOf', () => {
  it("takes the config's check and silenced hosts when the story sets no check", () => {
    expect(realRequestPolicyOf(config, {})).toStrictEqual({ check: 'off', silenceHosts: ['fonts.example.com'] })
  })

  it.each(['fail', 'warn', 'off'] as const)("takes the story's check %s over the config's", (realRequests) => {
    expect(realRequestPolicyOf({ ...config, realRequests: 'warn' }, { realRequests }).check).toBe(realRequests)
  })
})
