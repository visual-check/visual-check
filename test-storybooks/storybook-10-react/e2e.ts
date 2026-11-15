// The end-to-end check of this test Storybook: it serves the static build, runs the built CLI against it and checks
// what the CLI reports. Run it with `pnpm turbo run e2e --filter @visual-check/test-storybook-10-react`, which builds the
// CLI and the Storybook first, with TEST_STORYBOOK_IMAGE naming the browser image. It prints one line per case, then
// each of its problems, and exits 1 when any case fails. Turbo hands the arguments after `--` to this script, as in
// `pnpm turbo run e2e --filter @visual-check/test-storybook-10-react -- --host`.
//
// With `--inside-image` it runs inside visual-check's amd64 browser image, where the CLI starts the browser itself: it
// needs no TEST_STORYBOOK_IMAGE and no docker, and checks `platform: 'host'` and a platform mismatch in place of the
// kill case.
//
// With `--host` it runs on the machine itself with `platform: 'host'`, and needs no TEST_STORYBOOK_IMAGE or docker.
// Its two cases share a cache, VISUAL_CHECK_CACHE_DIR when the caller sets it, so it can look at the cache after the
// run, else a temporary folder. The cache must start empty: `update` downloads the headless shell into it, then `test`
// reuses it. They capture one story, against baselines `update` writes, since the committed ones need the image's
// fonts. `--no-docker`, which needs `--host` and no docker on the PATH, adds a case: with the default platform, `test`
// exits 2 with the no-Docker error.
import { type ChildProcessByStdio, spawn, spawnSync } from 'node:child_process'
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, extname, join, resolve as resolvePath, sep } from 'node:path'
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
 * Whether the check runs the browser on the machine itself, as the `--host` argument says.
 */
const onHost = process.argv.includes('--host')

/**
 * Whether the check on the machine itself also checks the error for a run with no Docker, as the `--no-docker`
 * argument says.
 */
const withoutDocker = process.argv.includes('--no-docker')

/**
 * Where visual-check's browser image records the browser it holds.
 */
const markerPath = '/etc/visual-check/chromium.json'

/**
 * The browser package, through this package's workspace link to it, which names the Chromium version the CLI
 * downloads for the host.
 */
const browserPackagePath = join(packageDir, 'node_modules', '@visual-check', 'chromium', 'chromium.json')

/**
 * Chrome for Testing's name for the platform of each machine visual-check downloads a headless shell for, by Node's
 * OS and architecture.
 */
const chromeForTestingPlatforms: Record<string, string> = {
  'linux/x64': 'linux64',
  'linux/arm64': 'linux-arm64',
  'darwin/x64': 'mac-x64',
  'darwin/arm64': 'mac-arm64',
  'win32/x64': 'win64',
}

/**
 * The story the host cases capture. One shows the download and its reuse.
 */
const hostStoryId = 'card--default'

/**
 * What the CLI says when there's no docker command: the problem, then the fix that names `platform: 'host'`.
 */
const noDockerTexts = [
  "visual-check runs the browser in Docker, and there's no docker command on PATH.",
  "Start or install Docker, or set platform: 'host' in the config.",
]

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
 * The storage stories and their expected outcomes. Each checks that visual-check's markers aren't in cookies,
 * `localStorage`, `sessionStorage` or IndexedDB, then writes them, so on one page the second fails unless storage is
 * cleared between them.
 */
const storageOutcomes: Outcomes = { 'storage--first': 'passed', 'storage--second': 'passed' }

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
   * Stops the server, dropping every open connection.
   */
  stop: () => Promise<void>
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
 * The part of the browser package that the cold cache case uses.
 */
interface BrowserPackage {
  /**
   * The Chromium version, such as `157.0.8103.78`.
   */
  chromium: string
}

/**
 * What the host cases share.
 */
