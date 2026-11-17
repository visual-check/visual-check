import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  BrowserExitedError,
  BrowserLaunchError,
  type ConsoleMessage,
  type Driver,
  type PageSetup,
  type PageViewport,
} from '../capture/driver/driver.js'
import { answerEvaluate } from '../capture/fake-driver.fixture.js'
import { answerOptionsReadExpression, optionsReadAnswer } from '../storybook/options-read.fixture.js'
import type { StoriesFile } from '../storybook/options-read.js'
import { finishedAnswer } from '../storybook/preview-script.fixture.js'
import { greyPng } from '../visual-diff/images.fixture.js'
import type { BrowserLaunch, LaunchBrowser } from './launch-browser.js'
import type { RunCliOptions } from './run-cli.js'
import type { ReportLine } from './run-output.js'

/**
 * The version in the CLI's `package.json`, which every header a run prints names.
 */
export const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string
}

/**
 * The workspace's browser package: its version and its `chromium.json`.
 */
export const browserPackage = (() => {
  const require = createRequire(import.meta.url)
  const { version: packageVersion } = JSON.parse(
    readFileSync(require.resolve('@visual-check/chromium/package.json'), 'utf8'),
  ) as { version: string }
  const json = JSON.parse(readFileSync(require.resolve('@visual-check/chromium'), 'utf8')) as {
    chromium: string
    image: { tag: string; digest: string }
    headlessShell: string
    sha256: Record<string, string>
  }

  return { packageVersion, ...json, imageReference: `${json.image.tag}@${json.image.digest}` }
})()

/**
 * The folder holding the marker path no test writes, so that no test reads the machine's own marker.
 */
const absentMarkerFolder = mkdtempSync(join(tmpdir(), 'visual-check-no-marker-'))

/**
 * A marker path where nothing exists, which makes a run happen outside visual-check's image.
 */
export const absentMarkerPath = join(absentMarkerFolder, 'chromium.json')

/**
 * The cache folder a run on the host names in `VISUAL_CHECK_CACHE_DIR`. Nothing is written there, since the tests'
 * launches are fakes.
 */
const cacheDir = join(absentMarkerFolder, 'cache')

/**
 * The environment of a run on the host, which keeps its cache folder out of the user's.
 */
export const hostEnvironment = { VISUAL_CHECK_CACHE_DIR: cacheDir }

/**
 * Options that only keep the run outside visual-check's image, for runs that stop before the launch.
 */
export const noMarker: RunCliOptions = { imageMarkerPath: absentMarkerPath }

/**
 * The options every run gets: a Docker probe and a machine that both have 4 CPUs and 16 GiB, an engine that isn't
 * Docker Desktop's, Linux on x64, and no container around the run, so no test runs the real `docker` or reads the
 * machine it runs on. `update` captures a page again at once, so no test waits a second for it.
 */
export const hostOptions = {
  probeDocker: async () => ({ cpus: 4, memoryBytes: 16 * 2 ** 30, desktop: false }),
  machine: { cpus: 4, memoryBytes: 16 * 2 ** 30 },
  insideContainer: false,
  tty: false,
  os: 'linux',
  arch: 'x64',
  findKnownContainer: async () => undefined,
  recaptureDelayMs: 0,
} satisfies RunCliOptions

/**
 * A Docker probe that finds Docker Desktop's engine, with 4 CPUs and 16 GiB.
 */
export const desktopProbe = async () => ({ cpus: 4, memoryBytes: 16 * 2 ** 30, desktop: true })

/**
 * The ID of the container the CLI runs in, in the runs where the Docker daemon knows it.
 */
export const containerId = 'c'.repeat(64)

/**
 * Options that fail the run if it launches a browser, for runs that must stop before the launch.
 */
export const noLaunch: RunCliOptions = {
  ...hostOptions,
  launchBrowser: () => Promise.reject(new Error('The run launched a browser.')),
  imageMarkerPath: absentMarkerPath,
}

/**
 * How the fake browser answers one story.
 */
