// The end-to-end check of this test Storybook: it serves the static build, runs the built CLI against it and checks
// what the CLI reports. Run it with `pnpm turbo run e2e --filter @visual-check/test-storybook-10-react`, which builds the
// CLI and the Storybook first, with TEST_STORYBOOK_IMAGE naming the browser image. It prints one line per case, then
// each of its problems, and exits 1 when any case fails.
//
// With `--inside-image` it runs inside visual-check's amd64 browser image, where the CLI starts the browser itself: it
// needs no TEST_STORYBOOK_IMAGE and no docker, and checks `platform: 'host'` and a platform mismatch in place of the
// kill case.
import { type ChildProcessByStdio, spawn, spawnSync } from 'node:child_process'
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, extname, join, sep } from 'node:path'
import type { Readable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

/**
 * What became of one snapshot, as the CLI's line for it says: a `test` outcome, or an `update` one.
 */
type Outcome = 'passed' | 'differs' | 'broken' | 'missing' | 'written' | 'kept'

/**
 * Each story's outcome, by story ID.
 */
type Outcomes = Record<string, Outcome>

/**
 * A started CLI, with its standard output and standard error piped.
 */
type CliProcess = ChildProcessByStdio<null, Readable, Readable>

/**
 * This package's folder, which the CLI runs in.
 */
const packageDir = fileURLToPath(new URL('.', import.meta.url))

/**
 * The static Storybook build that `pnpm build-storybook` writes.
 */
const staticDir = join(packageDir, 'storybook-static')

/**
 * The built CLI, through this package's workspace link to it.
 */
const cliBin = join(packageDir, 'node_modules', '@visual-check', 'cli', 'dist', 'bin.js')

/**
 * The committed baselines.
 */
const committedBaselines = join(packageDir, '.visual-check', 'baselines')

/**
 * Where the update case copies the baselines it wrote when they differ from the committed ones, for CI to keep.
 */
const diagnosticsDir = join(packageDir, 'e2e-output')

/**
 * Whether the check runs inside visual-check's browser image, as the `--inside-image` argument says.
 */
const insideImage = process.argv.includes('--inside-image')

/**
 * Where visual-check's browser image records the browser it holds.
 */
const markerPath = '/etc/visual-check/chromium.json'

/**
 * The browser image every run uses, until the browser package names a published one.
 */
const image = process.env.TEST_STORYBOOK_IMAGE

/**
 * How to run the check so that Turbo builds what it needs first.
 */
const turboHint =
  'run the check with pnpm turbo run e2e --filter @visual-check/test-storybook-10-react, which builds the CLI and ' +
  'the Storybook first.'

/**
 * How long one CLI run may take before it is killed, in milliseconds.
 */
const cliTimeoutMilliseconds = 300_000

/**
 * The names visual-check gives its containers, as a `docker ps` name filter.
 */
const containerNamePattern = '^visual-check-[0-9a-f]{12}$'

/**
 * The story the deliberate change alters, and the stylesheet that alters it through its `card` class.
 */
const deliberateChange = {
  storyId: 'card--default',
  style: '<style>.card { background: #fde68a !important; }</style>',
}

/**
 * How many workers the committed-baselines case and the update-then-test case capture with, so they capture in
 * parallel on any machine.
 */
const parallelWorkers = 2

/**
 * The storage stories, by the pattern their IDs match. Each checks that visual-check's markers aren't in cookies,
 * `localStorage`, `sessionStorage` or IndexedDB, then writes them, so on one page the second fails unless storage is
 * cleared between them.
 */
const storageFilter = /^storage--/

/**
 * The hazard stories, by the pattern their IDs match, and what the hazards case checks beyond their outcomes: where
 * the one that navigates away goes and how many times its page loads, once and then on each of its 2 retries, what the
 * one that crashes says, and the stories whose next story must pass, because they leave their page held or crashed.
 */
const hazards = {
  filter: /^hazards--/,
  navigatesAway: { storyId: 'hazards--navigates-away', says: 'navigated away to /categories/burgers', loads: 3 },
  crashes: { storyId: 'hazards--crashes', says: 'The page crashed' },
  followedByPass: ['hazards--before-unload', 'hazards--crashes'],
}

/**
 * How long the kill case waits for the CLI to start capturing, and for its container to go after the kill, in
 * milliseconds.
 */
const killTimeouts = { capturing: 60_000, removed: 10_000 }

/**
 * Each mark a snapshot line starts with, then the Storybook, the story ID and the detail, separated by two spaces.
 */
const snapshotLinePattern = /^[✓✗!] \S+ {2}(\S+) {2}(.+)$/

/**
 * The detail each outcome's line ends with.
 */
const outcomeDetails: [Outcome, RegExp][] = [
  ['passed', /^\d+ ms$/],
  ['differs', /^differs: /],
  ['broken', /^broken: /],
  ['missing', /^missing: /],
  ['written', /^written /],
  ['kept', /^kept$/],
]

/**
 * The outcomes that make a run exit 1.
 */
const failingOutcomes: Outcome[] = ['differs', 'broken', 'missing']

/**
 * The content type of each file extension the static build holds.
 */
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

/**
 * How the static server changes what it serves.
 */
interface ServeOptions {
  /**
   * Markup added to the end of every `iframe.html`'s `<head>`.
   */
  injectIntoStoryPage?: string
  /**
   * Leaves every `iframe.html` request unanswered until the server stops, so a run can't finish a capture.
   */
  holdStoryPages?: boolean
}

/**
 * A running static server for the Storybook build.
 */
interface StorybookServer {
  /**
   * The URL it serves the Storybook at.
   */
  url: string
  /**
   * Whether a story page has been asked for, which means the browser is capturing.
   */
  storyPageRequested: () => boolean
  /**
   * How many times the page of the story with this ID, its `iframe.html` with that `id`, has been asked for.
   */
  storyPageLoads: (storyId: string) => number
  /**
   * Stops the server, dropping every open connection.
   */
  stop: () => Promise<void>
}

/**
 * One snapshot line of the CLI's output.
 */
interface SnapshotLine {
  /**
   * The story's ID.
   */
  storyId: string
  /**
   * The outcome the line gives.
   */
  outcome: Outcome
  /**
   * What the line says after the story ID, such as `120 ms` or `broken: ` and why.
   */
  detail: string
}

/**
 * What one CLI run printed and how it ended.
 */
interface CliRun {
  /**
   * The exit code, or `null` when a signal ended it.
   */
  exitCode: number | null
  /**
   * The signal that ended it, or `null` when it exited.
   */
  signal: NodeJS.Signals | null
  /**
   * Whether the time limit ended it.
   */
  timedOut: boolean
  /**
   * Its standard error.
   */
  stderr: string
  /**
   * Each snapshot line, in the order the CLI printed them.
   */
  snapshots: SnapshotLine[]
  /**
   * Each snapshot line's outcome, by story ID.
   */
  outcomes: Outcomes
}

/**
 * A CLI that is followed while it runs.
 */
interface FollowedCli {
  /**
   * What it has printed on standard error so far.
   */
  stderr: () => string
  /**
   * How it ended, such as `exited 2`, or `undefined` while it runs.
   */
  ending: () => string | undefined
}

/**
 * The part of the image's marker that the platform cases use.
 */
interface ImageMarker {
  /**
   * The architecture the image's browser is for, `amd64` or `arm64`.
   */
  arch: 'amd64' | 'arm64'
}

/**
 * One end-to-end case: what it checks, and the check, which gives every problem it finds.
 */
interface Case {
  /**
   * What the case checks.
   */
  name: string
  /**
   * Runs the case, resolving with its problems, none when it passes.
   */
  run: () => Promise<string[]>
}

/**
 * Lists what the check needs and doesn't have: the static build and the built CLI, then the browser image, or inside
 * visual-check's image its marker and no docker.
 */
function findSetupProblems(): string[] {
  return [
    ...(existsSync(join(staticDir, 'index.json')) ? [] : [`storybook-static/ is missing: ${turboHint}`]),
    ...(existsSync(cliBin) ? [] : [`The CLI is not built: ${turboHint}`]),
    ...(insideImage ? findInsideImageProblems() : findBrowserImageProblems()),
  ]
}

/**
 * Lists what the check needs outside the image: the name of the browser image.
 */
function findBrowserImageProblems(): string[] {
  return image
    ? []
    : ['TEST_STORYBOOK_IMAGE is not set: set it to the browser image, such as visual-check-chromium:amd64.']
}

/**
 * Lists what the check needs inside the image: the image's marker, for the amd64 image because the committed baselines
 * are linux/amd64, and no docker, which the mode proves the CLI needs none of.
 */
function findInsideImageProblems(): string[] {
  return [
    ...markerProblems(),
    ...(isDockerOnPath()
      ? ['docker is on the PATH: this mode proves the CLI needs none, so run it where there is none.']
      : []),
  ]
}

/**
 * Lists what is wrong with the image's marker: it is missing, or it isn't the amd64 image's.
 */
function markerProblems(): string[] {
  if (!existsSync(markerPath)) {
    return [`${markerPath} is missing: run this mode inside visual-check's image.`]
  }

  return readMarker().arch === 'amd64'
    ? []
    : ['The committed baselines are linux/amd64, so run this mode in the amd64 image.']
}

/**
 * Whether an executable file named `docker` is in one of the `PATH` folders.
 */
function isDockerOnPath(): boolean {
  return (process.env.PATH ?? '').split(delimiter).some((folder) => {
    const path = join(folder, 'docker')

    try {
      accessSync(path, constants.X_OK)

      return isFile(path)
    } catch {
      return false
    }
  })
}

/**
 * Reads the image's marker.
 */
function readMarker(): ImageMarker {
  return JSON.parse(readFileSync(markerPath, 'utf8')) as ImageMarker
}

/**
 * Gives the path of the file in the static build that a URL path names, or `undefined` when it names no file there.
 */
function staticFileOf(pathname: string): string | undefined {
  const filePath = join(staticDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname)

  return filePath.startsWith(`${staticDir}${sep}`) && isFile(filePath) ? filePath : undefined
}

/**
 * Whether a file is at this path.
 */
function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile()
}

