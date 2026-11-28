import { describe, expect, it } from 'vitest'
import type { ReportRealRequest } from '../report/report-document.js'
import { realRequestCountsOf, realRequestsBlockOf } from './real-requests-block.js'

/**
 * A host that fails the run.
 */
function failing(host: string): ReportRealRequest {
  return { host, severity: 'fail' }
}

/**
 * A host that is only listed.
 */
function warning(host: string): ReportRealRequest {
  return { host, severity: 'warn' }
}

describe('realRequestCountsOf', () => {
  it('counts the snapshots with real network requests and how many of them fail the run', () => {
    expect(realRequestCountsOf([{ realRequests: [failing('a.test')] }])).toBe(
      '1 snapshot with real network requests, which fails the run',
    )
    expect(realRequestCountsOf([{ realRequests: [failing('a.test')] }, { realRequests: [failing('b.test')] }])).toBe(
      '2 snapshots with real network requests, which fail the run',
    )
    expect(
      realRequestCountsOf([
        { realRequests: [failing('a.test')] },
        { realRequests: [warning('b.test')] },
        { realRequests: [warning('c.test')] },
      ]),
    ).toBe('3 snapshots with real network requests, 1 of which fails the run')
    expect(realRequestCountsOf([{ realRequests: [warning('a.test')] }, { realRequests: [] }])).toBe(
      '1 snapshot with real network requests',
    )
  })
})

describe('realRequestsBlockOf', () => {
  it('gives no line when no snapshot has real network requests', () => {
    expect(realRequestsBlockOf([{ name: 'web  a', realRequests: [] }])).toEqual([])
  })

  it('lists each snapshot with real network requests by name, then each host with its severity', () => {
    expect(
      realRequestsBlockOf([
        { name: 'web  a', realRequests: [failing('api.example.com'), failing('127.0.0.1:6007')] },
        { name: 'web  b', realRequests: [] },
        { name: 'web  c  dark', realRequests: [warning('ws.example.com')] },
      ]),
    ).toEqual([
      '── 2 snapshots with real network requests, 1 of which fails the run ──',
      'web  a',
      '  real network request (fail): api.example.com',
      '  real network request (fail): 127.0.0.1:6007',
      'web  c  dark',
      '  real network request (warn): ws.example.com',
    ])
  })

  it('lists the first 5 hosts of a snapshot, then how many more it has', () => {
    const hosts = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => failing(`${name}.test`))

    expect(realRequestsBlockOf([{ name: 'web  a', realRequests: hosts }]).slice(-2)).toEqual([
      '  real network request (fail): e.test',
      '  …and 2 more hosts',
    ])
    expect(realRequestsBlockOf([{ name: 'web  a', realRequests: hosts.slice(0, 6) }]).at(-1)).toBe('  …and 1 more host')
  })
})
