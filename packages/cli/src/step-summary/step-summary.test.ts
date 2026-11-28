import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { testEntryWith, testReportWith } from '../report/report-document.fixture.js'
import {
  emptyUpdateCounts,
  type ReportEntryFields,
  type ReportPageError,
  type UpdateReport,
  type UpdateReportEntry,
  updateReportOf,
} from '../report/report-document.js'
import { appendStepSummary, StepSummaryError, stepSummaryOf } from './step-summary.js'

/**
 * A budget no test's summary comes near, so nothing is cut.
 */
const roomy = 1024 * 1024

/**
 * The temporary folders the tests made, removed after each test.
 */
const temporaryFolders: string[] = []

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

/**
 * Makes a temporary folder, removed after the test. Returns its real path.
 */
function temporaryFolder(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-step-summary-')))

  temporaryFolders.push(folder)

  return folder
}

/**
 * Builds a finished `update` report of the `web` Storybook with the entries and counts given.
 */
function updateReportWith(entries: UpdateReportEntry[], counts: Partial<UpdateReport['counts']>): UpdateReport {
  return updateReportOf({
    visualCheck: '0.1.0',
    exitCode: entries.some((entry) => entry.status === 'broken') ? 1 : 0,
    selection: { by: 'all', base: null, changedFiles: null, fallback: null },
    storybooks: [{ name: 'web', url: 'http://localhost:6006' }],
    counts: { ...emptyUpdateCounts(), ...counts },
    snapshots: entries,
    warnings: [],
    error: null,
  })
}

/**
 * The status and reason of each kind of `update` entry, kept together so a status only takes its own reasons.
 */
type UpdateEntryStatus = UpdateReportEntry extends infer Entry
  ? Entry extends UpdateReportEntry
    ? Pick<Entry, 'status' | 'reason'>
    : never
  : never

/**
 * Builds an `update` report's entry with its status and reason, and the fields given. Every other field is a `test`
 * entry's default, with no hosts.
 */
function updateEntryWith(fields: Partial<ReportEntryFields> & UpdateEntryStatus): UpdateReportEntry {
  const {
    status: _status,
    reason: _reason,
    ...defaults
  } = testEntryWith({
    id: fields.id ?? 'a',
    status: 'passed',
    reason: null,
  })

  return { ...defaults, realRequestHosts: [], remoteContentHosts: [], ...fields }
}

