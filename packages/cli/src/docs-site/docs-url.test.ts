import { describe, expect, it } from 'vitest'
import { docsUrlOf } from './docs-url.js'

describe('docsUrlOf', () => {
  it('puts the page under /docs on the docs site', () => {
    expect(docsUrlOf('ci')).toBe('https://visual-check.vercel.app/docs/ci')
  })

  it('keeps a nested page as it is', () => {
    expect(docsUrlOf('config/modes')).toBe('https://visual-check.vercel.app/docs/config/modes')
  })
})
