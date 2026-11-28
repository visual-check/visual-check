import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { PageError } from '../capture/driver/driver.js'
import type { TestReport, UpdateReport } from '../report/report-document.js'
import {
  cleanUpRuns,
  createRun,
  defaultRunSnapshot,
  fakeBrowser,
  removeMarkerFolder,
  reportFolderIn,
} from './run-cli.fixture.js'
import { runCli } from './run-cli.js'

afterEach(cleanUpRuns)
afterAll(removeMarkerFolder)

/**
 * Reads the `report.json` of the report folder beside the project's config.
 */
function readReport(project: string): TestReport {
  return JSON.parse(readFileSync(join(reportFolderIn(project), 'report.json'), 'utf8')) as TestReport
}

/**
 * A `console.error` a story's page logged.
 */
const logged: PageError = { kind: 'console.error', text: 'TypeError: Failed to fetch' }

/**
 * An uncaught error a story's page raised.
 */
const thrown: PageError = { kind: 'error', text: 'Uncaught Error: Request timeout' }

/**
 * A load from the story's Storybook, at `url`, that got an HTTP 500.
 */
function failedLoadAt(url: string): PageError {
  return { kind: 'load', text: `${url}/api/orders?page=2`, loadError: 'HTTP 500' }
}

describe('runCli page errors', () => {
  it('fails test on a passed snapshot whose page logged a console.error, keeping it passed', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot })
    const result = await runCli(['test', '--all'], {}, project, fakeBrowser({ a: { pageErrors: [logged] } }).options)
    const report = readReport(project)

    expect(result.exitCode).toBe(1)
    expect(report.exitCode).toBe(1)
    expect(report.counts).toEqual({ passed: 2, flaky: 0, differs: 0, broken: 0, missing: 0, orphan: 0 })
    expect(report.snapshots).toHaveLength(1)
    expect(report.snapshots[0]).toMatchObject({
      id: 'a',
      status: 'passed',
      reason: null,
      message: 'Passed.',
      pageErrors: [{ kind: 'console.error', text: 'TypeError: Failed to fetch', severity: 'fail' }],
      staleExpectedPageErrors: [],
    })
  })

  it("lists page errors as warnings and exits 0 with the config's pageErrors: 'warn'", async () => {
    const { project, url } = await createRun(['a'], { a: defaultRunSnapshot }, "pageErrors: 'warn',")
    const { options } = fakeBrowser({ a: { pageErrors: [thrown, failedLoadAt(url)] } })
    const result = await runCli(['test', '--all'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(readReport(project).snapshots.map(({ id, status, pageErrors }) => [id, status, pageErrors])).toEqual([
      [
        'a',
        'passed',
        [
          { kind: 'error', text: 'Uncaught Error: Request timeout', severity: 'warn' },
          { kind: 'load', text: `${url}/api/orders?page=2`, loadError: 'HTTP 500', severity: 'warn' },
        ],
      ],
    ])
  })

  it("lists nothing and exits 0 with the config's pageErrors: 'off'", async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, "pageErrors: 'off',")
    const result = await runCli(['test', '--all'], {}, project, fakeBrowser({ a: { pageErrors: [logged] } }).options)

    expect(result.exitCode).toBe(0)
    expect(readReport(project).snapshots).toEqual([])
  })

  it("takes a story's pageErrors over the config's", async () => {
    const { project } = await createRun(
      ['a', 'b'],
      { a: defaultRunSnapshot, b: defaultRunSnapshot },
      "pageErrors: 'off',",
    )
    const { options } = fakeBrowser(
      { a: { pageErrors: [logged] }, b: { pageErrors: [logged] } },
      { read: { options: { a: { pageErrors: 'fail' } } } },
    )
    const result = await runCli(['test', '--all'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(readReport(project).snapshots.map(({ id, pageErrors }) => [id, pageErrors.length])).toEqual([['a', 1]])
  })

  it("drops the page errors the config's string and the story's RegExp expect, by message and by URL", async () => {
    const { project, url } = await createRun(
      ['a'],
      { a: defaultRunSnapshot },
      "expectedPageErrors: ['Failed to fetch', /never raised/],",
    )
    const { options } = fakeBrowser(
      { a: { pageErrors: [logged, failedLoadAt(url), thrown] } },
      { read: { options: { a: { expectedPageErrors: [/\/api\/orders\?page=\d/] } } } },
    )
    const result = await runCli(['test', '--all'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(readReport(project).snapshots[0]).toMatchObject({
      id: 'a',
      pageErrors: [{ kind: 'error', text: 'Uncaught Error: Request timeout', severity: 'fail' }],
      staleExpectedPageErrors: [],
    })
  })

  it('exits 0 once every page error is expected', async () => {
    const { project, url } = await createRun(['a'], { a: defaultRunSnapshot }, 'expectedPageErrors: [/timeout/i],')
    const { options } = fakeBrowser(
      { a: { pageErrors: [thrown, failedLoadAt(url)] } },
      { read: { options: { a: { expectedPageErrors: ['/api/orders'] } } } },
    )
    const result = await runCli(['test', '--all'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(readReport(project).snapshots).toEqual([])
  })

  it("lists a story's expected page errors that matched nothing as stale, and exits 0", async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, "expectedPageErrors: ['config entry'],")
    const { options } = fakeBrowser(
      { a: { pageErrors: [logged] } },
      { read: { options: { a: { expectedPageErrors: ['Failed to fetch', 'Not raised', /gone/i] } } } },
    )
    const result = await runCli(['test', '--all'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(readReport(project).snapshots[0]).toMatchObject({
      id: 'a',
      status: 'passed',
      pageErrors: [],
      staleExpectedPageErrors: ['"Not raised"', '/gone/i'],
    })
  })

  it('keeps the reason of a story broken for another reason, and lists its page errors', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const { options } = fakeBrowser(
      { a: { broken: true, pageErrors: [thrown] } },
      { read: { options: { a: { expectedPageErrors: ['Not raised'] } } } },
    )
    const result = await runCli(['test', '--all'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(readReport(project).snapshots[0]).toMatchObject({
      id: 'a',
      status: 'broken',
      reason: 'error',
      pageErrors: [{ kind: 'error', text: 'Uncaught Error: Request timeout', severity: 'fail' }],
      staleExpectedPageErrors: [],
    })
  })

  it('lists page errors only for the mode whose load raised them', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot, 'a.dark': defaultRunSnapshot })
    const { options } = fakeBrowser(
      { a: { byGlobals: { 'theme:dark': { pageErrors: [logged] } } } },
      { read: { options: { a: { modes: { dark: { globals: { theme: 'dark' } } } } } } },
    )
    const result = await runCli(['test', '--all'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(readReport(project).snapshots.map(({ id, mode, pageErrors }) => [id, mode, pageErrors])).toEqual([
      ['a.dark', 'dark', [{ kind: 'console.error', text: 'TypeError: Failed to fetch', severity: 'fail' }]],
    ])
  })

  it('writes the baseline in update, lists the page errors of every load once, and exits 0', async () => {
    const { project } = await createRun(['a', 'b'])
    const { options } = fakeBrowser({
      a: { captures: [{ pageErrors: [logged] }, { pageErrors: [logged, thrown] }] },
      b: { pageErrors: [] },
    })
    const result = await runCli(['update', '--all', '--reporter', 'json'], {}, project, options)
    const report = JSON.parse(result.stdout) as UpdateReport

    expect(result.exitCode).toBe(0)
    expect(report.exitCode).toBe(0)
    expect(report.counts).toMatchObject({ written: 2, broken: 0 })
    expect(report.snapshots.map(({ id, status, pageErrors }) => [id, status, pageErrors])).toEqual([
      [
        'a',
        'written',
        [
          { kind: 'console.error', text: 'TypeError: Failed to fetch', severity: 'fail' },
          { kind: 'error', text: 'Uncaught Error: Request timeout', severity: 'fail' },
        ],
      ],
      ['b', 'written', []],
    ])
  })

  it("doesn't list a baseline update kept, whatever its page errors", async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const { options } = fakeBrowser({ a: { pageErrors: [logged] } })
    const result = await runCli(['update', '--all', '--reporter', 'json'], {}, project, options)
    const report = JSON.parse(result.stdout) as UpdateReport

    expect(result.exitCode).toBe(0)
    expect(report.counts).toMatchObject({ written: 0, kept: 1 })
    expect(report.snapshots).toEqual([])
  })
})
