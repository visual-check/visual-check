// The end-to-end check of a test Storybook: it serves the static build, runs the built CLI against it and checks
// what the CLI reports. It works in the folder it starts in, so each test Storybook runs this same file from its own
// folder, as `node ../storybook-10-react/e2e.ts`. Run it with `pnpm turbo run e2e --filter <package name>`, which builds
// the CLI and the Storybook first, with TEST_STORYBOOK_IMAGE naming the browser image. It prints one line per case,
// then each of its problems, and exits 1 when any case fails. Every run of the CLI is without `CI` in its environment,
// so what a case gives doesn't depend on where it runs. Turbo hands the arguments after `--` to this script, as in
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
// fonts. Their server lists that one story in `index.json`, since `update` writes every missing baseline whatever the
// selection. `--no-docker`, which needs `--host` and no docker on the PATH, adds a case: with the default platform,
// `test` exits 2 with the no-Docker error.
//
// With `--affected`, which needs `--host` and goes without `--no-docker`, it runs the affected stories cases in place
// of the host cases: `test` with no selection flag and `--base HEAD`, so the changed files are what the working tree
// changed, which a checkout of one commit can tell too. They change a stories file or a helper of this package's
// stories while the CLI runs, and put back its exact bytes after, also on SIGINT or SIGTERM. The working tree's own
// changes must affect no story. Their server lists every story, and their baselines folder holds a baseline for every
// snapshot, so the consistency check finds nothing and `test` captures the selected stories alone. Four more run
// `test` with a config of the three test Storybooks, at URLs nothing answers at, and check which Storybooks it leaves
// out or names in the report's error. They share the cache as the host cases do, but it needn't start empty.
//
// With `--arm64` it runs one case, with TEST_STORYBOOK_IMAGE naming an arm64 build of the browser image: `test` with
// the platform `linux/arm64` and the default tolerance gives the expected outcomes against the committed baselines,
// which are written on amd64. It makes the committed baselines case's checks, on a server that leaves out the stories
// of the file that fails to load.
//
// With `--oldest-browser` it runs one smoke case, with the installed browser package, which CI's Oldest browser job
// replaces with npm's oldest in the CLI's range: `update` of one story into an empty folder launches the browser and
// captures, with no image comparison. It runs in the package's own image, which the CLI pulls by tag and digest, unless
// TEST_STORYBOOK_IMAGE names one. It needs docker.
//
// With `--skill-script` it runs the agent skill's runner script cases in place of every other case, with `--host` on
// the machine itself, else with TEST_STORYBOOK_IMAGE naming the browser image. Each case installs the script with a
// setup.json whose CLI command is `pnpm exec visual-check` in this package's folder, and whose Storybooks start with
// `pnpm run storybook`, which serves a test Storybook on port 6006 with `storybook dev`. So port 6006 must be free. The
// script starts a Storybook, reuses one already running, exits 2 on a port mismatch, and starts only the Storybook a
// change reaches, which an interrupt then stops with the CLI and the browser. That case changes Storybook 9.1's
// `main.ts` while the script runs, and puts back its exact bytes after, also on SIGINT or SIGTERM. The working tree's
// own changes must reach no story, which it checks first. With the image, the killed CLI case runs too. On the host,
// the cases share the cache as the host cases do, but it needn't start empty.
import { type ChildProcessByStdio, spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, dirname, extname, join, relative, resolve as resolvePath, sep } from 'node:path'
import type { Readable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'
import type {
  ReportBrokenReason,
  ReportConsoleMessage,
  ReportFailedLoad,
  ReportImages,
  ReportPageError,
  ReportSize,
  TestReport,
  TestReportCounts,
  TestReportEntry,
  UpdateReport,
  UpdateReportCounts,
  UpdateReportEntry,
} from '@visual-check/cli'
import {
  answerWithStaticFile,
  type Case,
  cliBin,
  committedBaselines,
  descendantsOf,
  diagnosticsDir,
  docker,
  executableOnPath,
  image,
  isFile,
  isRunning,
  localEnvironment,
  newContainers,
  noDockerTexts,
  packageDir,
  problemUnless,
  readBrowserPackage,
  readBrowserPackageVersion,
  runCases,
  thisMachinesChromeForTestingPlatform,
  visualCheckContainers,
  waitUntil,
  withTemporaryFolder,
} from './e2e-support.ts'

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
 * The static Storybook build that `pnpm build-storybook` writes.
 */
const staticDir = join(packageDir, 'storybook-static')

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
 * Whether the check on the machine itself runs the affected stories cases in place of the host cases, as the
 * `--affected` argument says.
 */
const affectedOnly = process.argv.includes('--affected')

/**
 * Whether the check runs the committed baselines on the arm64 browser image, as the `--arm64` argument says.
 */
const onArm64Image = process.argv.includes('--arm64')

/**
 * Whether the check runs the smoke case with the installed browser package, as the `--oldest-browser` argument says.
 */
const onOldestBrowser = process.argv.includes('--oldest-browser')

/**
 * Whether the check runs the agent skill's runner script cases in place of every other case, as the `--skill-script`
 * argument says.
 */
const skillScriptOnly = process.argv.includes('--skill-script')

/**
 * The agent skill's runner script, through this package's workspace link to the CLI, which holds its source folder.
 */
const skillScriptSource = join(packageDir, 'node_modules', '@visual-check', 'cli', 'skill', 'scripts', 'run.mjs')

/**
 * Where `storybook dev` serves a test Storybook, as each one's `storybook` script starts it.
 */
const storybookDevUrl = 'http://127.0.0.1:6006'

/**
 * How long, in ms, the interrupt case waits for the runner script to start Storybook 9.1 and the CLI to start
 * capturing: a cold `storybook dev` start on Windows and the CLI's own start can take minutes.
 */
const skillStartTimeout = 240_000

/**
 * How long, in ms, the runner script has to end after an interrupt, and a Storybook it started to stop answering.
 */
const skillStopTimeouts = { ended: 60_000, stopped: 15_000 }

/**
 * How long, in ms, a runner script may run before it is killed: two CLI runs and up to 180 s of waiting for
 * Storybook, and above the interrupt case's wait for the capture plus its wait for the end.
 */
const skillScriptTimeout = 420_000

/**
 * Where visual-check's browser image records the browser it holds.
 */
const markerPath = '/etc/visual-check/chromium.json'

/**
 * The story the host cases capture, the only one their server's `index.json` lists. One shows the download and its
 * reuse.
 */
const hostStoryId = 'card--default'

/**
 * The helper the affected stories case changes, beside the stories files, and a story of each stories file that
 * imports it, the only ones that do.
 */
const affectedHelper = {
  name: 'mocking-worker.ts',
  importedBy: ['network--mocked-fetch', 'page-errors--console-error', 'remote-content--every-kind'],
}

/**
 * The line the affected stories cases add to the end of the file they change, a comment, so the build is the same.
 */
const affectedChangeLine = '// visual-check e2e: a change for the affected stories cases\n'

/**
 * The hint every note about an empty affected selection ends with. It mirrors the CLI's hint
 * (`packages/cli/src/commands/run-selection.ts`), which the e2e can't import.
 */
const affectedAllHint = 'Run with --all to cover every story.'

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
 * The story the deliberate change alters, and the stylesheet that alters it through its `card` class.
 */
const deliberateChange = {
  storyId: 'card--default',
  style: '<style>.card { background: #fde68a !important; }</style>',
}

/**
 * The grow case: the masked story it widens, by the pattern its ID matches, and the script it adds to every
 * `iframe.html`, which runs before Storybook imports any stories file and widens the story's masked element from 200 to
 * 300 px, so its mask grows with it.
 */
const growingMask = {
  storyId: 'masks--grows',
  filter: /^masks--grows$/,
  script: '<script>globalThis.__visualCheckE2eGrow = true</script>',
}

/**
 * The one-pixel change: the story it changes, by its ID and the pattern that matches only it, the stylesheet that
 * changes it, the detail its line must hold with `pixels: 0`, `differs:` included so a larger count can't match, and
 * the `pixels` its report entry must give then.
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
  pixels: { differ: 1, allowed: 0, budget: 0, scale: 1 },
}

/**
 * The flaky case: the story it changes, by its ID and the pattern that matches only it, and the deliberate change's
 * stylesheet, which the server adds to that story's first page loads only, so a retry past them captures the story as
 * its baseline has it. Its runs, each on a server of its own: the `retries` its config sets, the config's default when
 * not given, how many of the story's first page loads change, the outcome `test` gives the story, and how many times
 * the server is asked for its page, once and then on each retry `test` takes.
 */
const flakyChange = {
  storyId: deliberateChange.storyId,
  filter: /^card--default$/,
  markup: deliberateChange.style,
  runs: [
    { name: 'default retries', changedLoads: 1, outcome: 'passed', storyPages: 2 },
    { name: 'retries: 0', retries: 0, changedLoads: 1, outcome: 'differs', storyPages: 1 },
    { name: 'retries: 2', retries: 2, changedLoads: 2, outcome: 'passed', storyPages: 3 },
  ] satisfies FlakyRun[],
}

/**
 * The heading `test` lists its flaky snapshots under, after the snapshot lines, each name on a line of its own
 * indented two spaces.
 */
const flakyHeading = 'Flaky snapshots, which passed on a retry:'

/**
 * What the detail of a snapshot line that passed on a retry ends with. The `passed` outcome's pattern pins it to the
 * end. `update`'s flaky lines end with it too, which the `kept` outcome's pattern allows.
 */
const flakyMark = '· flaky'

/**
 * The heading `update` lists its flaky snapshots under, the last lines of its standard output, each name on a line of
 * its own indented two spaces.
 */
const updateFlakyHeading = 'Flaky snapshots, whose loads disagreed:'

/**
 * The most loads `update` makes of a snapshot, whatever `retries` says.
 */
const updateMaxLoads = 3

/**
 * What the text of every console message a stability case's markup logs starts with, so its entry's own can be told
 * from Storybook's.
 */
const e2eConsolePrefix = 'visual-check e2e:'

/**
 * The stability cases: `update` on the card story alone, by its ID and the pattern that matches only it, each on a
 * server of its own whose `index.json` lists only that story. `update` takes every snapshot whose baseline is missing
 * whatever the selection, so with every story listed it would write the baselines of all the others. The server adds
 * each case's markup to the story's page loads, load by load, and counts them. Its cases:
 *
 * - `keptFlaky`: the deliberate change's stylesheet in the first load only, with the baseline there. The first load
 *   differs from the baseline and the second is within tolerance of it, so the baseline is kept, flaky.
 * - `writtenFlaky`: the same, with the baseline missing. The first two loads disagree and the third agrees with the
 *   second, so the third is written, flaky, as the committed baseline has it.
 * - `unstable`: a different card background in each load, red, green, then blue, with the baseline there, and a script
 *   that logs the load's number. No two of the 3 loads agree, so the story is broken, and its entry keeps the third
 *   load's console messages.
 * - `changedAfterCapture`: a script in each of the 3 loads `update` can make that logs a warning, adds a fixed clock,
 *   48 px text at the bottom left, and sets its text to `Date.now()` at once and every 50 ms after, with the baseline
 *   there. The text must be there from the start: a fast machine captures the first load before a first tick, and an
 *   empty clock matches the baseline, which `update` keeps without a check. The first load's page differs from the
 *   baseline, and captured again a second later it differs by pixels, so the story is broken after 1 load, and its
 *   entry keeps that load's warning.
 *
 * Each runs with `--reporter json`, so `update`'s lines are on standard error and its document on standard output. A
 * kept baseline is only counted; any other outcome is the document's one entry.
 */
const updateStability = {
  storyId: deliberateChange.storyId,
  filter: flakyChange.filter,
  keptFlaky: {
    name: 'kept-flaky',
    loadMarkup: [deliberateChange.style],
    hasBaseline: true,
    outcome: 'kept',
    detail: /^kept · flaky$/,
    flaky: true,
    storyPages: 2,
    counts: { written: 0, deleted: 0, kept: 1, broken: 0, flaky: 1 },
    entry: null,
  } satisfies StabilityRun,
  writtenFlaky: {
    name: 'written-flaky',
    loadMarkup: [deliberateChange.style],
    hasBaseline: false,
    outcome: 'written',
    detail: /^written: missing · flaky$/,
    flaky: true,
    storyPages: updateMaxLoads,
    counts: { written: 1, deleted: 0, kept: 0, broken: 0, flaky: 1 },
    entry: {
      fields: { status: 'written', reason: 'missing', flaky: true, attempts: updateMaxLoads },
      message: /^Written: missing$/,
      e2eConsole: [],
    },
  } satisfies StabilityRun,
  unstable: {
    name: 'unstable',
    loadMarkup: ['#ef4444', '#22c55e', '#3b82f6'].map(
      (color, index) =>
        `<style>.card { background: ${color} !important; }</style>` +
        `<script>console.info("${e2eConsolePrefix} load ${index + 1}")</script>`,
    ),
    hasBaseline: true,
    outcome: 'broken',
    detail: /^broken: No two of the story's 3 loads agreed, so its baseline wasn't written\.$/,
    flaky: false,
    storyPages: updateMaxLoads,
    counts: { written: 0, deleted: 0, kept: 0, broken: 1, flaky: 0 },
    entry: {
      fields: { status: 'broken', reason: 'unstable', attempts: updateMaxLoads },
      message: /^No two of the story's 3 loads agreed, so its baseline wasn't written\.$/,
      e2eConsole: [{ level: 'info', text: `${e2eConsolePrefix} load ${updateMaxLoads}` }],
    },
  } satisfies StabilityRun,
  changedAfterCapture: {
    name: 'changed-after-capture',
    loadMarkup: Array.from(
      { length: updateMaxLoads },
      () =>
        `<script>console.warn("${e2eConsolePrefix} the clock ticks"); ` +
        'addEventListener("DOMContentLoaded", () => { ' +
        'const clock = document.body.appendChild(document.createElement("div")); ' +
        'clock.style.cssText = "position: fixed; left: 16px; bottom: 16px; font: 48px monospace; color: #000"; ' +
        'const tick = () => { clock.textContent = String(Date.now()) }; tick(); setInterval(tick, 50) })</script>',
    ),
    hasBaseline: true,
    outcome: 'broken',
    detail:
      /^broken: The story changed in the second after its capture: \d+ differ, \d+ allowed\. Use its wait hook to wait until it settles\.$/,
    flaky: false,
    storyPages: 1,
    counts: { written: 0, deleted: 0, kept: 0, broken: 1, flaky: 0 },
    entry: {
      fields: { status: 'broken', reason: 'changed-after-capture', attempts: 1 },
      message:
        /^The story changed in the second after its capture: \d+ differ, \d+ allowed\. Use its wait hook to wait until it settles\.$/,
      e2eConsole: [{ level: 'warn', text: `${e2eConsolePrefix} the clock ticks` }],
    },
  } satisfies StabilityRun,
}

/**
 * The remote content hint case: the story it unmasks, by its ID and the pattern that matches only it, and the script
 * it adds to every `iframe.html`, which runs before Storybook imports any stories file and sets the story's mask
 * `remote` to `null`, so the snapshot shows the remote content its baseline has masked. The options-reading page gets
 * the script too, and visual-check reads the mask there. Every differing pixel then lies inside remote content from
 * `localhost` on the server's port, the list marker of `list-style-image` included, since the search counts the whole
 * list, so `test` hints at a mask for that host.
 */
const unmaskedRemoteContent = {
  storyId: 'remote-content--every-kind',
  filter: /^remote-content--every-kind$/,
  script: '<script>globalThis.__visualCheckE2eUnmask = true</script>',
}

/**
 * The address of the docs page the remote content hint links to.
 */
const remoteContentDocs = 'https://visual-check.vercel.app/docs/remote-content'

/**
 * The report JSON case: the story each of its runs takes, by its ID and the pattern that matches only it, the stem of
 * the stray baseline it adds to the baselines, which no story calls for, so `test` lists it as an orphan and `update`
 * deletes it, and the committed baseline it gives the story in place of its own. That one is the capture area story's
 * card alone, 320 × 160, so the story's 1280 × 720 snapshot differs from it by size, as `size` gives.
 */
const reportJson = {
  storyId: 'card--default',
  filter: /^card--default$/,
  orphan: 'stray--orphan',
  otherSizeBaseline: 'capture-area--element',
  size: { baseline: [320, 160], snapshot: [1280, 720] } satisfies ReportSize,
}

/**
 * What a report entry lists when it has no image.
 */
const noImages: ReportImages = { baseline: null, snapshot: null, diff: null }

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
 * one that crashes says, the stories whose next story must pass, because they leave their page held or crashed, and
 * what the report's entries of the two broken ones hold. The one that crashes has no image, and neither has the one
 * that navigates away, whose entry gives where it went and keeps the warning its `play` logs before it follows the
 * link, which shows console messages survive the navigation.
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
  entries: [
    { storyId: 'hazards--crashes', reason: 'crashed', pageImage: false },
    {
      storyId: 'hazards--navigates-away',
      reason: 'navigated-away',
      pageImage: false,
      holds: 'details.url ending /categories/burgers and the warning "Following the burgers link"',
      has: (entry) =>
        entry.details?.url?.endsWith('/categories/burgers') === true &&
        entry.console.some(({ level, text }) => level === 'warn' && text === 'Following the burgers link'),
    },
  ] satisfies BrokenEntry[],
}

/**
 * The font file the font readiness story asks for. The server never answers it, so the font face stays loading and
 * that story is broken, `fonts-not-loaded`, in every case. Stopping the server drops the held request.
 */
const neverAnsweredPath = '/visual-check-e2e/never-loads.woff2'

/**
 * The path the server answers with a 500, which the page errors story `ServerError` fetches.
 */
const serverErrorPath = '/visual-check-e2e/server-error'

/**
 * The path whose connection the server destroys, answering nothing, which the page errors story `DroppedLoad` fetches.
 */
const droppedPath = '/visual-check-e2e/dropped'

/**
 * How the server answers the paths it never serves from the build, by path: the font file it never answers, the 500
 * and the connection it destroys.
 */
const fixedAnswers: Record<string, (request: IncomingMessage, response: ServerResponse) => void> = {
  [neverAnsweredPath]: () => undefined,
  [serverErrorPath]: (_request, response) => response.writeHead(500).end(),
  [droppedPath]: (request) => request.socket.destroy(),
}

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
 * broken, `load-failed`, before any baseline is read, so they have none and stay broken in every `test` that lists
 * them. The server leaves them out of `index.json` unless a case asks for them, so only the committed baselines case
 * and the CI stop case see them.
 */
const loadFailsFilter = /^load-fails--/

/**
 * What the line of each broken per-story options story says, in its reason's own wording: what the `wait` hook threw,
 * and that the story's file failed to load, with what the file threw. The load failure's lines are checked only in a
 * run that lists those stories.
 */
const perStoryOptionsLines: [storyId: string, says: string][] = [
  ['wait--throws', "The story's wait hook threw Error: visual-check: wait threw"],
  ['load-fails--first', 'failed to load: Error: visual-check: this stories file fails to load'],
  ['load-fails--second', 'failed to load: Error: visual-check: this stories file fails to load'],
]

/**
 * What the line of each broken capture area story says, in its reason's own wording: that the element selector matched
 * nothing or a box of zero size, and that the full page is over the most a capture can be, with the hint to set
 * `element`.
 */
const captureAreaLines: [storyId: string, says: string][] = [
  ['capture-area--element-missing', 'matched nothing'],
  ['capture-area--element-zero-size', 'box of zero size'],
  ['capture-area--too-tall', 'over 32,767 on a side. Set element'],
]

/**
 * What the line of each broken grid story says, in its reason's own wording: that the grid is wider than the viewport.
 */
const gridLines: [storyId: string, says: string][] = [['grid--too-wide', 'wider than the 1280 px viewport']]

/**
 * What the report's entry of each broken readiness, per-story options, capture area and grid story holds: its reason,
 * an image of its page but for the story too tall to capture and the ones whose file failed to load, and the details
 * its reason gives: the grid too wide gives its width and the viewport's. The story whose `play` threw has its stack,
 * which shows the stack reaches visual-check through Storybook's channel, and the one whose `play` left an unhandled
 * error keeps it as a console message of level `error`.
 */
