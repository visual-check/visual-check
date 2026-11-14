import { describe, expect, it } from 'vitest'
import { isHttpUrl } from './is-http-url.js'

describe('isHttpUrl', () => {
  it.each(['http://127.0.0.1:6006', 'https://example.com/storybook'])('accepts %j', (value) => {
    expect(isHttpUrl(value)).toBe(true)
  })

  it.each(['localhost:6006', 'ftp://example.com', 'not a url', ''])('rejects %j', (value) => {
    expect(isHttpUrl(value)).toBe(false)
  })

  it.each([undefined, null, 6006, {}])('rejects the non-string %j', (value) => {
    expect(isHttpUrl(value)).toBe(false)
  })
})
