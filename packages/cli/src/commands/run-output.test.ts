import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyTestCounts, reportJsonOf, testReportOf } from '../report/report-document.js'
import { reportLineOf, runOutputOf } from './run-output.js'

describe('reportLineOf', () => {
  it("gives report.json's path relative to the cwd, with /", () => {
    const project = join('/', 'project')
    const folder = join(project, '.visual-check', 'report')

    expect(reportLineOf(project, folder)).toBe('Report: .visual-check/report/report.json')
    expect(reportLineOf(join(project, 'packages', 'web'), folder)).toBe(
      'Report: ../../.visual-check/report/report.json',
    )
  })
})

describe('runOutputOf', () => {
  const report = testReportOf({
    visualCheck: '0.1.0',
    consistencyOnly: false,
    exitCode: 0,
    shard: null,
    selection: { by: 'all', base: null, changedFiles: null, fallback: null },
    reportDir: '.visual-check/report',
    storybooks: [{ name: 'web', url: 'http://localhost:6006' }],
    counts: emptyTestCounts(),
    snapshots: [],
    error: null,
  })
  const output = { stdout: '✓ web  a  passed\n', stderr: 'warning\n' }
  const text = 'Report: .visual-check/report/report.json'

  it.each([undefined, 'live', 'log'] as const)(
    'keeps both streams, the report line on the stream given and the report for reporter %s',
    (reporter) => {
      expect(runOutputOf(output, report, reporter, { stream: 'stdout', text })).toEqual({
        ...output,
        reportLine: { stream: 'stdout', text },
        report,
      })
      expect(runOutputOf(output, report, reporter, { stream: 'stderr', text })).toEqual({
        ...output,
        reportLine: { stream: 'stderr', text },
        report,
      })
    },
  )

  it.each(['stdout', 'stderr'] as const)(
    'puts the document alone on stdout for json, the human lines then the rest on stderr, and the report line given for %s on stderr',
    (stream) => {
      expect(runOutputOf(output, report, 'json', { stream, text })).toEqual({
        stdout: `${reportJsonOf(report)}\n`,
        stderr: '✓ web  a  passed\nwarning\n',
        reportLine: { stream: 'stderr', text },
        report,
      })
    },
  )

  it.each([undefined, 'json'] as const)(
    'gives no report line when no report was written, for reporter %s',
    (reporter) => {
      expect(runOutputOf(output, report, reporter, undefined).reportLine).toBeUndefined()
    },
  )

  it('gives only the streams and the report, whatever else the output it is given holds', () => {
    expect(runOutputOf({ ...output, message: 'Boom.' } as typeof output, report, 'log', undefined)).toEqual({
      ...output,
      report,
    })
  })
})
