import { describe, expect, it } from 'vitest'
import { isSameAddress } from './same-address.js'

describe('isSameAddress', () => {
  it.each([
    ['the same URL', 'http://127.0.0.1:6006', 'http://127.0.0.1:6006'],
    ['a trailing slash', 'http://127.0.0.1:6006', 'http://127.0.0.1:6006/'],
    ['a default port', 'http://storybook.test', 'http://storybook.test:80'],
    ['another letter case', 'http://Storybook.test:6006', 'http://storybook.test:6006'],
    ['localhost and an IPv4 loopback address', 'http://localhost:6006', 'http://127.0.0.1:6006'],
    ['two IPv4 loopback addresses', 'http://127.0.0.2:6006', 'http://127.0.0.1:6006'],
    ['localhost and the IPv6 loopback address', 'https://localhost:6006', 'https://[::1]:6006'],
    ['a trailing slash after a path', 'http://localhost:6006/docs', 'http://localhost:6006/docs/'],
    ['the same path', 'http://localhost:6006/docs', 'http://127.0.0.1:6006/docs'],
  ])('holds for %s', (_what, one, other) => {
    expect(isSameAddress(one, other)).toBe(true)
    expect(isSameAddress(other, one)).toBe(true)
  })

  it.each([
    ['another protocol', 'http://localhost:6006', 'https://localhost:6006'],
    ['another port', 'http://localhost:6006', 'http://localhost:6007'],
    ['another path', 'http://localhost:6006', 'http://localhost:6006/docs'],
    ['another host', 'http://one.test:6006', 'http://other.test:6006'],
    ['a loopback name and another host', 'http://localhost:6006', 'http://192.168.0.2:6006'],
    ['a host that only starts like a loopback address', 'http://127.0.0.1:6006', 'http://127.0.0.1.test:6006'],
    ["a URL that doesn't parse", 'http://localhost:6006', 'localhost'],
    ["two URLs that don't parse", 'localhost', 'localhost'],
  ])("doesn't hold for %s", (_what, one, other) => {
    expect(isSameAddress(one, other)).toBe(false)
    expect(isSameAddress(other, one)).toBe(false)
  })
})
