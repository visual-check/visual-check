import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import type { StorybookBaselines } from './consistency-check.js'
import type { SnapshotToCapture } from './plan-snapshots.js'
import {
  type RunFindings,
  reportSelectionOf,
  type TestErrorReportFacts,
  type TestReportFacts,
  testErrorReportOf,
  testReportFor,
  type UpdateReportFacts,
  updateErrorReportOf,
  updateReportFor,
} from './run-report.js'
import { missingResultOf, type SnapshotResult } from './snapshot-result.js'

const folders: string[] = []

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

/**
 * Makes a project folder with a baselines folder, removed after the test.
 */
function projectFolder(): { project: string; storybook: ResolvedStorybook } {
  const project = mkdtempSync(join(tmpdir(), 'visual-check-run-report-'))

  folders.push(project)
  mkdirSync(join(project, 'baselines'))

  return {
    project,
    storybook: {
      name: 'web',
      dir: project,
      configDir: join(project, '.storybook'),
      baselines: join(project, 'baselines'),
      url: 'http://web.test',
    },
  }
}

function itemOf(storybook: ResolvedStorybook, id: string): SnapshotToCapture {
  return {
    storybook,
    story: { id, title: 'Button', name: id, importPath: './button.stories.tsx' },
    mode: undefined,
    key: id,
    selected: true,
    options: {},
    tolerance: { color: 0.01, pixels: 20 },
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1, touch: false },
    globals: {},
  }
}

const passed: SnapshotResult = { status: 'passed', detail: '12 ms', attempts: 1, gatheredPageErrors: [] }

const missing: SnapshotResult = { ...missingResultOf(), gatheredPageErrors: [] }

function factsOf(project: string, storybook: ResolvedStorybook, findings: RunFindings): TestReportFacts {
  return {
    version: '1.2.3',
    configPath: join(project, 'visual-check.config.mjs'),
    consistencyOnly: false,
    shard: undefined,
    selection: { by: 'all', base: null, changedFiles: null, fallback: null },
    storybooks: [storybook],
    exitCode: 1,
    findings,
  }
}

function noOrphans(storybook: ResolvedStorybook): StorybookBaselines[] {
  return [{ storybook, paths: [], orphans: [], expected: [] }]
}

/**
 * Gives findings with no deleted baseline and no warning.
 */
function findingsOf(findings: Pick<RunFindings, 'items' | 'results' | 'baselines'>): RunFindings {
  return { ...findings, deleted: [], warnings: [] }
}

describe('testReportFor', () => {
  it('counts plain passes without listing them, and lists the rest in planned order', async () => {
    const { project, storybook } = projectFolder()
    const report = await testReportFor(
      factsOf(
        project,
        storybook,
        findingsOf({
          items: [itemOf(storybook, 'a'), itemOf(storybook, 'b'), itemOf(storybook, 'c')],
          results: [passed, missing, undefined],
          baselines: noOrphans(storybook),
        }),
      ),
    )

    expect(report).toMatchObject({
      version: 1,
      visualCheck: '1.2.3',
      command: 'test',
      consistencyOnly: false,
      exitCode: 1,
      shard: null,
      selection: { by: 'all', base: null, changedFiles: null, fallback: null },
      reportDir: '.visual-check/report',
      storybooks: [{ name: 'web', url: 'http://web.test' }],
      counts: { passed: 1, flaky: 0, differs: 0, broken: 0, missing: 1, orphan: 0 },
      warnings: [],
      error: null,
    })
    expect(report.storybooks[0]).toEqual({ name: 'web', url: 'http://web.test' })
    expect(report.snapshots.map(({ id, status }) => [id, status])).toEqual([['b', 'missing']])
    expect(report.snapshots[0]).toMatchObject({ baseline: 'baselines/b.png', attempts: 0 })
  })

  it('lists each orphan after the snapshots, with its baseline copied into the report folder', async () => {
    const { project, storybook } = projectFolder()
    const orphan = join(storybook.baselines, 'gone.png')

    writeFileSync(orphan, 'old bytes')

    const report = await testReportFor(
      factsOf(
        project,
        storybook,
        findingsOf({
          items: [itemOf(storybook, 'a')],
          results: [missing],
          baselines: [{ storybook, paths: [orphan], orphans: [orphan], expected: [] }],
        }),
      ),
    )

    expect(report.counts).toEqual({ passed: 0, flaky: 0, differs: 0, broken: 0, missing: 1, orphan: 1 })
    expect(report.snapshots.map(({ id, status }) => [id, status])).toEqual([
      ['a', 'missing'],
      ['gone', 'orphan'],
    ])
    expect(report.snapshots[1]?.images).toEqual({
      baseline: 'images/web/gone.baseline.png',
      snapshot: null,
      diff: null,
    })
    expect(readFileSync(join(project, '.visual-check', 'report', 'images', 'web', 'gone.baseline.png'), 'utf8')).toBe(
      'old bytes',
    )
  })

  it('names a shard and a consistency-only run', async () => {
    const { project, storybook } = projectFolder()
    const report = await testReportFor({
      ...factsOf(project, storybook, findingsOf({ items: [], results: [], baselines: [] })),
      consistencyOnly: true,
      shard: { index: 2, total: 3 },
      exitCode: 0,
    })

    expect(report).toMatchObject({ consistencyOnly: true, shard: { index: 2, total: 3 }, exitCode: 0, snapshots: [] })
  })
})

