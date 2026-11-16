import { describe, expect, it } from 'vitest'
import { remoteContentHintOf } from './remote-content-hint.js'

describe('remoteContentHintOf', () => {
  it('names one host, with its mask line and the docs page', () => {
    expect(remoteContentHintOf(['images.unsplash.com'])).toEqual([
      'hint: Differs only inside remote content from images.unsplash.com. A CDN can serve different bytes to ' +
        'different machines. Mask it by host:',
      "  { host: 'images.unsplash.com' }",
      'See https://visual-check.vercel.app/docs/remote-content',
    ])
  })

  it('names two hosts with and, one mask line each', () => {
    expect(remoteContentHintOf(['a.com', 'b.com'])).toEqual([
      'hint: Differs only inside remote content from a.com and b.com. A CDN can serve different bytes to different ' +
        'machines. Mask it by host:',
      "  { host: 'a.com' }",
      "  { host: 'b.com' }",
      'See https://visual-check.vercel.app/docs/remote-content',
    ])
  })

  it('names three hosts with commas and a last and, one mask line each in order', () => {
    expect(remoteContentHintOf(['a.com', 'b.com', 'c.com'])).toEqual([
      'hint: Differs only inside remote content from a.com, b.com and c.com. A CDN can serve different bytes to ' +
        'different machines. Mask it by host:',
      "  { host: 'a.com' }",
      "  { host: 'b.com' }",
      "  { host: 'c.com' }",
      'See https://visual-check.vercel.app/docs/remote-content',
    ])
  })
})