/**
 * Adds markup to the end of a page's `<head>`, or leaves the page as it is when there is none to add.
 */
function withMarkup(page: Buffer, markup: string | undefined): Buffer | string {
  return markup === undefined ? page : page.toString('utf8').replace('</head>', `${markup}</head>`)
}

/**
 * Answers a request for a URL path with the static build's file, or 404 when it names no file there. A story page
 * gets the markup `injectIntoStoryPage` gives.
 */
function serveFile(pathname: string, response: ServerResponse, options: ServeOptions): void {
  const filePath = staticFileOf(pathname)

  if (filePath === undefined) {
    response.writeHead(404).end()

    return
  }

  const body = readFileSync(filePath)

  response
    .writeHead(200, { 'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream' })
    .end(pathname === '/iframe.html' ? withMarkup(body, options.injectIntoStoryPage) : body)
}

/**
 * Counts one more request for a story's page, under the story's ID, the `id` search parameter of its `iframe.html`.
 */
function countStoryPageLoad(storyPageLoads: Map<string, number>, searchParams: URLSearchParams): void {
  const storyId = searchParams.get('id') ?? ''

  storyPageLoads.set(storyId, (storyPageLoads.get(storyId) ?? 0) + 1)
}

/**
 * Serves the static build on a free port of 127.0.0.1, changed as the options say, and counts the requests for each
 * story's page.
 */
