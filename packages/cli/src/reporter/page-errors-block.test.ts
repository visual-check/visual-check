import { describe, expect, it } from 'vitest'
import type { ReportPageError } from '../report/report-document.js'
import { pageErrorCountsOf, pageErrorsBlockOf, pageErrorTextOf } from './page-errors-block.js'

/**
 * A `console.error` that fails the run, with the text given.
 */
function failing(text: string): ReportPageError {
  return { kind: 'console.error', text, severity: 'fail' }
}

/**
 * A `console.error` that only warns, with the text given.
 */
function warning(text: string): ReportPageError {
  return { kind: 'console.error', text, severity: 'warn' }
}

describe('pageErrorTextOf', () => {
  it.each([
    [{ kind: 'console.error', text: 'TypeError: Failed to fetch' }, 'console.error TypeError: Failed to fetch'],
    [{ kind: 'error', text: 'Uncaught Error: boom' }, 'uncaught error Uncaught Error: boom'],
    [{ kind: 'unhandledrejection', text: 'Request timeout' }, 'unhandled rejection Request timeout'],
    [
      { kind: 'load', text: 'http://localhost:6006/api/orders', loadError: 'HTTP 404' },
      'failed load http://localhost:6006/api/orders · HTTP 404',
    ],
  ] as const)('gives %o as %s', (error, text) => {
    expect(pageErrorTextOf(error)).toBe(text)
  })

  it('keeps the first line of a text that spans several, with LF or CRLF line ends', () => {
    expect(pageErrorTextOf({ kind: 'error', text: 'Uncaught Error: boom\n    at render (a.tsx:1:1)' })).toBe(
      'uncaught error Uncaught Error: boom',
    )
    expect(pageErrorTextOf({ kind: 'error', text: 'Uncaught Error: boom\r\n    at render (a.tsx:1:1)' })).toBe(
      'uncaught error Uncaught Error: boom',
    )
  })

  it('skips blank lines to the first that holds text', () => {
    expect(pageErrorTextOf({ kind: 'console.error', text: '\n  \r\nBoom\nat a.tsx' })).toBe('console.error Boom')
  })

  it('gives the kind alone for a blank text', () => {
    expect(pageErrorTextOf({ kind: 'console.error', text: '' })).toBe('console.error')
    expect(pageErrorTextOf({ kind: 'console.error', text: ' \n ' })).toBe('console.error')
  })
})

describe('pageErrorCountsOf', () => {
  it.each([
    [[[failing('A')]], 'test', '1 snapshot with page errors, which fails the run'],
    [[[failing('A')], [failing('B')]], 'test', '2 snapshots with page errors, which fail the run'],
    [[[failing('A')], [warning('B')], []], 'test', '2 snapshots with page errors, 1 of which fails the run'],
    [[[failing('A')], [failing('B')], [warning('C')]], 'test', '3 snapshots with page errors, 2 of which fail the run'],
    [[[warning('A')], [warning('B')]], 'test', '2 snapshots with page errors'],
    [[[failing('A')]], 'update', '1 snapshot with page errors'],
    [[[failing('A')], [warning('B')]], 'update', '2 snapshots with page errors'],
  ] as const)('counts snapshots with %o in %s as %s', (errors, command, text) => {
    const snapshots = errors.map((pageErrors) => ({ pageErrors, staleExpectedPageErrors: [] }))

    expect(pageErrorCountsOf(snapshots, command)).toBe(text)
  })

  it('counts the stale expected page errors apart, after the snapshots with page errors, leaving out a zero count', () => {
    expect(
      pageErrorCountsOf(
        [
          { pageErrors: [failing('A')], staleExpectedPageErrors: ['"x"'] },
          { pageErrors: [], staleExpectedPageErrors: ['"y"', '/z/'] },
        ],
        'test',
      ),
    ).toBe('1 snapshot with page errors, which fails the run · 3 stale expected page errors')
    expect(pageErrorCountsOf([{ pageErrors: [], staleExpectedPageErrors: ['"y"'] }], 'test')).toBe(
      '1 stale expected page error',
    )
  })
})

describe('pageErrorsBlockOf', () => {
  it('gives no line when no snapshot has page errors or stale expected page errors', () => {
    expect(pageErrorsBlockOf([], 'test')).toEqual([])
    expect(pageErrorsBlockOf([{ name: 'web  a', pageErrors: [], staleExpectedPageErrors: [] }], 'test')).toEqual([])
  })

  it('lists each snapshot with either by name, with its page errors and severity, then its stale entries', () => {
    const block = pageErrorsBlockOf(
      [
        {
          name: 'web  a',
          pageErrors: [
            failing('TypeError: Failed to fetch'),
            {
              kind: 'load',
              text: 'http://localhost:6006/x.png',
              loadError: 'net::ERR_EMPTY_RESPONSE',
              severity: 'fail',
            },
          ],
          staleExpectedPageErrors: ['"Not raised"', '/gone/i'],
        },
        { name: 'web  b', pageErrors: [], staleExpectedPageErrors: [] },
        {
          name: 'web  c  dark',
          pageErrors: [{ kind: 'unhandledrejection', text: 'Request timeout', severity: 'warn' }],
          staleExpectedPageErrors: [],
        },
        { name: 'web  d', pageErrors: [], staleExpectedPageErrors: ['"Gone"'] },
      ],
      'test',
    )

    expect(block).toEqual([
      '── 2 snapshots with page errors, 1 of which fails the run · 3 stale expected page errors ──',
      'web  a',
      '  page error (fail): console.error TypeError: Failed to fetch',
      '  page error (fail): failed load http://localhost:6006/x.png · net::ERR_EMPTY_RESPONSE',
      '  stale expected page error: "Not raised"',
      '  stale expected page error: /gone/i',
      'web  c  dark',
      '  page error (warn): unhandled rejection Request timeout',
      'web  d',
      '  stale expected page error: "Gone"',
    ])
  })

  it("never says update fails, marking a page error that would fail test as such, and a warning as it's", () => {
    const block = pageErrorsBlockOf(
      [{ name: 'web  a', pageErrors: [failing('Boom'), warning('Careful')], staleExpectedPageErrors: [] }],
      'update',
    )

    expect(block).toEqual([
      '── 1 snapshot with page errors ──',
      'web  a',
      '  page error (fails test): console.error Boom',
      '  page error (warn): console.error Careful',
    ])
  })

  it("lists a snapshot's first 5 page errors, then how many more it has", () => {
    const errorsOf = (count: number): ReportPageError[] =>
      Array.from({ length: count }, (_, index) => failing(`Error ${index + 1}`))
    const blockOf = (count: number, stale: string[] = []): string[] =>
      pageErrorsBlockOf([{ name: 'web  a', pageErrors: errorsOf(count), staleExpectedPageErrors: stale }], 'test')
    const firstFive = [
      '── 1 snapshot with page errors, which fails the run ──',
      'web  a',
      '  page error (fail): console.error Error 1',
      '  page error (fail): console.error Error 2',
      '  page error (fail): console.error Error 3',
      '  page error (fail): console.error Error 4',
      '  page error (fail): console.error Error 5',
    ]

    expect(blockOf(5)).toEqual(firstFive)
    expect(blockOf(6, ['"x"'])).toEqual([
      '── 1 snapshot with page errors, which fails the run · 1 stale expected page error ──',
      ...firstFive.slice(1),
      '  …and 1 more page error',
      '  stale expected page error: "x"',
    ])
    expect(blockOf(7)).toEqual([...firstFive, '  …and 2 more page errors'])
  })
})