describe('stepSummaryOf', () => {
  it('gives the heading and the counts of a test that passed', () => {
    const report = testReportWith([
      testEntryWith({ id: 'a', status: 'passed', reason: null }),
      testEntryWith({ id: 'b', status: 'passed', reason: null }),
    ])

    expect(stepSummaryOf(report, roomy)).toBe('### visual-check 0.1.0 · test\n\n2 passed\n')
  })

  it('names the shard in the heading', () => {
    const report = testReportWith([], { shard: { index: 2, total: 4 } })

    expect(stepSummaryOf(report, roomy)).toBe('### visual-check 0.1.0 · test · shard 2/4\n\n0 passed\n')
  })

  it('names a consistency-only test in the heading', () => {
    const report = testReportWith([testEntryWith({ id: 'a', status: 'missing', reason: null })], {
      consistencyOnly: true,
    })

    expect(stepSummaryOf(report, roomy)).toMatch(
      /^### visual-check 0\.1\.0 · test · consistency\n\n0 passed · 1 missing\n/,
    )
  })

  it('lists the flaky snapshots and a table of the failures, in the report order', () => {
    const report = testReportWith(
      [
        testEntryWith({ id: 'button--secondary', status: 'passed', reason: null, flaky: true }),
        testEntryWith({ id: 'a', mode: 'dark', status: 'passed', reason: null, flaky: true }),
        testEntryWith({ id: 'c', status: 'passed', reason: null }),
        testEntryWith({
          id: 'button--primary',
          mode: 'dark',
          status: 'differs',
          reason: 'pixels',
          message: '84 differ, 80 allowed (20 at scale 2)',
        }),
        testEntryWith({ id: 'checkout--flow', status: 'broken', reason: 'navigated-away', message: 'Navigated away.' }),
        testEntryWith({ id: 'card--empty', status: 'missing', reason: null, message: 'No baseline yet.' }),
        testEntryWith({
          id: 'stray--orphan',
          story: null,
          status: 'orphan',
          reason: null,
          message: 'No story calls for .visual-check/baselines/stray--orphan.png.',
        }),
      ],
      { shard: { index: 2, total: 4 } },
    )

    expect(stepSummaryOf(report, roomy)).toBe(
      [
        '### visual-check 0.1.0 · test · shard 2/4',
        '',
        '3 passed (2 flaky) · 1 differs · 1 broken · 1 missing · 1 orphan',
        '',
        '**Flaky snapshots**',
        '',
        '- web · button--secondary',
        '- web · a · dark',
        '',
        '**Failures**',
        '',
        '| Storybook | Story | Mode | Status | Message |',
        '| --- | --- | --- | --- | --- |',
        '| web | button--primary | dark | differs | 84 differ, 80 allowed (20 at scale 2) |',
        '| web | checkout--flow |  | broken | Navigated away. |',
        '| web | card--empty |  | missing | No baseline yet. |',
        '| web | stray--orphan |  | orphan | No story calls for .visual-check/baselines/stray--orphan.png. |',
        '',
      ].join('\n'),
    )
  })

  it('escapes each cell, so a message can neither end it nor break the line, and its markup shows as written', () => {
    const report = testReportWith([
      testEntryWith({
        id: 'a',
        status: 'broken',
        reason: 'error',
        message: 'a|b<c>\nd\\e\r\nf\rg &lt; *x* _y_ `z` [l](u) ~s~ #h',
      }),
    ])

    expect(stepSummaryOf(report, roomy)).toContain(
      '| web | a |  | broken | a\\|b&lt;c> d\\\\e f g &amp;lt; \\*x\\* \\_y\\_ \\`z\\` \\[l\\](u) \\~s\\~ \\#h |\n',
    )
  })

  it("escapes a flaky snapshot's names, so their markup shows as written", () => {
    const report = testReportWith([
      testEntryWith({
        storybook: '#web',
        id: 'a',
        story: '*a*_b_',
        mode: '`dark`<[x]>',
        status: 'passed',
        reason: null,
        flaky: true,
      }),
    ])

    expect(stepSummaryOf(report, roomy)).toContain('\n- \\#web · \\*a\\*\\_b\\_ · \\`dark\\`&lt;\\[x\\]>\n')
  })

  it('lists at most 100 flaky snapshots, then how many more there are', () => {
    const report = testReportWith(
      Array.from({ length: 101 }, (_, index) =>
        testEntryWith({ id: `s${index}`, status: 'passed', reason: null, flaky: true }),
      ),
    )
    const lines = stepSummaryOf(report, roomy).split('\n')

    expect(lines.filter((line) => line.startsWith('- '))).toHaveLength(101)
    expect(lines.at(-3)).toBe('- web · s99')
    expect(lines.at(-2)).toBe('- …and 1 more')
  })

  it("gives an update's counts and its broken stories", () => {
    const report = updateReportWith(
      [
        updateEntryWith({ id: 'a', status: 'written', reason: 'missing', flaky: true }),
        updateEntryWith({ id: 'b', status: 'broken', reason: 'timeout', message: 'Timed out.' }),
        updateEntryWith({ id: 'gone', story: null, status: 'deleted', reason: null }),
      ],
      { written: 1, deleted: 1, kept: 3, broken: 1, flaky: 1 },
    )

    expect(stepSummaryOf(report, roomy)).toBe(
      [
        '### visual-check 0.1.0 · update',
        '',
        '1 written · 1 deleted · 3 kept · 1 broken',
        '',
        '**Flaky snapshots**',
        '',
        '- web · a',
        '',
        '**Failures**',
        '',
        '| Storybook | Story | Mode | Status | Message |',
        '| --- | --- | --- | --- | --- |',
        '| web | b |  | broken | Timed out. |',
        '',
      ].join('\n'),
    )
  })

  it('gives the error of a run that exited 2 as an indented block, with no counts', () => {
    const report = testReportWith([], {
      exitCode: 2,
      error: {
        message: 'Nothing answers at http://localhost:6006.\nStart Storybook | then run again.',
        storybooks: [],
      },
    })

    expect(stepSummaryOf(report, roomy)).toBe(
      [
        '### visual-check 0.1.0 · test',
        '',
        'The run stopped with exit code 2:',
        '',
        '    Nothing answers at http://localhost:6006.',
        '    Start Storybook | then run again.',
        '',
      ].join('\n'),
    )
  })

  it.each([
    ['ASCII', 'x'],
    ['multi-byte', 'ł🙂'],
  ])('cuts thousands of %s failures to stay under the budget, keeping the first and counting the rest', (_, unit) => {
    const message = unit.repeat(400 / unit.length)
    const entries = Array.from({ length: 20_000 }, (_, index) =>
      testEntryWith({ id: `story-${index}`, status: 'broken', reason: 'error', message }),
    )
    const budget = 1024 * 1024 - 1024
    const summary = stepSummaryOf(testReportWith(entries), budget)
    const rows = summary.split('\n').filter((line) => line.startsWith('| web |'))
    const shown = rows.length

    expect(Buffer.byteLength(summary, 'utf8')).toBeLessThan(budget)
    expect(shown).toBeGreaterThan(100)
    expect(shown).toBeLessThan(20_000)
    expect(rows[0]).toBe(`| web | story-0 |  | broken | ${message} |`)
    expect(rows.at(-1)).toBe(`| web | story-${shown - 1} |  | broken | ${message} |`)
    expect(summary).toMatch(
      new RegExp(
        `\\|\\n\\n_${20_000 - shown} more failures aren't shown, to keep this summary under GitHub's 1 MiB\\. ` +
          'report\\.json lists them all\\._\\n$',
      ),
    )

    // One more row, with the note counting one fewer, would not have fitted.
    const withOneMore = summary.replace(
      /\n\n_\d+ more failures/,
      `\n| web | story-${shown} |  | broken | ${message} |\n\n_${20_000 - shown - 1} more failures`,
    )

    expect(Buffer.byteLength(withOneMore, 'utf8')).toBeGreaterThanOrEqual(budget)
  })

  it('names one failure left out in the singular', () => {
    const entries = [
      testEntryWith({ id: 'a', status: 'broken', reason: 'error', message: 'Boom.' }),
      testEntryWith({ id: 'b', status: 'broken', reason: 'error', message: 'x'.repeat(500) }),
    ]
    const full = stepSummaryOf(testReportWith(entries), roomy)
    const withoutLast = full.replace(`| web | b |  | broken | ${'x'.repeat(500)} |\n`, '')
    const note =
      "\n_1 more failure isn't shown, to keep this summary under GitHub's 1 MiB. report.json lists them all._\n"
    const budget = Buffer.byteLength(withoutLast + note, 'utf8') + 1

    expect(stepSummaryOf(testReportWith(entries), budget)).toBe(withoutLast + note)
  })

  it("leaves report.json out of an update's cut note, since update writes none", () => {
    const entries = [
      updateEntryWith({ id: 'a', status: 'broken', reason: 'error', message: 'Boom.' }),
      updateEntryWith({ id: 'b', status: 'broken', reason: 'error', message: 'x'.repeat(500) }),
    ]
    const summary = stepSummaryOf(updateReportWith(entries, { broken: 2 }), 300)

    expect(summary).toContain(
      "| web | a |  | broken | Boom. |\n\n_1 more failure isn't shown, to keep this summary under GitHub's 1 MiB._\n",
    )
  })

  it.each([
    ['ASCII', 'x'],
    ['multi-byte', 'ł🙂'],
  ])('cuts a %s error too long for the budget at a character, with a note', (_, unit) => {
    const line = unit.repeat(60 / unit.length)
    const message = Array.from({ length: 50 }, () => line).join('\n')
    const report = testReportWith([], { exitCode: 2, error: { message, storybooks: [] } })
    const whole = stepSummaryOf(report, roomy)
    const head = '### visual-check 0.1.0 · test\n\nThe run stopped with exit code 2:\n\n'
    const tail = "\n\n_The error is cut, to keep this summary under GitHub's 1 MiB._\n"

    for (const budget of [500, 501, 502, 503, 1000]) {
      const summary = stepSummaryOf(report, budget)
      const block = summary.slice(head.length, -tail.length)
      const nextCharacter = [...whole.slice(head.length + block.length)][0] ?? ''

      expect(summary.startsWith(head)).toBe(true)
      expect(summary.endsWith(tail)).toBe(true)
      expect(whole.startsWith(`${head}${block}`)).toBe(true)
      expect(summary).not.toContain('\uFFFD')
      expect(Buffer.byteLength(summary, 'utf8')).toBeLessThan(budget)
      // The next character of the error would not have fitted.
      expect(Buffer.byteLength(summary, 'utf8') + Buffer.byteLength(nextCharacter, 'utf8')).toBeGreaterThanOrEqual(
        budget,
      )
    }
  })

  it("gives the heading alone when not even the cut error's note fits, and nothing when the heading doesn't", () => {
    const report = testReportWith([], { exitCode: 2, error: { message: 'x'.repeat(500), storybooks: [] } })

    expect(stepSummaryOf(report, 100)).toBe('### visual-check 0.1.0 · test\n')
    expect(stepSummaryOf(report, 20)).toBe('')
  })

  it("gives nothing when even the part before the table doesn't fit", () => {
    const report = testReportWith([testEntryWith({ id: 'a', status: 'broken', reason: 'error', message: 'Boom.' })])

    expect(stepSummaryOf(report, 100)).toBe('')
    expect(stepSummaryOf(testReportWith([]), 10)).toBe('')
    expect(stepSummaryOf(testReportWith([]), -5)).toBe('')
  })
})