const brokenEntries: BrokenEntry[] = [
  { storyId: 'readiness--render-throws', reason: 'error', pageImage: true },
  {
    storyId: 'readiness--play-throws',
    reason: 'play-threw',
    pageImage: true,
    holds: "play's message and a stack",
    has: (entry) =>
      entry.details?.play?.message.includes('visual-check: play threw') === true && entry.details.play.stack.length > 0,
  },
  {
    storyId: 'readiness--play-leaves-unhandled-error',
    reason: 'play-threw',
    pageImage: true,
    holds: 'a console message of level error',
    has: (entry) => entry.console.some(({ level }) => level === 'error'),
  },
  {
    storyId: 'readiness--never-ready',
    reason: 'timeout',
    pageImage: true,
    holds: 'details.timeoutMs',
    has: (entry) => (entry.details?.timeoutMs ?? 0) > 0,
  },
  {
    storyId: 'readiness--font-never-loads',
    reason: 'fonts-not-loaded',
    pageImage: true,
    holds: 'Never Loads in details.pendingFonts',
    has: (entry) => entry.details?.pendingFonts?.some((face) => face.includes('Never Loads')) === true,
  },
  { storyId: 'wait--throws', reason: 'wait-threw', pageImage: true },
  { storyId: 'capture-area--element-missing', reason: 'element-missing', pageImage: true },
  { storyId: 'capture-area--element-zero-size', reason: 'element-missing', pageImage: true },
  {
    storyId: 'capture-area--too-tall',
    reason: 'too-tall',
    pageImage: false,
    holds: 'details.size',
    has: (entry) => entry.details?.size?.length === 2,
  },
  {
    storyId: 'grid--too-wide',
    reason: 'grid-too-wide',
    pageImage: true,
    holds: 'details.grid of 1400 and 1280',
    has: (entry) => entry.details?.grid?.width === 1400 && entry.details.grid.viewportWidth === 1280,
  },
  ...['load-fails--first', 'load-fails--second'].map(
    (storyId): BrokenEntry => ({
      storyId,
      reason: 'load-failed',
      pageImage: false,
      holds: "the file's error in details.loadError",
      has: (entry) => entry.details?.loadError?.includes('visual-check: this stories file fails to load') === true,
    }),
  ),
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
 * The header of the consistency output, which a CI `test` prints when it stops before capturing, with its count of
 * every snapshot the stories call for.
 */
const consistencyHeaderPattern = /^visual-check \S+ · test · consistency · (\d+) snapshots?$/m

/**
 * The line a CI `test` ends its output with when its consistency check finds anything, so it captures nothing.
 */
const ciStopLine = 'In CI, test stops before capturing when the consistency check finds anything.'

/**
 * The report folder `test` writes beside a config in `configFolder`.
 */
function reportFolderOf(configFolder: string): string {
  return join(configFolder, '.visual-check', 'report')
}

/**
 * The line every `test` that exits 0 or 1 ends its output with, for a config in `configFolder`: the path of the
 * report's `report.json`, relative to the folder the CLI runs in. With `--reporter json`, or on exit 2, it ends
 * standard error instead.
 */
function reportLineOf(configFolder: string): string {
  const path = relative(packageDir, join(reportFolderOf(configFolder), 'report.json'))

  return `Report: ${path.split(sep).join('/')}`
}

/**
 * How many shards the sharding case splits `test` into.
 */
const shardCount = 4

/**
 * The line a shard prints right after its header, since it skips the consistency check.
 */
const consistencyLeftNote = 'Missing baselines and orphans are left to test --consistency.'

/**
 * What the warning for a Storybook that ignores the test path's user agent says, wherever it names the Storybook.
 */
const testPathWarning = 'StorybookTestRunner user agent'

/**
 * What the warning that ends a finished `update` says about the network stories, each line led by the remote origin's
 * host, `localhost` on the server's port. No other story is listed: `MockedFetch`'s request is answered by its service
 * worker, and the remote content stories' meta masks the host.
 */
const networkWarning = {
  /**
   * The rest of the line that says `RealFetch` makes a real network request.
   */
  request: ': 1 story (network--real-fetch). This story makes real network requests and may be unreliable.',
  /**
   * The rest of the line that says `RemoteImage` shows remote content.
   */
  remoteContent:
    ': 1 story (network--remote-image) shows remote content. ' +
    'A CDN can serve it differently on another machine, so CI may fail.',
  /**
   * Matches a line of the warning, of either kind, so the case finds every one.
   */
  linePattern: /^\S+: \d+ stor(?:y|ies) \(/,
}

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
  ['passed', /^\d+ ms( · flaky)?$/],
  ['differs', /^differs: /],
  ['broken', /^broken: /],
  ['missing', /^missing: /],
  ['written', /^written: /],
  ['kept', /^kept( · flaky)?$/],
]

/**
 * The outcomes that make a run exit 1.
 */
const failingOutcomes: Outcome[] = ['differs', 'broken', 'missing']

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
   * Markup added to the end of the `<head>` of one story's page loads, after `injectIntoIframe`'s, load by load: each
   * request for that story's page gets the markup for its place in the order. The options-reading page never gets it.
   */
  injectIntoLoads?: StoryLoadsMarkup
  /**
   * Leaves every story page request unanswered until `releaseStoryPages()` or the server stops, so a run can't finish
   * a capture meanwhile. The options-reading page is answered at once.
   */
  holdStoryPages?: boolean
  /**
   * The one story `index.json` lists, leaving out every other entry, so a run's Storybook has that story alone. Every
   * entry is listed when not given, but for the stories of the file that fails to load, unless `withLoadFails` is set.
   */
  onlyStory?: string
  /**
   * Whether `index.json` lists the stories of the stories file that fails to load. It leaves them out when not given,
   * so a run's Storybook has no story that is broken before it is captured. The cases that check the load failure
   * list them.
   */
  withLoadFails?: boolean
  /**
   * Once the server has been asked for this story's page, it destroys the socket of every later request whose pathname
   * matches `path`, answering nothing. The options-reading page asks first, so it gets the file.
   */
  dropAfterStoryPage?: DroppedFiles
}

/**
 * The files the server drops once it has been asked for one story's page.
 */
interface DroppedFiles {
  /**
   * The ID of the story whose page request starts the dropping.
   */
  storyId: string
  /**
   * Matches the pathnames of the files dropped.
   */
  path: RegExp
}

/**
 * Markup for one story's page loads, load by load.
 */
interface StoryLoadsMarkup {
  /**
   * The ID of the story whose page gets the markup.
   */
  storyId: string
  /**
   * The markup of each of that story's page loads, in order: the first load gets the first, the second the second, and
   * so on. A load past the end of the list gets none.
   */
  markup: string[]
}

/**
 * One run of the flaky case.
 */
interface FlakyRun {
  /**
   * What the run's problems start with.
   */
  name: string
  /**
   * How many of the story's first page loads change.
   */
  changedLoads: number
  /**
   * The outcome `test` gives the story.
   */
  outcome: Outcome
  /**
   * How many times the server is asked for the story's page.
   */
  storyPages: number
  /**
   * The `retries` the run's config sets. The config's default when not given.
   */
  retries?: number
}

/**
 * One stability case: `update` on the card story alone, with markup in its page loads, against a baselines folder that
 * holds the story's committed baseline, or nothing when the case has it missing.
 */
interface StabilityRun {
  /**
   * The folder, in the diagnostics folder's `update-stability/`, that keeps the story's baseline after the run when it
   * isn't the committed one.
   */
  name: string
  /**
   * The markup of each of the story's page loads, in order: see `StoryLoadsMarkup`.
   */
  loadMarkup: string[]
  /**
   * Whether the baselines folder holds the story's committed baseline before the run.
   */
  hasBaseline: boolean
  /**
   * The outcome `update` gives the story.
   */
  outcome: Outcome
  /**
   * Matches the whole detail of the story's line.
   */
  detail: RegExp
  /**
   * Whether `update` lists the story as flaky.
   */
  flaky: boolean
  /**
   * How many times the server is asked for the story's page.
   */
  storyPages: number
  /**
   * The counts of `update`'s JSON document.
   */
  counts: UpdateReportCounts
  /**
   * What the document's one entry, the story's, holds, or `null` when it lists none, as for a kept baseline.
   */
  entry: StabilityEntry | null
}

/**
 * What the story's entry in a stability case's `update` document holds.
 */
