import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { testEntryWith, testReportWith } from '../report/report-document.fixture.js'
import { testEndLinesOf } from './end-block.js'

const project = join('/', 'project')
const atConfig = { cwd: project, configFolder: project }

describe('testEndLinesOf', () => {
  it('gives only the counts and the time when nothing failed and nothing is flaky', () => {
    const passed = ['a', 'b', 'c'].map((id) => testEntryWith({ id, status: 'passed', reason: null }))

    expect(testEndLinesOf(testReportWith(passed), { ...atConfig, elapsedMs: 1234 })).toEqual(['3 passed · 1.2s'])
  })

  it('gives 0 passed for an empty run', () => {
    expect(testEndLinesOf(testReportWith([]), { ...atConfig, elapsedMs: 0 })).toEqual(['0 passed · 0 ms'])
  })

  it('lists each failure with its detail, diff, hints and last console lines, then the flaky snapshots and counts', () => {
    const passes = Array.from({ length: 246 }, (_, index) =>
      testEntryWith({ id: `p${index}`, status: 'passed', reason: null }),
    )
    const hint =
      'Differs only inside remote content from images.example.com. A CDN can serve different bytes to different ' +
      "machines. Mask it by host: { host: 'images.example.com' }. See https://docs/remote-content"
    const entries = [
      testEntryWith({
        id: 'button--primary.dark',
        story: 'button--primary',
        mode: 'dark',
        status: 'differs',
        reason: 'pixels',
        message: '84 differ, 80 allowed (20 at scale 2)',
        hints: [{ kind: 'remote-content', hosts: ['images.example.com'], message: hint }],
        images: {
          baseline: 'images/web/button--primary.dark.baseline.png',
          snapshot: 'images/web/button--primary.dark.snapshot.png',
          diff: 'images/web/button--primary.dark.diff.png',
        },
      }),
      testEntryWith({ id: 'button--secondary', status: 'passed', reason: null, flaky: true }),
      ...passes,
      testEntryWith({ id: 'button--wide', status: 'passed', reason: null, flaky: true }),
      testEntryWith({
        id: 'checkout--flow',
        status: 'broken',
        reason: 'navigated-away',
        message: 'The story navigated away to /categories/burgers. Await the new page before clicking.',
        console: [
          { level: 'error', text: 'First error' },
          { level: 'warn', text: 'First warning' },
          { level: 'log', text: 'Rendering' },
          { level: 'error', text: 'Second error' },
          { level: 'info', text: 'Loaded' },
          { level: 'warn', text: 'Second warning' },
          { level: 'debug', text: 'Mounted' },
          { level: 'warn', text: 'Deprecated prop size' },
          { level: 'error', text: 'Uncaught TypeError: x is undefined\n    at Button (button.tsx:4:2)' },
        ],
      }),
      testEntryWith({ id: 'card--empty', status: 'missing', reason: null, attempts: 0 }),
      testEntryWith({
        id: 'stray--orphan',
        story: null,
        importPath: null,
        status: 'orphan',
        reason: null,
        attempts: 0,
      }),
    ]

    expect(testEndLinesOf(testReportWith(entries), { ...atConfig, elapsedMs: 192_000 })).toEqual([
      '── 4 failures ──',
      'web  button--primary  dark',
      '  differs: 84 differ, 80 allowed (20 at scale 2)',
      '  diff: .visual-check/report/images/web/button--primary.dark.diff.png',
      `  hint: ${hint}`,
      'web  checkout--flow',
      '  broken: The story navigated away to /categories/burgers. Await the new page before clicking.',
      '  console warn: First warning',
      '  console error: Second error',
      '  console warn: Second warning',
      '  console warn: Deprecated prop size',
      '  console error: Uncaught TypeError: x is undefined',
      'web  card--empty',
      '  missing: no baseline yet; run visual-check update to write it',
      'web  stray--orphan',
      '  orphan: no story calls for .visual-check/baselines/stray--orphan.png; run visual-check update to delete it',
      'Flaky snapshots, which passed on a retry:',
      '  web  button--secondary',
      '  web  button--wide',
      '248 passed (2 flaky) · 1 differs · 1 broken · 1 missing · 1 orphan · 3m 12s',
    ])
  })

  it('cuts a console message with CRLF line ends at its first line', () => {
    const entry = testEntryWith({
      status: 'broken',
      reason: 'error',
      message: 'It threw.',
      console: [{ level: 'error', text: 'Uncaught Error: boom\r\n    at render (a.tsx:1:1)' }],
    })

    expect(testEndLinesOf(testReportWith([entry]), { ...atConfig, elapsedMs: 0 })).toEqual([
      '── 1 failure ──',
      'web  a',
      '  broken: It threw.',
      '  console error: Uncaught Error: boom',
      '0 passed · 1 broken · 0 ms',
    ])
  })

  it('prints no diff line for a size difference with no visual diff', () => {
    const entry = testEntryWith({ status: 'differs', reason: 'size', message: 'size 10 × 10, baseline 10 × 20' })

    expect(testEndLinesOf(testReportWith([entry]), { ...atConfig, elapsedMs: 0 })).toEqual([
      '── 1 failure ──',
      'web  a',
      '  differs: size 10 × 10, baseline 10 × 20',
      '0 passed · 1 differs · 0 ms',
    ])
  })

  it('counts two orphans as orphans', () => {
    const orphans = ['x', 'y'].map((id) => testEntryWith({ id, story: null, status: 'orphan', reason: null }))

    expect(testEndLinesOf(testReportWith(orphans), { ...atConfig, elapsedMs: 0 }).at(-1)).toBe(
      '0 passed · 2 orphans · 0 ms',
    )
  })

  it('lists only the flaky snapshots when nothing failed', () => {
    const entries = [
      testEntryWith({ id: 'a', mode: 'dark', status: 'passed', reason: null, flaky: true }),
      testEntryWith({ id: 'b', status: 'passed', reason: null }),
    ]

    expect(testEndLinesOf(testReportWith(entries), { ...atConfig, elapsedMs: 0 })).toEqual([
      'Flaky snapshots, which passed on a retry:',
      '  web  a  dark',
      '2 passed (1 flaky) · 0 ms',
    ])
  })

  it.each([
    {
      where: 'a parent of the config folder',
      cwd: project,
      diff: 'packages/web/.visual-check/report/images/web/a.diff.png',
      orphan: 'packages/web/.visual-check/baselines/b.png',
    },
    {
      where: 'a child of the config folder',
      cwd: join(project, 'packages', 'web', 'src'),
      diff: '../.visual-check/report/images/web/a.diff.png',
      orphan: '../.visual-check/baselines/b.png',
    },
  ])('prints paths relative to the cwd when it is $where', ({ cwd, diff, orphan }) => {
    const entries = [
      testEntryWith({
        status: 'differs',
        reason: 'pixels',
        message: '5 differ, 0 allowed',
        images: { baseline: null, snapshot: null, diff: 'images/web/a.diff.png' },
      }),
      testEntryWith({ id: 'b', story: null, status: 'orphan', reason: null }),
    ]
    const context = { cwd, configFolder: join(project, 'packages', 'web'), elapsedMs: 0 }

    expect(testEndLinesOf(testReportWith(entries), context)).toEqual([
      '── 2 failures ──',
      'web  a',
      '  differs: 5 differ, 0 allowed',
      `  diff: ${diff}`,
      'web  b',
      `  orphan: no story calls for ${orphan}; run visual-check update to delete it`,
      '0 passed · 1 differs · 1 orphan · 0 ms',
    ])
  })

  it("lists the snapshots with page errors after the failures and before the flaky ones, a failure's too", () => {
    const entries = [
      testEntryWith({
        id: 'a',
        status: 'differs',
        reason: 'pixels',
        message: '5 differ, 0 allowed',
        pageErrors: [{ kind: 'error', text: 'Uncaught Error: boom\n    at a.tsx:1:1', severity: 'fail' }],
      }),
      testEntryWith({ id: 'b', status: 'passed', reason: null, flaky: true }),
      testEntryWith({
        id: 'c',
        mode: 'dark',
        status: 'passed',
        reason: null,
        pageErrors: [
          {
            kind: 'load',
            text: 'http://localhost:6006/api/orders',
            loadError: 'HTTP 500',
            severity: 'fail',
          },
        ],
        staleExpectedPageErrors: ['/timeout/i'],
      }),
    ]

    expect(testEndLinesOf(testReportWith(entries), { ...atConfig, elapsedMs: 0 })).toEqual([
      '── 1 failure ──',
      'web  a',
      '  differs: 5 differ, 0 allowed',
      '── 2 snapshots with page errors, which fail the run · 1 stale expected page error ──',
      'web  a',
      '  page error (fail): uncaught error Uncaught Error: boom',
      'web  c  dark',
      '  page error (fail): failed load http://localhost:6006/api/orders · HTTP 500',
      '  stale expected page error: /timeout/i',
      'Flaky snapshots, which passed on a retry:',
      '  web  b',
      '2 passed (1 flaky) · 1 differs · 0 ms',
    ])
  })

  it('says why a run whose snapshots all passed fails on page errors', () => {
    const entry = testEntryWith({
      status: 'passed',
      reason: null,
      pageErrors: [{ kind: 'console.error', text: 'TypeError: Failed to fetch', severity: 'fail' }],
    })

    expect(testEndLinesOf(testReportWith([entry]), { ...atConfig, elapsedMs: 0 })).toEqual([
      '── 1 snapshot with page errors, which fails the run ──',
      'web  a',
      '  page error (fail): console.error TypeError: Failed to fetch',
      '1 passed · 0 ms',
    ])
  })
})
