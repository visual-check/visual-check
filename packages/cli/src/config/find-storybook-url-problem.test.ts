import { describe, expect, it } from 'vitest'
import { findStorybookUrlProblem, mayHoldLogin } from './find-storybook-url-problem.js'

describe('findStorybookUrlProblem', () => {
  it.each(['http://127.0.0.1:6006', 'https://example.com/storybook', 'https://example.com/?q=a@b'])(
    'accepts %j',
    (value) => {
      expect(findStorybookUrlProblem(value)).toBeUndefined()
    },
  )

  it.each(['localhost:6006', 'ftp://example.com', 'not a url', ''])('finds %j is not http', (value) => {
    expect(findStorybookUrlProblem(value)).toBe('not-http')
  })

  it.each([undefined, null, 6006, {}])('finds the non-string %j is not http', (value) => {
    expect(findStorybookUrlProblem(value)).toBe('not-http')
  })

  it.each(['https://user:secret@example.com', 'https://user@example.com', 'http://:secret@127.0.0.1:6006'])(
    'finds a login in %j',
    (value) => {
      expect(findStorybookUrlProblem(value)).toBe('login')
    },
  )

  it('finds a login whatever the protocol', () => {
    expect(findStorybookUrlProblem('ftp://user:secret@example.com')).toBe('login')
  })
})

describe('mayHoldLogin', () => {
  it.each(['https://user:secret@example.com', 'user:secret@host:6006', 'node@sha256:abc'])('is true for %j', (text) => {
    expect(mayHoldLogin(text)).toBe(true)
  })

  it.each(['http://127.0.0.1:6006', 'localhost:6006', ''])('is false for %j', (text) => {
    expect(mayHoldLogin(text)).toBe(false)
  })
})
