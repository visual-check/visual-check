import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyTestCounts, reportJsonOf, testReportOf } from '../report/report-document.js'
import { cliOutputOf, documentOutputOf, reportLineOf } from './run-output.js'

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

describe('cliOutputOf', () => {
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
  const result = { stdout: '✓ web  a  passed\n', stderr: 'warning\n' }
  const line = 'Report: .visual-check/report/report.json'

  it.each([undefined, 'live', 'log'] as const)(
    'keeps both streams and gives the report line for stdout, after stderr, for reporter %s',
    (reporter) => {
      expect(cliOutputOf(result, report, reporter, line)).toEqual({
        stdout: '✓ web  a  passed\n',
        stderr: 'warning\n',
        reportLine: { stream: 'stdout', text: line },
      })
    },
  )

  it('puts only the document on stdout for json, the human lines then the rest on stderr, and the report line for stderr', () => {
    expect(cliOutputOf(result, report, 'json', line)).toEqual({
      stdout: `${reportJsonOf(report)}\n`,
      stderr: '✓ web  a  passed\nwarning\n',
      reportLine: { stream: 'stderr', text: line },
    })
  })
})

describe('documentOutputOf', () => {
  const report = testReportOf({
    visualCheck: '0.1.0',
    consistencyOnly: false,
    exitCode: 2,
    shard: null,
    selection: { by: 'all', base: null, changedFiles: null, fallback: null },
    reportDir: '.visual-check/report',
    storybooks: [],
    counts: emptyTestCounts(),
    snapshots: [],
    error: { message: 'Boom.', storybooks: [] },
  })
  const result = { stdout: '✓ web  a  passed\n', stderr: 'Boom.\n' }
  const line = 'Report: .visual-check/report/report.json'

  it.each([undefined, 'live', 'log'] as const)(
    'keeps both streams and gives the report line for stderr for reporter %s',
    (reporter) => {
      expect(documentOutputOf(result, report, reporter, line)).toEqual({
        stdout: '✓ web  a  passed\n',
        stderr: 'Boom.\n',
        reportLine: { stream: 'stderr', text: line },
      })
    },
  )

  it('gives no report line when no report was written', () => {
    expect(documentOutputOf(result, report, 'log', undefined)).toEqual({
      stdout: '✓ web  a  passed\n',
      stderr: 'Boom.\n',
    })
  })

  it('puts only the document on stdout for json, and the human lines on stderr before the rest', () => {
    expect(documentOutputOf(result, report, 'json', undefined)).toEqual({
      stdout: `${reportJsonOf(report)}\n`,
      stderr: '✓ web  a  passed\nBoom.\n',
    })
  })
})