export interface FakeStory {
  /**
   * The snapshot it captures. `defaultRunSnapshot` when not given.
   */
  snapshot?: Uint8Array
  /**
   * The snapshot its page gives when captured again on the same load. `snapshot` when not given.
   */
  snapshotLater?: Uint8Array
  /**
   * Whether Storybook reports the story finished with an error, which makes it a broken story.
   */
  broken?: boolean
  /**
   * How long Storybook's `completing` render step took for the story, in ms. The page saw no such step when not given.
   */
  completingMs?: number
  /**
   * The hosts its page reports real network requests to. None when not given.
   */
  requestHosts?: string[]
  /**
   * The console messages and errors its page sends. None when not given.
   */
  consoleMessages?: ConsoleMessage[]
  /**
   * Whether the browser exits while capturing it.
   */
  browserExits?: boolean
  /**
   * Whether the browser exits once it has captured the story, before the worker takes its next story, so no capture is
   * in flight. In `update`, a capture of the same page again on that load then meets the exit.
   */
  browserExitsAfter?: boolean
  /**
   * The IDs of stories whose captures this one's capture waits for until they are capturing, so they are in flight
   * when it goes on. Those stories must reach their capture on other workers, or the test times out.
   */
  waitsForCapturing?: string[]
  /**
   * The browser's last output lines when it exits while capturing. `Out of memory` and `bye from browser <n>` when
   * not given.
   */
  exitOutput?: readonly string[]
  /**
   * Whether the browser's exit says its graphics process couldn't start. It doesn't when not given.
   */
  graphicsFailed?: boolean
  /**
   * The ID of a story this one's capture waits for until that story's capture has settled, then one more macrotask, so
   * its result reaches the pool first. That story must reach its capture on another worker, or the gate never opens
   * and the test times out. It doesn't wait when not given.
   */
  waitsFor?: string
  /**
   * How the story answers instead when its URL sets globals, as a mode's snapshot does, by the URL's `globals`
   * parameter, such as `theme:dark`. What it gives replaces the story's own answers. The story answers as it does
   * without globals when not given.
   */
  byGlobals?: Record<string, FakeStory>
  /**
   * How the story answers each load of its page in turn, by its URL: the first load as the first item, the second as
   * the second, and every load past the list as the last. What each gives replaces the story's own answers. The story
   * answers every load the same when not given.
   */
  captures?: FakeStory[]
  /**
   * The remote content the page gives when the capture asks for it, each item by its host and box in CSS pixels of the
   * top document. The page gives none, leaving the remote content unknown, when not given.
   */
  remote?: { host: string; x: number; y: number; width: number; height: number }[]
}

/**
 * How the fake browser answers the options read. By default every stories file loads and no story has options.
 */
export interface FakeRead {
  /**
   * Each story's merged `parameters.visualCheck`, by ID, as the page gives it. A story left out has none.
   */
  options?: Record<string, unknown>
  /**
   * The stories files that fail to load, by import path, each with the message the page gives.
   */
  failed?: Record<string, string>
  /**
   * The stories files whose stories don't load within readyTimeout.
   */
  timedOut?: string[]
  /**
   * The page's answer to the read of each preview, by its URL, in place of one built from the files, such as one whose
   * preview never started.
   */
  answers?: Record<string, unknown>
  /**
   * The browsers, by launch number counting from 1, that exit as a read is made in them.
   */
  exitingBrowsers?: number[]
}

/**
 * What one options read asked for.
 */
export interface ReadRecord {
  /**
   * Which of the run's launches the read was made in, counting from 1.
   */
  browser: number
  /**
   * The URL of the page the read was made on.
   */
  url: string
  /**
   * The stories files the read asked for.
   */
  files: StoriesFile[]
}

/**
 * Builds what the fake page read of one stories file, as `read` says.
 */
function fileReadOf({ importPath, storyIds }: StoriesFile, read: FakeRead) {
  const failed = read.failed?.[importPath]

  if (failed !== undefined) {
    return { importPath, outcome: 'failed' as const, message: failed }
  }

  if (read.timedOut?.includes(importPath) === true) {
    return { importPath, outcome: 'timed-out' as const }
  }

  return { importPath, stories: storyIds.map((id) => ({ id, options: read.options?.[id] })) }
}