/**
 * A `console.error` with the text given and the severity, `fail` unless given.
 */
function loggedError(text: string, severity: 'fail' | 'warn' = 'fail'): ReportPageError {
  return { kind: 'console.error', text, severity }
}

describe('stepSummaryOf page errors', () => {
  it('counts the snapshots with page errors and the stale entries, and names the first of each, before the failures', () => {
    const report = testReportWith([
      testEntryWith({ id: 'a', status: 'passed', reason: null, flaky: true }),
      testEntryWith({
        id: 'b',
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
          loggedError('Second'),
        ],
      }),
      testEntryWith({ id: 'c', status: 'passed', reason: null, staleExpectedPageErrors: ['"Not raised"', '/x/'] }),
      testEntryWith({
        id: 'd',
        status: 'broken',
        reason: 'error',
        message: 'Boom.',
        pageErrors: [{ kind: 'error', text: 'Uncaught Error: boom\n    at a.tsx:1:1', severity: 'warn' }],
      }),
    ])

    expect(stepSummaryOf(report, roomy)).toBe(
      [
        '### visual-check 0.1.0 · test',
        '',
        '3 passed (1 flaky) · 1 broken',
        '',
        '**Flaky snapshots**',
        '',
        '- web · a',
        '',
        '**Page errors**',
        '',
        '2 snapshots with page errors, 1 of which fails the run · 2 stale expected page errors',
        '',
        '- web · b · dark: failed load http://localhost:6006/api/orders · HTTP 500',
        '- web · c: stale expected page error "Not raised"',
        '- web · d: uncaught error Uncaught Error: boom',
        '',
        '**Failures**',
        '',
        '| Storybook | Story | Mode | Status | Message |',
        '| --- | --- | --- | --- | --- |',
        '| web | d |  | broken | Boom. |',
        '',
      ].join('\n'),
    )
  })

  it.each([
    ['1 snapshot with page errors, which fails the run', [loggedError('A')]],
    ['1 snapshot with page errors', [loggedError('A', 'warn')]],
  ])('says %s', (counts, pageErrors) => {
    const report = testReportWith([testEntryWith({ id: 'a', status: 'passed', reason: null, pageErrors })])

    expect(stepSummaryOf(report, roomy)).toContain(`\n\n**Page errors**\n\n${counts}\n\n- web · a: console.error A\n`)
  })

  it('names the first 5 snapshots, then how many more there are', () => {
    const report = testReportWith(
      Array.from({ length: 7 }, (_, index) =>
        testEntryWith({ id: `s${index}`, status: 'passed', reason: null, pageErrors: [loggedError(`E${index}`)] }),
      ),
    )
    const lines = stepSummaryOf(report, roomy).split('\n')

    expect(lines).toContain('7 snapshots with page errors, which fail the run')
    expect(lines.filter((line) => line.startsWith('- '))).toEqual([
      '- web · s0: console.error E0',
      '- web · s1: console.error E1',
      '- web · s2: console.error E2',
      '- web · s3: console.error E3',
      '- web · s4: console.error E4',
      '- …and 2 more',
    ])
  })

  it("never says an update's page errors fail the run", () => {
    const report = updateReportWith(
      [updateEntryWith({ id: 'a', status: 'written', reason: 'missing', pageErrors: [loggedError('A')] })],
      { written: 1 },
    )

    expect(stepSummaryOf(report, roomy)).toBe(
      [
        '### visual-check 0.1.0 · update',
        '',
        '1 written',
        '',
        '**Page errors**',
        '',
        '1 snapshot with page errors',
        '',
        '- web · a: console.error A',
        '',
      ].join('\n'),
    )
  })

  it('escapes the names and the page error, so their markup shows as written', () => {
    const report = testReportWith([
      testEntryWith({
        storybook: '#web',
        id: 'a',
        story: '*a*',
        status: 'passed',
        reason: null,
        pageErrors: [loggedError('<b>|_x_ `y` [l](u)')],
      }),
    ])

    expect(stepSummaryOf(report, roomy)).toContain(
      '\n- \\#web · \\*a\\*: console.error &lt;b>\\|\\_x\\_ \\`y\\` \\[l\\](u)\n',
    )
  })

  it('counts in the part before the table that must fit', () => {
    const report = testReportWith([
      testEntryWith({ id: 'a', status: 'passed', reason: null, pageErrors: [loggedError('x'.repeat(400))] }),
      testEntryWith({ id: 'b', status: 'broken', reason: 'error', message: 'y'.repeat(500) }),
    ])
    const whole = stepSummaryOf(report, roomy)
    const head = whole.slice(0, whole.indexOf('\n| web |'))
    const cutNote =
      "\n\n_1 more failure isn't shown, to keep this summary under GitHub's 1 MiB. report.json lists them all._\n"
    const fitting = Buffer.byteLength(`${head}${cutNote}`, 'utf8') + 1

    expect(head).toContain('x'.repeat(400))
    expect(stepSummaryOf(report, fitting)).toBe(`${head}${cutNote}`)
    expect(stepSummaryOf(report, fitting - 1)).toBe('')
  })

  it("gives nothing when a passing run's page errors don't fit", () => {
    const report = testReportWith([
      testEntryWith({ id: 'a', status: 'passed', reason: null, pageErrors: [loggedError('x'.repeat(400))] }),
    ])
    const whole = stepSummaryOf(report, roomy)

    expect(stepSummaryOf(report, Buffer.byteLength(whole, 'utf8') + 1)).toBe(whole)
    expect(stepSummaryOf(report, Buffer.byteLength(whole, 'utf8'))).toBe('')
  })
})

