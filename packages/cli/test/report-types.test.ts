import { describe, expectTypeOf, it } from 'vitest'
import type {
  Report,
  ReportBrokenReason,
  ReportConsoleLevel,
  ReportDiffReason,
  ReportHint,
  ReportPageError,
  ReportPixels,
  ReportRealRequest,
  ReportSelection,
  TestReport,
  TestReportCounts,
  TestReportEntry,
  UpdateReport,
  UpdateReportCounts,
  UpdateReportEntry,
} from '../src/index.js'

describe('the report types exported from the package entry', () => {
  it('pins the version and the command literals', () => {
    expectTypeOf<TestReport['version']>().toEqualTypeOf<1>()
    expectTypeOf<UpdateReport['version']>().toEqualTypeOf<1>()
    expectTypeOf<TestReport['command']>().toEqualTypeOf<'test'>()
    expectTypeOf<UpdateReport['command']>().toEqualTypeOf<'update'>()
  })

  it('has the document fields of the spec, no more and no fewer', () => {
    expectTypeOf<keyof TestReport>().toEqualTypeOf<
      | 'version'
      | 'visualCheck'
      | 'command'
      | 'consistencyOnly'
      | 'exitCode'
      | 'shard'
      | 'selection'
      | 'reportDir'
      | 'storybooks'
      | 'counts'
      | 'snapshots'
      | 'warnings'
      | 'error'
    >()
    expectTypeOf<keyof UpdateReport>().toEqualTypeOf<keyof TestReport>()
  })

  it('has the entry fields of the spec, test adds its real network requests and update the two host lists', () => {
    expectTypeOf<keyof TestReportEntry>().toEqualTypeOf<
      | 'storybook'
      | 'id'
      | 'kind'
      | 'story'
      | 'importPath'
      | 'mode'
      | 'status'
      | 'reason'
      | 'message'
      | 'flaky'
      | 'attempts'
      | 'pixels'
      | 'size'
      | 'details'
      | 'hints'
      | 'console'
      | 'pageErrors'
      | 'staleExpectedPageErrors'
      | 'baseline'
      | 'images'
      | 'realRequests'
    >()
    expectTypeOf<Exclude<keyof UpdateReportEntry, keyof TestReportEntry>>().toEqualTypeOf<
      'realRequestHosts' | 'remoteContentHosts'
    >()
    expectTypeOf<Exclude<keyof TestReportEntry, keyof UpdateReportEntry>>().toEqualTypeOf<'realRequests'>()
  })

  it('lists the statuses and reasons of the spec', () => {
    expectTypeOf<TestReportEntry['status']>().toEqualTypeOf<'passed' | 'differs' | 'broken' | 'missing' | 'orphan'>()
    expectTypeOf<UpdateReportEntry['status']>().toEqualTypeOf<'written' | 'deleted' | 'broken'>()
    expectTypeOf<ReportDiffReason>().toEqualTypeOf<'pixels' | 'size'>()
    expectTypeOf<ReportConsoleLevel>().toEqualTypeOf<'debug' | 'info' | 'log' | 'warn' | 'error'>()
    expectTypeOf<ReportHint['kind']>().toEqualTypeOf<'remote-content' | 'failed-loads'>()
    expectTypeOf<Extract<TestReportEntry, { status: 'differs' }>['reason']>().toEqualTypeOf<ReportDiffReason>()
    expectTypeOf<Extract<TestReportEntry, { status: 'broken' }>['reason']>().toEqualTypeOf<ReportBrokenReason>()
    expectTypeOf<Extract<UpdateReportEntry, { status: 'written' }>['reason']>().toEqualTypeOf<'missing' | 'differs'>()
  })

  it('has the counts of the spec', () => {
    expectTypeOf<keyof TestReportCounts>().toEqualTypeOf<
      'passed' | 'flaky' | 'differs' | 'broken' | 'missing' | 'orphan'
    >()
    expectTypeOf<keyof UpdateReportCounts>().toEqualTypeOf<'written' | 'deleted' | 'kept' | 'broken' | 'flaky'>()
    expectTypeOf<TestReport['counts']>().toEqualTypeOf<TestReportCounts>()
    expectTypeOf<UpdateReport['counts']>().toEqualTypeOf<UpdateReportCounts>()
  })

  it('says how the stories were picked, with the base, the count of changed files and why it fell back', () => {
    expectTypeOf<ReportSelection>().toEqualTypeOf<{
      by: 'affected' | 'all' | 'filter'
      base: string | null
      changedFiles: number | null
      fallback: string | null
    }>()
    expectTypeOf<TestReport['selection']>().toEqualTypeOf<ReportSelection>()
  })

  it('lists page errors by kind and severity, and stale expected page errors as written', () => {
    expectTypeOf<ReportPageError>().toEqualTypeOf<{
      kind: 'console.error' | 'error' | 'unhandledrejection' | 'load'
      text: string
      loadError?: string
      severity: 'fail' | 'warn'
    }>()
    expectTypeOf<TestReportEntry['pageErrors']>().toEqualTypeOf<ReportPageError[]>()
    expectTypeOf<UpdateReportEntry['staleExpectedPageErrors']>().toEqualTypeOf<string[]>()
  })

  it("lists a test entry's real network requests by host and severity", () => {
    expectTypeOf<ReportRealRequest>().toEqualTypeOf<{ host: string; severity: 'fail' | 'warn' }>()
    expectTypeOf<TestReportEntry['realRequests']>().toEqualTypeOf<ReportRealRequest[]>()
  })

  it('writes the budget as a count or a percentage', () => {
    expectTypeOf<ReportPixels['budget']>().toEqualTypeOf<number | `${number}%`>()
  })

  it('makes Report the union of both documents', () => {
    expectTypeOf<Report>().toEqualTypeOf<TestReport | UpdateReport>()
    expectTypeOf<Report['command']>().toEqualTypeOf<'test' | 'update'>()
  })
})