describe('reportSelectionOf', () => {
  it('gives what picked the stories, knowing nothing of a base, changed files or a fallback', () => {
    const unknown = { base: null, changedFiles: null, fallback: null }

    expect(reportSelectionOf({ kind: 'default' })).toEqual({ by: 'all', ...unknown })
    expect(reportSelectionOf({ kind: 'all' })).toEqual({ by: 'all', ...unknown })
    expect(reportSelectionOf({ kind: 'affected' })).toEqual({ by: 'affected', ...unknown })
    expect(reportSelectionOf({ kind: 'filter', pattern: /button/ })).toEqual({ by: 'filter', ...unknown })
  })
})

/**
 * What an error report of a run that stopped at an unreachable Storybook is built from.
 */
const errorFacts: TestErrorReportFacts = {
  version: '1.2.3',
  consistencyOnly: false,
  shard: { index: 2, total: 3 },
  selection: { by: 'filter', base: null, changedFiles: null, fallback: null },
  storybooks: [
    { name: 'docs', url: 'http://docs.test' },
    { name: 'web', url: 'http://web.test' },
  ],
  message:
    '\nNothing answers at http://web.test/index.json.\nTo check one Storybook on its own, pass --storybook <name>.\n',
  unreachable: [{ name: 'web', url: 'http://web.test' }],
  written: true,
}

describe('testErrorReportOf', () => {
  it('holds the error, trimmed, with the unreachable Storybooks, and no results', () => {
    expect(testErrorReportOf(errorFacts)).toEqual({
      version: 1,
      visualCheck: '1.2.3',
      command: 'test',
      consistencyOnly: false,
      exitCode: 2,
      shard: { index: 2, total: 3 },
      selection: { by: 'filter', base: null, changedFiles: null, fallback: null },
      reportDir: '.visual-check/report',
      storybooks: [
        { name: 'docs', url: 'http://docs.test' },
        { name: 'web', url: 'http://web.test' },
      ],
      counts: { passed: 0, flaky: 0, differs: 0, broken: 0, missing: 0, orphan: 0 },
      snapshots: [],
      warnings: [],
      error: {
        message:
          'Nothing answers at http://web.test/index.json.\nTo check one Storybook on its own, pass --storybook <name>.',
        storybooks: [{ name: 'web', url: 'http://web.test' }],
      },
    })
  })

  it("gives no report folder when the report isn't written", () => {
    expect(testErrorReportOf({ ...errorFacts, shard: undefined, written: false })).toMatchObject({
      shard: null,
      reportDir: null,
    })
  })
})

/**
 * A storybook of an `update` run whose config is in `/project`, with its baselines in `/project/baselines`.
 */
const updateStorybook: ResolvedStorybook = {
  name: 'web',
  dir: '/project',
  configDir: '/project/.storybook',
  baselines: '/project/baselines',
  url: 'http://web.test',
}

/**
 * What an `update` report is built from, with the given findings.
 */