/**
 * The snapshot a fake story captures when it gives none: a black PNG file of 10 × 10 pixels.
 */
export const defaultRunSnapshot = new Uint8Array(await greyPng(10, 10, 0))

/**
 * A white PNG file of the same size, whose 100 pixels all differ from `defaultRunSnapshot`'s, beyond the default
 * tolerance at scale 1 and at scale 2.
 */
export const otherSnapshot = new Uint8Array(await greyPng(10, 10, 255))

/**
 * What the fake browser saw.
 */
export interface FakeBrowserRecord {
  /**
   * Every launch, in order.
   */
  launches: BrowserLaunch[]
  /**
   * The URL of every page loaded, in order: each options read's preview and each story.
   */
  urls: string[]
  /**
   * Every options read, in order.
   */
  reads: ReadRecord[]
  /**
   * The capture preparation each story's page was asked for, in order: the story's ID with the element and the masks
   * it was sent, and whether it was asked to find the remote content the page shows.
   */
  preparations: { id: string; element: unknown; masks: unknown; findRemote: unknown }[]
  /**
   * The setup of every page opened.
   */
  setups: PageSetup[]
  /**
   * Every viewport set.
   */
  viewports: PageViewport[]
  /**
   * How many times a page was closed.
   */
  pageCloses: number
  /**
   * Whether the driver was closed.
   */
  closed: boolean
  /**
   * How many times the driver was closed.
   */
  driverCloses: number
  /**
   * What happened to each browser, in order, each browser numbered by its launch from 1: `<id> on <n>` as a story's
   * capture finishes on browser n, whether it captured or the browser exited, `<id> again on <n>` as a later capture of
   * the same load of its page does, `close page on <n>` as a page of browser n closes, and `close <n>` as browser n
   * closes.
   */
  events: string[]
  /**
   * Every capture that finished, in order: the story's ID, which capture of its page's load it was, counting from 1,
   * and when it finished, by `performance.now()`.
   */
  captures: { id: string; onLoad: number; at: number }[]
}

/**
 * Makes an empty record of what a fake browser saw.
 */
export function newRecord(): FakeBrowserRecord {
  return {
    launches: [],
    urls: [],
    reads: [],
    preparations: [],
    setups: [],
    viewports: [],
    pageCloses: 0,
    closed: false,
    driverCloses: 0,
    events: [],
    captures: [],
  }
}

/**
 * The gates stories wait on: `capturing <id>`, opened once that story's capture has reached the capture step, and
 * `settled <id>`, opened once it has settled. Every browser of a run shares them, so a story can wait for one captured
 * in another browser.
 */
export type StoryGates = Map<string, { promise: Promise<void>; resolve: () => void }>

/**
 * Gives a gate, such as `settled a`, making it when it doesn't exist yet.
 */
function gateOf(gates: StoryGates, name: string): { promise: Promise<void>; resolve: () => void } {
  let gate = gates.get(name)

  if (gate === undefined) {
    let resolve: () => void = () => undefined
    const promise = new Promise<void>((resolvePromise) => {
      resolve = resolvePromise
    })

    gate = { promise, resolve }
    gates.set(name, gate)
  }

  return gate
}

/**
 * What a fake driver answers with, and where it records what it saw.
 */
export interface FakeDriverOptions {
  /**
   * How its pages answer each story, by ID.
   */
  stories: Record<string, FakeStory>
  /**
   * Where it records what it saw.
   */
  record: FakeBrowserRecord
  /**
   * The browser version it reports.
   */
  version: string
  /**
   * Which of the run's launches it is, counting from 1. 1 when not given.
   */
  browser?: number
  /**
   * The gates its stories wait on, which the run's other browsers share. Gates of its own when not given.
   */
  gates?: StoryGates
  /**
   * How its pages answer the options read. Every file loads and no story has options when not given.
   */
  read?: FakeRead
}

