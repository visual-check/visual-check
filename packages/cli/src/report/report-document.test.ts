import { describe, expect, it } from 'vitest'
import {
  emptyTestCounts,
  emptyUpdateCounts,
  reportImagePathOf,
  reportJsonOf,
  testReportOf,
  updateReportOf,
} from './report-document.js'

const selection = { by: 'all', base: null, changedFiles: null, fallback: null } as const
const storybooks = [{ name: 'web', url: 'http://localhost:6006' }]

describe('testReportOf', () => {
  const report = testReportOf({
    visualCheck: '0.1.0',
    consistencyOnly: false,
    exitCode: 1,
    shard: { index: 1, total: 2 },
    selection,
    reportDir: '.visual-check/report',
    storybooks,
    counts: emptyTestCounts(),
    snapshots: [],
    error: null,
  })

  it('builds the keys in the order of the document', () => {
    expect(Object.keys(report)).toEqual([
      'version',
      'visualCheck',
      'command',
      'consistencyOnly',
      'exitCode',
      'shard',
      'selection',
      'reportDir',
      'storybooks',
      'counts',
      'snapshots',
      'warnings',
      'error',
    ])
  })

  it('fills the version, the command and no warnings', () => {
    expect(report).toMatchObject({ version: 1, command: 'test', warnings: [] })
  })

  it('keeps the counts in the order of the document', () => {
    expect(Object.keys(report.counts)).toEqual(['passed', 'flaky', 'differs', 'broken', 'missing', 'orphan'])
  })
})

describe('updateReportOf', () => {
  const report = updateReportOf({
    visualCheck: '0.1.0',
    exitCode: 0,
    selection,
    storybooks,
    counts: emptyUpdateCounts(),
    snapshots: [],
    warnings: [],
    error: null,
  })

  it('builds the keys in the order of the document', () => {
    expect(Object.keys(report)).toEqual([
      'version',
      'visualCheck',
      'command',
      'consistencyOnly',
      'exitCode',
      'shard',
      'selection',
      'reportDir',
      'storybooks',
      'counts',
      'snapshots',
      'warnings',
      'error',
    ])
  })

  it('fills the version, the command and the fields update leaves out', () => {
    expect(report).toMatchObject({
      version: 1,
      command: 'update',
      consistencyOnly: false,
      shard: null,
      reportDir: null,
    })
  })

  it('keeps the counts in the order of the document', () => {
    expect(Object.keys(report.counts)).toEqual(['written', 'deleted', 'kept', 'broken', 'flaky'])
  })
})

describe('reportJsonOf', () => {
  it('prints one minified document', () => {
    const report = updateReportOf({
      visualCheck: '0.1.0',
      exitCode: 0,
      selection,
      storybooks,
      counts: emptyUpdateCounts(),
      snapshots: [],
      warnings: [],
      error: null,
    })

    expect(reportJsonOf(report)).toBe(JSON.stringify(report))
    expect(reportJsonOf(report)).not.toMatch(/\n| {2}|: /u)
  })
})

describe('reportImagePathOf', () => {
  it('gives a path with / in the Storybook folder', () => {
    expect(reportImagePathOf('web', 'a.dark', 'diff')).toBe('images/web/a.dark.diff.png')
  })
})