interface HostRun {
  /**
   * The path of the config, which sets `platform: 'host'` and keeps the baselines in a folder that starts empty.
   */
  config: string
  /**
   * The folder the CLI caches the headless shell in.
   */
  cacheDir: string
  /**
   * The environment without `CI`, which `update` refuses to run under, and with `VISUAL_CHECK_CACHE_DIR` naming the
   * cache folder.
   */
  environment: NodeJS.ProcessEnv
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
 * Lists what the check needs and doesn't have: the static build and the built CLI, arguments that go together, then
 * what its mode needs.
 */
function findSetupProblems(): string[] {
  return [
    ...(existsSync(join(staticDir, 'index.json')) ? [] : [`storybook-static/ is missing: ${turboHint}`]),
    ...(existsSync(cliBin) ? [] : [`The CLI is not built: ${turboHint}`]),
    ...findArgumentProblems(),
    ...findModeProblems(),
  ]
}

/**
 * Lists what is wrong with the arguments: `--inside-image` and `--host` are separate modes, and `--no-docker` needs
 * `--host`.
 */
function findArgumentProblems(): string[] {
  const conflicts: [boolean, string][] = [
    [insideImage && onHost, '--inside-image and --host are separate modes: give one of them.'],
    [withoutDocker && !onHost, '--no-docker only runs with --host.'],
  ]

  return conflicts.filter(([conflicting]) => conflicting).map(([, problem]) => problem)
}

/**
 * Lists what the mode the arguments pick needs and doesn't have: inside visual-check's image its marker and no docker,
 * on the machine itself what `--no-docker` needs, else the browser image.
 */
function findModeProblems(): string[] {
  if (insideImage) {
    return findInsideImageProblems()
  }

  if (onHost) {
    return findHostProblems()
  }

  return findBrowserImageProblems()
}

/**
 * Lists what the check needs on the machine itself: with `--no-docker`, no docker, since that case checks the error
 * for a run without it.
 */
function findHostProblems(): string[] {
  return withoutDocker && isDockerOnPath()
    ? ['docker is on the PATH: --no-docker checks the error for a run without it, so run it where there is none.']
    : []
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
 * Reads the browser package.
 */
function readBrowserPackage(): BrowserPackage {
  return JSON.parse(readFileSync(browserPackagePath, 'utf8')) as BrowserPackage
}

/**
 * Gives Chrome for Testing's name for this machine's platform, such as `mac-arm64`.
 *
 * @throws {Error} When visual-check downloads no headless shell for the machine.
 */
function thisMachinesChromeForTestingPlatform(): string {
  const machine = `${process.platform}/${process.arch}`
  const platform = chromeForTestingPlatforms[machine]

  if (platform === undefined) {
    throw new Error(`visual-check downloads no headless shell for ${machine}, so --host can't run here`)
  }

  return platform
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
 * Whether nothing is at this path, or an empty folder is.
 */
function isMissingOrEmpty(path: string): boolean {
  return !existsSync(path) || (statSync(path).isDirectory() && readdirSync(path).length === 0)
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
 * Serves the static build on a free port of 127.0.0.1, changed as the options say.
 */
async function serveStorybook(options: ServeOptions = {}): Promise<StorybookServer> {
  let storyPageRequested = false
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (pathname === '/iframe.html') {
      storyPageRequested = true

      if (options.holdStoryPages) {
        return
      }
    }

    serveFile(pathname, response, options)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    storyPageRequested: () => storyPageRequested,
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
 * Reads the outcome of every snapshot line in the CLI's output, by story ID.
 *
 * @throws {Error} When a snapshot line ends in a detail no outcome has.
 */
function parseOutcomes(stdout: string): Outcomes {
  return Object.fromEntries(stdout.split('\n').flatMap(snapshotOf))
}

/**
 * Reads a snapshot line's story ID and outcome. Any other line gives nothing.
 *
 * @throws {Error} When a snapshot line ends in a detail no outcome has.
 */
function snapshotOf(line: string): [string, Outcome][] {
  const match = snapshotLinePattern.exec(line)

  if (match === null) {
    return []
  }

  const [, storyId = '', detail = ''] = match
  const outcome = outcomeDetails.find(([, pattern]) => pattern.test(detail))?.[0]

  if (outcome === undefined) {
    throw new Error(`The CLI printed a snapshot line with no known outcome: ${line}`)
  }

  return [[storyId, outcome]]
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

  return { exitCode, signal, timedOut, stderr, outcomes: parseOutcomes(stdout) }
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
 * What `test` gives a story right after `update` wrote its baseline: a broken story stays broken, any other passes.
 */
function retestOutcomeOf(outcome: Outcome): Outcome {
  return outcome === 'broken' ? 'broken' : 'passed'
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
 * `update` into an empty folder writes every story that isn't broken, `test` then passes them, and the baselines of
 * the stories expected to pass are byte-identical to the committed ones. Only those have a committed baseline the
 * written one must equal. Both commands take 2 workers from the config.
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
 * passes both.
 */
async function checkStorageClearing(): Promise<string[]> {
  return await withStorybookServer({}, async (server) => {
    const run = await runCli(['test', '--filter', '^storage--', '--workers', '1', '--url', server.url])

    return expectedRunProblems('test', run, storageOutcomes)
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
 * Runs `test --all` against the committed baselines with a config that sets this platform, or none when it is
 * `undefined`, and hands the run and the server to `check`.
 */
async function testWithPlatform(
  platform: string | undefined,
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
    ...missingTextProblems(run.stderr, [`image for ${arch}`, `platform is ${platform}`]),
    ...capturedProblems(server),
  ])
}

/**
 * Lists each text the message on standard error doesn't hold, with the whole message.
 */
function missingTextProblems(stderr: string, texts: string[]): string[] {
  return texts
    .filter((text) => !stderr.includes(text))
    .map((text) => `the message doesn't say "${text}"${outputOf(stderr)}`)
}

/**
 * Gives the problem when the browser asked for a story, which means the run captured, or none.
 */
function capturedProblems(server: StorybookServer): string[] {
  return server.storyPageRequested() ? ['the browser asked for a story, so the run captured'] : []
}

/**
 * Where there's no docker, the default platform makes `test` exit 2 before any capture: the message says there's no
 * docker command, and offers to start or install Docker or to set `platform: 'host'`.
 */
async function checkNoDocker(): Promise<string[]> {
  return await testWithPlatform(undefined, (run, server) => [
    ...exitCodeProblems('test', run, 2),
    ...outcomeProblems('test', run.outcomes, {}),
    ...missingTextProblems(run.stderr, noDockerTexts),
    ...capturedProblems(server),
  ])
}

/**
 * Writes the config the host cases share, with `platform: 'host'` and its baselines in a new folder inside the
 * temporary one, and gives what they share. The cache is VISUAL_CHECK_CACHE_DIR when the caller sets it, resolved as
 * the CLI resolves it in this package's folder, else a new folder inside the temporary one.
 */
function hostRunOf(folder: string, url: string): HostRun {
  const cacheSetting = process.env.VISUAL_CHECK_CACHE_DIR
  const cacheDir = cacheSetting ? resolvePath(packageDir, cacheSetting) : join(folder, 'cache')

  return {
    config: writeConfig(folder, url, join(folder, 'baselines'), 'host'),
    cacheDir,
    environment: { ...localEnvironment(), VISUAL_CHECK_CACHE_DIR: cacheDir },
  }
}

/**
 * With an empty cache, `update` says it is downloading the browser package's Chromium for this machine's platform,
 * writes the story's baseline and exits 0, and the cache then holds the marker of a complete install.
 */
async function checkColdCache(host: HostRun): Promise<string[]> {
  if (!isMissingOrEmpty(host.cacheDir)) {
    return [
      `the cache ${host.cacheDir} isn't empty, so update wouldn't download: ` +
        'empty it, or set VISUAL_CHECK_CACHE_DIR to an empty folder or leave it unset',
    ]
  }

  const { chromium } = readBrowserPackage()
  const platform = thisMachinesChromeForTestingPlatform()
  const download = `Downloading Chromium ${chromium} (${platform})`
  const marker = join(host.cacheDir, 'chromium', chromium, `chrome-headless-shell-${platform}.done`)
  const run = await runCli(['update', '--filter', hostStoryId, '--config', host.config], host.environment)

  return [
    ...expectedRunProblems('update', run, { [hostStoryId]: 'written' }),
    ...missingTextProblems(run.stderr, [download]),
    ...(isFile(marker) ? [] : [`the cache has no ${marker}`]),
  ]
}

/**
 * With the cache `update` filled, `test` downloads nothing and passes the story against the baseline `update` wrote.
 */
async function checkWarmCache(host: HostRun): Promise<string[]> {
  const run = await runCli(['test', '--filter', hostStoryId, '--config', host.config], host.environment)

  return [
    ...expectedRunProblems('test', run, { [hostStoryId]: 'passed' }),
    ...(run.stderr.includes('Downloading') ? [`test downloaded again${outputOf(run.stderr)}`] : []),
  ]
}

/**
 * The host cases, in order: the cold cache case, then the warm cache case, which needs the baseline and the cache the
 * cold one leaves and so runs only when that one passed, then with `--no-docker` the no-Docker case.
 */
function hostCases(host: HostRun): Case[] {
  let coldCachePassed = false

  return [
    {
      name: `cold cache: update downloads the headless shell and writes ${hostStoryId}`,
      run: async () => {
        const problems = await checkColdCache(host)

        coldCachePassed = problems.length === 0

        return problems
      },
    },
    {
      name: `warm cache: test downloads nothing and ${hostStoryId} passes`,
      run: async () => (coldCachePassed ? await checkWarmCache(host) : ['not run: the cold cache case failed']),
    },
    ...(withoutDocker
      ? [{ name: "no Docker: the default platform exits 2 offering platform: 'host'", run: checkNoDocker }]
      : []),
  ]
}

/**
 * Runs the host cases and resolves with whether all of them passed. They share one server and a temporary folder,
 * which holds their config and baselines, and their cache when the caller doesn't name one.
 */
async function runHostCases(): Promise<boolean> {
  return await withStorybookServer({}, (server) =>
    withTemporaryFolder((folder) => runCases(hostCases(hostRunOf(folder, server.url)))),
  )
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
} else if (onHost) {
  process.exitCode = (await runHostCases()) ? 0 : 1
} else {
  const expected = JSON.parse(readFileSync(join(packageDir, 'expected-outcomes.json'), 'utf8')) as Outcomes
  const passed = await runCases([
    { name: 'committed baselines: test gives the expected outcomes', run: () => checkCommittedBaselines(expected) },
    {
      name: "update then test: update writes every story that isn't broken, test passes, the baselines match the committed ones",
      run: () => checkUpdateThenTest(expected),
    },
    {
      name: 'storage: with 1 worker, a story finds storage empty after a story that filled it',
      run: checkStorageClearing,
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