/**
 * Builds a fake driver whose pages answer each story, by ID, and the options read as the options say. Once the
 * browser exits, `exited` settles and every call fails with the exit, whose output names the browser.
 */
export function fakeDriverOf({
  stories,
  record,
  version,
  browser = 1,
  gates = new Map(),
  read = {},
}: FakeDriverOptions): Driver {
  let settleExited: (error: BrowserExitedError) => void = () => undefined
  let gone: BrowserExitedError | undefined
  const exit = (exiting: FakeStory = {}): BrowserExitedError => {
    gone ??= new BrowserExitedError(
      { code: null, signal: 'SIGKILL', error: undefined },
      exiting.exitOutput ?? ['Out of memory', `bye from browser ${browser}`],
      exiting.graphicsFailed === true,
    )
    settleExited(gone)

    return gone
  }
  const failIfGone = (): void => {
    if (gone !== undefined) {
      throw gone
    }
  }

  return {
    version,
    exited: new Promise((resolve) => {
      settleExited = resolve
    }),
    newPage: async (setup) => {
      let story: FakeStory = {}
      let id = ''
      let pageUrl = ''
      let capturesOnLoad = 0

      /**
       * Answers the options read of the files it asks for, as `read` says, recording it. The browser exits instead
       * when `read` says so.
       */
      const answerRead = (files: StoriesFile[]): unknown => {
        record.reads.push({ browser, url: pageUrl, files: JSON.parse(JSON.stringify(files)) as StoriesFile[] })

        if (read.exitingBrowsers?.includes(browser) === true) {
          throw exit()
        }

        return read.answers?.[pageUrl] ?? optionsReadAnswer(files.map((file) => fileReadOf(file, read)))
      }

      failIfGone()
      record.setups.push(setup)

      return {
        clearStorage: async () => {
          failIfGone()
        },
        setViewport: async (viewport) => {
          failIfGone()
          record.viewports.push(viewport)
        },
        goto: async (url) => {
          failIfGone()
          pageUrl = url
          capturesOnLoad = 0
          record.urls.push(url)

          const { searchParams } = new URL(url)
          const globals = searchParams.get('globals')

          id = searchParams.get('id') ?? ''
          story = stories[id] ?? {}

          if (globals !== null) {
            story = { ...story, ...story.byGlobals?.[globals] }
          }

          const { captures } = story

          if (captures !== undefined) {
            const loads = record.urls.filter((loaded) => loaded === url).length

            story = { ...story, ...captures[Math.min(loads, captures.length) - 1] }
          }
        },
        evaluate: async (expression, timeoutMs) => {
          failIfGone()

          const status = story.broken === true ? 'error' : 'success'
          const completingMs = story.completingMs ?? null
          const request = /\.prepareCapture\((.*), \d+\)\n\}\)\(\)$/s.exec(expression)?.[1]
          const preparation =
            request === undefined
              ? undefined
              : (JSON.parse(request) as { element: unknown; masks: unknown; findRemote: unknown })
          const remote = preparation?.findRemote === true ? story.remote : undefined

          if (preparation !== undefined) {
            const { element, masks, findRemote } = preparation

            record.preparations.push({ id, element, masks, findRemote })
          }

          return await answerEvaluate(
            {
              storyWait: async () => finishedAnswer({ status, completingMs }),
              optionsRead: async () => await answerOptionsReadExpression(expression, answerRead),
              capturePrep: async () => ({ outcome: 'ready', box: null, ...(remote === undefined ? {} : { remote }) }),
            },
            expression,
            timeoutMs,
          )
        },
        capture: async () => {
          capturesOnLoad += 1

          const onLoad = capturesOnLoad

          gateOf(gates, `capturing ${id}`).resolve()
          await Promise.all((story.waitsForCapturing ?? []).map((other) => gateOf(gates, `capturing ${other}`).promise))

          if (story.waitsFor !== undefined) {
            await gateOf(gates, `settled ${story.waitsFor}`).promise
            await new Promise((resolve) => setTimeout(resolve, 0))
          }

          try {
            failIfGone()

            if (story.browserExits === true) {
              throw exit(story)
            }

            const snapshot = story.snapshot ?? defaultRunSnapshot

            return onLoad === 1 ? snapshot : (story.snapshotLater ?? snapshot)
          } finally {
            record.events.push(onLoad === 1 ? `${id} on ${browser}` : `${id} again on ${browser}`)
            record.captures.push({ id, onLoad, at: performance.now() })
            gateOf(gates, `settled ${id}`).resolve()

            if (story.browserExitsAfter === true) {
              exit()
            }
          }
        },
        close: async () => {
          record.pageCloses += 1
          record.events.push(`close page on ${browser}`)
        },
        requestHosts: () => (setup.watchRequests ? (story.requestHosts ?? []) : []),
        consoleMessages: () => [...(story.consoleMessages ?? [])],
      }
    },
    close: async () => {
      record.closed = true
      record.driverCloses += 1
      record.events.push(`close ${browser}`)
    },
  }
}

