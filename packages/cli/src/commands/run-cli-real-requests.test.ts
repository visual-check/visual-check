import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { TestReport } from '../report/report-document.js'
import {
  cleanUpRuns,
  createRun,
  defaultRunSnapshot,
  fakeBrowser,
  otherSnapshot,
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
 * Gives each listed entry's ID, status and real network requests.
 */
function listedOf(project: string): [string, string, unknown][] {
  return readReport(project).snapshots.map(({ id, status, realRequests }) => [id, status, realRequests])
}

describe('runCli real network requests', () => {
  it("fails test on a passed snapshot whose page fetched another origin, with the config's realRequests: 'fail'", async () => {
    const { project } = await createRun(
      ['a', 'b'],
      { a: defaultRunSnapshot, b: defaultRunSnapshot },
      "realRequests: 'fail',",
    )
    const { options, record } = fakeBrowser({ a: { requestHosts: ['api.example.com', '127.0.0.1:6007'] } })
    const result = await runCli(['test', '--all'], {}, project, options)
    const report = readReport(project)

    expect(result.exitCode).toBe(1)
    expect(report.exitCode).toBe(1)
    expect(report.counts).toMatchObject({ passed: 2, differs: 0, broken: 0 })
    expect(listedOf(project)).toEqual([
      [
        'a',
        'passed',
        [
          { host: 'api.example.com', severity: 'fail' },
          { host: '127.0.0.1:6007', severity: 'fail' },
        ],
      ],
    ])
    expect(record.setups.some(({ watchRequests }) => watchRequests)).toBe(true)
    expect(result.stdout).toContain(
      [
        '── 1 snapshot with real network requests, which fails the run ──',
        'web  a',
        '  real network request (fail): api.example.com',
        '  real network request (fail): 127.0.0.1:6007',
        '2 passed · ',
      ].join('\n'),
    )
  })

  it('neither fails on nor lists a host silenceHosts matches, exactly, by hostname or by wildcard', async () => {
    const { project } = await createRun(
      ['a'],
      { a: defaultRunSnapshot },
      "realRequests: 'fail', silenceHosts: ['api.example.com', 'localhost', '*.cdn.test'],",
    )
    const { options } = fakeBrowser({ a: { requestHosts: ['api.example.com', 'localhost:6007', 'img.cdn.test:8443'] } })
    const result = await runCli(['test', '--all'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(readReport(project).snapshots).toEqual([])
    expect(result.stdout).not.toContain('real network request')
  })

  it("lists real network requests as warnings and exits 0 with the config's realRequests: 'warn'", async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, "realRequests: 'warn',")
    const result = await runCli(
      ['test', '--all'],
      {},
      project,
      fakeBrowser({ a: { requestHosts: ['api.example.com'] } }).options,
    )

    expect(result.exitCode).toBe(0)
    expect(listedOf(project)).toEqual([['a', 'passed', [{ host: 'api.example.com', severity: 'warn' }]]])
  })

  it("watches no page's requests and lists nothing by the default realRequests: 'off'", async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot })
    const { options, record } = fakeBrowser({ a: { requestHosts: ['api.example.com'] } })
    const result = await runCli(['test', '--all'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(readReport(project).snapshots).toEqual([])
    expect(record.setups.length).toBeGreaterThan(0)
    expect(record.setups.some(({ watchRequests }) => watchRequests)).toBe(false)
  })

  it("takes a story's realRequests over the config's, watching only for the stories that check them", async () => {
    const { project } = await createRun(
      ['a', 'b', 'c'],
      { a: defaultRunSnapshot, b: defaultRunSnapshot, c: defaultRunSnapshot },
      "realRequests: 'off',",
    )
    const { options } = fakeBrowser(
      {
        a: { requestHosts: ['a.example.com'] },
        b: { requestHosts: ['b.example.com'] },
        c: { requestHosts: ['c.example.com'] },
      },
      { read: { options: { a: { realRequests: 'fail' }, b: { realRequests: 'warn' } } } },
    )
    const result = await runCli(['test', '--all', '--workers', '1'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(listedOf(project)).toEqual([
      ['a', 'passed', [{ host: 'a.example.com', severity: 'fail' }]],
      ['b', 'passed', [{ host: 'b.example.com', severity: 'warn' }]],
    ])
  })

  it("turns a story's real network requests off under the config's 'fail'", async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, "realRequests: 'fail',")
    const { options } = fakeBrowser(
      { a: { requestHosts: ['api.example.com'] } },
      { read: { options: { a: { realRequests: 'off' } } } },
    )
    const result = await runCli(['test', '--all'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(readReport(project).snapshots).toEqual([])
  })

  it('lists real network requests only for the mode whose load made them', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot, 'a.dark': defaultRunSnapshot })
    const { options } = fakeBrowser(
      { a: { byGlobals: { 'theme:dark': { requestHosts: ['api.example.com'] } } } },
      { read: { options: { a: { realRequests: 'fail', modes: { dark: { globals: { theme: 'dark' } } } } } } },
    )
    const result = await runCli(['test', '--all'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(readReport(project).snapshots.map(({ id, mode, realRequests }) => [id, mode, realRequests])).toEqual([
      ['a.dark', 'dark', [{ host: 'api.example.com', severity: 'fail' }]],
    ])
  })

  it('lists each host of every load once, a host made on one load of several included', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, "realRequests: 'fail',")
    const { options } = fakeBrowser({
      a: {
        captures: [
          { snapshot: otherSnapshot, requestHosts: ['api.example.com', 'once.example.com'] },
          { requestHosts: ['api.example.com'] },
        ],
      },
    })
    const result = await runCli(['test', '--all'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(
      readReport(project).snapshots.map(({ id, status, flaky, realRequests }) => [id, status, flaky, realRequests]),
    ).toEqual([
      [
        'a',
        'passed',
        true,
        [
          { host: 'api.example.com', severity: 'fail' },
          { host: 'once.example.com', severity: 'fail' },
        ],
      ],
    ])
  })

  it('keeps the reason of a story broken for another reason, and lists its real network requests', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, "realRequests: 'warn',")
    const { options } = fakeBrowser({ a: { broken: true, requestHosts: ['api.example.com'] } })
    const result = await runCli(['test', '--all'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(readReport(project).snapshots[0]).toMatchObject({
      id: 'a',
      status: 'broken',
      reason: 'error',
      realRequests: [{ host: 'api.example.com', severity: 'warn' }],
    })
  })

  it("leaves update's document and warnings as they are, whatever realRequests says", async () => {
    /**
     * Runs `update` of a project whose config holds `config`, and gives its exit code, its JSON document with the
     * Storybook's port left out, and the lines of its network warning.
     */
    const updated = async (config: string): Promise<[number, string, string[]]> => {
      const { project } = await createRun(['a', 'b'], {}, config)
      const { options } = fakeBrowser({ a: { requestHosts: ['api.example.com'] } })
      const result = await runCli(['update', '--all', '--reporter', 'json'], {}, project, options)

      return [
        result.exitCode,
        result.stdout.replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:N'),
        result.stderr.split('\n').filter((line) => line.startsWith('api.example.com:')),
      ]
    }

    const unchecked = await updated('')

    expect(unchecked[0]).toBe(0)
    expect(unchecked[2]).toEqual([
      'api.example.com: 1 story (a). This story makes real network requests and may be unreliable.',
    ])
    expect(await updated("realRequests: 'fail',")).toEqual(unchecked)
    expect(await updated("realRequests: 'warn', silenceHosts: ['other.example.com'],")).toEqual(unchecked)
  })
})