describe('stepSummaryOf real network requests', () => {
  it('counts the snapshots with real network requests and names the first 5 with their hosts, after the page errors', () => {
    const report = testReportWith([
      testEntryWith({
        id: 'a',
        status: 'passed',
        reason: null,
        pageErrors: [loggedError('A')],
        realRequests: ['a.test', 'b.test', 'c.test', 'd.test'].map((host) => ({ host, severity: 'fail' as const })),
      }),
      ...Array.from({ length: 6 }, (_, index) =>
        testEntryWith({
          id: `s${index}`,
          mode: index === 0 ? 'dark' : null,
          status: 'passed',
          reason: null,
          realRequests: [{ host: `api${index}.test:8080`, severity: 'warn' }],
        }),
      ),
    ])

    expect(stepSummaryOf(report, roomy)).toBe(
      [
        '### visual-check 0.1.0 · test',
        '',
        '7 passed',
        '',
        '**Page errors**',
        '',
        '1 snapshot with page errors, which fails the run',
        '',
        '- web · a: console.error A',
        '',
        '**Real network requests**',
        '',
        '7 snapshots with real network requests, 1 of which fails the run',
        '',
        '- web · a: a.test, b.test, c.test, …',
        '- web · s0 · dark: api0.test:8080',
        '- web · s1: api1.test:8080',
        '- web · s2: api2.test:8080',
        '- web · s3: api3.test:8080',
        '- …and 2 more',
        '',
      ].join('\n'),
    )
  })

  it('gives no block when no snapshot has real network requests', () => {
    const report = testReportWith([testEntryWith({ id: 'a', status: 'passed', reason: null })])

    expect(stepSummaryOf(report, roomy)).not.toContain('Real network requests')
  })
})