async function serveStorybook(options: ServeOptions = {}): Promise<StorybookServer> {
  const storyPageLoads = new Map<string, number>()
  const server = createServer((request, response) => {
    const { pathname, searchParams } = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (pathname === '/iframe.html') {
      countStoryPageLoad(storyPageLoads, searchParams)

      if (options.holdStoryPages) {
        return
      }
    }

    serveFile(pathname, response, options)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    storyPageRequested: () => storyPageLoads.size > 0,
    storyPageLoads: (storyId: string) => storyPageLoads.get(storyId) ?? 0,
    stop: async () => {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

/**
 * Starts a server for the build, hands it to `use`, and stops it however `use` ends.
 */
async function withStorybookServer<T>(options: ServeOptions, use: (server: StorybookServer) => Promise<T>): Promise<T> {
  const server = await serveStorybook(options)

  try {
    return await use(server)
  } finally {
    await server.stop()
  }
}

/**
 * Makes a temporary folder, hands it to `use`, and removes it however `use` ends.
 */
async function withTemporaryFolder<T>(use: (folder: string) => Promise<T>): Promise<T> {
  const folder = mkdtempSync(join(tmpdir(), 'visual-check-e2e-'))

  try {
    return await use(folder)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

/**
 * Starts the built CLI in this package's folder with the given arguments and environment. It is killed when it runs
 * past the time limit.
 */
function startCli(args: string[], env: NodeJS.ProcessEnv): CliProcess {
  return spawn(process.execPath, [cliBin, ...args], {
    cwd: packageDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: cliTimeoutMilliseconds,
    killSignal: 'SIGKILL',
  })
}

/**
 * Reads every snapshot line in the CLI's output, in order.
 *
 * @throws {Error} When a snapshot line ends in a detail no outcome has.
 */
function parseSnapshots(stdout: string): SnapshotLine[] {
  return stdout.split('\n').flatMap(snapshotOf)
}

/**
 * Reads a snapshot line's story ID, outcome and detail. Any other line gives nothing.
 *
 * @throws {Error} When a snapshot line ends in a detail no outcome has.
 */
function snapshotOf(line: string): SnapshotLine[] {
  const match = snapshotLinePattern.exec(line)

  if (match === null) {
    return []
  }

  const [, storyId = '', detail = ''] = match
  const outcome = outcomeDetails.find(([, pattern]) => pattern.test(detail))?.[0]

  if (outcome === undefined) {
    throw new Error(`The CLI printed a snapshot line with no known outcome: ${line}`)
  }

  return [{ storyId, outcome, detail }]
}

/**
 * Runs the built CLI to the end, or until the time limit kills it, and reads its outcomes.
 */
async function runCli(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<CliRun> {
  const started = performance.now()
  const child = startCli(args, env)
  let stdout = ''
  let stderr = ''

  child.stdout.setEncoding('utf8').on('data', (text: string) => {
    stdout += text
  })
  child.stderr.setEncoding('utf8').on('data', (text: string) => {
    stderr += text
  })

  const [exitCode, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, closeSignal) => resolve([code, closeSignal]))
  })

  const timedOut = signal === 'SIGKILL' && performance.now() - started >= cliTimeoutMilliseconds
  const snapshots = parseSnapshots(stdout)
  const outcomes = Object.fromEntries(snapshots.map((snapshot) => [snapshot.storyId, snapshot.outcome]))

  return { exitCode, signal, timedOut, stderr, snapshots, outcomes }
}

/**
 * Follows a started CLI: collects its standard error and notes how it ends.
 */
function followCli(cli: CliProcess): FollowedCli {
  let stderr = ''
  let ending: string | undefined

  cli.stdout.resume()
  cli.stderr.setEncoding('utf8').on('data', (text: string) => {
    stderr += text
  })
  cli.on('error', (error) => {
    ending ??= `couldn't run: ${error.message}`
  })
  cli.on('exit', (code, signal) => {
    ending ??= signal === null ? `exited ${code}` : `was ended by ${signal}`
  })

  return { stderr: () => stderr, ending: () => ending }
}

/**
 * Gives the problem with how a run ended, with what it printed on standard error, or none when it exited with the
 * expected code.
 */
function exitCodeProblems(command: string, run: CliRun, expected: number): string[] {
  if (run.timedOut) {
    return [`${command} timed out after ${cliTimeoutMilliseconds / 1000} s${outputOf(run.stderr)}`]
  }

  if (run.signal !== null) {
    return [`${command} was ended by ${run.signal}${outputOf(run.stderr)}`]
  }

  return run.exitCode === expected
    ? []
    : [`${command} exited ${run.exitCode}, expected ${expected}${outputOf(run.stderr)}`]
}

/**
 * Writes what a run printed on standard error on one line, in parentheses, or nothing when it printed nothing.
 */
function outputOf(stderr: string): string {
  const output = stderr.trim().replace(/\s*\n\s*/g, ' ')

  return output ? ` (${output})` : ''
}

/**
 * Lists every story whose outcome isn't the expected one, including stories only one side has.
 */
function outcomeProblems(command: string, actual: Outcomes, expected: Outcomes): string[] {
  const storyIds = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()

  return storyIds
    .filter((storyId) => actual[storyId] !== expected[storyId])
    .map(
      (storyId) =>
        `${command}: ${storyId} is ${actual[storyId] ?? 'not in the run'}, expected ${expected[storyId] ?? 'no such story'}`,
    )
}

/**
 * The exit code a run gives for these outcomes: 1 when any story differs, is broken or is missing, else 0.
 */
function exitCodeOf(outcomes: Outcomes): number {
  return Object.values(outcomes).some((outcome) => failingOutcomes.includes(outcome)) ? 1 : 0
}

/**
 * Changes each story's outcome with `change`.
 */
function mapOutcomes(outcomes: Outcomes, change: (outcome: Outcome) => Outcome): Outcomes {
  return Object.fromEntries(Object.entries(outcomes).map(([storyId, outcome]) => [storyId, change(outcome)]))
}

/**
 * What `update` into an empty folder gives a story with this expected `test` outcome: a broken story stays broken,
 * any other is written.
 */
function updateOutcomeOf(outcome: Outcome): Outcome {
  return outcome === 'broken' ? 'broken' : 'written'
}

/**
 * What `test` gives a story right after `update` into an empty folder: a broken story has no baseline, so it's missing,
 * because `test` never captures a story without one, and any other passes.
 */
function retestOutcomeOf(outcome: Outcome): Outcome {
  return outcome === 'broken' ? 'missing' : 'passed'
}

/**
 * Whether both files exist and hold the same bytes.
 */
function isSameFile(path: string, otherPath: string): boolean {
  return isFile(path) && isFile(otherPath) && readFileSync(path).equals(readFileSync(otherPath))
}

/**
 * Lists the written baselines of these stories that aren't byte-identical to the committed ones. When there are any, it
 * copies every written baseline to the diagnostics folder and names it.
 */
function baselineProblems(written: string, storyIds: string[]): string[] {
  const differing = storyIds
    .map((storyId) => `${storyId}.png`)
    .filter((name) => !isSameFile(join(written, name), join(committedBaselines, name)))

  if (differing.length === 0) {
    return []
  }

  cpSync(written, diagnosticsDir, { recursive: true })

  return [
    `written baselines differ from the committed ones: ${differing.join(', ')}`,
    `the written baselines are in ${diagnosticsDir}`,
  ]
}

/**
 * The environment without `CI`, which `update` refuses to run under.
 */
function localEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env }

  delete environment.CI

  return environment
}

/**
 * Writes a config for this Storybook, served at the URL, with its baselines in the given folder and, when given, its
 * platform, that captures with 2 workers. Gives its path.
 */
function writeConfig(folder: string, url: string, baselines: string, platform?: string): string {
  const path = join(folder, 'visual-check.config.mjs')
  const config = {
    storybooks: { react: { url, dir: packageDir, baselines } },
    image,
    workers: parallelWorkers,
    ...(platform === undefined ? {} : { platform }),
  }

  writeFileSync(path, `export default ${JSON.stringify(config, null, 2)}\n`)

  return path
}

/**
 * Lists the IDs of visual-check's containers: running ones, or all of them, stopped ones included.
 */
function visualCheckContainers(which: 'running' | 'all'): string[] {
  const all = which === 'all' ? ['-a'] : []
  const result = spawnSync('docker', ['ps', ...all, '--filter', `name=${containerNamePattern}`, '-q'], {
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(`docker ps failed: ${String(result.error ?? result.stderr.trim())}`)
  }

  return result.stdout.split('\n').filter((line) => line !== '')
}

/**
 * Lists the IDs of visual-check's containers that weren't there before.
 */
function newContainers(which: 'running' | 'all', before: ReadonlySet<string>): string[] {
  return visualCheckContainers(which).filter((id) => !before.has(id))
}

/**
 * Checks the condition every 200 ms until it holds or the time is up. Resolves with whether it held.
 */
async function waitUntil(condition: () => boolean, timeoutMilliseconds: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMilliseconds

  while (!condition()) {
    if (Date.now() >= deadline) {
      return false
    }

    await sleep(200)
  }

  return true
}

/**
 * `test` against the committed baselines, with 2 workers, gives exactly the expected outcomes.
 */
async function checkCommittedBaselines(expected: Outcomes): Promise<string[]> {
  return await withStorybookServer({}, async (server) => {
    const run = await runCli(['test', '--all', '--url', server.url, '--workers', String(parallelWorkers)])

    return expectedRunProblems('test', run, expected)
  })
}

/**
 * `update` into an empty folder writes every story that isn't broken, `test` then passes them and finds the broken
 * ones missing, and the baselines of the stories expected to pass are byte-identical to the committed ones. Only those
 * have a committed baseline the written one must equal. Both commands take 2 workers from the config.
 */
async function checkUpdateThenTest(expected: Outcomes): Promise<string[]> {
  rmSync(diagnosticsDir, { recursive: true, force: true })

  return await withStorybookServer({}, (server) =>
    withTemporaryFolder(async (folder) => {
      const baselines = join(folder, 'baselines')
      const args = ['--all', '--config', writeConfig(folder, server.url, baselines)]
      const updateProblems = await runAndCheck('update', args, mapOutcomes(expected, updateOutcomeOf))

      if (updateProblems.length > 0) {
        return updateProblems
      }

      const passing = Object.keys(expected).filter((storyId) => expected[storyId] === 'passed')

      return [
        ...baselineProblems(baselines, passing),
        ...(await runAndCheck('test', args, mapOutcomes(expected, retestOutcomeOf))),
      ]
    }),
  )
}

/**
 * Lists how a run's exit code and outcomes differ from the ones the expected outcomes give.
 */
function expectedRunProblems(command: string, run: CliRun, expected: Outcomes): string[] {
  return [...exitCodeProblems(command, run, exitCodeOf(expected)), ...outcomeProblems(command, run.outcomes, expected)]
}

/**
 * Runs a command locally, without `CI`, and lists how its exit code and outcomes differ from the expected ones.
 */
async function runAndCheck(command: 'test' | 'update', args: string[], expected: Outcomes): Promise<string[]> {
  const run = await runCli([command, ...args], localEnvironment())

  return expectedRunProblems(command, run, expected)
}

/**
 * On one worker, the storage stories run one right after the other on the same page, in index order, so the second
 * passes only when the storage the first filled was cleared between them. `test` against the committed baselines
 * gives their expected outcomes, both passed.
 */
async function checkStorageClearing(expected: Outcomes): Promise<string[]> {
  return await withStorybookServer({}, async (server) => {
    const run = await runCli(['test', '--filter', storageFilter.source, '--workers', '1', '--url', server.url])

    return expectedRunProblems('test', run, outcomesMatching(expected, storageFilter))
  })
}

/**
 * Keeps the expected outcomes of the stories whose ID matches the pattern.
 */
function outcomesMatching(expected: Outcomes, pattern: RegExp): Outcomes {
  return Object.fromEntries(Object.entries(expected).filter(([storyId]) => pattern.test(storyId)))
}

/**
 * Gives the problem with a story's snapshot line when it doesn't say `text`, or none when it does or the run has no
 * line for the story, which the outcome check reports.
 */
function lineSaysProblems(run: CliRun, storyId: string, text: string): string[] {
  const line = run.snapshots.find((snapshot) => snapshot.storyId === storyId)

  return line === undefined || line.detail.includes(text)
    ? []
    : [`test: ${storyId}'s line doesn't say "${text}": ${line.detail}`]
}

/**
 * The story that navigates away says where it went, and the server was asked for its page 3 times: once, then on each
 * of its 2 retries.
 */
function navigatedAwayProblems(run: CliRun, server: StorybookServer): string[] {
  const { storyId, says, loads } = hazards.navigatesAway
  const seen = server.storyPageLoads(storyId)

  return [
    ...lineSaysProblems(run, storyId, says),
    ...(seen === loads ? [] : [`test: the server was asked for ${storyId}'s page ${seen} times, expected ${loads}`]),
  ]
}

/**
 * Gives the problem with the snapshot line after a story's when there is none or it didn't pass, or none when it
 * passed or the run has no line for the story, which the outcome check reports.
 */
function followedByPassProblems(run: CliRun, storyId: string): string[] {
  const index = run.snapshots.findIndex((snapshot) => snapshot.storyId === storyId)

  return index === -1 ? [] : passedAfterProblems(storyId, run.snapshots[index + 1])
}

/**
 * Gives the problem with the snapshot line after a story's when there is none or it didn't pass, or none when it
 * passed.
 */
function passedAfterProblems(storyId: string, next: SnapshotLine | undefined): string[] {
  if (next === undefined) {
    return [`test: no story ran after ${storyId}, expected one that passed`]
  }

  return next.outcome === 'passed'
    ? []
    : [`test: ${next.storyId}, the story after ${storyId}, is ${next.outcome}, expected passed`]
}

/**
 * On one worker, the hazard stories run one after the other in index order, and `test` against the committed baselines
 * gives exactly their expected outcomes. The story that navigates away is broken saying where it went, after its page
 * loaded 3 times. The story that crashes is broken saying its page crashed. The stories after `BeforeUnload` and
 * `Crashes` pass, so a page that a `beforeunload` dialog holds, or a crashed page that isn't replaced, shows.
 */
async function checkHazards(expected: Outcomes): Promise<string[]> {
  return await withStorybookServer({}, async (server) => {
    const run = await runCli(['test', '--filter', hazards.filter.source, '--workers', '1', '--url', server.url])

    return [
      ...expectedRunProblems('test', run, outcomesMatching(expected, hazards.filter)),
      ...navigatedAwayProblems(run, server),
      ...lineSaysProblems(run, hazards.crashes.storyId, hazards.crashes.says),
      ...hazards.followedByPass.flatMap((storyId) => followedByPassProblems(run, storyId)),
    ]
  })
}

/**
 * A visible change to one story fails `test` with that story's snapshot differing, and every other story as expected.
 */
async function checkDeliberateChange(expected: Outcomes): Promise<string[]> {
  return await withStorybookServer({ injectIntoStoryPage: deliberateChange.style }, async (server) => {
    const run = await runCli(['test', '--all', '--url', server.url])

    return [
      ...exitCodeProblems('test', run, 1),
      ...outcomeProblems('test', run.outcomes, { ...expected, [deliberateChange.storyId]: 'differs' }),
    ]
  })
}

/**
 * Runs `test --all` against the committed baselines with a config that sets this platform, and hands the run and the
 * server to `check`.
 */
async function testWithPlatform(
  platform: string,
  check: (run: CliRun, server: StorybookServer) => string[],
): Promise<string[]> {
  return await withStorybookServer({}, (server) =>
    withTemporaryFolder(async (folder) => {
      const config = writeConfig(folder, server.url, committedBaselines, platform)

      return check(await runCli(['test', '--all', '--config', config]), server)
    }),
  )
}

/**
 * Inside the image, `platform: 'host'` captures with the image's browser and gives exactly the expected outcomes.
 */
async function checkHostPlatform(expected: Outcomes): Promise<string[]> {
  return await testWithPlatform('host', (run) => expectedRunProblems('test', run, expected))
}

/**
 * Inside the amd64 image, the platform `linux/arm64` exits 2 before any capture, and the message names the image's
 * architecture and the configured platform.
 */
async function checkPlatformMismatch(): Promise<string[]> {
  const { arch } = readMarker()
  const platform = 'linux/arm64'

  return await testWithPlatform(platform, (run, server) => [
    ...exitCodeProblems('test', run, 2),
    ...outcomeProblems('test', run.outcomes, {}),
    ...[`image for ${arch}`, `platform is ${platform}`]
      .filter((text) => !run.stderr.includes(text))
      .map((text) => `the message doesn't say "${text}"${outputOf(run.stderr)}`),
    ...(server.storyPageRequested() ? ['the browser asked for a story, so the run captured'] : []),
  ])
}

/**
 * Killing the CLI while it captures leaves no container of its own behind. The server holds the story pages, so the
 * run is still capturing when the kill comes. Containers that were there before the run don't count.
 */
async function checkKill(): Promise<string[]> {
  const before = new Set(visualCheckContainers('all'))

  return await withStorybookServer({ holdStoryPages: true }, async (server) => {
    const child = startCli(['test', '--all', '--url', server.url], process.env)
    const cli = followCli(child)

    try {
      const notCapturing = await waitForCapture(server, cli, before)

      if (notCapturing !== undefined) {
        return [notCapturing]
      }

      child.kill('SIGKILL')

      return await waitForRemoval(before)
    } finally {
      child.kill('SIGKILL')
    }
  })
}

/**
 * Waits until the browser asks for a story, which the server holds, and a new visual-check container is running.
 * Gives what went wrong instead, or `undefined`.
 */
async function waitForCapture(
  server: StorybookServer,
  cli: FollowedCli,
  before: ReadonlySet<string>,
): Promise<string | undefined> {
  await waitUntil(() => server.storyPageRequested() || cli.ending() !== undefined, killTimeouts.capturing)

  const ending = cli.ending()

  if (ending !== undefined) {
    return `the CLI ${ending} before the kill${outputOf(cli.stderr())}`
  }

  if (!server.storyPageRequested()) {
    return `the browser didn't ask for a story within ${killTimeouts.capturing / 1000} s`
  }

  return newContainers('running', before).length === 0
    ? 'no new visual-check container was running while the CLI captured'
    : undefined
}

/**
 * Waits for every visual-check container the run started to go. Gives the ones that remain once the time is up.
 */
async function waitForRemoval(before: ReadonlySet<string>): Promise<string[]> {
  const removed = await waitUntil(() => newContainers('all', before).length === 0, killTimeouts.removed)

  return removed
    ? []
    : [`containers remain ${killTimeouts.removed / 1000} s after the kill: ${newContainers('all', before).join(', ')}`]
}

/**
 * The cases only the image can run: the host platform and a platform of the other architecture.
 */
function insideImageCases(expected: Outcomes): Case[] {
  return [
    {
      name: "platform host: test uses the image's browser and gives the expected outcomes",
      run: () => checkHostPlatform(expected),
    },
    {
      name: 'platform mismatch: test exits 2 naming both architectures before any capture',
      run: checkPlatformMismatch,
    },
  ]
}

/**
 * Runs every case, prints its result, and resolves with whether all of them passed.
 */
async function runCases(cases: Case[]): Promise<boolean> {
  let passed = true

  for (const testCase of cases) {
    const problems = await problemsOf(testCase)

    printResult(testCase.name, problems)
    passed = passed && problems.length === 0
  }

  return passed
}

/**
 * Prints one line for a case, marked passed or failed, then one indented line for each of its problems.
 */
function printResult(name: string, problems: string[]): void {
  console.log(
    [`${problems.length === 0 ? '✓' : '✗'} ${name}`, ...problems.map((problem) => `    ${problem}`)].join('\n'),
  )
}

/**
 * Runs a case and gives its problems. A case that throws has the error's message as its one problem.
 */
async function problemsOf(testCase: Case): Promise<string[]> {
  try {
    return await testCase.run()
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
}

const setupProblems = findSetupProblems()

if (setupProblems.length > 0) {
  console.error(setupProblems.join('\n'))
  process.exitCode = 1
} else {
  const expected = JSON.parse(readFileSync(join(packageDir, 'expected-outcomes.json'), 'utf8')) as Outcomes
  const passed = await runCases([
    { name: 'committed baselines: test gives the expected outcomes', run: () => checkCommittedBaselines(expected) },
    {
      name: "update then test: update writes every story that isn't broken, test passes them and finds the broken ones missing, the baselines match the committed ones",
      run: () => checkUpdateThenTest(expected),
    },
    {
      name: 'storage: with 1 worker, a story finds storage empty after a story that filled it',
      run: () => checkStorageClearing(expected),
    },
    {
      name: 'hazards: with 1 worker, test gives the expected outcomes, a story navigates away after 3 loads, a crash is reported, the stories after BeforeUnload and Crashes pass',
      run: () => checkHazards(expected),
    },
    {
      name: `deliberate change: test exits 1 and ${deliberateChange.storyId} differs`,
      run: () => checkDeliberateChange(expected),
    },
    ...(insideImage
      ? insideImageCases(expected)
      : [{ name: 'killing the CLI: no container is left behind', run: checkKill }]),
  ])

  process.exitCode = passed ? 0 : 1
}
