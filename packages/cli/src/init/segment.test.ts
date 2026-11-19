import { describe, expect, it } from 'vitest'
import { kindOf, segmentOf, segmentsOfMessage, textOf } from './segment.js'

describe('textOf', () => {
  it('gives plain text as it is', () => {
    expect(textOf('hint: a')).toBe('hint: a')
  })

  it('joins segments into plain text', () => {
    expect(textOf(['Next, from ', { code: 'acme' }, ' ', { aside: '(../..)' }, ':'])).toBe('Next, from acme (../..):')
  })
})

describe('segmentsOfMessage', () => {
  it('gives plain text as one segment, and segments as they are', () => {
    expect(segmentsOfMessage('hint: a')).toEqual(['hint: a'])
    expect(segmentsOfMessage(['a ', { code: 'b' }])).toEqual(['a ', { code: 'b' }])
  })
})

describe('kindOf and segmentOf', () => {
  it.each([
    ['words', 'text', 'words'],
    [{ code: 'acme' }, 'code', 'acme'],
    [{ aside: '(../..)' }, 'aside', '(../..)'],
  ] as const)('tells %o is %s, and builds it back from its kind and words', (segment, kind, words) => {
    expect(kindOf(segment)).toBe(kind)
    expect(segmentOf(kind, words)).toEqual(segment)
  })
})
