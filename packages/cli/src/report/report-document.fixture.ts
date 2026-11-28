import {
  type ReportEntryFields,
  reportDir,
  reportVersion,
  type TestReport,
  type TestReportCounts,
  type TestReportEntry,
} from './report-document.js'

/**
 * The status and reason of each kind of `test` entry, kept together so a status only takes its own reasons.
 */
type TestEntryStatus = TestReportEntry extends infer Entry
  ? Entry extends TestReportEntry
    ? Pick<Entry, 'status' | 'reason'>
    : never
  : never

/**
 * Builds a `test` report's entry with its status and reason, and the fields given. Every other field has a default: the
 * `web` Storybook, the ID `a`, a story of the same ID in `./button.stories.tsx`, no mode, no message, one capture, no
 * comparison, details, hints, console messages, page errors, stale expected page errors or images, and the baseline
 * `.visual-check/baselines/<id>.png`.
 *
 * @public
 */
export function testEntryWith(fields: Partial<ReportEntryFields> & TestEntryStatus): TestReportEntry {
  const id = fields.id ?? 'a'

  return {
    storybook: 'web',
    id,
    kind: 'story',
    story: id,
    importPath: './button.stories.tsx',
    mode: null,
    message: '',
    flaky: false,
    attempts: 1,
    pixels: null,
    size: null,
    details: null,
    hints: [],
    console: [],
    pageErrors: [],
    staleExpectedPageErrors: [],
    baseline: `.visual-check/baselines/${id}.png`,
    images: { baseline: null, snapshot: null, diff: null, compared: null },
    ...fields,
  }
}

/**
 * Counts a `test` report's entries by status, the flaky passes too.
 */
function testCountsOf(entries: readonly TestReportEntry[]): TestReportCounts {
  const countOf = (status: TestReportEntry['status']): number =>
    entries.filter((entry) => entry.status === status).length

  return {
    passed: countOf('passed'),
    flaky: entries.filter((entry) => entry.status === 'passed' && entry.flaky).length,
    differs: countOf('differs'),
    broken: countOf('broken'),
    missing: countOf('missing'),
    orphan: countOf('orphan'),
  }
}

/**
 * Builds a finished `test` report of the `web` Storybook holding the entries, its counts worked out from them, with the
 * fields in `overrides` given instead.
 *
 * @public
 */
export function testReportWith(entries: TestReportEntry[], overrides: Partial<TestReport> = {}): TestReport {
  return {
    version: reportVersion,
    visualCheck: '0.1.0',
    command: 'test',
    consistencyOnly: false,
    exitCode: entries.some((entry) => entry.status !== 'passed') ? 1 : 0,
    shard: null,
    selection: { by: 'all', base: null, changedFiles: null, fallback: null },
    reportDir,
    storybooks: [{ name: 'web', url: 'http://localhost:6006' }],
    counts: testCountsOf(entries),
    snapshots: entries,
    warnings: [],
    error: null,
    ...overrides,
  }
}
