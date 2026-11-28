import type { AddonSnapshot } from '@visual-check/cli/internal/addon-protocol'
import { describe, expect, it } from 'vitest'
import { snapshotWith } from '../channel-events/state.fixture.js'
import { detailLinesOf, rowOf, selectedRowOf } from './snapshot-row.js'

describe('rowOf', () => {
  it('gives the whole row of a pass', () => {
    const images = { baseline: 'a.baseline.png', snapshot: 'a.snapshot.png', diff: null }

    expect(rowOf(snapshotWith({ images }))).toEqual({
      key: 'card--default',
      label: 'Default',
      status: 'passed',
      statusText: 'Passed',
      flaky: false,
      message: 'Passed.',
      reason: null,
      details: [],
      hints: [],
      images,
    })
  })

  it.each<[statusText: string, fields: Partial<AddonSnapshot>]>([
    ['Passed', { status: 'passed', reason: null }],
    ['Visual diff', { status: 'differs', reason: 'size' }],
    ['Missing baseline', { status: 'missing', reason: null }],
    ['Broken story', { status: 'broken', reason: 'play-threw' }],
  ])('gives "%s", with its reason', (statusText, fields) => {
    expect(rowOf(snapshotWith(fields))).toMatchObject({ ...fields, statusText })
  })

  it('names the mode', () => {
    expect(rowOf(snapshotWith({ id: 'card--default.dark', mode: 'dark' }))).toMatchObject({
      key: 'card--default.dark',
      label: 'dark',
    })
  })

  it('marks a flaky snapshot and gives its hints', () => {
    const hints: AddonSnapshot['hints'] = [
      { kind: 'remote-content', hosts: ['a.test'], message: 'Mask a.test.' },
      { kind: 'remote-content', hosts: ['b.test'], message: 'Mask b.test.' },
    ]

    expect(rowOf(snapshotWith({ flaky: true, hints }))).toMatchObject({
      flaky: true,
      hints: ['Mask a.test.', 'Mask b.test.'],
    })
  })

  it('gives the details of a broken story', () => {
    expect(
      rowOf(snapshotWith({ status: 'broken', reason: 'navigated-away', details: { url: 'http://web.test/other' } })),
    ).toMatchObject({ reason: 'navigated-away', details: ['URL: http://web.test/other'] })
  })
})

describe('selectedRowOf', () => {
  /**
   * Builds rows of the statuses: `a`, `b`, `c` and so on.
   */
  function rowsOf(...statuses: ('passed' | 'differs' | 'missing')[]) {
    return statuses.map((status, index) => ({ ...rowOf(snapshotWith()), key: 'abc'[index] ?? '', status }))
  }

  it('is the first that is not passed, else the first, until one is picked', () => {
    expect(selectedRowOf(rowsOf('passed', 'missing', 'differs'), 'click-1')?.key).toBe('b')
    expect(selectedRowOf(rowsOf('passed', 'passed'), 'click-1')?.key).toBe('a')
    expect(selectedRowOf([], 'click-1')).toBeUndefined()
  })

  it.each(['a', 'b', 'c'])('is the picked one in the result it was picked in: %s', (key) => {
    const rows = rowsOf('passed', 'missing', 'differs')

    expect(selectedRowOf(rows, 'click-1', { key, resultId: 'click-1' })?.key).toBe(key)
  })

  it('stays the picked one in a later result while it is not passed', () => {
    const picked = { key: 'c', resultId: 'click-1' }

    expect(selectedRowOf(rowsOf('missing', 'passed', 'differs'), 'click-2', picked)?.key).toBe('c')
    expect(selectedRowOf(rowsOf('passed', 'missing', 'passed'), 'click-2', picked)?.key).toBe('b')
    expect(selectedRowOf(rowsOf('passed', 'passed', 'passed'), 'click-2', picked)?.key).toBe('a')
    expect(selectedRowOf(rowsOf('passed', 'missing'), 'click-2', picked)?.key).toBe('b')
  })
})

describe('detailLinesOf', () => {
  it.each<[lines: string[], details: NonNullable<AddonSnapshot['details']>]>([
    [[], {}],
    [['URL: http://web.test/other'], { url: 'http://web.test/other' }],
    [
      ['Error: Boom', 'at play (a.ts:1:1)', 'at run (b.ts:2:2)'],
      { play: { message: 'Error: Boom', stack: ['at play (a.ts:1:1)', 'at run (b.ts:2:2)'] } },
    ],
    [['Timeout: 15000 ms'], { timeoutMs: 15_000 }],
    [['Page size: 1280 × 40000 device pixels'], { size: [1280, 40_000] }],
    [['Pending fonts: Inter normal 400, Lato italic 700'], { pendingFonts: ['Inter normal 400', 'Lato italic 700'] }],
    [['Grid width: 1600 px, viewport width: 1280 px'], { grid: { width: 1600, viewportWidth: 1280 } }],
    [
      ['Full-page overflow: right 197 px, viewport width: 1280 px'],
      { overflow: { area: 'full-page', top: 0, right: 197, bottom: 0, left: 0, viewportWidth: 1280 } },
    ],
    [
      ['Element overflow: top 12 px, bottom 30 px, left 4 px, viewport width: 375 px'],
      { overflow: { area: 'element', top: 12, right: 0, bottom: 30, left: 4, viewportWidth: 375 } },
    ],
    [['SyntaxError: Unexpected token', '  at a.ts:1'], { loadError: 'SyntaxError: Unexpected token\n  at a.ts:1' }],
    [['Timeout: 15000 ms', 'Pending fonts: Inter'], { pendingFonts: ['Inter'], timeoutMs: 15_000 }],
  ])('gives %j', (lines, details) => {
    expect(detailLinesOf(details)).toEqual(lines)
  })

  it('gives none for a snapshot without details', () => {
    expect(detailLinesOf(null)).toEqual([])
  })
})
