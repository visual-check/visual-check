import { describe, expect, it } from 'vitest'
import { remoteContentHintMessageOf, remoteContentHintOf } from './remote-content-hint.js'

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

describe('remoteContentHintMessageOf', () => {
  it('says it in one line for one host, with its mask and the docs page', () => {
    expect(remoteContentHintMessageOf(['images.unsplash.com'])).toBe(
      'Differs only inside remote content from images.unsplash.com. A CDN can serve different bytes to different ' +
        "machines. Mask it by host: { host: 'images.unsplash.com' }. " +
        'See https://visual-check.vercel.app/docs/remote-content',
    )
  })

  it('names several hosts with commas and a last and, with their masks in order', () => {
    expect(remoteContentHintMessageOf(['a.com', 'b.com', 'c.com'])).toBe(
      'Differs only inside remote content from a.com, b.com and c.com. A CDN can serve different bytes to different ' +
        "machines. Mask it by host: { host: 'a.com' }, { host: 'b.com' }, { host: 'c.com' }. " +
        'See https://visual-check.vercel.app/docs/remote-content',
    )
  })
})