function updateFactsOf(findings: Partial<RunFindings>): UpdateReportFacts {
  return {
    version: '1.2.3',
    configPath: '/project/visual-check.config.mjs',
    selection: { by: 'all', base: null, changedFiles: null, fallback: null },
    storybooks: [updateStorybook],
    exitCode: 1,
    findings: { items: [], results: [], baselines: [], deleted: [], warnings: [], ...findings },
  }
}

describe('updateReportFor', () => {
  const hosts = { requests: ['api.test'], remoteContent: ['cdn.test'] }
  const written: SnapshotResult = {
    status: 'written',
    detail: '',
    attempts: 2,
    gatheredPageErrors: [],
    writtenFor: 'missing',
    hosts,
  }
  const kept: SnapshotResult = {
    status: 'kept',
    detail: 'kept · flaky',
    attempts: 2,
    gatheredPageErrors: [],
    flaky: true,
    hosts,
  }
  const broken: SnapshotResult = {
    status: 'broken',
    detail: '',
    attempts: 3,
    gatheredPageErrors: [],
    broken: { reason: 'unstable', message: "No two of the story's 3 loads agreed." },
  }

  it('lists the written and broken snapshots in planned order, then the deleted baselines, leaving out kept ones', () => {
    const warning = {
      kind: 'real-requests' as const,
      host: 'api.test',
      stories: [{ storybook: 'web', story: 'a' }],
      message: 'api.test: 1 story (a).',
    }
    const report = updateReportFor(
      updateFactsOf({
        items: ['a', 'b', 'c', 'd'].map((id) => itemOf(updateStorybook, id)),
        results: [broken, kept, written, undefined],
        deleted: [{ storybook: updateStorybook, path: '/project/baselines/gone.png' }],
        warnings: [warning],
      }),
    )

    expect(report).toMatchObject({
      version: 1,
      visualCheck: '1.2.3',
      command: 'update',
      consistencyOnly: false,
      exitCode: 1,
      shard: null,
      selection: { by: 'all', base: null, changedFiles: null, fallback: null },
      reportDir: null,
      storybooks: [{ name: 'web', url: 'http://web.test' }],
      counts: { written: 1, deleted: 1, kept: 1, broken: 1, flaky: 1 },
      warnings: [warning],
      error: null,
    })
    expect(report.storybooks[0]).toEqual({ name: 'web', url: 'http://web.test' })
    expect(report.snapshots.map(({ id, status, reason }) => [id, status, reason])).toEqual([
      ['a', 'broken', 'unstable'],
      ['c', 'written', 'missing'],
      ['gone', 'deleted', null],
    ])
    expect(report.snapshots[1]).toMatchObject({
      baseline: 'baselines/c.png',
      realRequestHosts: ['api.test'],
      remoteContentHosts: ['cdn.test'],
    })
    expect(report.snapshots[2]).toMatchObject({ baseline: 'baselines/gone.png', story: null })
  })

  it('gives empty counts and no entries when nothing was taken', () => {
    expect(updateReportFor({ ...updateFactsOf({}), exitCode: 0 })).toMatchObject({
      exitCode: 0,
      counts: { written: 0, deleted: 0, kept: 0, broken: 0, flaky: 0 },
      snapshots: [],
      warnings: [],
    })
  })
})

describe('updateErrorReportOf', () => {
  it('holds the error, trimmed, with the unreachable Storybooks, no results and no report folder', () => {
    expect(
      updateErrorReportOf({
        version: errorFacts.version,
        selection: errorFacts.selection,
        storybooks: errorFacts.storybooks,
        message: errorFacts.message,
        unreachable: errorFacts.unreachable,
      }),
    ).toEqual({
      version: 1,
      visualCheck: '1.2.3',
      command: 'update',
      consistencyOnly: false,
      exitCode: 2,
      shard: null,
      selection: { by: 'filter', base: null, changedFiles: null, fallback: null },
      reportDir: null,
      storybooks: [
        { name: 'docs', url: 'http://docs.test' },
        { name: 'web', url: 'http://web.test' },
      ],
      counts: { written: 0, deleted: 0, kept: 0, broken: 0, flaky: 0 },
      snapshots: [],
      warnings: [],
      error: {
        message:
          'Nothing answers at http://web.test/index.json.\nTo check one Storybook on its own, pass --storybook <name>.',
        storybooks: [{ name: 'web', url: 'http://web.test' }],
      },
    })
  })
})