describe('stepSummaryOf with a local update', () => {
  /**
   * The update of a project with a `visual:update` script, whose browser runs in Docker.
   */
  const scriptInDocker = { script: 'visual:update', docker: true }

  /**
   * A `test` report of one snapshot that differs.
   */
  const differing = testReportWith([
    testEntryWith({ id: 'a', status: 'differs', reason: 'pixels', message: '84 differ, 80 allowed' }),
  ])

  it('says how to update the baselines with the script, before the failures', () => {
    expect(stepSummaryOf(differing, roomy, scriptInDocker)).toBe(
      [
        '### visual-check 0.1.0 · test',
        '',
        '0 passed · 1 differs',
        '',
        'If the changes are intended, update the baselines on your machine: with Storybook running and Docker up, ' +
          'run the `visual:update` script, then commit the baselines it writes and deletes.',
        '',
        '**Failures**',
        '',
        '| Storybook | Story | Mode | Status | Message |',
        '| --- | --- | --- | --- | --- |',
        '| web | a |  | differs | 84 differ, 80 allowed |',
        '',
      ].join('\n'),
    )
  })

  it('names visual-check update when no script runs it', () => {
    expect(stepSummaryOf(differing, roomy, { script: undefined, docker: true })).toContain(
      '\n\nIf the changes are intended, update the baselines on your machine: with Storybook running and Docker up, ' +
        'run `visual-check update`, then commit the baselines it writes and deletes.\n\n**Failures**\n',
    )
  })

  it('leaves Docker out on the host platform', () => {
    expect(stepSummaryOf(differing, roomy, { script: 'visual:update', docker: false })).toContain(
      '\n\nIf the changes are intended, update the baselines on your machine: with Storybook running, ' +
        'run the `visual:update` script, then commit the baselines it writes and deletes.\n\n**Failures**\n',
    )
  })

  it('comes after the flaky snapshots', () => {
    const report = testReportWith([
      testEntryWith({ id: 'a', status: 'passed', reason: null, flaky: true }),
      testEntryWith({ id: 'b', status: 'missing', reason: null, message: 'No baseline yet.' }),
    ])

    expect(stepSummaryOf(report, roomy, scriptInDocker)).toMatch(
      /\n- web · a\n\nIf the changes are intended, [^\n]+\n\n\*\*Failures\*\*\n/,
    )
  })

  it.each([
    ['differs', testEntryWith({ id: 'a', status: 'differs', reason: 'pixels' })],
    ['missing', testEntryWith({ id: 'a', status: 'missing', reason: null })],
    ['orphan', testEntryWith({ id: 'a', story: null, status: 'orphan', reason: null })],
  ])('is there for a snapshot that is %s, alone or with a broken story', (_, entry) => {
    const report = testReportWith([entry, testEntryWith({ id: 'b', status: 'broken', reason: 'error' })])

    expect(stepSummaryOf(testReportWith([entry]), roomy, scriptInDocker)).toContain('If the changes are intended')
    expect(stepSummaryOf(report, roomy, scriptInDocker)).toContain('If the changes are intended')
  })

  it.each([
    [
      'a test whose only failures are broken stories',
      testReportWith([testEntryWith({ id: 'a', status: 'broken', reason: 'error', message: 'Boom.' })]),
    ],
    [
      'an update',
      updateReportWith([updateEntryWith({ id: 'a', status: 'broken', reason: 'error', message: 'Boom.' })], {
        broken: 1,
      }),
    ],
    ['a run that exited 2', testReportWith([], { exitCode: 2, error: { message: 'Boom.', storybooks: [] } })],
  ])('is left out of %s', (_, report) => {
    expect(stepSummaryOf(report, roomy, scriptInDocker)).toBe(stepSummaryOf(report, roomy))
    expect(stepSummaryOf(report, roomy, scriptInDocker)).not.toContain('If the changes are intended')
  })

  it('is left out with no local update given', () => {
    expect(stepSummaryOf(differing, roomy)).not.toContain('If the changes are intended')
  })

  it('counts in the part before the table that must fit', () => {
    const report = testReportWith([
      testEntryWith({ id: 'a', status: 'differs', reason: 'pixels', message: 'x'.repeat(500) }),
    ])
    const whole = stepSummaryOf(report, roomy, scriptInDocker)
    const head = whole.slice(0, whole.indexOf('\n| web |'))
    const cutNote =
      "\n\n_1 more failure isn't shown, to keep this summary under GitHub's 1 MiB. report.json lists them all._\n"
    const fitting = Buffer.byteLength(`${head}${cutNote}`, 'utf8') + 1

    expect(head).toContain('If the changes are intended')
    expect(stepSummaryOf(report, fitting, scriptInDocker)).toBe(`${head}${cutNote}`)
    expect(stepSummaryOf(report, fitting - 1, scriptInDocker)).toBe('')
  })
})

