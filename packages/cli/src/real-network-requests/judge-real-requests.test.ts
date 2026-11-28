import { describe, expect, it } from 'vitest'
import { judgeRealRequests } from './judge-real-requests.js'

describe('judgeRealRequests', () => {
  it("lists each host once, in the order first seen across the loads, with the check's severity", () => {
    const loads = [['api.example.com', '127.0.0.1:6007'], [], ['127.0.0.1:6007', 'ws.example.com']]

    expect(judgeRealRequests(loads, { check: 'fail', silenceHosts: [] })).toStrictEqual([
      { host: 'api.example.com', severity: 'fail' },
      { host: '127.0.0.1:6007', severity: 'fail' },
      { host: 'ws.example.com', severity: 'fail' },
    ])
    expect(judgeRealRequests([['api.example.com']], { check: 'warn', silenceHosts: [] })).toStrictEqual([
      { host: 'api.example.com', severity: 'warn' },
    ])
  })

  it('leaves out the hosts silenceHosts matches, exactly, by hostname and by wildcard', () => {
    const loads = [['api.example.com', 'localhost:6007', 'a.cdn.test:8443', 'cdn.test', 'other.test']]
    const silenceHosts = ['api.example.com', 'localhost', '*.cdn.test']

    expect(judgeRealRequests(loads, { check: 'fail', silenceHosts })).toStrictEqual([
      { host: 'cdn.test', severity: 'fail' },
      { host: 'other.test', severity: 'fail' },
    ])
  })

  it("lists nothing with check: 'off'", () => {
    expect(judgeRealRequests([['api.example.com']], { check: 'off', silenceHosts: [] })).toStrictEqual([])
  })

  it('lists nothing for no load', () => {
    expect(judgeRealRequests([], { check: 'fail', silenceHosts: [] })).toStrictEqual([])
  })
})
