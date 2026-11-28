import { describe, expect, it } from 'vitest'
import { isSilenced } from './silenced-hosts.js'

describe('isSilenced', () => {
  it('silences the exact host, with its port', () => {
    expect(isSilenced('api.example.com', ['api.example.com'])).toBe(true)
    expect(isSilenced('localhost:6006', ['localhost:6006'])).toBe(true)
    expect(isSilenced('api.example.com', ['other.example.com'])).toBe(false)
  })

  it('silences a host with a port by its hostname', () => {
    expect(isSilenced('localhost:6006', ['localhost'])).toBe(true)
    expect(isSilenced('localhost:6006', ['localhost:7007'])).toBe(false)
  })

  it('ignores case', () => {
    expect(isSilenced('api.example.com', ['API.Example.com'])).toBe(true)
    expect(isSilenced('a.example.com', ['*.EXAMPLE.com'])).toBe(true)
  })

  it('silences the subdomains of a wildcard entry, at any depth, but not the domain itself', () => {
    expect(isSilenced('a.example.com', ['*.example.com'])).toBe(true)
    expect(isSilenced('a.b.example.com', ['*.example.com'])).toBe(true)
    expect(isSilenced('a.example.com:8443', ['*.example.com'])).toBe(true)
    expect(isSilenced('a.example.com:8443', ['*.example.com:8443'])).toBe(true)
    expect(isSilenced('a.example.com:9000', ['*.example.com:8443'])).toBe(false)
    expect(isSilenced('example.com', ['*.example.com'])).toBe(false)
    expect(isSilenced('badexample.com', ['*.example.com'])).toBe(false)
  })

  it('silences a host when any entry does, and none with no entries', () => {
    expect(isSilenced('cdn.test', ['api.test', '*.other.test', 'cdn.test'])).toBe(true)
    expect(isSilenced('cdn.test', [])).toBe(false)
  })
})