describe('appendStepSummary', () => {
  it("creates the file when it doesn't exist", async () => {
    const path = join(temporaryFolder(), 'summary.md')

    await appendStepSummary(path, testReportWith([]))

    expect(readFileSync(path, 'utf8')).toBe('### visual-check 0.1.0 · test\n\n0 passed\n')
  })

  it('appends after what the file holds, a blank line apart, so its heading is one', async () => {
    const path = join(temporaryFolder(), 'summary.md')

    writeFileSync(path, 'Earlier text')
    await appendStepSummary(path, testReportWith([]))

    expect(readFileSync(path, 'utf8')).toBe('Earlier text\n\n### visual-check 0.1.0 · test\n\n0 passed\n')
  })

  it('counts the blank line in the budget', async () => {
    const path = join(temporaryFolder(), 'summary.md')
    const summary = '### visual-check 0.1.0 · test\n\n0 passed\n'
    const existingBytes = 1024 * 1024 - 1024 - Buffer.byteLength(summary, 'utf8') - 2

    writeFileSync(path, 'x'.repeat(existingBytes))
    await appendStepSummary(path, testReportWith([]))

    // The summary alone would fit, but not after the blank line.
    expect(statSync(path).size).toBe(existingBytes)

    writeFileSync(path, 'x'.repeat(existingBytes - 1))
    await appendStepSummary(path, testReportWith([]))

    expect(statSync(path).size).toBe(existingBytes - 1 + 2 + Buffer.byteLength(summary, 'utf8'))
    expect(statSync(path).size).toBeLessThan(1024 * 1024 - 1024)
  })

  it('keeps the file under 1 MiB, leaving 1 KiB for the Action, counting what it holds', async () => {
    const path = join(temporaryFolder(), 'summary.md')
    const entries = Array.from({ length: 1000 }, (_, index) =>
      testEntryWith({ id: `story-${index}`, status: 'broken', reason: 'error', message: 'Boom.' }),
    )

    writeFileSync(path, 'x'.repeat(1024 * 1024 - 4096))
    await appendStepSummary(path, testReportWith(entries))

    const size = statSync(path).size

    expect(size).toBeGreaterThan(1024 * 1024 - 4096)
    expect(size).toBeLessThan(1024 * 1024 - 1024)
    expect(readFileSync(path, 'utf8')).toMatch(/more failures aren't shown/)
  })

  it('leaves the file as it is when no summary fits', async () => {
    const path = join(temporaryFolder(), 'summary.md')

    writeFileSync(path, 'x'.repeat(1024 * 1024))
    await appendStepSummary(path, testReportWith([]))

    expect(statSync(path).size).toBe(1024 * 1024)
  })

  it("throws a StepSummaryError with the reason when the file can't be written", async () => {
    const folder = temporaryFolder()
    const path = join(folder, 'missing', 'summary.md')
    const error = await appendStepSummary(path, testReportWith([])).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(StepSummaryError)
    expect(error).toMatchObject({ path, reason: 'ENOENT: no such file or directory' })
  })

  it('throws a StepSummaryError when the path is a folder', async () => {
    const path = join(temporaryFolder(), 'summary')

    mkdirSync(path)

    await expect(appendStepSummary(path, testReportWith([]))).rejects.toMatchObject({
      name: 'StepSummaryError',
      path,
      reason: 'EISDIR: illegal operation on a directory',
    })
  })
})
