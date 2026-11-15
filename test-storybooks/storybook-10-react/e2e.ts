// The end-to-end check of a test Storybook: it serves the static build, runs the built CLI against it and checks
// what the CLI reports. It works in the folder it starts in, so each test Storybook runs this same file from its own
// folder, as `node ../storybook-10-react/e2e.ts`. Run it with `pnpm turbo run e2e --filter <package name>`, which builds
// the CLI and the Storybook first, with TEST_STORYBOOK_IMAGE naming the browser image. It prints one line per case,
// then each of its problems, and exits 1 when any case fails. Turbo hands the arguments after `--` to this script, as in
// `pnpm turbo run e2e --filter <package name> -- --host`.
//
// With `--inside-image` it runs inside visual-check's amd64 browser image, where the CLI starts the browser itself: it
// needs no TEST_STORYBOOK_IMAGE and no docker, and checks `platform: 'host'` and a platform mismatch in place of the
// cases that kill the CLI or the browser's container.
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
import { basename, delimiter, extname, join, resolve as resolvePath, sep } from 'node:path'
import type { Readable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'

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
 * The folder the check starts in, the test Storybook's package folder, which the CLI runs in.
 */
const packageDir = process.cwd()

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
 * Reads the package name from the `package.json` in the folder the check starts in.
 *
 * @returns The name, or undefined when there's no `package.json` there, it isn't valid JSON, or it has no name.
 */
function readPackageName(): string | undefined {
  try {
    const { name } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { name?: unknown }

    return typeof name === 'string' && name !== '' ? name : undefined
  } catch {
    return undefined
  }
}

/**
 * Says how to run the check so that Turbo builds what it needs first.
 *
 * @param packageName - The name of the package in the folder the check starts in.
 * @returns The hint, which names the package.
 */
function turboHint(packageName: string): string {
  return `run the check with pnpm turbo run e2e --filter ${packageName}, which builds the CLI and the Storybook first.`
}

/**
 * How long one CLI run may take before it is killed, in milliseconds.
 */
const cliTimeoutMilliseconds = 300_000

/**
 * The names visual-check gives its containers, as a `docker ps` name filter.
 */
const containerNamePattern = '^visual-check-[0-9a-f]{12}$'

/**
 * How long one docker command may take before it is killed, in milliseconds.
 */
const dockerTimeoutMilliseconds = 30_000

/**
 * The story the deliberate change alters, and the stylesheet that alters it through its `card` class.
 */
const deliberateChange = {
  storyId: 'card--default',
  style: '<style>.card { background: #fde68a !important; }</style>',
}

/**
 * The one-pixel change: the story it changes, by its ID and the pattern that matches only it, the stylesheet that
 * changes it and the detail its line must hold with `pixels: 0`, `differs:` included so a larger count can't match.
 * The stylesheet draws one black CSS pixel at (1000, 600) through a fixed `body::after`, which takes no space in the
 * layout. The story is captured in the default 1280 × 720 viewport at scale 1, so that spot is inside the snapshot, on
 * the white page far from the card, and exactly one pixel of the snapshot changes.
 */
const onePixelChange = {
  storyId: 'card--default',
  filter: /^card--default$/,
  style:
    '<style>body::after { content: ""; position: fixed; left: 1000px; top: 600px; width: 1px; height: 1px; ' +
    'background: #000; }</style>',
  says: 'differs: 1 differ, 0 allowed',
}

/**
 * The images `test` writes to the report for a differing snapshot, `<key>.<kind>.png` each.
 */
const reportImageKinds = ['baseline', 'snapshot', 'diff'] as const

/**
 * How many workers every case that captures in parallel uses, through `--workers` or the config it writes, so each
 * captures in parallel on any machine.
 */
const parallelWorkers = 2

/**
 * The storage stories, by the pattern their IDs match. Each checks that visual-check's markers aren't in cookies,
 * `localStorage`, `sessionStorage` or IndexedDB, then writes them, so on one page the second fails unless storage is
 * cleared between them.
 */
const storageFilter = /^storage--/

/**
 * The animation stories, by the pattern their IDs match. visual-check brings each to its end state at capture.
 */
const animationFilter = /^animations--/

/**
 * How many times the end-state case runs `test` on the animation stories, one run after the other, so a snapshot that
 * isn't the same on every run shows.
 */
const endStateRuns = 10

/**
 * The Storybook 10 test Storybook's committed baselines. Each animation story's snapshot is the same on every
 * Storybook, so the other test Storybooks' committed animation baselines must equal these byte for byte.
 */
const storybook10Baselines = resolvePath(packageDir, '..', 'storybook-10-react', '.visual-check', 'baselines')

/**
 * The hazard stories, by the pattern their IDs match, and what the hazards case checks beyond their outcomes: where
 * the one that navigates away goes and how many times its page loads, once and then on each of its 2 retries, what the
 * one that crashes says, and the stories whose next story must pass, because they leave their page held or crashed.
 *
 * The case runs with a `readyTimeout` of 60 s, in ms. The story that crashes fills V8's heap, about 3.8 GB, before its
 * renderer crashes: 1 to 4 s on a Mac, but 14 to 19 s on CI's runners, past the default 10 s.
 */
const hazards = {
  filter: /^hazards--/,
  readyTimeout: 60_000,
  navigatesAway: { storyId: 'hazards--navigates-away', says: 'navigated away to /categories/burgers', loads: 3 },
  crashes: { storyId: 'hazards--crashes', says: 'The page crashed' },
  followedByPass: ['hazards--before-unload', 'hazards--crashes'],
}

/**
 * The font file the font readiness story asks for. The server never answers it, so the font face stays loading and
 * that story is broken, `fonts-not-loaded`, in every case. Stopping the server drops the held request.
 */
const neverAnsweredPath = '/visual-check-e2e/never-loads.woff2'

/**
 * What the line of each broken readiness story says, a story once for each text it must hold. The CLI's line gives no
 * reason code, so each text is in its reason's own wording, pinning the reason as well as what the story threw or what
 * it was still waiting for when readyTimeout ran out.
 */
const readinessLines: [storyId: string, says: string][] = [
  ['readiness--render-throws', 'The story threw Error: visual-check: the render threw'],
  ['readiness--play-throws', 'play function threw Error: visual-check: play threw'],
  [
    'readiness--play-leaves-unhandled-error',
    'play function left unhandled errors: Error: visual-check: unhandled during play',
  ],
  ['readiness--never-ready', 'Storybook never sent storyFinished'],
  ['readiness--font-never-loads', "fonts hadn't loaded"],
  ['readiness--font-never-loads', 'Still loading: Never Loads'],
]

/**
 * The stories of the stories file that throws as the browser imports it, by the pattern their IDs match. They're
 * broken, `load-failed`, before any baseline is read, so they have none and stay broken in every `test`.
 */
const loadFailsFilter = /^load-fails--/

/**
 * What the line of each broken per-story options story says, in its reason's own wording: what the `wait` hook threw,
 * and that the story's file failed to load, with what the file threw.
 */
const perStoryOptionsLines: [storyId: string, says: string][] = [
  ['wait--throws', "The story's wait hook threw Error: visual-check: wait threw"],
  ['load-fails--first', 'failed to load: Error: visual-check: this stories file fails to load'],
  ['load-fails--second', 'failed to load: Error: visual-check: this stories file fails to load'],
]

/**
 * The stories that `disable: true` leaves out, which `index.json` lists but no run prints a line for or counts.
 */
const disabledStories = ['disabled--skipped', 'options--disabled-on-its-own']

/**
 * The invalid-options case: the script it adds to every `iframe.html`, which runs before Storybook imports any
 * stories file and asks `InvalidWhenAsked` for a `tolerance.pixels` of `'120%'`, and what `test`'s message must name.
 */
const invalidOptions = {
  script: '<script>globalThis.__visualCheckE2eInvalidOptions = true</script>',
  storyId: 'options--invalid-when-asked',
  key: 'visualCheck.tolerance.pixels',
}

/**
 * The invalid-modes case: the story it asks for invalid modes, and for each way it asks, the script it adds to every
 * `iframe.html`, which runs before Storybook imports any stories file, and what `test`'s message must name besides the
 * story. `undeclared` lists a mode whose global Storybook doesn't declare, which only the globals the real Storybook
 * reports can catch. `pinned` lists `dark` on a story that pins `theme` in its own `globals`.
 */
const invalidModes = {
  storyId: 'modes--invalid-mode-when-asked',
  asks: [
    {
      name: 'undeclared',
      script: "<script>globalThis.__visualCheckE2eInvalidModes = 'undeclared'</script>",
      texts: ['visualCheck.modes.e2e-undeclared.globals.e2eNever'],
    },
    {
      name: 'pinned',
      script: "<script>globalThis.__visualCheckE2eInvalidModes = 'pinned'</script>",
      texts: ['visualCheck.modes.dark.globals.theme', 'pins'],
    },
  ],
}

/**
 * What the committed-baselines case checks of the modes stories beyond their outcomes: the story that lists `dark` and
 * `mobile` has exactly 3 lines, its default capture and one per mode, and the story with its own list of modes has no
 * line for the meta's `dark`.
 */
const modeLines = {
  darkAndMobile: { storyId: 'modes--dark-and-mobile', count: 3 },
  ownModesOnly: { storyId: 'modes--own-modes-only', absentMode: 'dark' },
}

/**
 * The header's count of the snapshots a run takes.
 */
const headerCountPattern = /^visual-check \S+ · \S+ · (\d+) snapshots? · /m

/**
 * What the warning for a Storybook that ignores the test path's user agent says, wherever it names the Storybook.
 */
const testPathWarning = 'StorybookTestRunner user agent'

/**
 * The test-path case: the script it adds to every `iframe.html`, which makes `navigator.userAgent` the page's own without
 * ` StorybookTestRunner`, as a Storybook that ignores visual-check's user agent sees it, and the stories it captures,
 * by the pattern their IDs match.
 */
const userAgentIgnored = {
  script:
    '<script>(() => { const plain = navigator.userAgent.replace(" StorybookTestRunner", ""); ' +
    'Object.defineProperty(Navigator.prototype, "userAgent", { configurable: true, get: () => plain }) })()</script>',
  filter: /^button--/,
}

/**
 * The `storybook` package installed for this package, whose version the test-path warning names.
 */
const storybookPackagePath = join(packageDir, 'node_modules', 'storybook', 'package.json')

/**
 * How long the kill cases wait for the browser to ask for story pages, and for the run's containers to go once the
 * CLI is killed or ends, in milliseconds.
 */
const killTimeouts = { capturing: 60_000, removed: 10_000 }

/**
 * What a run says when its browser exits: each line of a story the browser was capturing, then on standard error, in
 * this order, that the browser exited and visual-check relaunched it, and when the relaunched browser exits too, that
 * it exited and the next step.
 */
const browserExits = {
  storyLineSays: 'The browser exited',
  relaunched: ['The browser exited', 'visual-check relaunches it once for the rest of the run.'],
  stopped: ['The browser exited', 'Run visual-check again.'],
}

/**
 * Each mark a snapshot line starts with, then the Storybook, the story ID, the mode for a mode's snapshot and the
 * detail, separated by two spaces. A mode's name takes lowercase letters, digits and -.
 */
const snapshotLinePattern = /^[✓✗!] \S+ {2}(\S+)(?: {2}([a-z0-9-]+))? {2}(.+)$/

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
 * How the static server changes what it serves. A story page is an `iframe.html` with an `id`, the page of the story
 * the browser captures. The page visual-check reads every story's options on, `iframe.html?viewMode=story`, has none.
 */
interface ServeOptions {
  /**
   * Markup added to the end of every `iframe.html`'s `<head>`, the options-reading page's included. Storybook's own
   * scripts there are modules, which run after the document is parsed, so a classic `<script>` here runs first.
   */
  injectIntoIframe?: string
  /**
   * Leaves every story page request unanswered until `releaseStoryPages()` or the server stops, so a run can't finish
   * a capture meanwhile. The options-reading page is answered at once.
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
   * The ID of the story each request for a story page was for, the `id` of its `iframe.html`, in the order they came,
   * held or not. A request means the browser is capturing that story. The options-reading page isn't a story page.
   */
  storyPageRequests: () => string[]
  /**
   * Stops holding the story pages: answers every held request, and every later one as it comes.
   */
  releaseStoryPages: () => void
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
   * The snapshot's key: the story ID for the story's default capture, `<story-id>.<mode>` for a mode's snapshot.
   */
  key: string
  /**
   * The story's ID.
   */
  storyId: string
  /**
   * The mode the snapshot is of, or `undefined` for the story's default capture.
   */
  mode: string | undefined
  /**
   * The outcome the line gives.
   */
  outcome: Outcome
  /**
   * What the line says after the story ID and the mode, such as `120 ms` or `broken: ` and why.
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
   * Its standard output.
   */
  stdout: string
  /**
   * Its standard error.
   */
  stderr: string
  /**
   * Each snapshot line, in the order the CLI printed them.
   */
  snapshots: SnapshotLine[]
  /**
   * Each snapshot line's outcome, by snapshot key.
   */
  outcomes: Outcomes
}

/**
 * A CLI that is followed while it runs.
 */
interface FollowedCli {
  /**
   * Resolves with what it printed and how it ended, once it has ended or the time limit has killed it. Rejects when it
   * couldn't run, or printed a snapshot line with no known outcome.
   */
  finished: Promise<CliRun>
  /**
   * What it has printed on standard error so far.
   */
  stderr: () => string
  /**
   * How it ended, such as `exited 2`, or `undefined` while it runs.
   */
  ending: () => string | undefined
  /**
   * Kills it with `SIGKILL`, unless it has ended.
   */
  kill: () => void
}

/**
 * A CLI run against a server that holds the story pages, as the kill cases start it.
 */
interface HeldRun {
  /**
   * The server, which holds the story pages until they're released.
   */
  server: StorybookServer
  /**
   * The CLI, followed.
   */
  cli: FollowedCli
  /**
   * The IDs of the visual-check containers that were there before the run, which don't count.
   */
  before: ReadonlySet<string>
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
 * The part of the installed `storybook` package that the test-path case uses.
 */
interface StorybookPackage {
  /**
   * Its version, such as `10.6.7`.
   */
  version: string
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
 * Lists what the check needs and doesn't have: the package name, the static build and the built CLI, arguments that
 * go together, then what its mode needs.
 */
function findSetupProblems(): string[] {
  return [...findBuildProblems(), ...findArgumentProblems(), ...findModeProblems()]
}

/**
 * Lists what is missing from the folder the check starts in: a package name, the static build and the built CLI. Each
 * missing build says how to make it, naming the package.
 */
function findBuildProblems(): string[] {
  const packageName = readPackageName()
  const hint = packageName === undefined ? 'run it from a test Storybook package folder.' : turboHint(packageName)

  return [
    ...findPackageNameProblems(packageName),
    ...(existsSync(join(staticDir, 'index.json')) ? [] : [`storybook-static/ is missing: ${hint}`]),
    ...(existsSync(cliBin) ? [] : [`The CLI is not built: ${hint}`]),
  ]
}

/**
 * Lists the problem with a missing package name: the folder the check starts in has no `package.json` with one.
 *
 * @param packageName - The name `readPackageName` read, if any.
 */
function findPackageNameProblems(packageName: string | undefined): string[] {
  return packageName === undefined ? [`No package name: ${packageDir} has no package.json with a name.`] : []
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
 * Reads the `storybook` package installed for this package.
 */
function readStorybookPackage(): StorybookPackage {
  return JSON.parse(readFileSync(storybookPackagePath, 'utf8')) as StorybookPackage
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
 * Answers a request for a URL path with the static build's file, or 404 when it names no file there. Every
 * `iframe.html`, the options-reading page included, gets the markup `injectIntoIframe` gives.
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
    .end(pathname === '/iframe.html' ? withMarkup(body, options.injectIntoIframe) : body)
}

/**
 * Gives the ID of the story a request is for when it asks for a story page, an `iframe.html` with an `id`, or
 * `undefined` for any other request, the options-reading page's included.
 */
function storyPageIdOf(pathname: string, searchParams: URLSearchParams): string | undefined {
  return pathname === '/iframe.html' ? (searchParams.get('id') ?? undefined) : undefined
}

/**
 * Serves the static build on a free port of 127.0.0.1, changed as the options say, and records the requests for story
 * pages. While it holds them, it keeps each one's answer until they're released. The options-reading page is never
 * held or recorded, so a run reads every story's options before it asks for a story page. It never answers a request
 * for the font file the font readiness story asks for, until it stops.
 */
async function serveStorybook(options: ServeOptions = {}): Promise<StorybookServer> {
  const storyPageRequests: string[] = []
  const heldAnswers: (() => void)[] = []
  let holding = options.holdStoryPages ?? false

  /**
   * Records a request for a story page, then answers it, or keeps the answer while the server holds story pages.
   */
  const answerStoryPage = (storyId: string, answer: () => void): void => {
    storyPageRequests.push(storyId)

    if (holding) {
      heldAnswers.push(answer)

      return
    }

    answer()
  }

  const server = createServer((request, response) => {
    const { pathname, searchParams } = new URL(request.url ?? '/', 'http://127.0.0.1')
    const answer = (): void => serveFile(pathname, response, options)
    const storyId = storyPageIdOf(pathname, searchParams)

    if (pathname === neverAnsweredPath) {
      return
    }

    if (storyId !== undefined) {
      answerStoryPage(storyId, answer)

      return
    }

    answer()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    storyPageRequests: () => [...storyPageRequests],
    releaseStoryPages: () => {
      holding = false

      for (const answer of heldAnswers.splice(0)) {
        answer()
      }
    },
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
 * Reads a snapshot line's key, story ID, mode, outcome and detail. Any other line gives nothing.
 *
 * @throws {Error} When a snapshot line ends in a detail no outcome has.
 */
function snapshotOf(line: string): SnapshotLine[] {
  const match = snapshotLinePattern.exec(line)

  if (match === null) {
    return []
  }

  const [, storyId = '', mode, detail = ''] = match
  const outcome = outcomeDetails.find(([, pattern]) => pattern.test(detail))?.[0]

  if (outcome === undefined) {
    throw new Error(`The CLI printed a snapshot line with no known outcome: ${line}`)
  }

  return [{ key: snapshotKeyOf(storyId, mode), storyId, mode, outcome, detail }]
}

/**
 * The key of a story's snapshot: the story ID for its default capture, `<story-id>.<mode>` for a mode's snapshot. It
 * mirrors the CLI's key (docs/prd/10-baselines-and-update.md › File names), which the e2e can't import.
 */
function snapshotKeyOf(storyId: string, mode: string | undefined): string {
  return mode === undefined ? storyId : `${storyId}.${mode}`
}

/**
 * Runs the built CLI to the end, or until the time limit kills it, and reads its outcomes.
 */
async function runCli(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<CliRun> {
  return await followCli(startCli(args, env)).finished
}

/**
 * Reads a run's snapshot lines and outcomes from what the CLI printed on standard output, given how it ended.
 *
 * @throws {Error} When a snapshot line ends in a detail no outcome has.
 */
function cliRunOf(stdout: string, ended: Omit<CliRun, 'stdout' | 'snapshots' | 'outcomes'>): CliRun {
  const snapshots = parseSnapshots(stdout)
  const outcomes = Object.fromEntries(snapshots.map((snapshot) => [snapshot.key, snapshot.outcome]))

  return { ...ended, stdout, snapshots, outcomes }
}

/**
 * Follows a started CLI: collects what it prints, notes how it ends and reads its run once it has ended, or the time
 * limit has killed it. Follow it as soon as it starts: following it later can miss its `close` event and wait forever,
 * and the time limit counts from the start.
 */
function followCli(cli: CliProcess): FollowedCli {
  const started = performance.now()
  let stdout = ''
  let stderr = ''
  let ending: string | undefined

  cli.stdout.setEncoding('utf8').on('data', (text: string) => {
    stdout += text
  })
  cli.stderr.setEncoding('utf8').on('data', (text: string) => {
    stderr += text
  })
  cli.on('exit', (code, signal) => {
    ending ??= signal === null ? `exited ${code}` : `was ended by ${signal}`
  })

  const finished = new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
    cli.on('error', (error) => {
      ending ??= `couldn't run: ${error.message}`
      reject(error)
    })
    cli.on('close', (code, signal) => resolve([code, signal]))
  }).then(([exitCode, signal]) => {
    const timedOut = signal === 'SIGKILL' && performance.now() - started >= cliTimeoutMilliseconds

    return cliRunOf(stdout, { exitCode, signal, timedOut, stderr })
  })

  // A case that stops before the CLI ends never awaits its run, so a CLI that couldn't run mustn't reject unhandled.
  finished.catch(() => undefined)

  return { finished, stderr: () => stderr, ending: () => ending, kill: () => cli.kill('SIGKILL') }
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
 * Lists every snapshot whose outcome isn't the expected one, by key, including snapshots only one side has.
 */
function outcomeProblems(command: string, actual: Outcomes, expected: Outcomes): string[] {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()

  return keys
    .filter((key) => actual[key] !== expected[key])
    .map(
      (key) =>
        `${command}: ${key} is ${actual[key] ?? 'not in the run'}, expected ${expected[key] ?? 'no such snapshot'}`,
    )
}

/**
 * The exit code a run gives for these outcomes: 1 when any story differs, is broken or is missing, else 0.
 */
function exitCodeOf(outcomes: Outcomes): number {
  return Object.values(outcomes).some((outcome) => failingOutcomes.includes(outcome)) ? 1 : 0
}

/**
 * Changes each snapshot's outcome with `change`, which gets the outcome and the snapshot's key.
 */
function mapOutcomes(outcomes: Outcomes, change: (outcome: Outcome, key: string) => Outcome): Outcomes {
  return Object.fromEntries(Object.entries(outcomes).map(([key, outcome]) => [key, change(outcome, key)]))
}

/**
 * What `update` into an empty folder gives a story with this expected `test` outcome: a broken story stays broken,
 * any other is written.
 */
function updateOutcomeOf(outcome: Outcome): Outcome {
  return outcome === 'broken' ? 'broken' : 'written'
}

/**
 * What `test` gives a story with this expected `test` outcome right after `update` into an empty folder: a broken
 * story has no baseline, so it's missing, because `test` never captures a story without one, and any other passes.
 * The stories of the stories file that fails to load stay broken, since they're broken before any baseline is read.
 */
function retestOutcomeOf(outcome: Outcome, key: string): Outcome {
  if (outcome !== 'broken') {
    return 'passed'
  }

  return loadFailsFilter.test(key) ? 'broken' : 'missing'
}

/**
 * Whether both files exist and hold the same bytes.
 */
function isSameFile(path: string, otherPath: string): boolean {
  return isFile(path) && isFile(otherPath) && readFileSync(path).equals(readFileSync(otherPath))
}

/**
 * Lists the written baselines of these snapshots, by key, that aren't byte-identical to the committed ones. When there
 * are any, it copies every written baseline to the diagnostics folder and names it.
 */
function baselineProblems(written: string, keys: string[]): string[] {
  const differing = keys
    .map((key) => `${key}.png`)
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
 * What a written config sets besides the Storybook, its baselines, the image and 2 workers.
 */
interface ConfigOptions {
  /**
   * The platform the browser runs on. The config's default when not given.
   */
  platform?: string | undefined
  /**
   * The `readyTimeout`, in ms. The config's default when not given.
   */
  readyTimeout?: number
  /**
   * How many more times a failing snapshot is captured before it fails. The config's default when not given.
   */
  retries?: number
  /**
   * The project's tolerance, which each story's own overrides key by key. The config's default when not given. It's
   * the subset of the CLI's `Tolerance` this check writes: counts of pixels, not shares.
   */
  tolerance?: { color?: number; pixels?: number }
}

/**
 * Writes a config for this Storybook, served at the URL, with its baselines in the given folder, that captures with 2
 * workers, and the platform, `readyTimeout`, `retries` and `tolerance` the options give. Gives its path. `test`'s report
 * goes into `.visual-check/report` in that folder.
 */
function writeConfig(folder: string, url: string, baselines: string, options: ConfigOptions = {}): string {
  const path = join(folder, 'visual-check.config.mjs')
  const config = {
    storybooks: { react: { url, dir: packageDir, baselines } },
    image,
    workers: parallelWorkers,
    ...options,
  }

  writeFileSync(path, `export default ${JSON.stringify(config, null, 2)}\n`)

  return path
}

/**
 * Runs a docker command and gives its standard output. It is killed when it runs past its time limit.
 *
 * @throws {Error} When the command fails or runs past its time limit.
 */
function docker(args: string[]): string {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: dockerTimeoutMilliseconds })

  if (result.status !== 0) {
    throw new Error(`docker ${args[0]} failed: ${String(result.error ?? result.stderr.trim())}`)
  }

  return result.stdout
}

/**
 * Lists the IDs of visual-check's containers: running ones, or all of them, stopped ones included.
 */
function visualCheckContainers(which: 'running' | 'all'): string[] {
  const all = which === 'all' ? ['-a'] : []

  return docker(['ps', ...all, '--filter', `name=${containerNamePattern}`, '-q'])
    .split('\n')
    .filter((line) => line !== '')
}

/**
 * Lists the IDs of visual-check's containers that weren't there before.
 */
function newContainers(which: 'running' | 'all', before: ReadonlySet<string>): string[] {
  return visualCheckContainers(which).filter((id) => !before.has(id))
}

/**
 * Kills every running visual-check container that wasn't there before, other runs' included, so the browser in it
 * exits, and gives their IDs.
 *
 * @throws {Error} When there is no such container, or `docker kill` fails.
 */
function killNewContainers(before: ReadonlySet<string>): string[] {
  const ids = newContainers('running', before)

  if (ids.length === 0) {
    throw new Error('no new visual-check container to kill')
  }

  docker(['kill', ...ids])

  return ids
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
 * `test` against the committed baselines, with 2 workers, gives exactly the expected outcomes. Each broken readiness
 * and per-story options story's line says why, and standard error has no test-path warning, since every page is on
 * Storybook's test path. The disabled stories, which `index.json` lists, have no line, and the header counts exactly
 * the snapshots with an expected outcome, the modes' included. The story that lists `dark` and `mobile` has exactly 3
 * lines, and the story with its own list of modes has no line for the meta's `dark`. Outside the Storybook 10 test
 * Storybook, the committed animation baselines are byte-identical to its own.
 */
async function checkCommittedBaselines(expected: Outcomes): Promise<string[]> {
  return await withStorybookServer({}, async (server) => {
    const run = await runCli(['test', '--all', '--url', server.url, '--workers', String(parallelWorkers)])

    return [
      ...expectedRunProblems('test', run, expected),
      ...[...readinessLines, ...perStoryOptionsLines].flatMap(([storyId, says]) =>
        lineSaysProblems(run, storyId, says),
      ),
      ...noTestPathWarningProblems(run.stderr),
      ...storybook10AnimationProblems(),
      ...disabledStoryProblems(run),
      ...headerCountProblems(run, Object.keys(expected).length),
      ...lineCountProblems(run, modeLines.darkAndMobile.storyId, modeLines.darkAndMobile.count),
      ...absentModeProblems(run, modeLines.ownModesOnly.storyId, modeLines.ownModesOnly.absentMode),
    ]
  })
}

/**
 * Gives the problem when a story doesn't have this many snapshot lines, its default capture's and its modes', or none
 * when it does.
 */
function lineCountProblems(run: CliRun, storyId: string, count: number): string[] {
  const lines = run.snapshots.filter((snapshot) => snapshot.storyId === storyId)

  return lines.length === count
    ? []
    : [
        `test printed ${lines.length} lines for ${storyId}, expected ${count}: ${lines.map(({ key }) => key).join(', ')}`,
      ]
}

/**
 * Gives the problem when a story has a snapshot line for this mode, or none when it hasn't.
 */
function absentModeProblems(run: CliRun, storyId: string, mode: string): string[] {
  return run.snapshots.some((snapshot) => snapshot.storyId === storyId && snapshot.mode === mode)
    ? [`test printed a line for ${snapshotKeyOf(storyId, mode)}, which the story's own modes leave out`]
    : []
}

/**
 * Lists how the committed animation baselines differ from the Storybook 10 test Storybook's, or none when this is that
 * Storybook. Both folders must hold the same `animations--*.png` files, byte for byte. `test` passes each animation
 * story here against its baseline, so on Storybook 11 this checks that its own pause of animations, then visual-check's
 * end state, gives Storybook 10's snapshots within the tolerance.
 */
function storybook10AnimationProblems(): string[] {
  if (committedBaselines === storybook10Baselines) {
    return []
  }

  const names = new Set([
    ...animationBaselineNames(committedBaselines),
    ...animationBaselineNames(storybook10Baselines),
  ])

  return [...names].sort().flatMap((name) => storybook10MatchProblems(name))
}

/**
 * Lists the names of the animation stories' baselines in a folder, such as `animations--video.png`.
 */
function animationBaselineNames(folder: string): string[] {
  return readdirSync(folder).filter((name) => animationFilter.test(name) && extname(name) === '.png')
}

/**
 * Gives the problem with a baseline when it isn't committed both in this package and in the Storybook 10 test
 * Storybook, or isn't byte-identical in both, or none. The problem names this package by its folder, such as
 * `storybook-11-react`.
 */
function storybook10MatchProblems(name: string): string[] {
  const packageFolder = basename(packageDir)
  const committed = join(committedBaselines, name)
  const storybook10 = join(storybook10Baselines, name)

  if (!isFile(committed)) {
    return [`${name} is in storybook-10-react's baselines but not committed in ${packageFolder}`]
  }

  if (!isFile(storybook10)) {
    return [`${name} is committed in ${packageFolder} but not in storybook-10-react's baselines`]
  }

  return isSameFile(committed, storybook10) ? [] : [`${name} in ${packageFolder} differs from storybook-10-react's`]
}

/**
 * On one server, `test` runs the animation stories against the committed baselines 10 times, one run after the
 * other, with a config that sets 2 workers, `retries: 0` and `tolerance: { pixels: 0 }`, and each run gives every one
 * of them its expected outcome. With no retries and no pixel allowed to differ, a run that passes captured each snapshot
 * with every pixel within the preview's color tolerance, 0.01, of its baseline. Every run's problems are kept, each led
 * by its run's number, so a story whose snapshot changes shows how often it did. A run that a signal ended, as the time
 * limit does, stops the case: that's a broken setup, not a snapshot that changed, and 10 of them would outlast CI's job.
 */
async function checkEndStateRuns(expected: Outcomes): Promise<string[]> {
  const expectedAnimations = outcomesMatching(expected, animationFilter)

  return await withStorybookServer({}, (server) =>
    withTemporaryFolder(async (folder) => {
      const config = writeConfig(folder, server.url, committedBaselines, { retries: 0, tolerance: { pixels: 0 } })
      const problems: string[] = []

      for (let runNumber = 1; runNumber <= endStateRuns; runNumber += 1) {
        const run = await runCli(['test', '--filter', animationFilter.source, '--config', config])

        problems.push(
          ...expectedRunProblems('test', run, expectedAnimations).map((problem) => `run ${runNumber}: ${problem}`),
        )

        if (run.signal !== null && runNumber < endStateRuns) {
          problems.push(`runs ${runNumber + 1} to ${endStateRuns} not run: run ${runNumber} was ended by ${run.signal}`)

          break
        }
      }

      return problems
    }),
  )
}

/**
 * Gives the problems with the disabled stories: one that `index.json` doesn't list, so its missing line proves nothing,
 * or one the run printed a line for. None when `index.json` lists each of them and none has a line.
 */
function disabledStoryProblems(run: CliRun): string[] {
  const indexed = readIndexedStoryIds()

  return disabledStories.flatMap((storyId) => [
    ...(indexed.includes(storyId) ? [] : [`index.json doesn't list ${storyId}`]),
    ...(run.snapshots.some((snapshot) => snapshot.storyId === storyId)
      ? [`test printed a line for ${storyId}, which is disabled`]
      : []),
  ])
}

/**
 * Reads the ID of every entry the static build's `index.json` lists.
 */
function readIndexedStoryIds(): string[] {
  const { entries } = JSON.parse(readFileSync(join(staticDir, 'index.json'), 'utf8')) as { entries: object }

  return Object.keys(entries)
}

/**
 * Gives the problem with a run's header when it doesn't count this many snapshots, or none when it does.
 */
function headerCountProblems(run: CliRun, count: number): string[] {
  const counted = headerCountPattern.exec(run.stdout)?.[1]

  return counted === String(count) ? [] : [`test's header counts ${counted ?? 'no'} snapshots, expected ${count}`]
}

/**
 * `update` into an empty folder writes every story that isn't broken, `test` then passes them and finds the broken
 * ones missing, apart from the stories of the file that fails to load, which stay broken, and the baselines of the
 * stories expected to pass are byte-identical to the committed ones. Only those have a committed baseline the written
 * one must equal. Both commands take 2 workers from the config.
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

      const passing = Object.keys(expected).filter((key) => expected[key] === 'passed')

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
 * Keeps the expected outcomes of the snapshots whose key matches the pattern.
 */
function outcomesMatching(expected: Outcomes, pattern: RegExp): Outcomes {
  return Object.fromEntries(Object.entries(expected).filter(([key]) => pattern.test(key)))
}

/**
 * Gives the problem with the snapshot line of a story's default capture when it doesn't say `text`, or none when it
 * does or the run has no line for it, which the outcome check reports.
 */
function lineSaysProblems(run: CliRun, storyId: string, text: string): string[] {
  const line = run.snapshots.find((snapshot) => snapshot.key === storyId)

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
  const seen = server.storyPageRequests().filter((requested) => requested === storyId).length

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
  const index = run.snapshots.findIndex((snapshot) => snapshot.key === storyId)

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
    : [`test: ${next.key}, the snapshot after ${storyId}, is ${next.outcome}, expected passed`]
}

/**
 * On one worker, the hazard stories run one after the other in index order, and `test` against the committed baselines
 * gives exactly their expected outcomes. The story that navigates away is broken saying where it went, after its page
 * loaded 3 times. The story that crashes is broken saying its page crashed. The stories after `BeforeUnload` and
 * `Crashes` pass, so a page that a `beforeunload` dialog holds, or a crashed page that isn't replaced, shows.
 */
async function checkHazards(expected: Outcomes): Promise<string[]> {
  return await withStorybookServer({}, (server) =>
    withTemporaryFolder(async (folder) => {
      const config = writeConfig(folder, server.url, committedBaselines, { readyTimeout: hazards.readyTimeout })
      const run = await runCli(['test', '--filter', hazards.filter.source, '--workers', '1', '--config', config])

      return [
        ...expectedRunProblems('test', run, outcomesMatching(expected, hazards.filter)),
        ...navigatedAwayProblems(run, server),
        ...lineSaysProblems(run, hazards.crashes.storyId, hazards.crashes.says),
        ...hazards.followedByPass.flatMap((storyId) => followedByPassProblems(run, storyId)),
      ]
    }),
  )
}

/**
 * A visible change to one story fails `test` with that story's snapshot differing, and every other story as expected.
 */
async function checkDeliberateChange(expected: Outcomes): Promise<string[]> {
  return await withStorybookServer({ injectIntoIframe: deliberateChange.style }, async (server) => {
    const run = await runCli(['test', '--all', '--url', server.url])

    return [
      ...exitCodeProblems('test', run, 1),
      ...outcomeProblems('test', run.outcomes, { ...expected, [deliberateChange.storyId]: 'differs' }),
    ]
  })
}

/**
 * With one pixel of the card story changed, `test` on that story against the committed baselines fails with a config
 * that sets `tolerance: { pixels: 0 }`: the story differs, its line says `1 differ, 0 allowed`, and the report beside
 * the config holds its baseline, snapshot and diff. With the default tolerance, the same `test` gives the story its
 * expected outcome, passed. Each problem starts with the tolerance its run had.
 */
async function checkOnePixelChange(expected: Outcomes): Promise<string[]> {
  const { storyId, filter, style, says } = onePixelChange
  const defaultExpected = outcomesMatching(expected, filter)

  return await withStorybookServer({ injectIntoIframe: style }, (server) =>
    withTemporaryFolder(async (folder) => {
      const testArgs = ['test', '--filter', filter.source]
      const noPixelsConfig = writeConfig(folder, server.url, committedBaselines, { tolerance: { pixels: 0 } })
      const noPixelsRun = await runCli([...testArgs, '--config', noPixelsConfig])
      // Every `test` clears the report first, so its images are checked before the default run.
      const noPixelsProblems = [
        ...expectedRunProblems('test', noPixelsRun, { [storyId]: 'differs' }),
        ...lineSaysProblems(noPixelsRun, storyId, says),
        ...reportImageProblems(folder, storyId),
      ]
      const defaultConfig = writeConfig(folder, server.url, committedBaselines)
      const defaultRun = await runCli([...testArgs, '--config', defaultConfig])

      return [
        ...noPixelsProblems.map((problem) => `pixels: 0: ${problem}`),
        ...expectedRunProblems('test', defaultRun, defaultExpected).map((problem) => `default tolerance: ${problem}`),
      ]
    }),
  )
}

/**
 * Lists each image of a snapshot that the report beside a config in this folder doesn't hold for the Storybook
 * `react`, or none when it holds them all.
 */
function reportImageProblems(configFolder: string, key: string): string[] {
  const imagesFolder = join(configFolder, '.visual-check', 'report', 'images', 'react')

  return reportImageKinds
    .map((kind) => join(imagesFolder, `${key}.${kind}.png`))
    .filter((path) => !isFile(path))
    .map((path) => `test wrote no ${path}`)
}

/**
 * With every `iframe.html`'s `navigator.userAgent` its own without `StorybookTestRunner`, Storybook takes the path it
 * takes off the test path, waiting about 100 ms as each story completes. `test` with 2 workers gives the button
 * stories their expected outcomes, so it exits 0, and standard error warns once that the Storybook seems to ignore the
 * user agent, naming it and the version of the `storybook` package installed here. The case writes its own config
 * naming the Storybook `react`, so the warning names `react` whichever folder the check runs from.
 */
async function checkTestPathWarning(expected: Outcomes): Promise<string[]> {
  const { version } = readStorybookPackage()

  return await withStorybookServer({ injectIntoIframe: userAgentIgnored.script }, (server) =>
    withTemporaryFolder(async (folder) => {
      const config = writeConfig(folder, server.url, committedBaselines)
      const run = await runCli(['test', '--filter', userAgentIgnored.filter.source, '--config', config])

      return [
        ...expectedRunProblems('test', run, outcomesMatching(expected, userAgentIgnored.filter)),
        ...testPathWarningProblems(run.stderr, version),
      ]
    }),
  )
}

/**
 * Gives the problem with standard error when it doesn't warn about the test path exactly once, or the warning doesn't
 * name the Storybook `react` and this `storybook` version, or none.
 */
function testPathWarningProblems(stderr: string, storybookVersion: string): string[] {
  const warnings = stderr.split('\n').filter((line) => line.includes(testPathWarning))
  const [warning, ...others] = warnings
  const names = `Storybook react (storybook ${storybookVersion})`

  if (warning === undefined || others.length > 0) {
    return [`test warned about the test path ${warnings.length} times, expected once${outputOf(stderr)}`]
  }

  return warning.includes(names) ? [] : [`test's warning doesn't name ${names}: ${warning}`]
}

/**
 * Gives the problem with standard error when it warns about the test path, or none.
 */
function noTestPathWarningProblems(stderr: string): string[] {
  return stderr.includes(testPathWarning) ? [`test warned about the test path${outputOf(stderr)}`] : []
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
      const config = writeConfig(folder, server.url, committedBaselines, { platform })

      return check(await runCli(['test', '--all', '--config', config]), server)
    }),
  )
}

/**
 * With every page of the Storybook asking `InvalidWhenAsked` for a `tolerance.pixels` of `'120%'`, `test` exits 2
 * before any capture, its message naming the story and the key, and prints nothing on standard output.
 */
async function checkInvalidOptions(): Promise<string[]> {
  return await checkRejectedBeforeCapture(invalidOptions.script, [invalidOptions.storyId, invalidOptions.key])
}

/**
 * For each way the invalid-modes case asks `InvalidModeWhenAsked` for invalid modes, in turn, `test` exits 2 before
 * any capture, its message naming the story and the key, and prints nothing on standard output, so no snapshot line.
 * Each problem starts with the way it asked.
 */
async function checkInvalidModes(): Promise<string[]> {
  const problems: string[] = []

  for (const { name, script, texts } of invalidModes.asks) {
    const asked = await checkRejectedBeforeCapture(script, [invalidModes.storyId, ...texts])

    problems.push(...asked.map((problem) => `${name}: ${problem}`))
  }

  return problems
}

/**
 * With this markup in every page of the Storybook, `test` exits 2 before any capture, its message holding each of the
 * texts, and prints nothing on standard output.
 */
async function checkRejectedBeforeCapture(markup: string, texts: string[]): Promise<string[]> {
  return await withStorybookServer({ injectIntoIframe: markup }, async (server) => {
    const run = await runCli(['test', '--all', '--url', server.url])

    return [
      ...exitCodeProblems('test', run, 2),
      ...missingTextProblems(run.stderr, texts),
      ...(run.stdout === '' ? [] : [`test printed on standard output: ${run.stdout.trim()}`]),
      ...capturedProblems(server),
    ]
  })
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
 * Notes the visual-check containers that are there, starts a server that holds the story pages and the CLI with these
 * arguments and the server's `--url`, and hands them to `use`. Kills the CLI, unless it has ended, and stops the server
 * however `use` ends.
 */
async function withHeldRun<T>(args: string[], use: (run: HeldRun) => Promise<T>): Promise<T> {
  const before = new Set(visualCheckContainers('all'))

  return await withStorybookServer({ holdStoryPages: true }, async (server) => {
    const cli = followCli(startCli([...args, '--url', server.url], process.env))

    try {
      return await use({ server, cli, before })
    } finally {
      cli.kill()
    }
  })
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
  return server.storyPageRequests().length > 0 ? ['the browser asked for a story, so the run captured'] : []
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
    config: writeConfig(folder, url, join(folder, 'baselines'), { platform: 'host' }),
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
  return await withHeldRun(['test', '--all'], async ({ server, cli, before }) => {
    await waitForCapture(server, cli, before, 1)
    cli.kill()

    return await waitForRemoval(before)
  })
}

/**
 * Runs `test --all` with 2 workers as `withHeldRun` does, waits until both workers have asked the first browser for a
 * story page, and hands the run and the IDs of those stories, the ones in flight, to `use`.
 */
async function withBothWorkersCapturing<T>(use: (run: HeldRun, inFlight: string[]) => Promise<T>): Promise<T> {
  return await withHeldRun(['test', '--all', '--workers', String(parallelWorkers)], async (run) => {
    await waitForCapture(run.server, run.cli, run.before, parallelWorkers)

    return await use(run, run.server.storyPageRequests())
  })
}

/**
 * With 2 workers, killing the browser's container once both have asked for a story page, which the server holds,
 * breaks those 2 stories, each line saying the browser exited. The server then answers every story page, and the
 * browser relaunches for the stories left, which get their expected outcomes. `test` exits 1, its standard error says
 * the browser exited and visual-check relaunched it, and none of the run's containers is left. Containers that were
 * there before the run don't count.
 */
async function checkBrowserExitsOnce(expected: Outcomes): Promise<string[]> {
  return await withBothWorkersCapturing(async ({ server, cli, before }, inFlight) => {
    killNewContainers(before)
    server.releaseStoryPages()

    const run = await cli.finished

    return [
      ...exitCodeProblems('test', run, 1),
      ...brokenByExitProblems(run, inFlight, expected),
      ...stderrInOrderProblems('test', run, browserExits.relaunched),
      ...(await waitForRemoval(before)),
    ]
  })
}

/**
 * With 2 workers and the story pages held throughout, killing the browser's container once both have asked for a
 * story page, then the relaunched browser's once it asks for one, stops `test` with exit 2. The 2 stories the first
 * browser was capturing are broken, each line saying the browser exited, and no other story finished. Standard error
 * says the browser exited and visual-check relaunched it, then that the browser exited again and the next step, and
 * none of the run's containers is left. Containers that were there before the run don't count.
 */
async function checkBrowserExitsTwice(): Promise<string[]> {
  return await withBothWorkersCapturing(async ({ server, cli, before }, inFlight) => {
    const beforeRelaunch = new Set([...before, ...killNewContainers(before)])

    // Each held worker can ask the first browser for only one page, so the next request comes from the relaunch.
    await waitForCapture(server, cli, beforeRelaunch, parallelWorkers + 1)
    killNewContainers(beforeRelaunch)

    const run = await cli.finished

    return [
      ...exitCodeProblems('test', run, 2),
      ...brokenByExitProblems(run, inFlight, {}),
      ...stderrInOrderProblems('test', run, [...browserExits.relaunched, ...browserExits.stopped]),
      ...(await waitForRemoval(before)),
    ]
  })
}

/**
 * Lists how a run's outcomes differ from these: each story in flight when the first browser exited broken, its line
 * saying the browser exited, and every other story as `others` gives.
 */
function brokenByExitProblems(run: CliRun, inFlight: string[], others: Outcomes): string[] {
  const brokenByExit = Object.fromEntries(inFlight.map((storyId) => [storyId, 'broken'] as const))

  return [
    ...outcomeProblems('test', run.outcomes, { ...others, ...brokenByExit }),
    ...inFlight.flatMap((storyId) => lineSaysProblems(run, storyId, browserExits.storyLineSays)),
  ]
}

/**
 * Whether the text holds each of the parts, each one after the end of the one before.
 */
function holdsInOrder(text: string, parts: string[]): boolean {
  let from = 0

  for (const part of parts) {
    const index = text.indexOf(part, from)

    if (index === -1) {
      return false
    }

    from = index + part.length
  }

  return true
}

/**
 * Gives the problem with a run's standard error when it doesn't say each of the texts, in this order, or none when it
 * does.
 */
function stderrInOrderProblems(command: string, run: CliRun, texts: string[]): string[] {
  return holdsInOrder(run.stderr, texts)
    ? []
    : [`${command} doesn't say ${texts.map((text) => `"${text}"`).join(', then ')}${outputOf(run.stderr)}`]
}

/**
 * Waits until the browser has asked for this many story pages in all, which the server holds, and a visual-check
 * container that isn't in `before` is running.
 *
 * @throws {Error} When the CLI ends first, the browser hasn't asked for them in time, or no such container is running.
 */
async function waitForCapture(
  server: StorybookServer,
  cli: FollowedCli,
  before: ReadonlySet<string>,
  storyPages: number,
): Promise<void> {
  const asked = (): number => server.storyPageRequests().length

  await waitUntil(() => asked() >= storyPages || cli.ending() !== undefined, killTimeouts.capturing)

  const ending = cli.ending()

  if (ending !== undefined) {
    throw new Error(`the CLI ${ending} before the kill${outputOf(cli.stderr())}`)
  }

  if (asked() < storyPages) {
    throw new Error(
      `the browser asked for ${asked()} story pages in ${killTimeouts.capturing / 1000} s, expected ${storyPages}`,
    )
  }

  if (newContainers('running', before).length === 0) {
    throw new Error('no new visual-check container was running while the CLI captured')
  }
}

/**
 * Waits for every visual-check container the run started to go. Gives the ones that remain once the time is up.
 */
async function waitForRemoval(before: ReadonlySet<string>): Promise<string[]> {
  const removed = await waitUntil(() => newContainers('all', before).length === 0, killTimeouts.removed)

  return removed
    ? []
    : [`containers remain after ${killTimeouts.removed / 1000} s: ${newContainers('all', before).join(', ')}`]
}

/**
 * The cases only Docker can run, since they kill the CLI or visual-check's container: the CLI killed, and the browser
 * exiting once and twice.
 */
function outsideImageCases(expected: Outcomes): Case[] {
  return [
    { name: 'killing the CLI: no container is left behind', run: checkKill },
    {
      name: 'browser exits once: the stories in flight are broken saying so, the browser relaunches for the rest, test exits 1 saying it relaunched, no container is left behind',
      run: () => checkBrowserExitsOnce(expected),
    },
    {
      name: "browser exits twice: the first browser's stories are broken saying so, test exits 2 saying the browser exited, was relaunched and exited again, no container is left behind",
      run: checkBrowserExitsTwice,
    },
  ]
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
    {
      name: "committed baselines: test gives the expected outcomes, each broken readiness and per-story options story's line says why, no line for a disabled story, the header counts the expected outcomes, a story listing two modes has 3 lines, a story's own modes leave out the meta's, no test-path warning, the animation baselines are byte-identical to storybook-10-react's",
      run: () => checkCommittedBaselines(expected),
    },
    {
      name: `end state: ${endStateRuns} runs of test with pixels: 0 give every animation story its expected outcome`,
      run: () => checkEndStateRuns(expected),
    },
    {
      name: "update then test: update writes every story that isn't broken, test passes them and finds the broken ones missing, apart from the ones whose file fails to load, the baselines match the committed ones",
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
    {
      name: `one-pixel change: with pixels: 0, test exits 1, ${onePixelChange.storyId} differs saying "1 differ, 0 allowed" and the report holds its images; with the default tolerance, test passes it`,
      run: () => checkOnePixelChange(expected),
    },
    {
      name: "test path: a Storybook that ignores the test path's user agent triggers the warning once, and the run passes",
      run: () => checkTestPathWarning(expected),
    },
    {
      name: 'invalid per-story options: test exits 2 naming the story and the key, before any capture',
      run: checkInvalidOptions,
    },
    {
      name: 'invalid modes: test exits 2 naming the story and the key, for an undeclared global and a pinned one, before any capture',
      run: checkInvalidModes,
    },
    ...(insideImage ? insideImageCases(expected) : outsideImageCases(expected)),
  ])

  process.exitCode = passed ? 0 : 1
}
