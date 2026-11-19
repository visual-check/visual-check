import { describe, expect, it } from 'vitest'
import { wrappedLinesOf, wrappedSegmentLinesOf } from './wrapped-lines.js'

describe('wrappedLinesOf', () => {
  it('keeps text that fits on one line', () => {
    expect(wrappedLinesOf('Use 127.0.0.1, not localhost.', 30)).toEqual(['Use 127.0.0.1, not localhost.'])
  })

  it('breaks at the last space that fits, and drops it', () => {
    expect(wrappedLinesOf('Where visual-check opens this Storybook, locally and in CI.', 38)).toEqual([
      'Where visual-check opens this',
      'Storybook, locally and in CI.',
    ])
  })

  it('fills each line up to the width exactly', () => {
    expect(wrappedLinesOf('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc'])
  })

  it('drops runs of spaces between words and at a break', () => {
    expect(wrappedLinesOf('one   two  three ', 8)).toEqual(['one two', 'three'])
  })

  it('starts each wrapped line with the spaces its line starts with, and wraps in the room they leave', () => {
    expect(wrappedLinesOf('Unlisted:\n  - leftpad-zz, in src/a.js and src/b.js', 24)).toEqual([
      'Unlisted:',
      '  - leftpad-zz, in',
      '  src/a.js and src/b.js',
    ])
  })

  it('keeps a word that is wider than the room an indent leaves, broken at the edge', () => {
    expect(wrappedLinesOf('    abcdef', 7)).toEqual(['    abc', '    def'])
  })

  it('breaks a word wider than the width where it reaches the edge', () => {
    expect(wrappedLinesOf('see https://visual-check.vercel.app/docs now', 10)).toEqual([
      'see',
      'https://vi',
      'sual-check',
      '.vercel.ap',
      'p/docs now',
    ])
  })

  it('counts a character outside the BMP as one column, and never splits it', () => {
    expect(wrappedLinesOf('ab😀cd', 3)).toEqual(['ab😀', 'cd'])
  })

  it('starts a new line at a line break', () => {
    expect(wrappedLinesOf('one two\nthree', 20)).toEqual(['one two', 'three'])
  })

  it('takes a width below 1 as 1', () => {
    expect(wrappedLinesOf('ab c', 0)).toEqual(['a', 'b', 'c'])
  })

  it('gives one empty line for empty text', () => {
    expect(wrappedLinesOf('', 10)).toEqual([''])
  })
})

describe('wrappedSegmentLinesOf', () => {
  it('keeps a line that fits as it is', () => {
    expect(wrappedSegmentLinesOf(['Run ', { code: 'pnpm run storybook' }, ' now'], 30)).toEqual([
      ['Run ', { code: 'pnpm run storybook' }, ' now'],
    ])
  })

  it('keeps an aside as an aside, apart from the code and the words around it', () => {
    expect(wrappedSegmentLinesOf(['from ', { code: 'acme' }, ' ', { aside: '(../..)' }, ':'], 9)).toEqual([
      ['from ', { code: 'acme' }],
      [{ aside: '(../..)' }, ':'],
    ])
  })

  it('breaks at the last space that fits, drops it, and starts the next line with no space', () => {
    expect(
      wrappedSegmentLinesOf(
        ['Add your Storybook to ', { code: 'visual-check.config.ts' }, ', as the hints say, then start it'],
        45,
      ),
    ).toEqual([
      ['Add your Storybook to ', { code: 'visual-check.config.ts' }, ','],
      ['as the hints say, then start it'],
    ])
  })

  it('breaks at a space between words and a code segment', () => {
    expect(
      wrappedSegmentLinesOf(['To run visual-check in CI, see ', { code: 'https://x.dev/docs/ci' }, '.'], 40),
    ).toEqual([['To run visual-check in CI, see'], [{ code: 'https://x.dev/docs/ci' }, '.']])
  })

  it('keeps each piece of a code segment broken across lines as code', () => {
    expect(wrappedSegmentLinesOf(['see ', { code: 'abcdefghij' }], 6)).toEqual([
      ['see'],
      [{ code: 'abcdef' }],
      [{ code: 'ghij' }],
    ])
  })

  it('keeps two code segments on a line apart', () => {
    expect(wrappedSegmentLinesOf([{ code: 'a.ts' }, ' and ', { code: 'b.ts' }], 20)).toEqual([
      [{ code: 'a.ts' }, ' and ', { code: 'b.ts' }],
    ])
  })

  it('gives one empty line for no segments', () => {
    expect(wrappedSegmentLinesOf([], 20)).toEqual([[]])
  })
})
