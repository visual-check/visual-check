import { describe, expect, it } from 'vitest'
import { findBaselineClash } from './baseline-clash.js'

/**
 * `é` as one code point, as NFC encodes it.
 */
const composedE = 'é'.normalize('NFC')

/**
 * `é` as `e` and a combining acute accent, as NFD encodes it.
 */
const decomposedE = composedE.normalize('NFD')

describe('findBaselineClash', () => {
  it('finds two keys that differ only in how an accented letter is encoded', () => {
    const first = { key: `caf${composedE}--primary` }
    const second = { key: `caf${decomposedE}--primary` }

    expect(findBaselineClash([first, second])).toEqual({
      first,
      second,
      fileName: `caf${composedE}--primary.png`,
    })
  })

  it('finds two keys that differ only in case', () => {
    const first = { key: 'button--primary' }
    const second = { key: 'Button--Primary' }

    expect(findBaselineClash([first, second])).toEqual({ first, second, fileName: 'button--primary.png' })
  })

  it("finds two keys that are the same text, as a mode's and another story's can be", () => {
    const first = { key: 'button.dark' }
    const second = { key: 'button.dark' }

    expect(findBaselineClash([first, second])).toEqual({ first, second, fileName: 'button.dark.png' })
  })

  it('gives the clash whose later snapshot comes first', () => {
    const snapshots = [{ key: 'a' }, { key: 'b' }, { key: 'B' }, { key: 'A' }]

    expect(findBaselineClash(snapshots)).toEqual({ first: snapshots[1], second: snapshots[2], fileName: 'b.png' })
  })

  it('gives undefined for keys with files of their own', () => {
    expect(findBaselineClash([{ key: 'a' }, { key: 'a.dark' }, { key: 'b' }, { key: `${composedE}` }])).toBeUndefined()
  })

  it('gives undefined for no snapshots', () => {
    expect(findBaselineClash([])).toBeUndefined()
  })

  it('gives undefined for long keys that share their first 223 bytes, since their hashes differ', () => {
    const start = 'a'.repeat(223)

    expect(
      findBaselineClash([{ key: `${start}${'b'.repeat(30)}` }, { key: `${start}${'c'.repeat(30)}` }]),
    ).toBeUndefined()
  })
})
