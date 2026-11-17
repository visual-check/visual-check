import { describe, expect, it } from 'vitest'
import { wrappedLinesOf } from './wrapped-lines.js'

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