interface StabilityEntry {
  /**
   * Fields that must deeply equal these.
   */
  fields: Partial<UpdateReportEntry>
  /**
   * Matches the whole of its message.
   */
  message: RegExp
  /**
   * The console messages it keeps that the case's markup logs, those whose text starts with `e2eConsolePrefix`, in
   * order.
   */
  e2eConsole: ReportConsoleMessage[]
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
   * The time limit it ran under, in ms.
   */
  timeLimit: number
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
 * A config with the three test Storybooks, each at a URL nothing answers at, that the affected stories cases run with.
 */
interface ThreeStorybooks {
  /**
   * The path of the config, which sets `platform: 'host'`.
   */
  config: string
  /**
   * The folder the config is in, beside which `test` writes its report.
   */
  folder: string
  /**
   * Each Storybook's name and URL, in config order, as the report's `error.storybooks` names them.
   */
  storybooks: { name: string; url: string }[]
}

/**
 * What the report's entry of a broken story must hold beyond its status.
 */
interface BrokenEntry {
  /**
   * The story's ID, its entry's `id`.
   */
  storyId: string
  /**
   * Its `reason`.
   */
  reason: ReportBrokenReason
  /**
   * Whether `images.snapshot` holds an image of its page. Its other images are always `null`.
   */
  pageImage: boolean
  /**
   * What `has` checks, for the problem when it fails.
   */
  holds?: string
  /**
   * Whether the entry holds what `holds` says.
   */
  has?: (entry: TestReportEntry) => boolean
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
 * Lists what is wrong with the arguments: `--inside-image`, `--host`, `--arm64` and `--oldest-browser` are separate
 * modes, `--no-docker` needs `--host`, `--affected` needs `--host` and goes without `--no-docker`, and `--skill-script`
 * goes alone or with `--host`.
 */
function findArgumentProblems(): string[] {
  const modeCount = [insideImage, onHost, onArm64Image, onOldestBrowser].filter(Boolean).length
  const conflicts: [boolean, string][] = [
    [modeCount > 1, '--inside-image, --host, --arm64 and --oldest-browser are separate modes: give one of them.'],
    [withoutDocker && !onHost, '--no-docker only runs with --host.'],
    [affectedOnly && !onHost, '--affected only runs with --host.'],
    [affectedOnly && withoutDocker, '--affected runs in place of the host cases, so it goes without --no-docker.'],
  ]

  return [
    ...conflicts.filter(([conflicting]) => conflicting).map(([, problem]) => problem),
    ...findSkillScriptArgumentProblems(),
  ]
}

/**
 * Lists the problem with `--skill-script` given with an argument of another mode's cases, or none. It's apart from
 * `findArgumentProblems`, whose table one more condition would make too complex.
 */
function findSkillScriptArgumentProblems(): string[] {
  return skillScriptOnly && [insideImage, onArm64Image, onOldestBrowser, withoutDocker, affectedOnly].some(Boolean)
    ? ['--skill-script runs in place of the other cases: give it alone, or with --host.']
    : []
}

/**
 * Lists what the mode the arguments pick needs and doesn't have: inside visual-check's image its marker and no docker,
 * on the machine itself what `--no-docker` needs, with `--oldest-browser` docker, else the browser image.
 */
function findModeProblems(): string[] {
  if (insideImage) {
    return findInsideImageProblems()
  }

  if (onHost) {
    return findHostProblems()
  }

  if (onOldestBrowser) {
    return findOldestBrowserProblems()
  }

  return findBrowserImageProblems()
}

/**
 * Lists what the check needs on the machine itself: with `--no-docker`, no docker, since that case checks the error
 * for a run without it.
 */
function findHostProblems(): string[] {
  return withoutDocker && executableOnPath('docker') !== undefined
    ? ['docker is on the PATH: --no-docker checks the error for a run without it, so run it where there is none.']
    : []
}

/**
 * Lists what the smoke case needs: docker, which runs the browser package's image or TEST_STORYBOOK_IMAGE's. It needs
 * no TEST_STORYBOOK_IMAGE, since the CLI pulls the package's own image without one.
 */
function findOldestBrowserProblems(): string[] {
  return executableOnPath('docker') === undefined
    ? ['docker is not on the PATH: --oldest-browser runs the browser in its image, so run it where there is docker.']
    : []
}

/**
 * Lists what the check needs outside the image: the name of the browser image, the arm64 one with `--arm64`.
 */
function findBrowserImageProblems(): string[] {
  const example = onArm64Image ? 'visual-check-chromium:arm64' : 'visual-check-chromium:amd64'

  return image ? [] : [`TEST_STORYBOOK_IMAGE is not set: set it to the browser image, such as ${example}.`]
}

/**
 * Lists what the check needs inside the image: the image's marker, for the amd64 image because the committed baselines
 * are linux/amd64, and no docker, which the mode proves the CLI needs none of.
 */
function findInsideImageProblems(): string[] {
  return [
    ...markerProblems(),
    ...(executableOnPath('docker') !== undefined
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
 * Reads the image's marker.
 */
function readMarker(): ImageMarker {
  return JSON.parse(readFileSync(markerPath, 'utf8')) as ImageMarker
}

/**
 * Reads the `storybook` package installed for this package.
 */
function readStorybookPackage(): StorybookPackage {
  return JSON.parse(readFileSync(storybookPackagePath, 'utf8')) as StorybookPackage
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
 * Answers a request for a URL path with the static build's file, or 404 when it names no file there. An
 * `iframe.html` gets the markup, when there is any, and `index.json` lists the entries the options leave in it.
 */
function serveFile(
  pathname: string,
  response: ServerResponse,
  options: ServeOptions,
  markup: string | undefined,
): void {
  answerWithStaticFile(staticDir, pathname, response, (body) => changedBodyOf(pathname, body, options, markup))
}

/**
 * Gives a static file's body as the server changes it: an `iframe.html` with the markup, when there is any, and
 * `index.json` with the entries the options leave in it.
 */
function changedBodyOf(
  pathname: string,
  body: Buffer,
  options: ServeOptions,
  markup: string | undefined,
): Buffer | string {
  if (pathname === '/iframe.html') {
    return withMarkup(body, markup)
  }

  if (pathname === '/index.json') {
    return withListedEntries(body, options)
  }

  return body
}

/**
 * Gives `index.json` with the entries the options leave in it. The entries of the stories file that fails to load are
 * left out unless `withLoadFails` is set. Then, when `onlyStory` names a story, only its entry is left, or none when
 * the entries left don't list it.
 */
function withListedEntries(index: Buffer, options: ServeOptions): string {
  const parsed = JSON.parse(index.toString('utf8')) as { entries: Record<string, unknown> }
  const listed = Object.entries(parsed.entries).filter(
    ([storyId]) =>
      (options.withLoadFails === true || !loadFailsFilter.test(storyId)) &&
      (options.onlyStory === undefined || storyId === options.onlyStory),
  )

  return JSON.stringify({ ...parsed, entries: Object.fromEntries(listed) })
}

/**
 * Gives the ID of the story a request is for when it asks for a story page, an `iframe.html` with an `id`, or
 * `undefined` for any other request, the options-reading page's included.
 */
function storyPageIdOf(pathname: string, searchParams: URLSearchParams): string | undefined {
  return pathname === '/iframe.html' ? (searchParams.get('id') ?? undefined) : undefined
}

/**
 * Gives the markup a story page gets: `injectIntoIframe`'s, then `injectIntoLoads`'s for `load` when the page is of its
 * story. `load` counts the requests for the story's page so far, this one included.
 */
function storyPageMarkupOf(options: ServeOptions, storyId: string, load: number): string | undefined {
  const { injectIntoIframe, injectIntoLoads: storyLoads } = options
  const loadMarkup =
    storyLoads !== undefined && storyLoads.storyId === storyId ? storyLoads.markup[load - 1] : undefined

  // join writes an undefined injectIntoIframe as nothing.
  return loadMarkup === undefined ? injectIntoIframe : [injectIntoIframe, loadMarkup].join('')
}

/**
 * Serves the static build on a free port of 127.0.0.1, changed as the options say, and records the requests for story
 * pages. While it holds them, it keeps each one's answer until they're released. Once asked for the page of the story
 * `dropAfterStoryPage` names, it drops the connection of every request for the files it names. The options-reading
 * page is never held or recorded, so a run reads every story's options before it asks for a story page. It never
 * answers a request for the font file the font readiness story asks for, until it stops. It answers the page errors
 * story `ServerError`'s path with a 500, and destroys the connection of `DroppedLoad`'s.
 */
async function serveStorybook(options: ServeOptions = {}): Promise<StorybookServer> {
  const storyPageRequests: string[] = []
  const heldAnswers: (() => void)[] = []
  let holding = options.holdStoryPages ?? false
  let dropping = false

  /**
   * Records a request for a story page, then answers it with the markup that load gets, or keeps the answer while the
   * server holds story pages.
   */
  const answerStoryPage = (storyId: string, answerWith: (markup: string | undefined) => void): void => {
    storyPageRequests.push(storyId)
    dropping ||= options.dropAfterStoryPage?.storyId === storyId

    const load = storyPageRequests.filter((requested) => requested === storyId).length
    const markup = storyPageMarkupOf(options, storyId, load)
    const answer = (): void => answerWith(markup)

    if (holding) {
      heldAnswers.push(answer)

      return
    }

    answer()
  }

  /**
   * Answers a request for anything but a story page with the static build's file, or destroys its socket, answering
   * nothing, once the server drops that file.
   */
  const answerFile = (request: IncomingMessage, pathname: string, response: ServerResponse): void => {
    if (dropping && options.dropAfterStoryPage?.path.test(pathname) === true) {
      request.socket.destroy()

      return
    }

    serveFile(pathname, response, options, options.injectIntoIframe)
  }

  const server = createServer((request, response) => {
    const { pathname, searchParams } = new URL(request.url ?? '/', 'http://127.0.0.1')
    const storyId = storyPageIdOf(pathname, searchParams)

    const fixedAnswer = fixedAnswers[pathname]

    if (fixedAnswer !== undefined) {
      fixedAnswer(request, response)

      return
    }

    if (storyId !== undefined) {
      answerStoryPage(storyId, (markup) => serveFile(pathname, response, options, markup))

      return
    }

    answerFile(request, pathname, response)
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
 * Starts the built CLI in this package's folder with the given arguments and environment. It is killed when it runs
 * past the CLI's time limit.
 */
function startCli(args: string[], env: NodeJS.ProcessEnv): CliProcess {
  return startNode(cliBin, args, env, cliTimeoutMilliseconds)
}

/**
 * Starts Node on the script `entry` in this package's folder with the given arguments and environment, with its
 * standard output and error piped. It is killed with `SIGKILL` when it runs past the time limit, in ms.
 */
function startNode(entry: string, args: string[], env: NodeJS.ProcessEnv, timeLimit: number): CliProcess {
  return spawn(process.execPath, [entry, ...args], {
    cwd: packageDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeLimit,
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
 * Runs the built CLI to the end, or until the time limit kills it, and reads its outcomes. The environment is the
 * machine's without `CI`, unless the caller gives its own, so a run gives the same outcomes in CI and outside it.
 */
async function runCli(args: string[], env: NodeJS.ProcessEnv = localEnvironment()): Promise<CliRun> {
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
function followCli(cli: CliProcess, timeLimit = cliTimeoutMilliseconds): FollowedCli {
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
    const timedOut = signal === 'SIGKILL' && performance.now() - started >= timeLimit

    return cliRunOf(stdout, { exitCode, signal, timedOut, timeLimit, stderr })
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
  const ending = endingProblems(command, run)

  if (ending.length > 0) {
    return ending
  }

  return run.exitCode === expected
    ? []
    : [`${command} exited ${run.exitCode}, expected ${expected}${outputOf(run.stderr)}`]
}

/**
 * Gives the problem when the time limit or a signal ended a run, with what it printed on standard error, or none when
 * it exited.
 */
function endingProblems(command: string, run: CliRun): string[] {
  if (run.timedOut) {
    return [`${command} timed out after ${run.timeLimit / 1000} s${outputOf(run.stderr)}`]
  }

  return run.signal === null ? [] : [`${command} was ended by ${run.signal}${outputOf(run.stderr)}`]
}

/**
 * Writes what a run printed on standard output or error on one line, in parentheses, or nothing when it printed
 * nothing.
 */
function outputOf(output: string): string {
  const oneLine = output.trim().replace(/\s*\n\s*/g, ' ')

  return oneLine ? ` (${oneLine})` : ''
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
 * Changes each snapshot's outcome with `change`.
 */
function mapOutcomes(outcomes: Outcomes, change: (outcome: Outcome) => Outcome): Outcomes {
  return Object.fromEntries(Object.entries(outcomes).map(([key, outcome]) => [key, change(outcome)]))
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
   * How many more times `test` captures a snapshot that differs before it fails. The config's default when not given.
   */
  retries?: number
  /**
   * The project's tolerance, which each story's own overrides key by key. The config's default when not given. It's
   * the subset of the CLI's `Tolerance` this check writes: counts of pixels, not shares.
   */
  tolerance?: { color?: number; pixels?: number }
  /**
   * The project's expected page errors, which every story's are added to. The config's default when not given.
   */
  expectedPageErrors?: (string | RegExp)[]
}

/**
 * Writes a config for this Storybook, served at the URL, with its baselines in the given folder, that captures with 2
 * workers, and the platform, `readyTimeout`, `retries`, `tolerance` and `expectedPageErrors` the options give. Gives its
 * path. `test`'s report goes into `.visual-check/report` in that folder.
 */
function writeConfig(folder: string, url: string, baselines: string, options: ConfigOptions = {}): string {
  const path = join(folder, 'visual-check.config.mjs')
  const { expectedPageErrors, ...jsonOptions } = options
  const config = {
    storybooks: { react: { url, dir: packageDir, baselines } },
    image,
    workers: parallelWorkers,
    ...jsonOptions,
  }
  const json = JSON.stringify(config, null, 2)
  // JSON has no regular expressions, so the expected page errors are written as literals after the rest.
  const source =
    expectedPageErrors === undefined ? json : `{ ...${json}, expectedPageErrors: ${literalsOf(expectedPageErrors)} }`

  writeFileSync(path, `export default ${source}\n`)

  return path
}

/**
 * Writes a list of strings and regular expressions as a JavaScript array literal.
 */
function literalsOf(entries: (string | RegExp)[]): string {
  return `[${entries.map((entry) => (typeof entry === 'string' ? JSON.stringify(entry) : String(entry))).join(', ')}]`
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
 * Reads the `report.json` of the report beside a config in `configFolder`.
 */
function readReport(configFolder: string): TestReport {
  return JSON.parse(readFileSync(join(reportFolderOf(configFolder), 'report.json'), 'utf8')) as TestReport
}

/**
 * Reads the report beside a config in `configFolder` and gives what `check` finds wrong with it, each problem led by
 * `report:`, or the problem that there's no `report.json`.
 */
function reportProblems(configFolder: string, check: (report: TestReport) => string[]): string[] {
  const path = join(reportFolderOf(configFolder), 'report.json')

  if (!isFile(path)) {
    return [`test wrote no ${path}`]
  }

  return check(readReport(configFolder)).map((problem) => `report: ${problem}`)
}

/**
 * Whether the text's last line is this one.
 */
function endsWithLine(text: string, line: string): boolean {
  return `\n${text}`.endsWith(`\n${line}\n`)
}

/**
 * Gives the problem when a run's standard output, or with `stream: 'stderr'` its standard error, doesn't end with the
 * report line of a config in `configFolder`, or none.
 */
function reportLineProblems(run: CliRun, configFolder: string, stream: 'stdout' | 'stderr' = 'stdout'): string[] {
  const line = reportLineOf(configFolder)

  return endsWithLine(run[stream], line) ? [] : [`${stream}'s last line isn't "${line}"${outputOf(run[stream])}`]
}

/**
 * Lists how a report differs from these outcomes, `orphans` orphans besides: see `reportCountsProblems`,
 * `reportEntriesProblems` and `reportImagesProblems`.
 */
function reportOutcomeProblems(report: TestReport, expected: Outcomes, configFolder: string, orphans = 0): string[] {
  return [
    ...reportCountsProblems(report, expected, orphans),
    ...reportEntriesProblems(report, expected),
    ...reportImagesProblems(report, configFolder),
  ]
}

/**
 * Gives the problem when a report's counts aren't these outcomes' with this many orphans, the passes counting the
 * entries that passed on a retry as flaky, or none.
 */
function reportCountsProblems(report: TestReport, expected: Outcomes, orphans: number): string[] {
  const outcomes = Object.values(expected)
  const countOf = (outcome: Outcome): number => outcomes.filter((each) => each === outcome).length
  const counts: TestReportCounts = {
    passed: countOf('passed'),
    flaky: report.snapshots.filter(({ flaky }) => flaky).length,
    differs: countOf('differs'),
    broken: countOf('broken'),
    missing: countOf('missing'),
    orphan: orphans,
  }

  return isDeepStrictEqual(report.counts, counts)
    ? []
    : [`counts are ${JSON.stringify(report.counts)}, expected ${JSON.stringify(counts)}`]
}

/**
 * Lists how a report's entries, its orphans' apart, differ from these outcomes: each snapshot that doesn't pass has
 * an entry with its outcome as the status, and a snapshot that passed has one only when it passed on a retry, so a
 * plain pass listed is a problem.
 */
function reportEntriesProblems(report: TestReport, expected: Outcomes): string[] {
  const listed = report.snapshots.filter(({ status }) => status !== 'orphan')
  const plainPasses = listed.filter(({ status, flaky }) => status === 'passed' && !flaky).map(({ id }) => id)
  const flakyPasses = listed.filter(({ status, flaky }) => status === 'passed' && flaky).map(({ id }) => id)
  const listedExpected = Object.fromEntries(
    Object.entries(expected).filter(([key, outcome]) => outcome !== 'passed' || flakyPasses.includes(key)),
  )
  const actual = Object.fromEntries(
    listed.filter(({ id }) => !plainPasses.includes(id)).map((entry) => [entry.id, entry.status]),
  )

  return [
    ...outcomeProblems('entries', actual as Outcomes, listedExpected),
    ...(plainPasses.length === 0 ? [] : [`it lists plain passes: ${plainPasses.join(', ')}`]),
  ]
}

/**
 * Lists how the images a report's entries list differ from the files in its `images/` folder: each listed image that
 * isn't there, and each file there that no entry lists.
 */
function reportImagesProblems(report: TestReport, configFolder: string): string[] {
  const folder = reportFolderOf(configFolder)
  const listed = report.snapshots.flatMap(({ images }) => Object.values(images).filter((path) => path !== null))
  const imagesFolder = join(folder, 'images')
  const onDisk = existsSync(imagesFolder)
    ? readdirSync(imagesFolder, { recursive: true })
        .map((path) => join(imagesFolder, String(path)))
        .filter(isFile)
        .map((path) => relative(folder, path).split(sep).join('/'))
    : []

  return [
    ...listed.filter((path) => !onDisk.includes(path)).map((path) => `it lists ${path}, which isn't in ${folder}`),
    ...onDisk.filter((path) => !listed.includes(path)).map((path) => `${folder} holds ${path}, which no entry lists`),
  ]
}

/**
 * Lists what is wrong with the entry of each broken story these give, when the report has one with the status
 * `broken`: its reason, whether it has an image of its page, any other image, and what else it must hold. A story the
 * report has no broken entry for is left to `reportEntriesProblems`.
 */
function brokenEntryProblems(report: TestReport, brokenStories: BrokenEntry[]): string[] {
  return brokenStories.flatMap((brokenStory) => {
    const entry = report.snapshots.find(({ id, status }) => id === brokenStory.storyId && status === 'broken')

    return entry === undefined ? [] : brokenEntryHoldsProblems(entry, brokenStory)
  })
}

/**
 * Lists what a broken story's entry doesn't hold of what `brokenStory` gives: see `brokenEntryProblems`.
 */
function brokenEntryHoldsProblems(entry: TestReportEntry, brokenStory: BrokenEntry): string[] {
  const { storyId, reason, holds, has } = brokenStory

  return [
    ...problemUnless(entry.reason === reason, `${storyId}'s reason is ${entry.reason}, expected ${reason}`),
    ...brokenImagesProblems(entry, brokenStory),
    ...problemUnless(has?.(entry) ?? true, `${storyId}'s entry doesn't hold ${holds}: ${JSON.stringify(entry)}`),
  ]
}

/**
 * Lists what is wrong with a broken story's images: an image of its page where `brokenStory` says it has none, or
 * none where it has one, and any baseline or diff.
 */
function brokenImagesProblems(entry: TestReportEntry, { storyId, pageImage }: BrokenEntry): string[] {
  const { baseline, snapshot, diff } = entry.images
  const pageImageText = pageImage ? 'an image of its page' : 'null'

  return [
    ...problemUnless(
      (snapshot !== null) === pageImage,
      `${storyId}'s images.snapshot is ${snapshot}, expected ${pageImageText}`,
    ),
    ...problemUnless(
      baseline === null && diff === null,
      `${storyId} lists a baseline or diff image: ${baseline}, ${diff}`,
    ),
  ]
}

/**
 * Lists each of these fields of a snapshot's entry, among a report's or an `update` document's entries, that doesn't
 * deeply equal the given value, or the problem that there's no entry for the snapshot.
 */
function entryFieldProblems<Entry extends TestReportEntry | UpdateReportEntry>(
  entries: readonly Entry[],
  key: string,
  fields: Partial<Entry>,
): string[] {
  const entry = entries.find(({ id }) => id === key)

  if (entry === undefined) {
    return [`no entry for ${key}`]
  }

  return Object.entries(fields).flatMap(([field, value]) => {
    const actual = (entry as unknown as Record<string, unknown>)[field]

    return isDeepStrictEqual(actual, value)
      ? []
      : [`${key}'s ${field} is ${JSON.stringify(actual)}, expected ${JSON.stringify(value)}`]
  })
}

/**
 * The images a report entry of the Storybook `react` lists for a snapshot that differed: its baseline, snapshot and
 * diff, each `images/react/<key>.<kind>.png`.
 */
function differingImagesOf(key: string): ReportImages {
  return {
    baseline: `images/react/${key}.baseline.png`,
    snapshot: `images/react/${key}.snapshot.png`,
    diff: `images/react/${key}.diff.png`,
  }
}

/**
 * Lists every file in a folder and its subfolders, by its path relative to the folder, with its bytes in base64.
 * Nothing when there's no folder.
 */
function folderContentsOf(folder: string): string[] {
  if (!existsSync(folder)) {
    return []
  }

  return readdirSync(folder, { recursive: true })
    .map(String)
    .filter((path) => isFile(join(folder, path)))
    .sort()
    .map((path) => `${path}: ${readFileSync(join(folder, path)).toString('base64')}`)
}

/**
 * Runs `test --all` against the committed baselines with the package's config and 2 workers, on a server that lists the
 * stories of the file that fails to load, and checks the run with `committedBaselinesProblems`. The expected outcomes
 * are the ones of every story, those stories' included.
 */
async function checkCommittedBaselines(expected: Outcomes): Promise<string[]> {
  return await withStorybookServer({ withLoadFails: true }, async (server) =>
    committedBaselinesProblems(
      await runCli(['test', '--all', '--url', server.url, '--workers', String(parallelWorkers)]),
      expected,
      packageDir,
    ),
  )
}

/**
 * Runs `test --all` in CI against the committed baselines with the package's config, on a server that lists the
 * stories of the file that fails to load, and checks that the consistency check stopped it before any capture. It exits
 * 1, its only snapshot lines are those stories', broken, each saying the file failed to load, its header is the
 * consistency output's, counting every snapshot with an expected outcome, its output ends with the line that says CI
 * stops before capturing and the report line, and the browser asked for no story page. The expected outcomes are the
 * ones of every story, those stories' included.
 */
async function checkCiStop(expected: Outcomes): Promise<string[]> {
  return await withStorybookServer({ withLoadFails: true }, async (server) => {
    const run = await runCli(['test', '--all', '--url', server.url], { ...localEnvironment(), CI: 'true' })

    return [
      ...consistencyStopProblems(run, server, expected),
      ...(run.stdout.endsWith(`\n${ciStopLine}\n${reportLineOf(packageDir)}\n`)
        ? []
        : [`test's output doesn't end with "${ciStopLine}" and the report line${outputOf(run.stdout)}`]),
    ]
  })
}

/**
 * Runs `test --consistency` against the committed baselines with the package's config, on a server that lists the
 * stories of the file that fails to load, and checks what it found without capturing. It exits 1, its only snapshot
 * lines are those stories', broken, each saying the file failed to load, its header is the consistency output's,
 * counting every snapshot with an expected outcome, its output has no CI line, and the browser asked for no story page.
 * Its report is consistency-only, and lists exactly those stories, broken, `load-failed`, with the file's error. The
 * expected outcomes are the ones of every story, those stories' included.
 */
async function checkConsistencyOnly(expected: Outcomes): Promise<string[]> {
  return await withStorybookServer({ withLoadFails: true }, async (server) => {
    const run = await runCli(['test', '--consistency', '--url', server.url])

    return [
      ...consistencyStopProblems(run, server, expected),
      ...(run.stdout.includes(ciStopLine) ? [`test --consistency prints the CI line${outputOf(run.stdout)}`] : []),
      ...reportProblems(packageDir, (report) => [
        ...(report.consistencyOnly ? [] : ['consistencyOnly is false']),
        ...reportOutcomeProblems(report, outcomesMatching(expected, loadFailsFilter), packageDir),
        ...brokenEntryProblems(
          report,
          brokenEntries.filter(({ storyId }) => loadFailsFilter.test(storyId)),
        ),
      ]),
    ]
  })
}

/**
 * Lists how a run that stopped at the consistency check, against the committed baselines on a server that lists the
 * stories of the file that fails to load, differs from what it should print: it gives exactly those stories' outcomes,
 * each saying the file failed to load, its header is the consistency output's and counts every snapshot with an
 * expected outcome, and the browser asked for no story page.
 */
function consistencyStopProblems(run: CliRun, server: StorybookServer, expected: Outcomes): string[] {
  return [
    ...expectedRunProblems('test', run, outcomesMatching(expected, loadFailsFilter)),
    ...perStoryOptionsLines
      .filter(([storyId]) => loadFailsFilter.test(storyId))
      .flatMap(([storyId, says]) => lineSaysProblems(run, storyId, says)),
    ...consistencyHeaderProblems(run, Object.keys(expected).length),
    ...capturedProblems(server),
  ]
}

/**
 * Gives the problem with a run's output when it has no consistency header counting this many snapshots, or none when it
 * has.
 */
function consistencyHeaderProblems(run: CliRun, count: number): string[] {
  const counted = consistencyHeaderPattern.exec(run.stdout)?.[1]

  return counted === String(count)
    ? []
    : [`test's consistency header counts ${counted ?? 'no'} snapshots, expected ${count}${outputOf(run.stdout)}`]
}

/**
 * Runs `test --shard k/4` for k from 1 to 4, one after the other, against the committed baselines with the package's
 * config and 2 workers, each on a server of its own that lists the stories of the file that fails to load. Each shard
 * is checked with `shardProblems`. Together the shards print exactly one line for each snapshot with an expected
 * outcome, with that outcome, and each stories file `index.json` lists has lines in exactly one shard. The expected
 * outcomes are the ones of every story, those stories' included.
 */
async function checkShards(expected: Outcomes): Promise<string[]> {
  const storiesFiles = readStoriesFiles()
  const runs: CliRun[] = []
  const problems: string[] = []

  for (let shard = 1; shard <= shardCount; shard += 1) {
    const { run, storyPages } = await withStorybookServer({ withLoadFails: true }, async (server) => ({
      run: await runCli([
        'test',
        '--shard',
        `${shard}/${shardCount}`,
        '--url',
        server.url,
        '--workers',
        String(parallelWorkers),
      ]),
      storyPages: server.storyPageRequests(),
    }))

    runs.push(run)
    problems.push(
      ...shardProblems(shard, run, storyPages, expected, storiesFiles).map(
        (problem) => `shard ${shard}/${shardCount}: ${problem}`,
      ),
    )
  }

  return [...problems, ...shardedSnapshotProblems(runs, expected), ...shardedFileProblems(runs, storiesFiles)]
}

/**
 * Lists what is wrong with one shard's run: `shardHeaderProblems`, it exits with another code than the expected outcomes
 * of its snapshots give, the browser asked for the page of a story whose stories file the shard has no line for, or
 * its report, in the package's folder, doesn't name the shard or differs from those outcomes.
 */
function shardProblems(
  shard: number,
  run: CliRun,
  storyPages: string[],
  expected: Outcomes,
  storiesFiles: ReadonlyMap<string, string>,
): string[] {
  const ownExpected = Object.fromEntries(Object.entries(expected).filter(([key]) => key in run.outcomes))
  const ownFiles = storiesFilesOf(run, storiesFiles)
  const otherPages = [...new Set(storyPages)].filter((storyId) => !ownFiles.has(storiesFiles.get(storyId) ?? ''))

  return [
    ...shardHeaderProblems(shard, run),
    ...exitCodeProblems('test', run, exitCodeOf(ownExpected)),
    ...(otherPages.length === 0
      ? []
      : [`the browser asked for pages of stories files the shard has no line for: ${otherPages.join(', ')}`]),
    ...reportProblems(packageDir, (report) => [
      ...(isDeepStrictEqual(report.shard, { index: shard, total: shardCount })
        ? []
        : [`shard is ${JSON.stringify(report.shard)}, expected ${shard}/${shardCount}`]),
      ...reportOutcomeProblems(report, ownExpected, packageDir),
    ]),
  ]
}

/**
 * Lists what is wrong with the start of a shard's output: its header doesn't name the shard, or the line after it
 * isn't the note that the consistency check is left to `test --consistency`.
 */
function shardHeaderProblems(shard: number, run: CliRun): string[] {
  const [header = '', note] = run.stdout.split('\n')
  const shardPart = `· test · shard ${shard}/${shardCount} ·`

  return [
    ...(header.startsWith('visual-check ') && header.includes(shardPart)
      ? []
      : [`test's header doesn't say "${shardPart}": ${header}`]),
    ...(note === consistencyLeftNote
      ? []
      : [`test's line after its header isn't "${consistencyLeftNote}"${outputOf(run.stdout)}`]),
  ]
}

/**
 * Lists how the shards' snapshot lines, taken together, differ from the expected outcomes: each snapshot whose outcome
 * isn't the expected one or that no shard printed, and each snapshot more than one line gives, with the shards that
 * printed them.
 */
function shardedSnapshotProblems(runs: CliRun[], expected: Outcomes): string[] {
  const lines = runs.flatMap((run, index) => run.snapshots.map(({ key }) => ({ key, shard: index + 1 })))
  const keys = [...new Set(lines.map(({ key }) => key))].sort()

  return [
    ...outcomeProblems('the shards', Object.fromEntries(runs.flatMap((run) => Object.entries(run.outcomes))), expected),
    ...keys.flatMap((key) => {
      const shards = lines.filter((line) => line.key === key).map(({ shard }) => shard)

      return shards.length === 1 ? [] : [`${key} has ${shards.length} lines, in shards ${shards.join(', ')}`]
    }),
  ]
}

/**
 * Lists each stories file `index.json` lists that has snapshot lines in no shard, or in more than one, with the
 * shards.
 */
function shardedFileProblems(runs: CliRun[], storiesFiles: ReadonlyMap<string, string>): string[] {
  const filesOfShards = runs.map((run) => storiesFilesOf(run, storiesFiles))

  return [...new Set(storiesFiles.values())].sort().flatMap((file) => {
    const shards = filesOfShards.flatMap((files, index) => (files.has(file) ? [index + 1] : []))

    return shards.length === 1 ? [] : [`${file} has lines in ${shards.length} shards, expected 1: ${shards.join(', ')}`]
  })
}

/**
 * Gives the stories file of each story a run has a snapshot line for.
 */
function storiesFilesOf(run: CliRun, storiesFiles: ReadonlyMap<string, string>): Set<string> {
  return new Set(run.snapshots.flatMap(({ storyId }) => storiesFiles.get(storyId) ?? []))
}

/**
 * Lists what is wrong with a run of `test --all` against the committed baselines. It gives exactly the expected
 * outcomes. Each broken readiness, per-story options, capture area and grid story that has an expected outcome has a
 * line that says why, and standard error has no test-path warning, since every page is on Storybook's test path. The
 * disabled stories, which `index.json` lists, have no line, and the header counts exactly the snapshots with an
 * expected outcome, the modes' included. The story that lists `dark` and `mobile` has exactly 3 lines, and the story
 * with its own list of modes has no line for the meta's `dark`. Outside the Storybook 10 test Storybook, the committed
 * animation baselines are byte-identical to its own. Its stdout's last line is the report line of the config in
 * `configFolder`, and the report there counts and lists exactly the expected outcomes, has exactly the images its
 * entries list, and the entry of each broken readiness, per-story options, capture area and grid story that has an
 * expected outcome holds what `brokenEntries` gives.
 */
function committedBaselinesProblems(run: CliRun, expected: Outcomes, configFolder: string): string[] {
  return [
    ...reportLineProblems(run, configFolder),
    ...reportProblems(configFolder, (report) => [
      ...reportOutcomeProblems(report, expected, configFolder),
      ...brokenEntryProblems(
        report,
        brokenEntries.filter(({ storyId }) => expected[storyId] !== undefined),
      ),
    ]),
    ...expectedRunProblems('test', run, expected),
    ...[...readinessLines, ...perStoryOptionsLines, ...captureAreaLines, ...gridLines]
      .filter(([storyId]) => !loadFailsFilter.test(storyId) || expected[storyId] !== undefined)
      .flatMap(([storyId, says]) => lineSaysProblems(run, storyId, says)),
    ...noTestPathWarningProblems(run.stderr),
    ...storybook10AnimationProblems(),
    ...disabledStoryProblems(run),
    ...headerCountProblems(run, Object.keys(expected).length),
    ...lineCountProblems(run, modeLines.darkAndMobile.storyId, modeLines.darkAndMobile.count),
    ...absentModeProblems(run, modeLines.ownModesOnly.storyId, modeLines.ownModesOnly.absentMode),
  ]
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
  const indexed = [...readStoriesFiles().keys()]

  return disabledStories.flatMap((storyId) => [
    ...(indexed.includes(storyId) ? [] : [`index.json doesn't list ${storyId}`]),
    ...(run.snapshots.some((snapshot) => snapshot.storyId === storyId)
      ? [`test printed a line for ${storyId}, which is disabled`]
      : []),
  ])
}

/**
 * Reads the stories file, its `importPath`, of every entry the static build's `index.json` lists, by the entry's ID.
 */
function readStoriesFiles(): Map<string, string> {
  const { entries } = JSON.parse(readFileSync(join(staticDir, 'index.json'), 'utf8')) as {
    entries: Record<string, { importPath: string }>
  }

  return new Map(Object.entries(entries).map(([storyId, { importPath }]) => [storyId, importPath]))
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
 * ones missing, and the baselines of the stories expected to pass are byte-identical to the committed ones. Only those
 * have a committed baseline the written one must equal. `update`'s standard error ends with the network warning for the
 * network stories alone. Both commands take 2 workers from the config. `test`'s report counts and lists the outcomes it
 * gives, its missing entries with no image.
 */
async function checkUpdateThenTest(expected: Outcomes): Promise<string[]> {
  rmSync(diagnosticsDir, { recursive: true, force: true })

  return await withStorybookServer({}, (server) =>
    withTemporaryFolder(async (folder) => {
      const baselines = join(folder, 'baselines')
      const config = writeConfig(folder, server.url, baselines)
      const args = ['--all', '--config', config]
      const update = await runCli(['update', ...args])
      const updateProblems = [
        ...expectedRunProblems('update', update, mapOutcomes(expected, updateOutcomeOf)),
        ...networkWarningProblems(update.stderr, server),
      ]

      if (updateProblems.length > 0) {
        return updateProblems
      }

      const passing = Object.keys(expected).filter((key) => expected[key] === 'passed')

      const retestExpected = mapOutcomes(expected, retestOutcomeOf)
      const retest = await runCli(['test', ...args])
      const retestProblems = [
        ...expectedRunProblems('test', retest, retestExpected),
        ...reportProblems(folder, (report) => [
          ...reportOutcomeProblems(report, retestExpected, folder),
          ...report.snapshots
            .filter(({ status, images }) => status === 'missing' && !isDeepStrictEqual(images, noImages))
            .map(({ id, images }) => `${id} is missing but lists images: ${JSON.stringify(images)}`),
        ]),
      ]
      const pagesBefore = server.storyPageRequests().length
      const consistency = await runCli(['test', '--consistency', '--config', config])

      return [
        ...baselineProblems(baselines, passing),
        ...retestProblems,
        ...consistencyAfterUpdateProblems(
          consistency,
          expected,
          server.storyPageRequests().length - pagesBefore,
          folder,
        ),
      ]
    }),
  )
}

/**
 * Lists how `test --consistency`, run right after an `update` that wrote every story that isn't broken, differs from
 * what it should find: exactly the broken stories, missing since `update` writes no baseline for them, with the
 * consistency header counting every snapshot, a counts line of that many missing and no orphan, then the report line
 * of the config in `configFolder`, and no story page loaded.
 */
function consistencyAfterUpdateProblems(
  run: CliRun,
  expected: Outcomes,
  storyPagesLoaded: number,
  configFolder: string,
): string[] {
  const missing = Object.entries(mapOutcomes(expected, retestOutcomeOf)).filter(([, outcome]) => outcome === 'missing')
  const counts = `${missing.length} missing`

  return [
    ...expectedRunProblems('test --consistency', run, Object.fromEntries(missing)),
    ...consistencyHeaderProblems(run, Object.keys(expected).length),
    ...(run.stdout.endsWith(`\n${counts}\n${reportLineOf(configFolder)}\n`)
      ? []
      : [`test --consistency doesn't end with "${counts}" and the report line${outputOf(run.stdout)}`]),
    ...(storyPagesLoaded > 0 ? [`test --consistency loaded ${storyPagesLoaded} story pages, so it captured`] : []),
  ]
}

/**
 * Gives the problem with `update`'s standard error when its network warning isn't exactly the network stories' block,
 * or none. The block is a line for `RealFetch`'s request, then one for `RemoteImage`'s remote content, both after the
 * remote origin's host, `localhost` on the server's port. Standard error must end with it, and hold no other line of
 * the warning, so a story listed with them, or a host with a line of its own, fails the case. Whatever else standard
 * error says before the block doesn't matter.
 */
function networkWarningProblems(stderr: string, server: StorybookServer): string[] {
  const host = `localhost:${new URL(server.url).port}`
  const block = [`${host}${networkWarning.request}`, `${host}${networkWarning.remoteContent}`]
  const warned = stderr.split('\n').filter((line) => networkWarning.linePattern.test(line))

  if (warned.join('\n') === block.join('\n')) {
    return stderr.endsWith(`${block.join('\n')}\n`)
      ? []
      : [`update's network warning doesn't end its standard error${outputOf(stderr)}`]
  }

  return [
    `update's network warning isn't the network stories' block, expected:`,
    ...block.map((line) => `  ${line}`),
    'got:',
    ...(warned.length > 0 ? warned.map((line) => `  ${line}`) : ['  no warning']),
  ]
}

/**
 * Lists how a run's exit code and outcomes differ from the ones the expected outcomes give.
 */
function expectedRunProblems(command: string, run: CliRun, expected: Outcomes): string[] {
  return [...exitCodeProblems(command, run, exitCodeOf(expected)), ...outcomeProblems(command, run.outcomes, expected)]
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

  return [...lineSaysProblems(run, storyId, says), ...storyPageCountProblems(server, storyId, loads)]
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
 * `Crashes` pass, so a page that a `beforeunload` dialog holds, or a crashed page that isn't replaced, shows. The
 * report beside the config counts and lists the expected outcomes, and the two broken stories' entries hold what
 * `hazards.entries` gives.
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
        ...reportProblems(folder, (report) => [
          ...reportOutcomeProblems(report, outcomesMatching(expected, hazards.filter), folder),
          ...brokenEntryProblems(report, hazards.entries),
        ]),
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
 * A masked element that grows, and its mask with it, fails `test` with that story's snapshot differing: the mask
 * covers the element's box as it is at capture, not the baseline's.
 */
async function checkGrowingMask(): Promise<string[]> {
  return await withStorybookServer({ injectIntoIframe: growingMask.script }, async (server) => {
    const run = await runCli(['test', '--filter', growingMask.filter.source, '--url', server.url])

    return [
      ...exitCodeProblems('test', run, 1),
      ...outcomeProblems('test', run.outcomes, { [growingMask.storyId]: 'differs' }),
    ]
  })
}

/**
 * With one pixel of the card story changed, `test` on that story against the committed baselines fails with a config
 * that sets `tolerance: { pixels: 0 }`: the story differs, its line says `1 differ, 0 allowed`, and the report beside
 * the config lists it differing by pixels, 1 of 0 allowed with a budget of 0 at scale 1, with its baseline, snapshot and
 * diff, which it holds. With the default tolerance, the same `test` gives the story its expected outcome, passed. Each
 * problem starts with the tolerance its run had.
 */
async function checkOnePixelChange(expected: Outcomes): Promise<string[]> {
  const { storyId, filter, style, says, pixels } = onePixelChange
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
        ...reportProblems(folder, (report) => [
          ...entryFieldProblems(report.snapshots, storyId, {
            status: 'differs',
            reason: 'pixels',
            pixels,
            images: differingImagesOf(storyId),
          }),
          ...reportImagesProblems(report, folder),
        ]),
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
 * The flaky case's runs, one after the other, each on a server of its own that changes the card story's first page
 * loads and with a config of its own: see `flakyChange`. Each problem starts with its run's name.
 */
async function checkFlakyRetries(): Promise<string[]> {
  const problems: string[] = []

  for (const flakyRun of flakyChange.runs) {
    const runProblems = await flakyRunProblems(flakyRun)

    problems.push(...runProblems.map((problem) => `${flakyRun.name}: ${problem}`))
  }

  return problems
}

/**
 * Runs `test` on the card story against the committed baselines, with the story's first `changedLoads` page loads
 * changed and a config that sets the run's `retries`. `test` gives the story the run's outcome, and the server is asked
 * for its page the run's number of times. A pass is flaky: its line ends with `· flaky`, `test` lists it under the
 * flaky heading, its counts say `1 passed (1 flaky)`, and the report beside the config lists it passed, flaky, after as
 * many attempts as page loads, with its first capture's baseline, snapshot and diff, which it holds. A snapshot that
 * differs isn't flaky, so `test` lists no flaky snapshot.
 */
async function flakyRunProblems({ changedLoads, outcome, storyPages, retries }: FlakyRun): Promise<string[]> {
  const { storyId, filter, markup } = flakyChange
  const serveOptions = { injectIntoLoads: { storyId, markup: Array.from({ length: changedLoads }, () => markup) } }

  return await withStorybookServer(serveOptions, (server) =>
    withTemporaryFolder(async (folder) => {
      const config = writeConfig(folder, server.url, committedBaselines, retries === undefined ? {} : { retries })
      const run = await runCli(['test', '--filter', filter.source, '--config', config])

      return [
        ...expectedRunProblems('test', run, { [storyId]: outcome }),
        ...storyPageCountProblems(server, storyId, storyPages),
        ...(outcome === 'passed' ? flakyPassProblems(run, storyId, folder, storyPages) : notFlakyProblems(run)),
      ]
    }),
  )
}

/**
 * Gives the problem when the server wasn't asked for a story's page this many times, or none when it was.
 */
function storyPageCountProblems(server: StorybookServer, storyId: string, count: number): string[] {
  const seen = server.storyPageRequests().filter((requested) => requested === storyId).length

  return seen === count ? [] : [`the server was asked for ${storyId}'s page ${seen} times, expected ${count}`]
}

/**
 * Lists what shows a story's pass isn't flaky in a run of `test` with the Storybook `react`: its line doesn't end with
 * `· flaky`, the flaky heading isn't followed by its name, the counts don't say `1 passed (1 flaky)`, or the report
 * beside the config doesn't list it passed, flaky, after this many attempts, with its first capture's images, or
 * doesn't hold them.
 */
function flakyPassProblems(run: CliRun, storyId: string, configFolder: string, attempts: number): string[] {
  return [
    ...lineSaysProblems(run, storyId, flakyMark),
    ...stdoutSaysProblems(run, [`${flakyHeading}\n  react  ${storyId}\n`, '1 passed (1 flaky)']),
    ...reportProblems(configFolder, (report) => [
      ...entryFieldProblems(report.snapshots, storyId, {
        status: 'passed',
        flaky: true,
        attempts,
        images: differingImagesOf(storyId),
      }),
      ...reportImagesProblems(report, configFolder),
    ]),
  ]
}

/**
 * Lists each text a run's standard output doesn't hold, with the whole output on one line.
 */
function stdoutSaysProblems(run: CliRun, texts: string[]): string[] {
  return texts
    .filter((text) => !run.stdout.includes(text))
    .map((text) => `test's output doesn't say ${JSON.stringify(text)}${outputOf(run.stdout)}`)
}

/**
 * Gives the problem when a run of `test` marks a line flaky or lists flaky snapshots, or none.
 */
function notFlakyProblems(run: CliRun): string[] {
  const flaky = run.snapshots.some((snapshot) => snapshot.detail.includes(flakyMark))

  return flaky || run.stdout.includes(flakyHeading) ? [`test reports a flaky snapshot${outputOf(run.stdout)}`] : []
}

/**
 * Runs `update --reporter json` on the card story alone, with a stability case's markup in its page loads and a config
 * whose baselines folder holds the story's committed baseline, or nothing when the case has it missing: see
 * `updateStability`. Its lines, on standard error, give the story the case's outcome and detail, so it exits 1 only
 * when the story is broken, and list it as flaky at their end only when the case is flaky. Its standard output is one
 * `update` document with the case's counts and entry. The server is asked for the story's page the case's number of
 * times, and the folder then holds the story's committed baseline alone, byte for byte: kept or left untouched, or
 * written as committed. So no other baseline is written. A baseline that isn't the committed one is copied to the
 * case's folder in the diagnostics folder's `update-stability/`.
 */
async function checkUpdateStability(stabilityRun: StabilityRun): Promise<string[]> {
  const { storyId, filter } = updateStability
  const { name, loadMarkup, hasBaseline, outcome, detail, flaky, storyPages, counts, entry } = stabilityRun
  const serveOptions = { onlyStory: storyId, injectIntoLoads: { storyId, markup: loadMarkup } }

  return await withStorybookServer(serveOptions, (server) =>
    withTemporaryFolder(async (folder) => {
      const baselines = join(folder, 'baselines')
      const baselineName = `${storyId}.png`

      mkdirSync(baselines)

      if (hasBaseline) {
        cpSync(join(committedBaselines, baselineName), join(baselines, baselineName))
      }

      const config = writeConfig(folder, server.url, baselines)
      const run = await runCli(['update', '--reporter', 'json', '--filter', filter.source, '--config', config])
      const lines = humanLinesOf(run)

      return [
        ...expectedRunProblems('update', lines, { [storyId]: outcome }),
        ...lineMatchesProblems(lines, storyId, detail),
        ...updateFlakyProblems(lines, storyId, flaky),
        ...updateDocumentProblems(run.stdout, (document) => [
          ...updateCountsProblems(document.counts, counts),
          ...stabilityEntryProblems(document.snapshots, storyId, entry),
        ]),
        ...storyPageCountProblems(server, storyId, storyPages),
        ...onlyCommittedBaselineProblems(baselines, baselineName, join(diagnosticsDir, 'update-stability', name)),
      ]
    }),
  )
}

/**
 * Reads the lines a `--reporter json` run writes for people, on standard error, as a run whose standard output they
 * are, so the checks of a `log` run's lines apply to them.
 */
function humanLinesOf(run: CliRun): CliRun {
  return cliRunOf(run.stderr, run)
}

/**
 * Lists what is wrong with a stability case's `update` document's entries: they aren't the story's one entry holding
 * what `entry` gives, or, when `entry` is `null`, there's any entry.
 */
function stabilityEntryProblems(
  entries: readonly UpdateReportEntry[],
  storyId: string,
  entry: StabilityEntry | null,
): string[] {
  if (entry === null) {
    return problemUnless(entries.length === 0, `the document lists entries: ${JSON.stringify(entries)}`)
  }

  const [listed, ...others] = entries

  if (listed === undefined || others.length > 0) {
    return [`the document lists ${entries.length} entries, expected ${storyId}'s alone: ${JSON.stringify(entries)}`]
  }

  const e2eConsole = listed.console.filter(({ text }) => text.startsWith(e2eConsolePrefix))

  return [
    ...entryFieldProblems(entries, storyId, entry.fields),
    ...problemUnless(
      entry.message.test(listed.message),
      `its message "${listed.message}" doesn't match ${entry.message}`,
    ),
    ...problemUnless(
      isDeepStrictEqual(e2eConsole, entry.e2eConsole),
      `its console keeps ${JSON.stringify(e2eConsole)} of the case's messages, expected ${JSON.stringify(entry.e2eConsole)}`,
    ),
  ]
}

/**
 * Gives the problem with the snapshot line of a story's default capture in a run of `update` when the pattern doesn't
 * match its whole detail, or none when it does or the run has no line for it, which the outcome check reports.
 */
function lineMatchesProblems(run: CliRun, storyId: string, detail: RegExp): string[] {
  const line = run.snapshots.find((snapshot) => snapshot.key === storyId)

  return line === undefined || detail.test(line.detail)
    ? []
    : [`update: ${storyId}'s line says "${line.detail}", expected it to match ${detail}`]
}

/**
 * Gives the problem with a run of `update` with the Storybook `react` when a flaky story isn't listed alone under the
 * flaky heading at the end of its standard output, or, for a story that isn't flaky, when the run lists flaky
 * snapshots at all, or none.
 */
function updateFlakyProblems(run: CliRun, storyId: string, flaky: boolean): string[] {
  const listed = `${updateFlakyHeading}\n  react  ${storyId}\n`

  if (flaky) {
    return run.stdout.endsWith(listed)
      ? []
      : [`update's output doesn't end with ${JSON.stringify(listed)}${outputOf(run.stdout)}`]
  }

  return run.stdout.includes(updateFlakyHeading) ? [`update lists a flaky snapshot${outputOf(run.stdout)}`] : []
}

/**
 * Gives the problems with a baselines folder that must hold one committed baseline alone: any other file in it, or
 * that baseline missing or not byte-identical to the committed one. A baseline that isn't is copied to `keptIn`, for
 * CI to keep.
 */
function onlyCommittedBaselineProblems(folder: string, name: string, keptIn: string): string[] {
  const others = readdirSync(folder).filter((file) => file !== name)

  return [
    ...(others.length > 0 ? [`the baselines folder holds more than ${name}: ${others.join(', ')}`] : []),
    ...committedBaselineProblems(join(folder, name), keptIn),
  ]
}

/**
 * Gives the problem with a baseline that is missing, or isn't byte-identical to the committed one of the same name, or
 * none. One that isn't is copied to `keptIn`, for CI to keep, and the problem says where.
 */
function committedBaselineProblems(path: string, keptIn: string): string[] {
  const name = basename(path)

  if (isSameFile(path, join(committedBaselines, name))) {
    return []
  }

  if (!isFile(path)) {
    return [`${name} is missing from the baselines folder`]
  }

  mkdirSync(keptIn, { recursive: true })
  cpSync(path, join(keptIn, name))

  return [`${name} isn't byte-identical to the committed one: it's in ${keptIn}`]
}

/**
 * With the remote content story's mask `remote` dropped, `test` on that story against the committed baselines exits 1:
 * the story differs, since its snapshot shows the remote content its baseline has masked, and on its one retry every
 * differing pixel lies inside that content. So its line is followed by the end block's failures, where its failure
 * holds the hint on one line indented two spaces: that it differs only inside remote content from `localhost` on the
 * server's port, the mask for that host, and the docs page. The story differing also shows that the script reached
 * the options-reading page.
 */
async function checkRemoteContentHint(): Promise<string[]> {
  const { storyId, filter, script } = unmaskedRemoteContent

  return await withStorybookServer({ injectIntoIframe: script }, (server) =>
    withTemporaryFolder(async (folder) => {
      const config = writeConfig(folder, server.url, committedBaselines)
      const run = await runCli(['test', '--filter', filter.source, '--config', config])
      const host = `localhost:${new URL(server.url).port}`

      return [
        ...expectedRunProblems('test', run, { [storyId]: 'differs' }),
        ...linesAfterProblems(run, storyId, ['── 1 failure ──']),
        ...stdoutSaysProblems(run, [
          `\n  hint: Differs only inside remote content from ${host}. A CDN can serve different bytes to different ` +
            `machines. Mask it by host: { host: '${host}' }. See ${remoteContentDocs}\n`,
        ]),
      ]
    }),
  )
}

/**
 * The story whose stories file the server drops on its page, and that file's pathname in the static build.
 */
const droppedStoriesFile: DroppedFiles = { storyId: 'card--default', path: /^\/assets\/card\.stories-[\w-]+\.js$/ }

/**
 * With the server dropping the connection of every request for `card--default`'s stories file once it was asked for
 * that story's page, `test` on that story alone, with no retry, exits 1: the story is broken, and its line says its
 * page couldn't load that file from Storybook, with the browser's network error. Its failure in the end block holds
 * the hint about the server, naming `python3 -m http.server`, and its report entry has a `failed-loads` hint whose
 * first file is that stories file, with the browser's network error.
 */
async function checkFailedLoadsHint(): Promise<string[]> {
  const { storyId, path } = droppedStoriesFile

  return await withStorybookServer({ dropAfterStoryPage: droppedStoriesFile }, (server) =>
    withTemporaryFolder(async (folder) => {
      const config = writeConfig(folder, server.url, committedBaselines, { retries: 0 })
      const run = await runCli(['test', '--filter', `^${storyId}$`, '--config', config])

      return [
        ...expectedRunProblems('test', run, { [storyId]: 'broken' }),
        ...lineSaysProblems(run, storyId, "couldn't load /assets/card.stories-"),
        ...lineSaysProblems(run, storyId, 'from Storybook: net::ERR_'),
        ...stdoutSaysProblems(run, [
          "hint: Storybook's server dropped the connection or never answered.",
          'python3 -m http.server',
        ]),
        ...reportProblems(folder, (report) => failedLoadsEntryProblems(report, storyId, path)),
      ]
    }),
  )
}

/**
 * Gives the files of the `failed-loads` hints of the report's entry for the story, in order, or none.
 */
function failedLoadsOf(report: TestReport, storyId: string): ReportFailedLoad[] {
  const hints = report.snapshots.find((snapshot) => snapshot.id === storyId)?.hints ?? []

  return hints.flatMap((hint) => (hint.kind === 'failed-loads' ? hint.files : []))
}

/**
 * Gives the problem when the report's entry for the story has no `failed-loads` hint whose first file's pathname
 * matches `path` and whose error is a network error, or none.
 */
function failedLoadsEntryProblems(report: TestReport, storyId: string, path: RegExp): string[] {
  const [file] = failedLoadsOf(report, storyId)

  if (file === undefined) {
    return [`${storyId}'s entry has no failed-loads hint with a file`]
  }

  return path.test(new URL(file.url).pathname) && file.error.startsWith('net::ERR_')
    ? []
    : [
        `${storyId}'s failed-loads hint's first file isn't its stories file with a network error: ${JSON.stringify(file)}`,
      ]
}

/**
 * Gives the problem when the lines right after the snapshot line of a story's default capture aren't these, or none
 * when they are or the run has no line for it, which the outcome check reports.
 */
function linesAfterProblems(run: CliRun, storyId: string, expected: string[]): string[] {
  const lines = run.stdout.split('\n')
  const index = lines.findIndex((line) => snapshotOf(line)[0]?.key === storyId)

  if (index === -1) {
    return []
  }

  const after = lines.slice(index + 1, index + 1 + expected.length)

  return after.join('\n') === expected.join('\n')
    ? []
    : [`test: the lines after ${storyId}'s are ${JSON.stringify(after)}, expected ${JSON.stringify(expected)}`]
}

/**
 * The page errors stories and what their cases run: see the README's section on them.
 */
const pageErrors = {
  /**
   * Matches the keys of every page errors story's snapshots.
   */
  filter: /^page-errors--/,
  /**
   * The script, added to every `iframe.html`, that makes each page errors story raise its page errors. Without it,
   * each raises only those it expects, so every other case lists none of them.
   */
  script: '<script>globalThis.__visualCheckE2ePageErrors = true</script>',
  /**
   * The stories that each raise one kind of page error that nothing expects, each case alone.
   */
  failingKinds: [
    'page-errors--console-error',
    'page-errors--uncaught-error',
    'page-errors--unhandled-rejection',
    'page-errors--missing-file',
    'page-errors--server-error',
    'page-errors--dropped-load',
    'page-errors--worker-error',
  ],
  /**
   * Matches the stories whose page errors, or the page errors they raise, don't fail `test`.
   */
  notFailing: /^page-errors--(console-warn|other-origin|expected-worker-error|expected-errors|stale|warn|off)$/,
  /**
   * The stories of `notFailing` that `test` lists all the same: the stale entry's and the warning's.
   */
  notFailingListed: ['page-errors--stale', 'page-errors--warn'],
  /**
   * Matches the story whose page errors the config case's config expects, and a story that raises none, which shows
   * that a config's expected page errors never go stale.
   */
  byConfig: /^page-errors--(expected-by-config|console-warn)$/,
  /**
   * The config case's expected page errors: a string in `ExpectedByConfig`'s message and a regular expression that
   * matches the URL of the file it fetches.
   */
  configExpected: ['expected by the config', /\/visual-check-e2e\/expected-by-config\.json$/],
  /**
   * The story the update case writes.
   */
  updateStoryId: 'page-errors--missing-file',
}

/**
 * What a page error in a report entry must be: its kind and severity, and its text and load error, each exactly a
 * string or matching a regular expression. A pattern without a load error matches a page error without one.
 */
interface PageErrorPattern {
  /**
   * The page error's kind.
   */
  kind: ReportPageError['kind']
  /**
   * The page error's text, exactly, or a pattern it matches.
   */
  text: string | RegExp
  /**
   * The page error's severity.
   */
  severity: ReportPageError['severity']
  /**
   * A load's error, exactly, or a pattern it matches.
   */
  loadError?: string | RegExp
}

/**
 * What a report entry of a snapshot with page errors holds of them.
 */
interface PageErrorsOfEntry {
  /**
   * Its page errors, in order.
   */
  pageErrors: PageErrorPattern[]
  /**
   * Its stale expected page errors, as the report writes them.
   */
  stale: string[]
}

/**
 * Gives what the report entry of each page errors snapshot that has page errors or stale expected page errors holds of
 * them, by key, when the server at the URL serves the Storybook and the page errors script is in every page. A load's
 * text is its full URL on the server.
 */
function listedPageErrorsOf(url: string): Record<string, PageErrorsOfEntry> {
  const failing = (kind: ReportPageError['kind'], text: string | RegExp): PageErrorPattern => ({
    kind,
    text,
    severity: 'fail',
  })
  const load = (path: string, loadError: string | RegExp): PageErrorPattern => ({
    kind: 'load',
    text: `${url}${path}`,
    severity: 'fail',
    loadError,
  })
  const failingWith = (...patterns: PageErrorPattern[]): PageErrorsOfEntry => ({ pageErrors: patterns, stale: [] })

  return {
    'page-errors--console-error': failingWith(failing('console.error', 'visual-check e2e: a console.error')),
    'page-errors--uncaught-error': failingWith(failing('error', /visual-check e2e: an uncaught error/)),
    'page-errors--unhandled-rejection': failingWith(
      failing('unhandledrejection', /visual-check e2e: an unhandled rejection/),
    ),
    'page-errors--missing-file': failingWith(load('/visual-check-e2e/missing.json', 'HTTP 404')),
    'page-errors--server-error': failingWith(load(serverErrorPath, 'HTTP 500')),
    'page-errors--dropped-load': failingWith(load(droppedPath, /^net::ERR_/)),
    'page-errors--worker-error': failingWith(load('/visual-check-e2e/orders?visual-check-e2e-status=500', 'HTTP 500')),
    'page-errors--expected-by-config': failingWith(
      failing('console.error', 'visual-check e2e: expected by the config'),
      load('/visual-check-e2e/expected-by-config.json', 'HTTP 404'),
    ),
    'page-errors--stale': { pageErrors: [], stale: ['"an error this story stopped raising"'] },
    'page-errors--warn': {
      pageErrors: [{ kind: 'console.error', text: 'visual-check e2e: a console.error that warns', severity: 'warn' }],
      stale: [],
    },
    'page-errors--two-modes.dark': failingWith(
      failing('console.error', 'visual-check e2e: a console.error in the dark mode'),
    ),
  }
}

/**
 * Keeps the listed page errors of these keys.
 */
function listedPageErrorsAmong(
  listed: Record<string, PageErrorsOfEntry>,
  keys: string[],
): Record<string, PageErrorsOfEntry> {
  return Object.fromEntries(Object.entries(listed).filter(([key]) => keys.includes(key)))
}

/**
 * Whether a value is undefined where the pattern is, equals it where it's a string, or matches it where it's a regular
 * expression.
 */
function matchesPattern(value: string | undefined, pattern: string | RegExp | undefined): boolean {
  if (value === undefined || pattern === undefined) {
    return value === pattern
  }

  return typeof pattern === 'string' ? value === pattern : pattern.test(value)
}

/**
 * Whether a report's page error is what the pattern says.
 */
function pageErrorMatches(error: ReportPageError | undefined, pattern: PageErrorPattern): boolean {
  if (error === undefined) {
    return false
  }

  const fields: [value: string | undefined, pattern: string | RegExp | undefined][] = [
    [error.kind, pattern.kind],
    [error.severity, pattern.severity],
    [error.text, pattern.text],
    [error.loadError, pattern.loadError],
  ]

  return fields.every(([value, fieldPattern]) => matchesPattern(value, fieldPattern))
}

/**
 * Writes page error patterns as JSON, each regular expression as its literal.
 */
function patternsJsonOf(patterns: PageErrorPattern[]): string {
  return JSON.stringify(patterns, (_key, value: unknown) => (value instanceof RegExp ? String(value) : value))
}

/**
 * Gives the problems with the page errors of a report's or an `update` document's entries: the entries, by key, are
 * exactly those `listed` has, and each holds the page errors and stale expected page errors it gives, in order.
 */
function pageErrorsEntriesProblems(
  entries: readonly (TestReportEntry | UpdateReportEntry)[],
  listed: Record<string, PageErrorsOfEntry>,
): string[] {
  const keys = entries.map(({ id }) => id).sort()
  const expectedKeys = Object.keys(listed).sort()

  return [
    ...problemUnless(
      isDeepStrictEqual(keys, expectedKeys),
      `it lists ${JSON.stringify(keys)}, expected ${JSON.stringify(expectedKeys)}`,
    ),
    ...entries.flatMap((entry) => {
      const expected = listed[entry.id]

      return expected === undefined ? [] : pageErrorsEntryProblems(entry, expected)
    }),
  ]
}

/**
 * Gives the problems with an entry whose page errors or stale expected page errors aren't these, or none.
 */
function pageErrorsEntryProblems(
  { id, pageErrors: actual, staleExpectedPageErrors }: TestReportEntry | UpdateReportEntry,
  { pageErrors: expected, stale }: PageErrorsOfEntry,
): string[] {
  const matching =
    actual.length === expected.length && expected.every((pattern, index) => pageErrorMatches(actual[index], pattern))

  return [
    ...problemUnless(
      matching,
      `${id}'s pageErrors are ${JSON.stringify(actual)}, expected ${patternsJsonOf(expected)}`,
    ),
    ...problemUnless(
      isDeepStrictEqual(staleExpectedPageErrors, stale),
      `${id}'s staleExpectedPageErrors are ${JSON.stringify(staleExpectedPageErrors)}, expected ${JSON.stringify(stale)}`,
    ),
  ]
}

/**
 * With the page errors script in every page, `test` of every page errors story against the committed baselines exits
 * 1, though every snapshot passes, since some have page errors that fail it. Its end block heads the page errors block
 * with how many snapshots have page errors or stale expected ones and how many of them fail the run, and its report
 * counts every snapshot passed and lists those snapshots alone, passed, each with its page errors: kind, text or URL,
 * load error and severity. Of the story with two modes, only the `dark` snapshot is listed, since only that mode's
 * globals raise its error.
 */
async function checkPageErrors(expected: Outcomes): Promise<string[]> {
  const outcomes = outcomesMatching(expected, pageErrors.filter)

  return await withStorybookServer({ injectIntoIframe: pageErrors.script }, async (server) => {
    const run = await runCli(['test', '--filter', pageErrors.filter.source, '--url', server.url])
    const listed = listedPageErrorsOf(server.url)
    const failing = Object.values(listed).filter(({ pageErrors }) =>
      pageErrors.some(({ severity }) => severity === 'fail'),
    ).length
    const heading = `── ${Object.keys(listed).length} snapshots with page errors, ${failing} of which fail the run ──`

    return [
      ...exitCodeProblems('test', run, 1),
      ...outcomeProblems('test', run.outcomes, outcomes),
      ...stdoutSaysProblems(run, [heading]),
      ...reportProblems(packageDir, (report) => [
        ...reportCountsProblems(report, outcomes, 0),
        ...pageErrorsEntriesProblems(report.snapshots, listed),
      ]),
    ]
  })
}

/**
 * With the page errors script in every page, `test` of each story that raises one kind of page error nothing expects,
 * alone, exits 1 though the story passes, and its report lists the story with that page error alone. Each problem
 * starts with the story's ID.
 */
async function checkEachPageErrorKind(): Promise<string[]> {
  return await withStorybookServer({ injectIntoIframe: pageErrors.script }, async (server) => {
    const listed = listedPageErrorsOf(server.url)
    const problems: string[] = []

    for (const storyId of pageErrors.failingKinds) {
      const run = await runCli(['test', '--filter', `^${storyId}$`, '--url', server.url])
      const runProblems = [
        ...exitCodeProblems('test', run, 1),
        ...outcomeProblems('test', run.outcomes, { [storyId]: 'passed' }),
        ...reportProblems(packageDir, (report) =>
          pageErrorsEntriesProblems(report.snapshots, listedPageErrorsAmong(listed, [storyId])),
        ),
      ]

      problems.push(...runProblems.map((problem) => `${storyId}: ${problem}`))
    }

    return problems
  })
}

/**
 * With the page errors script in every page, `test` of the stories whose page errors don't fail it exits 0 with every
 * snapshot passed. Its report lists only the story whose expected page error went stale and the one with
 * `pageErrors: 'warn'`: a `console.warn`, a failed load from another origin, the page errors a story expects, by a
 * string or a regular expression, in a message or a URL, the worker-built 500 among them, and those of the story with
 * `pageErrors: 'off'` aren't listed.
 */
async function checkPageErrorsThatDontFail(expected: Outcomes): Promise<string[]> {
  const outcomes = outcomesMatching(expected, pageErrors.notFailing)

  return await withStorybookServer({ injectIntoIframe: pageErrors.script }, async (server) => {
    const run = await runCli(['test', '--filter', pageErrors.notFailing.source, '--url', server.url])
    const listed = listedPageErrorsAmong(listedPageErrorsOf(server.url), pageErrors.notFailingListed)

    return [
      ...expectedRunProblems('test', run, outcomes),
      ...reportProblems(packageDir, (report) => [
        ...reportCountsProblems(report, outcomes, 0),
        ...pageErrorsEntriesProblems(report.snapshots, listed),
      ]),
    ]
  })
}

/**
 * With the page errors script in every page and a config that expects `ExpectedByConfig`'s page errors, a message by a
 * string and a URL by a regular expression, `test` of that story and one that raises no page error exits 0 with both
 * passed, and its report lists neither: the config's entries expect the first's page errors and never go stale.
 */
async function checkPageErrorsExpectedByConfig(expected: Outcomes): Promise<string[]> {
  const outcomes = outcomesMatching(expected, pageErrors.byConfig)

  return await withStorybookServer({ injectIntoIframe: pageErrors.script }, (server) =>
    withTemporaryFolder(async (folder) => {
      const config = writeConfig(folder, server.url, committedBaselines, {
        expectedPageErrors: pageErrors.configExpected,
      })
      const run = await runCli(['test', '--filter', pageErrors.byConfig.source, '--config', config])

      return [
        ...expectedRunProblems('test', run, outcomes),
        ...reportProblems(folder, (report) => [
          ...reportCountsProblems(report, outcomes, 0),
          ...pageErrorsEntriesProblems(report.snapshots, {}),
        ]),
      ]
    }),
  )
}

/**
 * With the page errors script in every page, on a server whose `index.json` lists only `MissingFile`, `update
 * --reporter json` of that story into an empty baselines folder writes its baseline, byte-identical to the committed
 * one, and exits 0, since page errors never fail `update`. Its lines, on standard error, end with the page errors
 * block, whose heading never says it fails the run and whose line marks the page error `fails test`, and its document
 * lists the story `written`, `missing`, with its page error.
 */
async function checkPageErrorsUpdate(): Promise<string[]> {
  const storyId = pageErrors.updateStoryId
  const serveOptions = { injectIntoIframe: pageErrors.script, onlyStory: storyId }

  return await withStorybookServer(serveOptions, (server) =>
    withTemporaryFolder(async (folder) => {
      const baselines = join(folder, 'baselines')

      mkdirSync(baselines)

      const config = writeConfig(folder, server.url, baselines)
      const run = await runCli(['update', '--reporter', 'json', '--filter', `^${storyId}$`, '--config', config])
      const lines = humanLinesOf(run)

      return [
        ...expectedRunProblems('update', lines, { [storyId]: 'written' }),
        ...stdoutSaysProblems(lines, ['── 1 snapshot with page errors ──', '  page error (fails test): failed load ']),
        ...updateDocumentProblems(run.stdout, (document) => [
          ...updateCountsProblems(document.counts, { written: 1, deleted: 0, kept: 0, broken: 0, flaky: 0 }),
          ...entryFieldProblems(document.snapshots, storyId, { status: 'written', reason: 'missing' }),
          ...pageErrorsEntriesProblems(
            document.snapshots,
            listedPageErrorsAmong(listedPageErrorsOf(server.url), [storyId]),
          ),
        ]),
        ...onlyCommittedBaselineProblems(baselines, `${storyId}.png`, join(diagnosticsDir, 'page-errors-update')),
      ]
    }),
  )
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
 * `undefined`, and hands the run, the server and the config's folder, which is removed once `check` returns, to
 * `check`.
 */
async function testWithPlatform(
  platform: string | undefined,
  check: (run: CliRun, server: StorybookServer, configFolder: string) => string[],
): Promise<string[]> {
  return await withStorybookServer({}, (server) =>
    withTemporaryFolder(async (folder) => {
      const config = writeConfig(folder, server.url, committedBaselines, { platform })

      return check(await runCli(['test', '--all', '--config', config]), server, folder)
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
 * The report JSON case's three runs, one after the other in one temporary folder, each problem led by the run's name:
 * see `jsonReporterProblems`, `unreachableStorybookProblems` and `updateJsonProblems`. The second runs after the first,
 * so the report it replaces held images.
 */
async function checkReportJsonAndErrors(): Promise<string[]> {
  return await withTemporaryFolder(async (folder) => {
    const jsonReporter = await jsonReporterProblems(folder)
    const unreachable = await unreachableStorybookProblems(folder)
    const update = await updateJsonProblems(folder)

    return [
      ...jsonReporter.map((problem) => `test --reporter json: ${problem}`),
      ...unreachable.map((problem) => `unreachable Storybook: ${problem}`),
      ...update.map((problem) => `update --reporter json: ${problem}`),
    ]
  })
}

/**
 * Copies the committed baselines into the folder's `baselines/`, gives the card story the baseline of another size in
 * place of its own, adds a stray copy of the card story's baseline that no story calls for, and runs
 * `test --reporter json` on the card story alone. It exits 1, its stdout is `report.json` exactly, one document on one
 * line, its stderr holds the human lines from the header on, and its stderr's last line is the report line. The report
 * counts the card story differing and the orphan, lists the card story differing by size, with both sizes and its
 * baseline, snapshot and diff, and the orphan with no story and its baseline copied into the report.
 */
async function jsonReporterProblems(folder: string): Promise<string[]> {
  const { storyId, filter, orphan, otherSizeBaseline, size } = reportJson
  const baselines = join(folder, 'baselines')
  const orphanPath = join(baselines, `${orphan}.png`)
  const orphanImage = `images/react/${orphan}.baseline.png`

  cpSync(committedBaselines, baselines, { recursive: true })
  cpSync(join(committedBaselines, `${storyId}.png`), orphanPath)
  cpSync(join(committedBaselines, `${otherSizeBaseline}.png`), join(baselines, `${storyId}.png`))

  return await withStorybookServer({}, async (server) => {
    const config = writeConfig(folder, server.url, baselines)
    const run = await runCli(['test', '--reporter', 'json', '--filter', filter.source, '--config', config])
    const reportJsonPath = join(reportFolderOf(folder), 'report.json')
    const isReportJson = isFile(reportJsonPath) && run.stdout === readFileSync(reportJsonPath, 'utf8')

    return [
      ...exitCodeProblems('test', run, 1),
      ...(isReportJson && run.stdout.split('\n').length === 2
        ? []
        : [`stdout isn't report.json's one document${outputOf(run.stdout)}`]),
      ...problemUnless(headerCountPattern.test(run.stderr), `stderr doesn't hold test's header${outputOf(run.stderr)}`),
      ...reportLineProblems(run, folder, 'stderr'),
      ...reportProblems(folder, (report) => [
        ...reportOutcomeProblems(report, { [storyId]: 'differs' }, folder, 1),
        ...entryFieldProblems(report.snapshots, storyId, {
          status: 'differs',
          reason: 'size',
          size,
          images: differingImagesOf(storyId),
        }),
        ...entryFieldProblems(report.snapshots, orphan, {
          status: 'orphan',
          story: null,
          images: { ...noImages, baseline: orphanImage },
        }),
        ...(isSameFile(join(reportFolderOf(folder), orphanImage), orphanPath)
          ? []
          : [`${orphanImage} isn't the orphan's baseline`]),
      ]),
    ]
  })
}

/**
 * With the Storybook's server stopped, `test --all` exits 2, its stderr's last line is the report line, and the report
 * holds only the error, which names the Storybook `react` at the server's URL, with no entry and no image left from
 * the report before.
 */
async function unreachableStorybookProblems(folder: string): Promise<string[]> {
  const server = await serveStorybook()

  await server.stop()

  const config = writeConfig(folder, server.url, committedBaselines)
  const run = await runCli(['test', '--all', '--config', config])
  const imagesFolder = join(reportFolderOf(folder), 'images')

  return [
    ...exitCodeProblems('test', run, 2),
    ...reportLineProblems(run, folder, 'stderr'),
    ...reportProblems(folder, (report) => errorReportProblems(report, server.url, imagesFolder)),
  ]
}

/**
 * Lists what is wrong with the report of a `test` that exited 2 because nothing answered at the Storybook `react`'s
 * URL: its error names another list of Storybooks, it has another exit code or an entry, or its images folder holds a
 * file.
 */
function errorReportProblems(report: TestReport, url: string, imagesFolder: string): string[] {
  const storybooks = report.error?.storybooks
  const { exitCode, snapshots } = report

  return [
    ...problemUnless(
      isDeepStrictEqual(storybooks, [{ name: 'react', url }]),
      `error.storybooks is ${JSON.stringify(storybooks)}, expected react at ${url}`,
    ),
    ...problemUnless(
      exitCode === 2 && snapshots.length === 0,
      `it isn't an exit 2 report with no entry: exit ${exitCode}, ${snapshots.length} entries`,
    ),
    ...problemUnless(isMissingOrEmpty(imagesFolder), `${imagesFolder} still holds images`),
  ]
}

/**
 * Over a report folder made beforehand, `update --reporter json` on the card story alone, on a server that lists that
 * story alone, into a baselines folder that holds the baseline of another size as the card story's and a stray
 * baseline, exits 0. Its stdout is one `update` document on one line that counts and lists the story written because it
 * differed and the stray baseline deleted, with no story. The baselines folder then holds the card story's committed
 * baseline alone, byte for byte, and the report folder is left exactly as it was.
 */
async function updateJsonProblems(folder: string): Promise<string[]> {
  const { storyId, filter, orphan, otherSizeBaseline } = reportJson
  const reportFolder = reportFolderOf(folder)
  const baselines = join(folder, 'update-baselines')
  const baselineName = `${storyId}.png`

  mkdirSync(reportFolder, { recursive: true })
  writeFileSync(join(reportFolder, 'report.json'), '{"madeBy":"e2e"}\n')
  mkdirSync(baselines)
  cpSync(join(committedBaselines, `${otherSizeBaseline}.png`), join(baselines, baselineName))
  cpSync(join(committedBaselines, baselineName), join(baselines, `${orphan}.png`))

  const before = folderContentsOf(reportFolder)

  return await withStorybookServer({ onlyStory: storyId }, async (server) => {
    const config = writeConfig(folder, server.url, baselines)
    const run = await runCli(['update', '--reporter', 'json', '--filter', filter.source, '--config', config])

    return [
      ...exitCodeProblems('update', run, 0),
      ...updateDocumentProblems(run.stdout, ({ counts, snapshots }) => {
        const entries = snapshots.map(({ id, story, status, reason }) => ({ id, story, status, reason }))
        const expectedEntries = [
          { id: storyId, story: storyId, status: 'written', reason: 'differs' },
          { id: orphan, story: null, status: 'deleted', reason: null },
        ]

        return [
          ...updateCountsProblems(counts, { written: 1, deleted: 1, kept: 0, broken: 0, flaky: 0 }),
          ...problemUnless(
            isDeepStrictEqual(entries, expectedEntries),
            `the document's entries are ${JSON.stringify(entries)}, expected ${JSON.stringify(expectedEntries)}`,
          ),
        ]
      }),
      ...onlyCommittedBaselineProblems(baselines, baselineName, join(diagnosticsDir, 'update-json')),
      ...(isDeepStrictEqual(folderContentsOf(reportFolder), before) ? [] : ['update changed the report folder']),
    ]
  })
}

/**
 * Gives the problems with `update`'s stdout when it isn't one `update` document on one line, with no report folder,
 * then what `check` finds wrong with the document, or none.
 */
function updateDocumentProblems(stdout: string, check: (document: UpdateReport) => string[]): string[] {
  const [line = '', ...rest] = stdout.split('\n')
  let document: UpdateReport

  try {
    document = JSON.parse(line) as UpdateReport
  } catch {
    return [`stdout isn't a JSON document${outputOf(stdout)}`]
  }

  const { command, reportDir } = document

  return [
    ...problemUnless(rest.join('\n') === '', `stdout has more than one line${outputOf(stdout)}`),
    ...problemUnless(
      command === 'update' && reportDir === null,
      `the document's command is ${command} and its reportDir ${reportDir}`,
    ),
    ...check(document),
  ]
}

/**
 * Gives the problem when an `update` document's counts aren't these, or none.
 */
function updateCountsProblems(counts: UpdateReportCounts, expected: UpdateReportCounts): string[] {
  return problemUnless(
    isDeepStrictEqual(counts, expected),
    `the document's counts are ${JSON.stringify(counts)}, expected ${JSON.stringify(expected)}`,
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
 * On the arm64 image, with the platform `linux/arm64` and the default tolerance, `test` against the committed
 * baselines, which are written on amd64, passes the checks of the committed baselines case. When it doesn't, `test`'s
 * report, if it wrote one, with each differing snapshot's images, is copied to `arm64-report/` in the diagnostics
 * folder.
 */
async function checkArm64Image(expected: Outcomes): Promise<string[]> {
  rmSync(diagnosticsDir, { recursive: true, force: true })

  return await testWithPlatform('linux/arm64', (run, _server, configFolder) => {
    const problems = committedBaselinesProblems(run, expected, configFolder)
    const report = join(configFolder, '.visual-check', 'report')

    if (problems.length === 0 || !existsSync(report)) {
      return problems
    }

    const keptReport = join(diagnosticsDir, 'arm64-report')

    cpSync(report, keptReport, { recursive: true })

    return [...problems, `test's report is in ${keptReport}`]
  })
}

/**
 * Notes the visual-check containers that are there, starts a server that holds the story pages and the CLI with these
 * arguments and the server's `--url`, and hands them to `use`. Kills the CLI, unless it has ended, and stops the server
 * however `use` ends.
 */
async function withHeldRun<T>(args: string[], use: (run: HeldRun) => Promise<T>): Promise<T> {
  const before = new Set(visualCheckContainers('all'))

  return await withStorybookServer({ holdStoryPages: true }, async (server) => {
    const cli = followCli(startCli([...args, '--url', server.url], localEnvironment()))

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
 * The cache the CLI keeps the headless shell in on the host: VISUAL_CHECK_CACHE_DIR when the caller sets it, resolved
 * as the CLI resolves it in this package's folder, else a new folder inside the temporary one.
 */
function hostCacheDirOf(folder: string): string {
  const cacheSetting = process.env.VISUAL_CHECK_CACHE_DIR

  return cacheSetting ? resolvePath(packageDir, cacheSetting) : join(folder, 'cache')
}

/**
 * Writes the config the host cases share, with `platform: 'host'` and its baselines in a new folder inside the
 * temporary one, and gives what they share, with the cache `hostCacheDirOf` gives.
 */
function hostRunOf(folder: string, url: string): HostRun {
  const cacheDir = hostCacheDirOf(folder)

  return {
    config: writeConfig(folder, url, join(folder, 'baselines'), { platform: 'host' }),
    cacheDir,
    environment: { ...localEnvironment(), VISUAL_CHECK_CACHE_DIR: cacheDir },
  }
}

/**
 * With an empty cache, `update` says it is downloading the browser package's Chromium for this machine's platform,
 * writes the baseline of the one story the server lists and exits 0, and the cache then holds the marker of a complete
 * install.
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
 * Gives the problem when the browser package's own image, `<tag>@<digest>`, isn't on this machine, which means the CLI
 * didn't pull it, or none when it is.
 */
function pulledImageProblems(): string[] {
  const { tag, digest } = readBrowserPackage().image
  const pulled = `${tag}@${digest}`

  try {
    docker(['image', 'inspect', pulled])

    return []
  } catch (error) {
    return [`the CLI didn't pull the browser package's image ${pulled}: ${(error as Error).message}`]
  }
}

/**
 * With the installed browser package, `update` of the host story into an empty folder launches the browser, captures
 * it and writes its baseline. With no TEST_STORYBOOK_IMAGE, the CLI pulled the package's own image to do so. Its server
 * lists that one story, since `update` writes every missing baseline whatever the selection.
 */
async function checkOldestBrowser(): Promise<string[]> {
  return await withStorybookServer({ onlyStory: hostStoryId }, (server) =>
    withTemporaryFolder(async (folder) => {
      const config = writeConfig(folder, server.url, join(folder, 'baselines'))
      const run = await runCli(['update', '--filter', hostStoryId, '--config', config])

      return [
        ...expectedRunProblems('update', run, { [hostStoryId]: 'written' }),
        ...(image ? [] : pulledImageProblems()),
      ]
    }),
  )
}

/**
 * The smoke case `--oldest-browser` runs, named with the installed browser package's version and Chromium.
 */
function oldestBrowserCases(): Case[] {
  const { chromium } = readBrowserPackage()
  const version = readBrowserPackageVersion()

  return [
    {
      name: `oldest browser: update captures ${hostStoryId} with the browser package ${version}'s Chromium ${chromium} and writes it, in the package's own image unless TEST_STORYBOOK_IMAGE names one`,
      run: checkOldestBrowser,
    },
  ]
}

/**
 * Runs the host cases and resolves with whether all of them passed. They share one server, whose `index.json` lists
 * only the host story, and a temporary folder, which holds their config and baselines, and their cache when the caller
 * doesn't name one.
 */
async function runHostCases(): Promise<boolean> {
  return await withStorybookServer({ onlyStory: hostStoryId }, (server) =>
    withTemporaryFolder((folder) => runCases(hostCases(hostRunOf(folder, server.url)))),
  )
}

/**
 * Runs git in this package's folder and gives its standard output. With optional locks off, its `git status` leaves the
 * index as it is, as the CLI's does.
 *
 * @throws {Error} When git fails or can't start.
 */
function git(args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: packageDir,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  })

  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${String(result.error ?? result.stderr.trim())}`)
  }

  return result.stdout
}

/**
 * Gives the SHA of `HEAD`, the base of a run with `--base HEAD`.
 */
function headSha(): string {
  return git(['rev-parse', 'HEAD']).trim()
}

/**
 * Counts the files changed since `HEAD`, as the CLI counts them with `--base HEAD`: what the index and the working tree
 * changed, a rename as both its paths, and the untracked files that aren't gitignored.
 */
function changedFileCount(): number {
  return git(['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'])
    .split('\0')
    .filter((entry) => entry !== '').length
}

/**
 * Gives the stories file, its `importPath`, of a story the static build's `index.json` lists.
 *
 * @throws {Error} When `index.json` doesn't list the story.
 */
function storiesFileOf(storiesFiles: ReadonlyMap<string, string>, storyId: string): string {
  const storiesFile = storiesFiles.get(storyId)

  if (storiesFile === undefined) {
    throw new Error(`storybook-static/index.json lists no ${storyId}`)
  }

  return storiesFile
}

/**
 * Gives the keys of the expected snapshots of the stories of these stories files, by their `importPath`.
 */
function keysOfStoriesFiles(expected: Outcomes, storiesFiles: ReadonlyMap<string, string>, files: string[]): string[] {
  return Object.keys(expected).filter((key) => {
    const [storyId = ''] = key.split('.')

    return files.includes(storiesFiles.get(storyId) ?? '')
  })
}

/**
 * Writes a baseline for every expected snapshot into the baselines folder of the host config in `folder`: the
 * committed one where there is one, else the host story's, so the consistency check finds no baseline missing and no
 * orphan, and `test` captures the selected stories alone.
 */
function writeEveryBaseline(folder: string, expected: Outcomes): void {
  const baselines = join(folder, 'baselines')

  mkdirSync(baselines, { recursive: true })

  for (const key of Object.keys(expected)) {
    const committed = join(committedBaselines, `${key}.png`)

    cpSync(
      isFile(committed) ? committed : join(committedBaselines, `${hostStoryId}.png`),
      join(baselines, `${key}.png`),
    )
  }
}

/**
 * Adds the change line to the end of a file, hands over to `use`, and puts back the file's exact bytes however `use`
 * ends, and on SIGINT or SIGTERM before it does, which then ends the check by that signal.
 */
async function withChangedFile<T>(path: string, use: () => Promise<T>): Promise<T> {
  const original = readFileSync(path)

  /**
   * Puts back the file's bytes, then ends the check by the signal, which no longer has this listener.
   */
  const restoreAndStop = (signal: NodeJS.Signals): void => {
    writeFileSync(path, original)
    process.kill(process.pid, signal)
  }

  process.once('SIGINT', restoreAndStop)
  process.once('SIGTERM', restoreAndStop)

  try {
    writeFileSync(path, Buffer.concat([original, Buffer.from(affectedChangeLine)]))

    return await use()
  } finally {
    process.off('SIGINT', restoreAndStop)
    process.off('SIGTERM', restoreAndStop)
    writeFileSync(path, original)
  }
}

/**
 * Runs `test` with no selection flag and `--base HEAD`, with the host config, so it covers the stories the working
 * tree's changes affect.
 */
async function testAffected(host: HostRun): Promise<CliRun> {
  return await runCli(['test', '--base', 'HEAD', '--config', host.config], host.environment)
}

/**
 * Lists how the snapshots a run has lines for differ from these keys: each one it has none for, and each other one it
 * has.
 */
function selectedKeysProblems(run: CliRun, keys: string[]): string[] {
  const lines = Object.keys(run.outcomes)

  return [
    ...keys.filter((key) => !lines.includes(key)).map((key) => `test has no line for ${key}`),
    ...lines.filter((key) => !keys.includes(key)).map((key) => `test has a line for ${key}, which isn't affected`),
  ]
}

/**
 * Gives the problem when a report's `selection` isn't the affected stories' from this base with this many changed
 * files and no fallback, or none.
 */
function affectedSelectionProblems(report: TestReport, base: string, changedFiles: number): string[] {
  const selection = { by: 'affected', base, changedFiles, fallback: null }

  return isDeepStrictEqual(report.selection, selection)
    ? []
    : [`selection is ${JSON.stringify(report.selection)}, expected ${JSON.stringify(selection)}`]
}

/**
 * The note `test` prints after its header when no story is affected and this many files changed since the base. It
 * mirrors the CLI's notes (`packages/cli/src/commands/run-selection.ts`), which the e2e can't import.
 */
function noAffectedStoryNoteOf(base: string, changedFiles: number): string {
  if (changedFiles === 0) {
    return `No files changed since ${base.slice(0, 7)}, so no story is affected. ${affectedAllHint}`
  }

  if (changedFiles === 1) {
    return `The changed file affects no story. ${affectedAllHint}`
  }

  return `None of the ${changedFiles} changed files affects a story. ${affectedAllHint}`
}

/**
 * The note `test` prints after its header, after the note about an empty affected selection when there is one, when an
 * affected run leaves out these Storybooks. It mirrors the CLI's note (`packages/cli/src/commands/run-selection.ts`),
 * which the e2e can't import.
 */
function leftOutNoteOf(names: string[]): string {
  const listed = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '')

  if (names.length === 1) {
    return `Storybook ${listed} is left out, since no changed file reaches it.`
  }

  return `Storybooks ${listed} are left out, since no changed file reaches them.`
}

/**
 * Gives the problem when the line of a run's stdout at this index, 1 for the line after its header, isn't this note,
 * or none.
 */
function noteProblems(run: CliRun, note: string, index = 1): string[] {
  const line = run.stdout.split('\n')[index]

  return line === note ? [] : [`line ${index + 1} of test's stdout is "${line ?? ''}", expected "${note}"`]
}

/**
 * With the working tree as it is, `test --base HEAD` exits 0 with no snapshot line, the note after its header says no
 * story is affected and counts the files git says changed, the next one says the Storybook `react` is left out, and its
 * report selects by the affected stories from `HEAD`, with that count and no fallback.
 */
async function checkNoChange(host: HostRun, folder: string): Promise<string[]> {
  const base = headSha()
  const changedFiles = changedFileCount()
  const run = await testAffected(host)

  return [
    ...exitCodeProblems('test', run, 0),
    ...selectedKeysProblems(run, []),
    ...noteProblems(run, noAffectedStoryNoteOf(base, changedFiles)),
    ...noteProblems(run, leftOutNoteOf(['react']), 2),
    ...reportLineProblems(run, folder),
    ...reportProblems(folder, (report) => affectedSelectionProblems(report, base, changedFiles)),
  ]
}

/**
 * With the change line added to the file at `path`, `test --base HEAD` has a line for each expected snapshot of these
 * stories files and no other, its header counts them, it exits with the code their outcomes give, and its report
 * selects by the affected stories from `HEAD`, with the files git says changed and no fallback.
 */
async function checkChangedFile(host: HostRun, folder: string, path: string, keys: string[]): Promise<string[]> {
  return await withChangedFile(path, async () => {
    const base = headSha()
    const changedFiles = changedFileCount()
    const run = await testAffected(host)

    return [
      ...exitCodeProblems('test', run, exitCodeOf(run.outcomes)),
      ...selectedKeysProblems(run, keys),
      ...headerCountProblems(run, keys.length),
      ...reportLineProblems(run, folder),
      ...reportProblems(folder, (report) => affectedSelectionProblems(report, base, changedFiles)),
    ]
  })
}

/**
 * Gives the URL of a port on this machine that nothing listens on: one the system gave a server that is closed again.
 */
async function unusedUrl(): Promise<string> {
  const server = createServer()

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const { port } = server.address() as AddressInfo

  await new Promise((resolve) => server.close(resolve))

  return `http://127.0.0.1:${port}`
}

/**
 * Writes a config with `platform: 'host'` and the three test Storybooks, `storybook-9`, `storybook-10` and
 * `storybook-11`, each with its own folder as `dir`, its baselines in a new folder and a URL nothing answers at, into a
 * new folder inside the temporary one, so its report goes apart from the host config's. Storybook 9.1 and 11 take
 * their stories from this package's stories folder, so their stories globs point into another package.
 */
async function writeThreeStorybooksConfig(folder: string): Promise<ThreeStorybooks> {
  const configFolder = join(folder, 'three')
  const storybooks: ThreeStorybooks['storybooks'] = []
  const settings: Record<string, { url: string; dir: string; baselines: string }> = {}

  mkdirSync(configFolder, { recursive: true })

  for (const version of [9, 10, 11]) {
    const name = `storybook-${version}`
    const url = await unusedUrl()

    storybooks.push({ name, url })
    settings[name] = {
      url,
      dir: join(dirname(packageDir), `storybook-${version}-react`),
      baselines: join(configFolder, 'baselines', name),
    }
  }

  const config = join(configFolder, 'visual-check.config.mjs')

  writeFileSync(config, `export default ${JSON.stringify({ storybooks: settings, platform: 'host' }, null, 2)}\n`)

  return { config, folder: configFolder, storybooks }
}

/**
 * Runs `test` with no selection flag and `--base HEAD`, with the three Storybooks' config, so it requires only the
 * Storybooks the working tree's changes reach.
 */
async function testThreeStorybooks(host: HostRun, three: ThreeStorybooks): Promise<CliRun> {
  return await runCli(['test', '--base', 'HEAD', '--config', three.config], host.environment)
}

/**
 * With the working tree as it is, `test --base HEAD` with the three Storybooks exits 0 with no snapshot line, the note
 * after its header says no story is affected, the next one says all three Storybooks are left out, and its report has
 * no error, since it reached none of them.
 */
async function checkThreeNoChange(host: HostRun, three: ThreeStorybooks): Promise<string[]> {
  const base = headSha()
  const changedFiles = changedFileCount()
  const run = await testThreeStorybooks(host, three)

  return [
    ...exitCodeProblems('test', run, 0),
    ...selectedKeysProblems(run, []),
    ...noteProblems(run, noAffectedStoryNoteOf(base, changedFiles)),
    ...noteProblems(run, leftOutNoteOf(three.storybooks.map(({ name }) => name)), 2),
    ...reportProblems(three.folder, (report) =>
      problemUnless(report.error === null, `error is ${JSON.stringify(report.error)}, expected null`),
    ),
  ]
}

/**
 * With the change line added to the file at `path`, `test --base HEAD` with the three Storybooks exits 2 before any
 * capture, with no snapshot line and no report entry, and its report's `error.storybooks` names exactly these
 * Storybooks, in config order with their URLs: the ones the change reaches, since nothing answers at any of them.
 */
async function checkThreeChangedFile(
  host: HostRun,
  three: ThreeStorybooks,
  path: string,
  names: string[],
): Promise<string[]> {
  return await withChangedFile(path, async () => {
    const run = await testThreeStorybooks(host, three)
    const expected = three.storybooks.filter(({ name }) => names.includes(name))

    return [
      ...exitCodeProblems('test', run, 2),
      ...selectedKeysProblems(run, []),
      ...reportProblems(three.folder, (report) => [
        ...problemUnless(
          isDeepStrictEqual(report.error?.storybooks, expected),
          `error.storybooks is ${JSON.stringify(report.error?.storybooks)}, expected ${JSON.stringify(expected)}`,
        ),
        ...problemUnless(
          report.snapshots.length === 0,
          `the report has ${report.snapshots.length} entries, expected none`,
        ),
      ]),
    ]
  })
}

/**
 * The affected stories cases, in order: no change, then the host story's stories file changed, then the helper that
 * only some stories files import changed, then the same with the three Storybooks: no change, the host story's stories
 * file changed, then Storybook 9.1's `main.ts` changed, then Storybook 11's.
 */
function affectedCases(host: HostRun, folder: string, three: ThreeStorybooks, expected: Outcomes): Case[] {
  const storiesFiles = readStoriesFiles()

  return [
    {
      name: 'no change: test --base HEAD exits 0 capturing nothing, its note says no story is affected and counts the files git says changed, the next says react is left out, its report selects by the affected stories from HEAD with that count and no fallback',
      run: () => checkNoChange(host, folder),
    },
    {
      name: `stories file changed: with a line added to ${hostStoryId}'s stories file, test --base HEAD captures that file's stories alone, its report counts the files git says changed`,
      run: async () => {
        const storiesFile = storiesFileOf(storiesFiles, hostStoryId)
        const keys = keysOfStoriesFiles(expected, storiesFiles, [storiesFile])

        return await checkChangedFile(host, folder, resolvePath(packageDir, storiesFile), keys)
      },
    },
    {
      name: `helper changed: with a line added to ${affectedHelper.name}, test --base HEAD captures the stories of the ${affectedHelper.importedBy.length} stories files that import it alone, its report counts the files git says changed`,
      run: async () => {
        const importers = affectedHelper.importedBy.map((storyId) => storiesFileOf(storiesFiles, storyId))
        const keys = keysOfStoriesFiles(expected, storiesFiles, importers)
        const helperFolder = dirname(resolvePath(packageDir, storiesFileOf(storiesFiles, hostStoryId)))

        return await checkChangedFile(host, folder, join(helperFolder, affectedHelper.name), keys)
      },
    },
    {
      name: 'three Storybooks, no change: test --base HEAD exits 0 capturing nothing, its notes say no story is affected and storybook-9, storybook-10 and storybook-11 are left out, its report has no error',
      run: () => checkThreeNoChange(host, three),
    },
    {
      name: `three Storybooks, stories file changed: with a line added to ${hostStoryId}'s stories file, test --base HEAD exits 2 and error.storybooks names all three, storybook-9 and storybook-11 through their stories globs into this package`,
      run: async () => {
        const storiesFile = resolvePath(packageDir, storiesFileOf(storiesFiles, hostStoryId))
        const names = three.storybooks.map(({ name }) => name)

        return await checkThreeChangedFile(host, three, storiesFile, names)
      },
    },
    {
      name: "three Storybooks, Storybook 9.1's main.ts changed: test --base HEAD exits 2 and error.storybooks names storybook-9 alone",
      run: async () => {
        const mainConfig = join(dirname(packageDir), 'storybook-9-react', '.storybook', 'main.ts')

        return await checkThreeChangedFile(host, three, mainConfig, ['storybook-9'])
      },
    },
    {
      name: "three Storybooks, Storybook 11's main.ts changed: test --base HEAD exits 2 and error.storybooks names storybook-11 alone, so Storybook 9.1's and 10's globs were read",
      run: async () => {
        const mainConfig = join(dirname(packageDir), 'storybook-11-react', '.storybook', 'main.ts')

        return await checkThreeChangedFile(host, three, mainConfig, ['storybook-11'])
      },
    },
  ]
}

/**
 * Runs the affected stories cases and resolves with whether all of them passed. They share one server, whose
 * `index.json` lists every story but the stories of the file that fails to load, and a temporary folder, which holds
 * their config, a baseline for every expected snapshot and their report, the three Storybooks' config and its report,
 * and their cache when the caller doesn't name one.
 */
async function runAffectedCases(expected: Outcomes): Promise<boolean> {
  return await withStorybookServer({}, (server) =>
    withTemporaryFolder(async (folder) => {
      const host = hostRunOf(folder, server.url)
      const three = await writeThreeStorybooksConfig(folder)

      writeEveryBaseline(folder, expected)

      return await runCases(affectedCases(host, folder, three, expected))
    }),
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
 * there before the run don't count. Its stdout's last line is the report line of the package's config, and the report
 * counts and lists those outcomes, the 2 stories broken, `browser-exited`, with no image.
 */
async function checkBrowserExitsOnce(expected: Outcomes): Promise<string[]> {
  return await withBothWorkersCapturing(async ({ server, cli, before }, inFlight) => {
    killNewContainers(before)
    server.releaseStoryPages()

    const run = await cli.finished
    const brokenByExit = Object.fromEntries(inFlight.map((storyId) => [storyId, 'broken'] as const))

    return [
      ...exitCodeProblems('test', run, 1),
      ...brokenByExitProblems(run, inFlight, expected),
      ...stderrInOrderProblems('test', run, browserExits.relaunched),
      ...reportLineProblems(run, packageDir),
      ...reportProblems(packageDir, (report) => [
        ...reportOutcomeProblems(report, { ...expected, ...brokenByExit }, packageDir),
        ...brokenEntryProblems(
          report,
          inFlight.map((storyId) => ({ storyId, reason: 'browser-exited', pageImage: false })),
        ),
      ]),
      ...(await waitForRemoval(before)),
    ]
  })
}

/**
 * With 2 workers and the story pages held throughout, killing the browser's container once both have asked for a
 * story page, then the relaunched browser's once it asks for one, stops `test` with exit 2. The 2 stories the first
 * browser was capturing are broken, each line saying the browser exited, and no other story finished. Standard error
 * says the browser exited and visual-check relaunched it, then that the browser exited again and the next step, and
 * none of the run's containers is left. Containers that were there before the run don't count. Its stderr's last line
 * is the report line of the package's config, and the report holds only the error: an exit 2 report with a message and
 * no entry.
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
      ...reportLineProblems(run, packageDir, 'stderr'),
      ...reportProblems(packageDir, ({ exitCode, error, snapshots }) =>
        problemUnless(
          exitCode === 2 && error !== null && error.message !== '' && snapshots.length === 0,
          `it isn't an exit 2 report of an error with no entry: exit ${exitCode}, error ${JSON.stringify(error)}, ` +
            `${snapshots.length} entries`,
        ),
      ),
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
      name: 'browser exits once: the stories in flight are broken saying so, the browser relaunches for the rest, test exits 1 saying it relaunched, the report lists the 2 stories broken, browser-exited, with no image, no container is left behind',
      run: () => checkBrowserExitsOnce(expected),
    },
    {
      name: "browser exits twice: the first browser's stories are broken saying so, test exits 2 saying the browser exited, was relaunched and exited again, the report holds only the error, no container is left behind",
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
 * The one case the arm64 image runs: the committed baselines, written on amd64, on `linux/arm64`.
 */
function arm64ImageCases(expected: Outcomes): Case[] {
  return [
    {
      name: 'arm64 image: with platform linux/arm64 and the default tolerance, the committed baselines case holds against the baselines written on amd64',
      run: () => checkArm64Image(expected),
    },
  ]
}

/**
 * A Storybook in a config the runner script cases write.
 */
interface SkillStorybook {
  /**
   * The test Storybook's package folder.
   */
  dir: string
  /**
   * Where it is served.
   */
  url: string
  /**
   * Its baselines folder.
   */
  baselines: string
}

/**
 * A command in the skill's `setup.json`, as the runner script reads it.
 */
interface SkillCommand {
  /**
   * The words of the command, the program first.
   */
  command: string[]
  /**
   * The folder it runs in, absolute.
   */
  cwd: string
}

/**
 * A runner script a case started.
 */
interface SkillScriptRun {
  /**
   * The script's process.
   */
  child: CliProcess
  /**
   * The script, followed as a CLI is.
   */
  followed: FollowedCli
}

/**
 * Installs the agent skill in `folder` as `visual-check init` lays it out: the runner script in `skill/scripts/`, and
 * `skill/setup.json`, whose CLI command is `pnpm exec visual-check` in this package's folder and whose Storybooks start
 * with the given commands. Gives the script's path.
 */
function writeSkillInstall(folder: string, storybooks: Record<string, SkillCommand>): string {
  const script = join(folder, 'skill', 'scripts', 'run.mjs')
  const setup = { cli: { command: ['pnpm', 'exec', 'visual-check'], cwd: packageDir }, storybooks }

  mkdirSync(dirname(script), { recursive: true })
  cpSync(skillScriptSource, script)
  writeFileSync(join(folder, 'skill', 'setup.json'), `${JSON.stringify(setup, null, 2)}\n`)

  return script
}

/**
 * The start command of the test Storybook in `dir`, as `init` writes it: its `storybook` script, which serves it at
 * `storybookDevUrl` with `storybook dev`.
 */
function devStart(dir: string): SkillCommand {
  return { command: ['pnpm', 'run', 'storybook'], cwd: dir }
}

/**
 * The environment the runner script cases run the script in: the machine's without `CI`, and on the host with
 * VISUAL_CHECK_CACHE_DIR naming the cache `hostCacheDirOf` gives for the temporary folder.
 */
function skillEnvironment(folder: string): NodeJS.ProcessEnv {
  return onHost ? { ...localEnvironment(), VISUAL_CHECK_CACHE_DIR: hostCacheDirOf(folder) } : localEnvironment()
}

/**
 * Writes a config with these Storybooks into `folder` that captures with 2 workers, with `platform: 'host'` on the
 * host, else in the browser image. Gives its path. `test`'s report goes into `.visual-check/report` in that folder.
 */
function skillConfig(folder: string, storybooks: Record<string, SkillStorybook>): string {
  const path = join(folder, 'visual-check.config.mjs')
  const config = { storybooks, workers: parallelWorkers, ...(onHost ? { platform: 'host' } : { image }) }

  mkdirSync(folder, { recursive: true })
  writeFileSync(path, `export default ${JSON.stringify(config, null, 2)}\n`)

  return path
}

/**
 * Starts the runner script in this package's folder with the given arguments and environment, and follows it as a CLI
 * is. It is killed when it runs past the script's time limit.
 */
function startSkillScript(script: string, args: string[], env: NodeJS.ProcessEnv): SkillScriptRun {
  const child = startNode(script, args, env, skillScriptTimeout)

  return { child, followed: followCli(child, skillScriptTimeout) }
}

/**
 * Interrupts the runner script as an agent's tool does: `SIGINT`, or on Windows `TerminateProcess`, which no handler
 * can catch, so the script's keepers stop what it started.
 */
function interruptSkillScript(child: CliProcess): void {
  if (process.platform === 'win32') {
    child.kill()
  } else {
    child.kill('SIGINT')
  }
}

/**
 * Whether anything answers a request for `<url>/index.json` within 2 s, whatever the answer.
 */
async function answersAt(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/index.json`, { signal: AbortSignal.timeout(2_000) })

    await response.body?.cancel()

    return true
  } catch {
    return false
  }
}

/**
 * Gives the problem when something answers at `storybookDevUrl`, where a case is about to have the script start a test
 * Storybook, or none.
 */
async function portFreeProblems(): Promise<string[]> {
  return (await answersAt(storybookDevUrl))
    ? ['port 6006 is in use: stop what serves it, since the case starts a test Storybook there.']
    : []
}

/**
 * Waits for `storybookDevUrl` to stop answering, as it does once the script has stopped the Storybook it started. Gives
 * the problem when it still answers once the time is up.
 */
async function stoppedProblems(): Promise<string[]> {
  const deadline = Date.now() + skillStopTimeouts.stopped

  while (await answersAt(storybookDevUrl)) {
    if (Date.now() >= deadline) {
      return [`${storybookDevUrl} still answers ${skillStopTimeouts.stopped / 1000} s after the script ended`]
    }

    await sleep(200)
  }

  return []
}

/**
 * Gives the problem when the time limit or a signal ended the script, or its exit code isn't its report's, or isn't 0
 * or 1, or none.
 */
function reportExitCodeProblems(run: CliRun, configFolder: string): string[] {
  const ending = endingProblems('the script', run)

  if (ending.length > 0) {
    return ending
  }

  return reportProblems(configFolder, (report) =>
    problemUnless(
      run.exitCode === report.exitCode && (report.exitCode === 0 || report.exitCode === 1),
      `the script exited ${run.exitCode} and the report says ${report.exitCode}, expected the same 0 or 1${outputOf(run.stderr)}`,
    ),
  )
}

/**
 * Gives the problem when the script's standard output isn't the one line of a JSON document, else what `check` finds
 * wrong with the document.
 */
function skillStdoutProblems(run: CliRun, check: (document: TestReport) => string[]): string[] {
  if (run.stdout.split('\n').length !== 2) {
    return [`stdout isn't one line${outputOf(run.stdout)}`]
  }

  let document: TestReport

  try {
    document = JSON.parse(run.stdout) as TestReport
  } catch {
    return [`stdout isn't a JSON document${outputOf(run.stdout)}`]
  }

  return check(document)
}

/**
 * With nothing on port 6006, the script starts the Storybook `react` with `pnpm run storybook --ci --exact-port`, waits
 * until it answers, runs `test` on the card story and stops it. It exits with the report's code, and its standard
 * output is `report.json`'s one document. The `^` and `$` of the filter go through `pnpm.cmd` on Windows.
 */
async function checkSkillStartsAndStops(folder: string, environment: NodeJS.ProcessEnv): Promise<string[]> {
  const portProblems = await portFreeProblems()

  if (portProblems.length > 0) {
    return portProblems
  }

  const config = skillConfig(folder, {
    react: { dir: packageDir, url: storybookDevUrl, baselines: committedBaselines },
  })
  const script = writeSkillInstall(folder, { react: devStart(packageDir) })
  const args = ['test', '--filter', `^${hostStoryId}$`, '--config', config]
  const run = await startSkillScript(script, args, environment).followed.finished
  const reportJsonPath = join(reportFolderOf(folder), 'report.json')

  return [
    ...reportExitCodeProblems(run, folder),
    ...skillStdoutProblems(run, () =>
      problemUnless(
        isFile(reportJsonPath) && run.stdout.trim() === readFileSync(reportJsonPath, 'utf8').trim(),
        `stdout isn't report.json's document${outputOf(run.stdout)}`,
      ),
    ),
    // The script's messages, as packages/cli/skill/scripts/run.mjs words them.
    ...stderrInOrderProblems('the script', run, [
      'Starting Storybook react in ',
      'pnpm run storybook --ci --exact-port',
      `Storybook react answers at ${storybookDevUrl} after `,
      'Stopped Storybook react.',
    ]),
    ...(await stoppedProblems()),
  ]
}

/**
 * With a server already answering at the Storybook `react`'s URL, the script starts nothing, whose start command would
 * fail, says it reused the server, exits with the report's code and leaves the server running.
 */
async function checkSkillReuses(folder: string, environment: NodeJS.ProcessEnv): Promise<string[]> {
  return await withStorybookServer({}, async (server) => {
    const config = skillConfig(folder, { react: { dir: packageDir, url: server.url, baselines: committedBaselines } })
    const script = writeSkillInstall(folder, {
      react: { command: [process.execPath, '-e', 'process.exit(3)'], cwd: packageDir },
    })
    const args = ['test', '--filter', `^${hostStoryId}$`, '--config', config]
    const run = await startSkillScript(script, args, environment).followed.finished

    return [
      // The script's messages, as packages/cli/skill/scripts/run.mjs words them.
      ...problemUnless(
        !run.stderr.includes('Starting Storybook'),
        `the script started a Storybook${outputOf(run.stderr)}`,
      ),
      ...missingTextProblems(run.stderr, [`Reused Storybook react, which was already running at ${server.url}.`]),
      ...reportExitCodeProblems(run, folder),
      ...problemUnless(await answersAt(server.url), 'the server no longer answers after the script ended'),
    ]
  })
}

/**
 * With the Storybook `react`'s URL on another port than the 6006 its start command serves on, the script exits 2
 * naming both ports and stops the Storybook, and its standard output is the first `test`'s document, whose error names
 * `react` at that URL. `--all` makes the run require `react`, whatever the working tree's changes.
 */
async function checkSkillPortMismatch(folder: string, environment: NodeJS.ProcessEnv): Promise<string[]> {
  const portProblems = await portFreeProblems()

  if (portProblems.length > 0) {
    return portProblems
  }

  const url = await unusedUrl()
  const config = skillConfig(folder, { react: { dir: packageDir, url, baselines: committedBaselines } })
  const script = writeSkillInstall(folder, { react: devStart(packageDir) })
  const run = await startSkillScript(script, ['test', '--all', '--config', config], environment).followed.finished
  const expected = [{ name: 'react', url }]

  return [
    ...exitCodeProblems('the script', run, 2),
    // The script's messages, as packages/cli/skill/scripts/run.mjs words them.
    ...stderrInOrderProblems('the script', run, [
      `Storybook react started on port 6006, but its URL ${url} is on port ${new URL(url).port}.`,
      'Stopped Storybook react.',
    ]),
    ...skillStdoutProblems(run, (document) =>
      problemUnless(
        isDeepStrictEqual(document.error?.storybooks, expected),
        `error.storybooks is ${JSON.stringify(document.error?.storybooks)}, expected ${JSON.stringify(expected)}`,
      ),
    ),
    ...(await stoppedProblems()),
  ]
}

/**
 * Waits until the script has started the Storybook `storybook-9` and the CLI it ran again has printed its header, and,
 * in the image, a visual-check container that isn't in `before` is running.
 *
 * @throws {Error} When the script ends first, or that doesn't happen in time.
 */
async function waitForSkillCapture(followed: FollowedCli, before: ReadonlySet<string>): Promise<void> {
  /**
   * Whether the CLI has printed its header after the script said `storybook-9` answers, with a new container running
   * in the image.
   */
  const capturing = (): boolean => {
    const stderr = followed.stderr()
    const answered = stderr.indexOf('Storybook storybook-9 answers at')

    return (
      answered !== -1 &&
      headerCountPattern.test(stderr.slice(answered)) &&
      (onHost || newContainers('running', before).length > 0)
    )
  }

  await waitUntil(() => capturing() || followed.ending() !== undefined, skillStartTimeout)

  const ending = followed.ending()

  if (ending !== undefined) {
    throw new Error(`the script ${ending} before the interrupt${outputOf(followed.stderr())}`)
  }

  if (!capturing()) {
    throw new Error(
      `the script didn't start storybook-9 and the CLI capturing in ${skillStartTimeout / 1000} s${outputOf(followed.stderr())}`,
    )
  }
}

/**
 * Gives the problems with how the interrupted script ended: it didn't end in time, or outside Windows it didn't exit
 * 130 or say it stopped `storybook-9`, or it didn't start `storybook-9`, or it started `storybook-10`. On Windows
 * `TerminateProcess` ends the script before it can say anything.
 */
async function interruptedProblems(followed: FollowedCli): Promise<string[]> {
  if (!(await waitUntil(() => followed.ending() !== undefined, skillStopTimeouts.ended))) {
    return [
      `the script still ran ${skillStopTimeouts.ended / 1000} s after the interrupt${outputOf(followed.stderr())}`,
    ]
  }

  const run = await followed.finished
  // The script's messages, as packages/cli/skill/scripts/run.mjs words them.
  const posixProblems =
    process.platform === 'win32'
      ? []
      : [
          ...exitCodeProblems('the script', run, 130),
          ...missingTextProblems(run.stderr, ['Stopped Storybook storybook-9.']),
        ]

  return [
    ...posixProblems,
    ...missingTextProblems(run.stderr, ['Starting Storybook storybook-9 ']),
    ...problemUnless(
      !run.stderr.includes('Starting Storybook storybook-10 '),
      `the script started storybook-10${outputOf(run.stderr)}`,
    ),
  ]
}

/**
 * Gives the problem when `test --base HEAD` with this config, run with the working tree as it is, requires a Storybook,
 * which it does when the tree's own changes reach a story: the interrupt case then couldn't tell which Storybooks its
 * change makes the script start. Gives none when it exits 0, requiring none.
 */
async function cleanTreeProblems(config: string, environment: NodeJS.ProcessEnv): Promise<string[]> {
  const run = await runCli(['test', '--base', 'HEAD', '--config', config], environment)

  return [
    ...endingProblems('test --base HEAD', run),
    ...problemUnless(
      run.exitCode === 0,
      `with the working tree as it is, test --base HEAD exits ${run.exitCode}, so the tree's own changes reach a story: commit or stash them, since the case needs its own change to be the only one${outputOf(run.stderr)}`,
    ),
  ]
}

/**
 * Waits for each of these processes to end. Gives the problem with the ones that still run once the time is up.
 */
async function processesGoneProblems(pids: number[]): Promise<string[]> {
  const gone = await waitUntil(() => !pids.some(isRunning), skillStopTimeouts.stopped)

  return gone
    ? []
    : [
        `processes the script started still run ${skillStopTimeouts.stopped / 1000} s after it ended: ${pids.filter(isRunning).join(', ')}`,
      ]
}

/**
 * With Storybook 9.1's `main.ts` changed, `test --base HEAD` through the script requires `storybook-9` alone, so the
 * script starts it alone: starting `storybook-10` too would serve port 6006 against its other URL and fail. Once the
 * CLI captures, an interrupt ends the script, which stops Storybook and the CLI: outside Windows every process the
 * script started is gone, and in the image no container is left behind. Containers that were there before the run
 * don't count. The working tree's own changes must reach no story, which the case checks first.
 */
async function checkSkillInterrupt(folder: string, environment: NodeJS.ProcessEnv): Promise<string[]> {
  const portProblems = await portFreeProblems()

  if (portProblems.length > 0) {
    return portProblems
  }

  const storybook9Dir = join(dirname(packageDir), 'storybook-9-react')
  const config = skillConfig(folder, {
    'storybook-9': {
      dir: storybook9Dir,
      url: storybookDevUrl,
      baselines: join(storybook9Dir, '.visual-check', 'baselines'),
    },
    'storybook-10': { dir: packageDir, url: await unusedUrl(), baselines: join(folder, 'baselines-10') },
  })
  const treeProblems = await cleanTreeProblems(config, environment)

  if (treeProblems.length > 0) {
    return treeProblems
  }

  const script = writeSkillInstall(folder, {
    'storybook-9': devStart(storybook9Dir),
    'storybook-10': devStart(packageDir),
  })
  const before = new Set(onHost ? [] : visualCheckContainers('all'))

  return await withChangedFile(join(storybook9Dir, '.storybook', 'main.ts'), async () => {
    const { child, followed } = startSkillScript(script, ['test', '--base', 'HEAD', '--config', config], environment)

    try {
      await waitForSkillCapture(followed, before)
    } catch (error) {
      followed.kill()
      await stoppedProblems()

      throw error
    }

    try {
      return await afterInterruptProblems({ child, followed }, before, environment)
    } finally {
      followed.kill()
    }
  })
}

/**
 * Notes the processes the capturing script started, outside Windows, interrupts it, and gives the problems with what
 * is left: how it ended, Storybook still answering, any of those processes still running, on the host on Windows a
 * headless shell from the run's cache still running, and in the image a visual-check container that isn't in `before`.
 */
async function afterInterruptProblems(
  { child, followed }: SkillScriptRun,
  before: ReadonlySet<string>,
  environment: NodeJS.ProcessEnv,
): Promise<string[]> {
  const started = process.platform === 'win32' ? [] : descendantsOf(child.pid ?? 0)

  interruptSkillScript(child)

  return [
    ...(await interruptedProblems(followed)),
    ...(await stoppedProblems()),
    ...(await processesGoneProblems(started)),
    ...(await leftBehindProblems(before, environment)),
  ]
}

/**
 * Gives the problems with what an interrupted run left behind: in the image a visual-check container that isn't in
 * `before`, on the host on Windows a headless shell from the run's cache still running, else none.
 */
async function leftBehindProblems(before: ReadonlySet<string>, environment: NodeJS.ProcessEnv): Promise<string[]> {
  if (!onHost) {
    return await waitForRemoval(before)
  }

  if (process.platform === 'win32') {
    return await browsersGoneProblems(environment.VISUAL_CHECK_CACHE_DIR)
  }

  return []
}

/**
 * Waits for every process whose executable is inside `cacheDir`, the headless shells the run started, to end. Gives
 * the problem with the ones that still run once the time is up. Windows only: there the script's tree isn't listed
 * before the interrupt, and a running executable keeps its folder from being removed.
 */
async function browsersGoneProblems(cacheDir: string | undefined): Promise<string[]> {
  if (cacheDir === undefined) {
    return []
  }

  const gone = await waitUntil(() => windowsProcessesIn(cacheDir).length === 0, skillStopTimeouts.stopped)

  return gone
    ? []
    : [
        `headless shells the run started still run ${skillStopTimeouts.stopped / 1000} s after the script ended: ${windowsProcessesIn(cacheDir).join(', ')}`,
      ]
}

/**
 * Lists the processes whose executable is inside `folder` on Windows, each as `<pid> <executable>`, through
 * PowerShell's `Get-CimInstance Win32_Process`.
 */
function windowsProcessesIn(folder: string): string[] {
  const query =
    'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:E2E_FOLDER, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { "$($_.ProcessId) $($_.ExecutablePath)" }'
  const listing = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], {
    encoding: 'utf8',
    env: { ...process.env, E2E_FOLDER: resolvePath(folder) },
    windowsHide: true,
  })

  return listing.stdout.split(/\r?\n/).filter((line) => line.trim() !== '')
}

/**
 * The runner script cases, in order, each in its own folder inside the temporary one, so their configs and reports
 * stay apart: it starts and stops a Storybook, reuses one, exits 2 on a port mismatch, starts only the Storybook a
 * change reaches and stops everything on an interrupt, then in the image the killed CLI case.
 */
function skillScriptCases(folder: string): Case[] {
  const environment = skillEnvironment(folder)

  return [
    {
      name: "starts and stops: with nothing on port 6006, the script starts react with pnpm run storybook --ci --exact-port, waits until it answers, exits with the report's code, stdout is report.json's one document, and it stops react after",
      run: () => checkSkillStartsAndStops(join(folder, 'starts'), environment),
    },
    {
      name: "reuses: with a server already answering at react's URL, the script starts nothing, says it reused it, exits with the report's code, and the server still answers after",
      run: () => checkSkillReuses(join(folder, 'reuses'), environment),
    },
    {
      name: "port mismatch: with react's URL on another port than 6006, the script exits 2 naming both ports, stops react, and stdout is test's document naming react in its error",
      run: () => checkSkillPortMismatch(join(folder, 'mismatch'), environment),
    },
    {
      name: "interrupt: with Storybook 9.1's main.ts changed, test --base HEAD through the script starts storybook-9 alone, and an interrupt while the CLI captures ends the script, stops storybook-9 and the CLI, and leaves no process or container behind",
      run: () => checkSkillInterrupt(join(folder, 'interrupt'), environment),
    },
    ...(onHost ? [] : [{ name: 'killing the CLI: no container is left behind', run: checkKill }]),
  ]
}

/**
 * Runs the runner script cases and resolves with whether all of them passed. They share a temporary folder, which holds
 * each case's folder, and on the host their cache when the caller doesn't name one.
 */
async function runSkillScriptCases(): Promise<boolean> {
  return await withTemporaryFolder((folder) => runCases(skillScriptCases(folder)))
}

/**
 * Reads each snapshot's expected outcome from `expected-outcomes.json`.
 */
function readExpectedOutcomes(): Outcomes {
  return JSON.parse(readFileSync(join(packageDir, 'expected-outcomes.json'), 'utf8')) as Outcomes
}

/**
 * Leaves out the expected outcomes of the stories of the file that fails to load, which the server doesn't list unless
 * a case asks for them.
 */
function withoutLoadFails(expected: Outcomes): Outcomes {
  return Object.fromEntries(Object.entries(expected).filter(([key]) => !loadFailsFilter.test(key)))
}

const setupProblems = findSetupProblems()

if (setupProblems.length > 0) {
  console.error(setupProblems.join('\n'))
  process.exitCode = 1
} else if (skillScriptOnly) {
  process.exitCode = (await runSkillScriptCases()) ? 0 : 1
} else if (affectedOnly) {
  process.exitCode = (await runAffectedCases(withoutLoadFails(readExpectedOutcomes()))) ? 0 : 1
} else if (onHost) {
  process.exitCode = (await runHostCases()) ? 0 : 1
} else if (onOldestBrowser) {
  process.exitCode = (await runCases(oldestBrowserCases())) ? 0 : 1
} else if (onArm64Image) {
  process.exitCode = (await runCases(arm64ImageCases(withoutLoadFails(readExpectedOutcomes())))) ? 0 : 1
} else {
  const everyOutcome = readExpectedOutcomes()
  const expected = withoutLoadFails(everyOutcome)
  const passed = await runCases([
    {
      name: "committed baselines: test gives the expected outcomes, each broken readiness, per-story options, capture area and grid story's line says why, no line for a disabled story, the header counts the expected outcomes, a story listing two modes has 3 lines, a story's own modes leave out the meta's, no test-path warning, the animation baselines are byte-identical to storybook-10-react's",
      run: () => checkCommittedBaselines(everyOutcome),
    },
    {
      name: 'CI stop: in CI, test --all on a server that lists the stories file that fails to load exits 1 before any capture, its only lines are the two load-fails stories, broken, saying the file failed to load, its consistency header counts the expected outcomes, it ends saying CI stops before capturing, no story page is asked for',
      run: () => checkCiStop(everyOutcome),
    },
    {
      name: 'consistency only: test --consistency on a server that lists the stories file that fails to load exits 1 without capturing, its only lines are the two load-fails stories, broken, saying the file failed to load, its consistency header counts the expected outcomes, no story page is asked for',
      run: () => checkConsistencyOnly(everyOutcome),
    },
    {
      name: `shards: test --shard k/${shardCount} for each k, on a server that lists the stories file that fails to load, names its shard in its header and notes the consistency check is left to test --consistency, exits with the code its snapshots' expected outcomes give, asks only for story pages of its own stories files; together the shards print one line for each snapshot with its expected outcome, and each stories file has lines in exactly one shard`,
      run: () => checkShards(everyOutcome),
    },
    {
      name: `end state: ${endStateRuns} runs of test with pixels: 0 give every animation story its expected outcome`,
      run: () => checkEndStateRuns(expected),
    },
    {
      name: "update then test: update writes every story that isn't broken, test passes them and finds the broken ones missing, test --consistency then exits 1 finding exactly the broken ones missing, with no story page loaded, the baselines match the committed ones, update warns about the network stories alone",
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
      name: `a masked element that grows: test exits 1 and ${growingMask.storyId} differs`,
      run: checkGrowingMask,
    },
    {
      name: `one-pixel change: with pixels: 0, test exits 1, ${onePixelChange.storyId} differs saying "1 differ, 0 allowed" and the report holds its images; with the default tolerance, test passes it`,
      run: () => checkOnePixelChange(expected),
    },
    {
      name: `flaky: with ${flakyChange.storyId}'s first page load changed, test passes it flaky on its one retry, its line ends "· flaky", test lists it as flaky and counts "1 passed (1 flaky)", the report holds its images; with retries: 0, test exits 1 and it differs after 1 page load; with retries: 2 and its first 2 page loads changed, it passes flaky after 3`,
      run: checkFlakyRetries,
    },
    {
      name: `update kept flaky: with ${updateStability.storyId}'s baseline there and its first page load changed, update on it alone keeps the baseline untouched after 2 page loads, its line says "kept · flaky", update lists it as flaky and exits 0, its JSON document counts it kept and flaky and lists nothing, nothing else is written`,
      run: () => checkUpdateStability(updateStability.keptFlaky),
    },
    {
      name: `update written flaky: with ${updateStability.storyId}'s baseline missing and its first page load changed, update on it alone writes it after 3 page loads, byte-identical to the committed one, its line says "written: missing · flaky", update lists it as flaky and exits 0, its JSON document lists it written, missing, flaky, nothing else is written`,
      run: () => checkUpdateStability(updateStability.writtenFlaky),
    },
    {
      name: `update unstable: with ${updateStability.storyId}'s baseline there and a different card background in each of its page loads, update on it alone exits 1 after 3 page loads, it's broken saying no two loads agreed, its JSON document lists it broken, unstable, with the third load's console message, its baseline is untouched, nothing else is written`,
      run: () => checkUpdateStability(updateStability.unstable),
    },
    {
      name: `update changed after capture: with a clock ticking in ${updateStability.storyId}'s page, update on it alone exits 1 after 1 page load, it's broken saying the story changed by pixels in the second after its capture and to use its wait hook, its JSON document lists it broken, changed-after-capture, with the page's warning, its baseline is untouched, nothing else is written`,
      run: () => checkUpdateStability(updateStability.changedAfterCapture),
    },
    {
      name: `remote content hint: with ${unmaskedRemoteContent.storyId}'s host mask dropped, test exits 1, it differs, and its failure in the end block holds the hint naming localhost on the server's port, its mask and the docs page`,
      run: checkRemoteContentHint,
    },
    {
      name: "failed loads hint: with card--default's stories file dropped by the server on its page, test exits 1, the story is broken saying its page couldn't load that file from Storybook, its failure holds the hint about the server, and its report entry lists the file",
      run: checkFailedLoadsHint,
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
    {
      name: 'report json and errors: test --reporter json prints report.json alone, lists a snapshot that differs by size with both sizes and its three images, and an orphan with its baseline; with the server stopped, test exits 2 leaving a report of the error naming react and its URL, with no image; update --reporter json prints its own document listing a baseline written because it differed and an orphan deleted, and leaves the report folder alone',
      run: checkReportJsonAndErrors,
    },
    {
      name: "page errors: with the page errors script, test of every page errors story exits 1 though each passes, its end block counts the snapshots with page errors, its report lists those snapshots alone, passed, each with its page errors' kind, text or URL, load error and severity, the two-modes story's dark snapshot alone",
      run: () => checkPageErrors(expected),
    },
    {
      name: 'page errors by kind: with the page errors script, test of each story raising one kind of page error nothing expects, alone, exits 1 though it passes, its report lists it with that page error',
      run: checkEachPageErrorKind,
    },
    {
      name: "page errors that don't fail: with the page errors script, test of the stories with a console.warn, a failed load from another origin, expected page errors, a stale expected page error, pageErrors: 'warn' and pageErrors: 'off' exits 0, its report lists only the stale entry's story and the warning's",
      run: () => checkPageErrorsThatDontFail(expected),
    },
    {
      name: "expected page errors in config: with the page errors script and a config expecting a message by a string and a URL by a regular expression, test exits 0 and its report lists nothing, the config's entries never going stale",
      run: () => checkPageErrorsExpectedByConfig(expected),
    },
    {
      name: 'page errors with update: with the page errors script, update --reporter json of a story with a page error writes its baseline, byte-identical to the committed one, exits 0, lists it in its page errors block and its document lists it written with its page error',
      run: checkPageErrorsUpdate,
    },
    ...(insideImage ? insideImageCases(expected) : outsideImageCases(expected)),
  ])

  process.exitCode = passed ? 0 : 1
}