/**
 * What a fake browser answers besides its stories.
 */
export interface FakeBrowserOptions {
  /**
   * The browser version every launch reports. The browser package's when not given.
   */
  version?: string
  /**
   * How the pages answer the options read. Every file loads and no story has options when not given.
   */
  read?: FakeRead
}

/**
 * The options only `init` reads, which a `test` or `update` run never uses.
 */
type InitOnlyOption =
  | 'interactive'
  | 'prompter'
  | 'nodeVersion'
  | 'listFiles'
  | 'runCommand'
  | 'findUnlistedDependencies'

/**
 * Builds options whose every launch writes pull progress and gives a fresh fake driver of the given version, answering
 * each story as `stories` says and the options read as `read` says. Returns them with what the fake browsers saw.
 */
export function fakeBrowser(
  stories: Record<string, FakeStory> = {},
  { version: driverVersion = browserPackage.chromium, read = {} }: FakeBrowserOptions = {},
): { options: Required<Omit<RunCliOptions, InitOnlyOption>>; record: FakeBrowserRecord; progress: string[] } {
  const record = newRecord()
  const progress: string[] = []
  const gates: StoryGates = new Map()
  const launchBrowser: LaunchBrowser = async (launch) => {
    record.launches.push(launch)

    if (launch.in === 'container') {
      launch.progress(`Pulling ${launch.image}\n`)
    }

    if (launch.in === 'host') {
      launch.progress(`Downloading Chromium ${launch.version}\n`)
    }

    return fakeDriverOf({ stories, record, version: driverVersion, browser: record.launches.length, gates, read })
  }

  return {
    options: {
      ...hostOptions,
      launchBrowser,
      progress: (text) => progress.push(text),
      imageMarkerPath: absentMarkerPath,
    },
    record,
    progress,
  }
}

/**
 * Builds options whose launch fails with `error`.
 */
export function failingLaunch(error: Error): RunCliOptions {
  return { ...hostOptions, launchBrowser: () => Promise.reject(error), imageMarkerPath: absentMarkerPath }
}

/**
 * Builds the header a run prints. A run with no `workers` in its config gets 4 workers from the fake probe's and
 * machine's 4 CPUs.
 */
export function headerOf(command: 'test' | 'update', count: number, workers = 4): string {
  const snapshots = `${count} ${count === 1 ? 'snapshot' : 'snapshots'}`

  return `visual-check ${version} · ${command} · ${snapshots} · ${workers} ${workers === 1 ? 'worker' : 'workers'}`
}

/**
 * Builds the line of a missing baseline in `test`.
 */
export function missingLineOf(storybook: string, id: string): string {
  return `✗ ${storybook}  ${id}  missing: no baseline yet; run visual-check update to write it`
}

/**
 * Builds the line of an orphan in `test`, by its Storybook, its file name without `.png` and its folder, relative to
 * the project, `.visual-check/baselines` when not given.
 */
