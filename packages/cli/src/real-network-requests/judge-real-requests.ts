import type { RealRequestPolicy } from './real-request-policy.js'
import { isSilenced } from './silenced-hosts.js'

/**
 * A host a snapshot's page sent real network requests to, which `silenceHosts` doesn't match, with what it does to the
 * run.
 *
 * @public
 */
export interface JudgedRealRequest {
  /**
   * The host, such as `api.example.com` or `127.0.0.1:6007`, with its port when it isn't the scheme's default.
   */
  host: string
  /**
   * `'fail'` fails `test`, by the snapshot's `realRequests: 'fail'`; `'warn'` is only listed, by `realRequests: 'warn'`.
   */
  severity: 'fail' | 'warn'
}

/**
 * Judges the hosts of the real network requests of a snapshot's loads by its policy. With `check: 'off'` there's
 * nothing to list. Otherwise each host is listed once, in the order first seen across the loads, with the policy's
 * severity, apart from the hosts `silenceHosts` matches.
 *
 * @public
 */
export function judgeRealRequests(
  loads: readonly (readonly string[])[],
  { check, silenceHosts }: RealRequestPolicy,
): JudgedRealRequest[] {
  if (check === 'off') {
    return []
  }

  return [...new Set(loads.flat())]
    .filter((host) => !isSilenced(host, silenceHosts))
    .map((host) => ({ host, severity: check }))
}
