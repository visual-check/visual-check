import { describe, expect, it } from 'vitest'
import type { ReportPageError } from '../report/report-document.js'
import { pageErrorsBlockOf, pageErrorTextOf } from './page-errors-block.js'

/**
 * A `console.error` that fails the run, with the text given.
 */
function failing(text: string): ReportPageError {
  return { kind: 'console.error', text, severity: 'fail' }
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
})

describe('pageErrorsBlockOf', () => {
  it('gives no line when no snapshot has page errors or stale expected page errors', () => {
    expect(pageErrorsBlockOf([])).toEqual([])
    expect(pageErrorsBlockOf([{ name: 'web  a', pageErrors: [], staleExpectedPageErrors: [] }])).toEqual([])
  })

  it('lists each snapshot with either by name, with its page errors and severity, then its stale entries', () => {
    const block = pageErrorsBlockOf([
      {
        name: 'web  a',
        pageErrors: [
          failing('TypeError: Failed to fetch'),
          { kind: 'load', text: 'http://localhost:6006/x.png', loadError: 'net::ERR_EMPTY_RESPONSE', severity: 'fail' },
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
    ])

    expect(block).toEqual([
      '── 3 snapshots with page errors ──',
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

  it('counts one snapshot in the singular', () => {
    expect(pageErrorsBlockOf([{ name: 'web  a', pageErrors: [failing('Boom')], staleExpectedPageErrors: [] }])[0]).toBe(
      '── 1 snapshot with page errors ──',
    )
  })

  it("lists a snapshot's first 5 page errors, then how many more it has", () => {
    const errorsOf = (count: number): ReportPageError[] =>
      Array.from({ length: count }, (_, index) => failing(`Error ${index + 1}`))

    expect(pageErrorsBlockOf([{ name: 'web  a', pageErrors: errorsOf(6), staleExpectedPageErrors: ['"x"'] }])).toEqual([
      '── 1 snapshot with page errors ──',
      'web  a',
      '  page error (fail): console.error Error 1',
      '  page error (fail): console.error Error 2',
      '  page error (fail): console.error Error 3',
      '  page error (fail): console.error Error 4',
      '  page error (fail): console.error Error 5',
      '  …and 1 more page error',
      '  stale expected page error: "x"',
    ])
    expect(pageErrorsBlockOf([{ name: 'web  a', pageErrors: errorsOf(7), staleExpectedPageErrors: [] }]).at(-1)).toBe(
      '  …and 2 more page errors',
    )
    expect(pageErrorsBlockOf([{ name: 'web  a', pageErrors: errorsOf(5), staleExpectedPageErrors: [] }])).toHaveLength(
      7,
    )
  })
})