export function orphanLineOf(storybook: string, stem: string, folder = '.visual-check/baselines'): string {
  const detail = `orphan: no story calls for ${folder}/${stem}.png; run visual-check update to delete it`

  return `✗ ${storybook}  ${stem}  ${detail}`
}

/**
 * Builds what a stream holds after printing these lines.
 */
export function printed(...lines: string[]): string {
  return lines.map((line) => `${line}\n`).join('')
}

/**
 * The report line of a `test` run in the config's folder.
 */
const reportLine = 'Report: .visual-check/report/report.json'

/**
 * The report line of a `test` that exits 0 or 1, run in the config's folder, which goes on stdout.
 */
export const reportOnStdout: ReportLine = { stream: 'stdout', text: reportLine }

/**
 * The report line of a `test` that exits 2 with its config found, or runs with `--reporter json`, run in the config's
 * folder, which goes on stderr.
 */
export const reportOnStderr: ReportLine = { stream: 'stderr', text: reportLine }

/**
 * Gives the first line a stream holds.
 */
export function firstLineOf(text: string): string | undefined {
  return text.split('\n')[0]
}

/**
 * The projects the tests made, removed after each test.
 */
const projects: string[] = []

/**
 * Makes a temporary project holding a `.git` folder, which ends the config search there, and `files`, each a path
 * relative to the project mapped to its content. Returns the project's real path.
 */
export function createProject(files: Record<string, string | Uint8Array>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-run-')))

  projects.push(root)
  mkdirSync(join(root, '.git'))
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')

  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }

  return root
}

/**
 * The servers the tests started, closed after each test.
 */
const servers: Server[] = []

/**
 * Starts the server on a free port, to be closed after the test. Returns its URL.
 */
export async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/**
 * Starts a server on a free port that answers every request with an index of the given stories, each in its stories
 * file from `importPaths` by ID, else in `./button.stories.tsx`. Returns its URL.
 */
export async function startStorybook(storyIds: string[], importPaths: Record<string, string> = {}): Promise<string> {
  const entries = Object.fromEntries(
    storyIds.map((id) => [
      id,
      {
        id,
        title: 'Button',
        name: id,
        importPath: importPaths[id] ?? './button.stories.tsx',
        type: 'story',
        subtype: 'story',
      },
    ]),
  )

  return await listen(
    createServer((_request, response) => {
      response.end(JSON.stringify({ v: 5, entries }))
    }),
  )
}

/**
 * Starts a server on a free port that records the URL of every request it gets. Returns its URL and the record.
 */
export async function startRecordingServer(): Promise<{ url: string; requests: string[] }> {
  const requests: string[] = []
  const url = await listen(
    createServer((request, response) => {
      requests.push(request.url ?? '')
      response.end('{}')
    }),
  )

  return { url, requests }
}

/**
 * Takes a port nothing listens on: listens on a free port, reads it and closes that server. Returns the URL it had.
 */
export async function takeUnusedUrl(): Promise<string> {
  const server = createServer()

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })

  return url
}

/**
 * Closes every server the tests started.
 */
async function closeServers(): Promise<void> {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => {
            resolve()
          })
        }),
    ),
  )
}

/**
 * Starts a Storybook with the given stories and makes a project for it whose baselines folder holds `baselines`, each
 * a story ID mapped to its baseline's bytes. `config` adds keys to the config. Each story is in its stories file from
 * `importPaths` by ID, else in `./button.stories.tsx`. Returns the project, the Storybook's URL and the baselines
 * folder.
 */
export async function createRun(
  storyIds: string[],
  baselines: Record<string, Uint8Array> = {},
  config = '',
  importPaths: Record<string, string> = {},
): Promise<{ project: string; url: string; folder: string }> {
  const url = await startStorybook(storyIds, importPaths)
  const storiesFiles = storyIds.map((id) => importPaths[id] ?? './button.stories.tsx')
  const project = createProject({
    'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } }, ${config} }\n`,
    ...Object.fromEntries(storiesFiles.map((path) => [path, ''])),
  })
  const folder = join(project, '.visual-check', 'baselines')

  for (const [id, bytes] of Object.entries(baselines)) {
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, `${id}.png`), bytes)
  }

  return { project, url, folder }
}

/**
 * Replaces the time of every pass line with `N`, flaky or not, since it varies from run to run.
 */
export function withoutTimes(text: string): string {
  return text.replace(/ {2}\d+ ms( · flaky)?$/gm, '  N ms$1')
}

/**
 * Gives the story ID of each story's URL in `urls`, in order, leaving out the options reads' previews.
 */
export function storyIdsOf(urls: readonly string[]): string[] {
  return urls.flatMap((url) => new URL(url).searchParams.get('id') ?? [])
}

/**
 * Gives the report folder of a project whose config file is in `project`.
 */
export function reportFolderIn(project: string): string {
  return join(project, '.visual-check', 'report')
}

/**
 * Leaves a report from an earlier run in the project's report folder. Returns the path of its one image.
 */
export function writeStaleReport(project: string): string {
  const image = join(reportFolderIn(project), 'images', 'web', 'old.diff.png')

  mkdirSync(dirname(image), { recursive: true })
  writeFileSync(image, defaultRunSnapshot)

  return image
}

/**
 * Removes the projects the tests made and closes the servers they started. A test file registers it with
 * `afterEach`.
 */
export async function cleanUpRuns(): Promise<void> {
  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true })
  }

  await closeServers()
}

/**
 * Removes the folder holding the marker path no test writes. A test file registers it with `afterAll`.
 */
export function removeMarkerFolder(): void {
  rmSync(absentMarkerFolder, { recursive: true, force: true })
}

/**
 * The folder in the cache that a run on the host keeps the browser package's headless shell in.
 */
export const chromiumFolder = join(cacheDir, 'chromium', browserPackage.chromium)

/**
 * Gives the executable of the headless shell a run on the host keeps in the cache for the Chrome for Testing platform.
 */
export function hostExecutableOf(platform: 'linux64' | 'linux-arm64'): string {
  return join(chromiumFolder, `chrome-headless-shell-${platform}`, 'chrome-headless-shell')
}

/**
 * The line Linux's dynamic loader prints when the headless shell links against a library the machine lacks.
 */
export const loaderLine =
  '/x/chrome-headless-shell: error while loading shared libraries: libnss3.so: cannot open shared object file: ' +
  'No such file or directory'

/**
 * Builds the launch error of a browser that exited at once because the machine lacks a library.
 */
export function missingLibraryError(): BrowserLaunchError {
  return new BrowserLaunchError('The browser exited with code 127 before it answered.', [loaderLine], { exited: true })
}

/**
 * Builds the header of the consistency output, which counts every planned snapshot and names no workers.
 */
export function consistencyHeaderOf(count: number): string {
  return `visual-check ${version} · test · consistency · ${count} ${count === 1 ? 'snapshot' : 'snapshots'}`
}

/**
 * The line a CI `test` prints after the consistency output when it stops before capturing.
 */
export const ciStopLine = 'In CI, test stops before capturing when the consistency check finds anything.'

/**
 * The hint every usage error ends with.
 */
export const usageHint = 'Run visual-check --help to see the commands and options.\n'

/**
 * Writes a marker file with the given text in a temporary folder. Returns its path.
 */
export function writeMarker(text: string): string {
  const folder = createProject({ 'chromium.json': text })

  return join(folder, 'chromium.json')
}

/**
 * The marker of visual-check's image for the browser package's version and the given architecture.
 */
export function markerOf(arch: 'amd64' | 'arm64', markerVersion: string = browserPackage.packageVersion): string {
  return `{"version":"${markerVersion}","arch":"${arch}"}\n`
}

/**
 * Installs `storybook` at `version` in the folder, as `node_modules/storybook/package.json`.
 */
export function installStorybook(folder: string, version: string): void {
  mkdirSync(join(folder, 'node_modules', 'storybook'), { recursive: true })
  writeFileSync(join(folder, 'node_modules', 'storybook', 'package.json'), JSON.stringify({ version }))
}
