import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { BrowserDownloadError } from '../browser-download/browser-download-error.js'
import {
  BrowserExitedError,
  BrowserLaunchError,
  type Driver,
  type PageSetup,
  type PageViewport,
} from '../capture/driver/driver.js'
import { answerEvaluate } from '../capture/fake-driver.fixture.js'
import { ContainerError } from '../container/container-error.js'
import { answerOptionsReadExpression, optionsReadAnswer } from '../storybook/options-read.fixture.js'
import type { StoriesFile } from '../storybook/options-read.js'
import { finishedAnswer } from '../storybook/preview-script.fixture.js'
import { greyPng, whitePixels } from '../visual-diff/images.fixture.js'
import type { ContainerRoute } from './browser-route.js'
import type { BrowserLaunch, LaunchBrowser } from './launch-browser.js'
import { type RunCliOptions, runCli } from './run-cli.js'

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string
}

/**
 * The workspace's browser package: its version and its `chromium.json`.
 */
const browserPackage = (() => {
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
const absentMarkerPath = join(absentMarkerFolder, 'chromium.json')

afterAll(() => {
  rmSync(absentMarkerFolder, { recursive: true, force: true })
})

/**
 * The cache folder a run on the host names in `VISUAL_CHECK_CACHE_DIR`. Nothing is written there, since the tests'
 * launches are fakes.
 */
const cacheDir = join(absentMarkerFolder, 'cache')

/**
 * The environment of a run on the host, which keeps its cache folder out of the user's.
 */
const hostEnvironment = { VISUAL_CHECK_CACHE_DIR: cacheDir }

/**
 * The folder in the cache that a run on the host keeps the browser package's headless shell in.
 */
const chromiumFolder = join(cacheDir, 'chromium', browserPackage.chromium)

/**
 * Gives the executable of the headless shell a run on the host keeps in the cache for the Chrome for Testing platform.
 */
function hostExecutableOf(platform: 'linux64' | 'linux-arm64'): string {
  return join(chromiumFolder, `chrome-headless-shell-${platform}`, 'chrome-headless-shell')
}

/**
 * The line Linux's dynamic loader prints when the headless shell links against a library the machine lacks.
 */
const loaderLine =
  '/x/chrome-headless-shell: error while loading shared libraries: libnss3.so: cannot open shared object file: ' +
  'No such file or directory'

/**
 * Builds the launch error of a browser that exited at once because the machine lacks a library.
 */
function missingLibraryError(): BrowserLaunchError {
  return new BrowserLaunchError('The browser exited with code 127 before it answered.', [loaderLine], { exited: true })
}

/**
 * Options that only keep the run outside visual-check's image, for runs that stop before the launch.
 */
const noMarker: RunCliOptions = { imageMarkerPath: absentMarkerPath }

/**
 * The options every run gets: a Docker probe and a machine that both have 4 CPUs and 16 GiB, an engine that isn't
 * Docker Desktop's, Linux on x64, and no container around the run, so no test runs the real `docker` or reads the
 * machine it runs on.
 */
const hostOptions = {
  probeDocker: async () => ({ cpus: 4, memoryBytes: 16 * 2 ** 30, desktop: false }),
  machine: { cpus: 4, memoryBytes: 16 * 2 ** 30 },
  insideContainer: false,
  os: 'linux',
  arch: 'x64',
  findKnownContainer: async () => undefined,
} satisfies RunCliOptions

/**
 * A Docker probe that finds Docker Desktop's engine, with 4 CPUs and 16 GiB.
 */
const desktopProbe = async () => ({ cpus: 4, memoryBytes: 16 * 2 ** 30, desktop: true })

/**
 * The ID of the container the CLI runs in, in the runs where the Docker daemon knows it.
 */
const containerId = 'c'.repeat(64)

/**
 * Options that fail the run if it launches a browser, for runs that must stop before the launch.
 */
const noLaunch: RunCliOptions = {
  ...hostOptions,
  launchBrowser: () => Promise.reject(new Error('The run launched a browser.')),
  imageMarkerPath: absentMarkerPath,
}

/**
 * How the fake browser answers one story.
 */
interface FakeStory {
  /**
   * The snapshot it captures. `defaultSnapshot` when not given.
   */
  snapshot?: Uint8Array
  /**
   * Whether Storybook reports the story finished with an error, which makes it a broken story.
   */
  broken?: boolean
  /**
   * How long Storybook's `completing` render step took for the story, in ms. The page saw no such step when not given.
   */
  completingMs?: number
  /**
   * Whether the browser exits while capturing it.
   */
  browserExits?: boolean
  /**
   * Whether the browser exits once it has captured the story, before the worker takes its next story, so no capture is
   * in flight.
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
}

/**
 * How the fake browser answers the options read. By default every stories file loads and no story has options.
 */
interface FakeRead {
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
interface ReadRecord {
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
const defaultSnapshot = new Uint8Array(await greyPng(10, 10, 0))

/**
 * A white PNG file of the same size, whose 100 pixels all differ from `defaultSnapshot`'s, beyond the default
 * tolerance at scale 1 and at scale 2.
 */
const otherSnapshot = new Uint8Array(await greyPng(10, 10, 255))

/**
 * What the fake browser saw.
 */
interface FakeBrowserRecord {
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
   * capture finishes on browser n, whether it captured or the browser exited, `close page on <n>` as a page of browser n
   * closes, and `close <n>` as browser n closes.
   */
  events: string[]
}

/**
 * Makes an empty record of what a fake browser saw.
 */
function newRecord(): FakeBrowserRecord {
  return {
    launches: [],
    urls: [],
    reads: [],
    setups: [],
    viewports: [],
    pageCloses: 0,
    closed: false,
    driverCloses: 0,
    events: [],
  }
}

/**
 * The gates stories wait on: `capturing <id>`, opened once that story's capture has reached the capture step, and
 * `settled <id>`, opened once it has settled. Every browser of a run shares them, so a story can wait for one captured
 * in another browser.
 */
type StoryGates = Map<string, { promise: Promise<void>; resolve: () => void }>

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
interface FakeDriverOptions {
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
function fakeDriverOf({
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
          record.urls.push(url)

          const { searchParams } = new URL(url)
          const globals = searchParams.get('globals')

          id = searchParams.get('id') ?? ''
          story = stories[id] ?? {}

          if (globals !== null) {
            story = { ...story, ...story.byGlobals?.[globals] }
          }
        },
        evaluate: async (expression, timeoutMs) => {
          failIfGone()

          const status = story.broken === true ? 'error' : 'success'
          const completingMs = story.completingMs ?? null

          return await answerEvaluate(
            {
              storyWait: async () => finishedAnswer({ status, completingMs }),
              optionsRead: async () => await answerOptionsReadExpression(expression, answerRead),
            },
            expression,
            timeoutMs,
          )
        },
        captureFullPage: async () => {
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

            return story.snapshot ?? defaultSnapshot
          } finally {
            record.events.push(`${id} on ${browser}`)
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
interface FakeBrowserOptions {
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
 * Builds options whose every launch writes pull progress and gives a fresh fake driver of the given version, answering
 * each story as `stories` says and the options read as `read` says. Returns them with what the fake browsers saw.
 */
function fakeBrowser(
  stories: Record<string, FakeStory> = {},
  { version: driverVersion = browserPackage.chromium, read = {} }: FakeBrowserOptions = {},
): { options: Required<RunCliOptions>; record: FakeBrowserRecord; progress: string[] } {
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
function failingLaunch(error: Error): RunCliOptions {
  return { ...hostOptions, launchBrowser: () => Promise.reject(error), imageMarkerPath: absentMarkerPath }
}

/**
 * Builds the header a run prints. A run with no `workers` in its config gets 4 workers from the fake probe's and
 * machine's 4 CPUs.
 */
function headerOf(command: 'test' | 'update', count: number, workers = 4): string {
  const snapshots = `${count} ${count === 1 ? 'snapshot' : 'snapshots'}`

  return `visual-check ${version} · ${command} · ${snapshots} · ${workers} ${workers === 1 ? 'worker' : 'workers'}`
}

/**
 * Builds the line of a missing baseline in `test`.
 */
function missingLineOf(storybook: string, id: string): string {
  return `✗ ${storybook}  ${id}  missing: no baseline yet; run visual-check update to write it`
}

/**
 * Builds what a stream holds after printing these lines.
 */
function printed(...lines: string[]): string {
  return lines.map((line) => `${line}\n`).join('')
}

/**
 * Gives the first line a stream holds.
 */
function firstLineOf(text: string): string | undefined {
  return text.split('\n')[0]
}

/**
 * The hint every usage error ends with.
 */
const usageHint = 'Run visual-check --help to see the commands and options.\n'

/**
 * The projects the tests made, removed after each test.
 */
const projects: string[] = []

/**
 * Makes a temporary project holding a `.git` folder, which ends the config search there, and `files`, each a path
 * relative to the project mapped to its content. Returns the project's real path.
 */
function createProject(files: Record<string, string | Uint8Array>): string {
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
 * Writes a marker file with the given text in a temporary folder. Returns its path.
 */
function writeMarker(text: string): string {
  const folder = createProject({ 'chromium.json': text })

  return join(folder, 'chromium.json')
}

/**
 * The marker of visual-check's image for the browser package's version and the given architecture.
 */
function markerOf(arch: 'amd64' | 'arm64', markerVersion: string = browserPackage.packageVersion): string {
  return `{"version":"${markerVersion}","arch":"${arch}"}\n`
}

/**
 * The servers the tests started, closed after each test.
 */
const servers: Server[] = []

/**
 * Starts the server on a free port, to be closed after the test. Returns its URL.
 */
async function listen(server: Server): Promise<string> {
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
async function startStorybook(storyIds: string[], importPaths: Record<string, string> = {}): Promise<string> {
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
async function startRecordingServer(): Promise<{ url: string; requests: string[] }> {
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
async function takeUnusedUrl(): Promise<string> {
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

afterEach(async () => {
  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true })
  }

  await closeServers()
})

describe('runCli', () => {
  it('prints the package version for --version', async () => {
    expect(await runCli(['--version'], {}, process.cwd())).toEqual({ exitCode: 0, stdout: `${version}\n`, stderr: '' })
  })

  it('prints the help text for --help', async () => {
    expect(await runCli(['--help'], {}, process.cwd())).toEqual({
      exitCode: 0,
      stdout: `Usage: visual-check <command> [options]

Commands:
  init     Set up visual-check in this project
  test     Capture snapshots and compare them with baselines
  update   Write missing and failing baselines and delete orphans (local only)

Options for test and update:
  --all               Cover every story
  --filter <regex>    Cover every story whose ID matches
  --storybook <name>  Cover only this Storybook
  --url <url>         Use this URL for the Storybook (with several Storybooks, needs --storybook)
  --config <path>     Use this config instead of searching for one
  --workers <n>       Capture with this many workers

Other options:
  --help     Show this help
  --version  Show the version
`,
      stderr: '',
    })
  })

  it('exits 2 with a hint when no command is given', async () => {
    expect(await runCli([], {}, process.cwd())).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: `No command given.\n${usageHint}`,
    })
  })

  it('exits 2 with the parse error and the hint for an unknown flag', async () => {
    const result = await runCli(['--nope'], {}, process.cwd())

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain("Unknown option '--nope'")
    expect(result.stderr.endsWith(`\n${usageHint}`)).toBe(true)
  })

  it('exits 2 for init, which is not available yet', async () => {
    expect(await runCli(['init'], {}, process.cwd())).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: "visual-check init isn't available yet. Write visual-check.config.ts by hand for now.\n",
    })
  })

  it('exits 2 for update in CI before looking at the config', async () => {
    const project = createProject({})

    expect(await runCli(['update'], { CI: 'true' }, project, noMarker)).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        'visual-check update only runs locally, and the CI environment variable is set. ' +
        'Run it on your machine and commit the baselines, or unset CI.\n',
    })
  })

  it('counts the snapshots of the selection in the header, with the noun in the right number', async () => {
    const url = await startStorybook(['button--primary', 'button--secondary'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
      'button.stories.tsx': '',
      '.visual-check/baselines/button--primary.png': defaultSnapshot,
    })

    expect(firstLineOf((await runCli(['test', '--all'], {}, project, fakeBrowser().options)).stdout)).toBe(
      headerOf('test', 2),
    )
    expect(
      firstLineOf((await runCli(['update', '--filter', 'secondary$'], {}, project, fakeBrowser().options)).stdout),
    ).toBe(headerOf('update', 1))
  })

  it('counts the snapshots of every Storybook in the run, and goes through them in config order', async () => {
    const web = await startStorybook(['a', 'b', 'c'])
    const docs = await startStorybook(['d'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${docs}' } } }\n`,
      'web/button.stories.tsx': '',
      'docs/button.stories.tsx': '',
    })
    const { options, record } = fakeBrowser()

    expect(await runCli(['test'], {}, project, options)).toEqual({
      exitCode: 1,
      stdout: printed(
        headerOf('test', 4),
        missingLineOf('web', 'a'),
        missingLineOf('web', 'b'),
        missingLineOf('web', 'c'),
        missingLineOf('docs', 'd'),
        '0 passed · 4 missing',
      ),
      stderr: '',
    })
    expect(record.urls).toEqual([`${web}/iframe.html?viewMode=story`, `${docs}/iframe.html?viewMode=story`])
  })

  it('suggests --storybook when one of several Storybooks is down', async () => {
    const web = await startStorybook(['a'])
    const down = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${down}' } } }\n`,
      'web/button.stories.tsx': '',
      'docs/button.stories.tsx': '',
    })
    const result = await runCli(['test'], {}, project, noLaunch)

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(`Storybook docs doesn't answer at ${down}/index.json`)
    expect(result.stderr).not.toContain('Storybook web')
    expect(result.stderr.endsWith('To check one Storybook on its own, pass --storybook <name>.\n')).toBe(true)
  })

  it('prints the warnings of Storybooks newer than 11 in config order, and carries on', async () => {
    const web = await startStorybook(['a'])
    const docs = await startStorybook(['b'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${docs}' } } }\n`,
      'web/button.stories.tsx': '',
      'docs/button.stories.tsx': '',
      'web/node_modules/storybook/package.json': JSON.stringify({ version: '12.1.0' }),
      'docs/node_modules/storybook/package.json': JSON.stringify({ version: '13.0.0' }),
    })
    const result = await runCli(['update'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(firstLineOf(result.stdout)).toBe(headerOf('update', 2))
    expect(result.stderr).toBe(
      'Warning: Storybook web runs storybook 12.1.0, and visual-check supports 9.1 to 11. The run carries on.\n' +
        'Warning: Storybook docs runs storybook 13.0.0, and visual-check supports 9.1 to 11. The run carries on.\n',
    )
  })

  it('prints a warning before the problems of the same run', async () => {
    const down = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${down}' } } }\n`,
      'node_modules/storybook/package.json': JSON.stringify({ version: '12.0.0' }),
    })
    const result = await runCli(['test'], {}, project, noLaunch)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/^Warning: Storybook web runs storybook 12\.0\.0.*\nStorybook web doesn't answer at /)
  })

  it('fails a Storybook older than 9.1 without reaching its index', async () => {
    const { url, requests } = await startRecordingServer()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
      'node_modules/storybook/package.json': JSON.stringify({ version: '9.0.0' }),
    })
    const result = await runCli(['test'], {}, project, noLaunch)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Storybook web runs storybook 9.0.0, and visual-check needs 9.1 or later.')
    expect(requests).toEqual([])
  })

  it('reports every Storybook that is down, in config order', async () => {
    const first = await takeUnusedUrl()
    const second = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${first}' }, docs: { dir: 'docs', url: '${second}' } } }\n`,
    })
    const result = await runCli(['test'], {}, project, noLaunch)

    expect(result.stderr.indexOf('Storybook web doesn')).toBeGreaterThanOrEqual(0)
    expect(result.stderr.indexOf('Storybook web doesn')).toBeLessThan(result.stderr.indexOf('Storybook docs doesn'))
  })

  it('does not suggest --storybook for problems that are not an unreachable Storybook', async () => {
    const failing = await listen(
      createServer((_request, response) => {
        response.statusCode = 500
        response.end('boom')
      }),
    )
    const web = await startStorybook(['a'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${failing}' } } }\n`,
      'docs/button.stories.tsx': '',
    })
    const result = await runCli(['test'], {}, project, noLaunch)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("Storybook docs's index.json failed")
    expect(result.stderr).toContain("Storybook web's index.json lists stories files that aren't on disk")
    expect(result.stderr).not.toContain('--storybook')
    expect(result.stderr.indexOf("Storybook web's")).toBeLessThan(result.stderr.indexOf("Storybook docs's"))
  })

  it('does not suggest --storybook when the only Storybook is down', async () => {
    const down = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${down}' } } }\n`,
    })
    const result = await runCli(['test'], {}, project, noLaunch)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("Storybook web doesn't answer")
    expect(result.stderr).not.toContain('--storybook')
  })

  it('exits 2 with the config error for a broken config', async () => {
    const project = createProject({
      'visual-check.config.mjs': "export default { storybooks: { web: { url: 'http://127.0.0.1:6006' } }, nope: 1 }\n",
    })
    const result = await runCli(['test'], {}, project, noLaunch)

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('nope')
    expect(result.stderr.endsWith('\n')).toBe(true)
  })

  it('hands --storybook, --url and --config to the config', async () => {
    const url = await startStorybook(['a'])
    const project = createProject({
      'other.config.mjs':
        "export default { storybooks: { web: { dir: 'web', url: { local: 'http://127.0.0.1:6008' } }, docs: { dir: 'docs', url: { local: 'http://127.0.0.1:6007' } } } }\n",
      'web/button.stories.tsx': '',
    })

    expect(
      await runCli(
        ['test', '--config', 'other.config.mjs', '--storybook', 'web', '--url', url],
        { CI: 'true' },
        project,
        fakeBrowser().options,
      ),
    ).toEqual({
      exitCode: 1,
      stdout: printed(headerOf('test', 1), missingLineOf('web', 'a'), '0 passed · 1 missing'),
      stderr: '',
    })
  })
})

/**
 * The detail of a story Storybook reports finished with an error.
 */
const brokenDetail =
  'broken: Storybook reported the story finished with status "error", as it does when a loader, beforeEach or the ' +
  'render throws, or when a check such as accessibility fails.'

/**
 * The detail of a story in flight when the fake browser exited.
 */
const browserExitedDetail =
  'broken: The browser exited while visual-check captured this story: The browser was killed by signal SIGKILL while ' +
  'in use.'

/**
 * What a run prints on stderr when the first fake browser exited and visual-check relaunches it for the rest of the
 * run.
 */
const relaunchNotice = printed(
  'The browser was killed by signal SIGKILL while in use.',
  'visual-check relaunches it once for the rest of the run.',
  "The browser's last output:",
  '  Out of memory',
  '  bye from browser 1',
)

/**
 * What a run prints on stderr, after `relaunchNotice`, when the relaunched fake browser exits too.
 */
const secondExitMessage = printed(
  'The browser was killed by signal SIGKILL while in use.',
  "The browser's output below may say why. Running out of memory is a common cause. Run visual-check again.",
  "The browser's last output:",
  '  Out of memory',
  '  bye from browser 2',
)

/**
 * Starts a Storybook with the given stories and makes a project for it whose baselines folder holds `baselines`, each
 * a story ID mapped to its baseline's bytes. `config` adds keys to the config. Each story is in its stories file from
 * `importPaths` by ID, else in `./button.stories.tsx`. Returns the project, the Storybook's URL and the baselines
 * folder.
 */
async function createRun(
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
 * Replaces the time of every pass line with `N`, since it varies from run to run.
 */
function withoutTimes(text: string): string {
  return text.replace(/ {2}\d+ ms$/gm, '  N ms')
}

/**
 * Gives the story ID of each story's URL in `urls`, in order, leaving out the options reads' previews.
 */
function storyIdsOf(urls: readonly string[]): string[] {
  return urls.flatMap((url) => new URL(url).searchParams.get('id') ?? [])
}

describe('runCli test', () => {
  it("ignores a .png nothing calls for, even one that can't be decoded", async () => {
    const { project, folder } = await createRun(['a'], {
      a: defaultSnapshot,
      gone: new TextEncoder().encode('not PNG'),
    })
    const result = await runCli(['test'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(withoutTimes(result.stdout)).toBe(printed(headerOf('test', 1), '✓ web  a  N ms', '1 passed'))
    expect(readdirSync(folder).sort()).toEqual(['a.png', 'gone.png'])
  })

  it("passes a snapshot that holds its baseline's bytes, captured from the story's own page", async () => {
    const { project, url } = await createRun(['button--primary'], { 'button--primary': defaultSnapshot })
    const { options, record } = fakeBrowser()
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(withoutTimes(result.stdout)).toBe(printed(headerOf('test', 1), '✓ web  button--primary  N ms', '1 passed'))
    expect(record.urls).toEqual([
      `${url}/iframe.html?viewMode=story`,
      `${url}/iframe.html?id=button--primary&viewMode=story`,
    ])
    expect(record.pageCloses).toBe(2)
    expect(record.closed).toBe(true)
  })

  it('reports differing, missing and broken stories, carries on, and exits 1 without capturing the missing one', async () => {
    const { project } = await createRun(['a', 'b', 'c', 'd', 'e'], {
      a: defaultSnapshot,
      b: otherSnapshot,
      d: defaultSnapshot,
      e: defaultSnapshot,
    })
    const { options, record } = fakeBrowser({ d: { broken: true } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('')
    expect(withoutTimes(result.stdout)).toBe(
      printed(
        headerOf('test', 5),
        '✓ web  a  N ms',
        '✗ web  b  differs: 100 differ, 20 allowed',
        missingLineOf('web', 'c'),
        `! web  d  ${brokenDetail}`,
        '✓ web  e  N ms',
        '2 passed · 1 differs · 1 broken · 1 missing',
      ),
    )
    expect(storyIdsOf(record.urls).sort()).toEqual(['a', 'b', 'd', 'e'])
  })

  it('prints the configured number of workers in the header, the noun in the right number', async () => {
    const { project: three } = await createRun(['a'], {}, 'workers: 3')
    const { project: one } = await createRun(['a'], {}, 'workers: 1')
    const { project: pair } = await createRun(['a'], {}, 'workers: { local: 5, ci: 2 }')

    const { options } = fakeBrowser()

    expect(firstLineOf((await runCli(['test'], {}, three, options)).stdout)).toBe(headerOf('test', 1, 3))
    expect(firstLineOf((await runCli(['test'], {}, one, options)).stdout)).toBe(headerOf('test', 1, 1))
    expect(firstLineOf((await runCli(['test'], { CI: 'true' }, pair, options)).stdout)).toBe(headerOf('test', 1, 2))
  })

  it('lets --workers beat the config, whether a number or auto', async () => {
    const { project: five } = await createRun(['a'], {}, 'workers: 5')
    const { project: auto } = await createRun(['a'], {}, "workers: 'auto'")
    const { options } = fakeBrowser()

    expect(firstLineOf((await runCli(['test', '--workers', '2'], {}, five, options)).stdout)).toBe(
      headerOf('test', 1, 2),
    )
    expect(firstLineOf((await runCli(['test', '--workers', '3'], {}, auto, options)).stdout)).toBe(
      headerOf('test', 1, 3),
    )
    expect(firstLineOf((await runCli(['test', '--workers', '1'], {}, auto, options)).stdout)).toBe(
      headerOf('test', 1, 1),
    )
  })

  it("sizes 'auto' workers from the Docker host the probe finds", async () => {
    const { project } = await createRun(['a'], {}, "workers: 'auto'")
    const { options } = fakeBrowser()
    const smallHost = { ...options, probeDocker: async () => ({ cpus: 2, memoryBytes: 7e9, desktop: false }) }

    expect(firstLineOf((await runCli(['test'], {}, project, options)).stdout)).toBe(headerOf('test', 1, 4))
    expect(firstLineOf((await runCli(['test'], {}, project, smallHost)).stdout)).toBe(headerOf('test', 1, 2))
  })

  it("sizes 'auto' workers from the machine inside visual-check's image, for any platform", async () => {
    const { project } = await createRun(['a'], {}, "workers: 'auto'")
    const { project: host } = await createRun(['a'], {}, "workers: 'auto', platform: 'host'")
    const inImage = {
      ...fakeBrowser().options,
      machine: { cpus: 2, memoryBytes: 7e9 },
      imageMarkerPath: writeMarker(markerOf('amd64')),
    }

    expect(firstLineOf((await runCli(['test'], {}, project, inImage)).stdout)).toBe(headerOf('test', 1, 2))
    expect(firstLineOf((await runCli(['test'], {}, host, inImage)).stdout)).toBe(headerOf('test', 1, 2))
  })

  it('captures nothing when every selected baseline is missing, after reading the options', async () => {
    const { project, url } = await createRun(['a', 'b'])
    const { options, record } = fakeBrowser()
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(
        headerOf('test', 2),
        missingLineOf('web', 'a'),
        missingLineOf('web', 'b'),
        '0 passed · 2 missing',
      ),
      stderr: '',
    })
    expect(record.launches).toHaveLength(1)
    expect(record.urls).toEqual([`${url}/iframe.html?viewMode=story`])
    expect(record.viewports).toEqual([])
  })

  it('prints only the header and the counts when the selection is empty', async () => {
    const { project } = await createRun(['a'])

    expect(await runCli(['test', '--filter', 'nothing'], {}, project, fakeBrowser().options)).toEqual({
      exitCode: 0,
      stdout: printed(headerOf('test', 0), '0 passed'),
      stderr: '',
    })
  })
})

/**
 * Gives the report folder of a project whose config file is in `project`.
 */
function reportFolderIn(project: string): string {
  return join(project, '.visual-check', 'report')
}

/**
 * Leaves a report from an earlier run in the project's report folder. Returns the path of its one image.
 */
function writeStaleReport(project: string): string {
  const image = join(reportFolderIn(project), 'images', 'web', 'old.diff.png')

  mkdirSync(dirname(image), { recursive: true })
  writeFileSync(image, defaultSnapshot)

  return image
}

describe('runCli visual diff', () => {
  it("leaves a differing snapshot's baseline, snapshot and visual diff in the report folder beside the config file", async () => {
    const url = await startStorybook(['a', 'b'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'packages/web', url: '${url}' } } }\n`,
      'packages/web/button.stories.tsx': '',
      'packages/web/.visual-check/baselines/a.png': defaultSnapshot,
      'packages/web/.visual-check/baselines/b.png': defaultSnapshot,
    })
    const { options } = fakeBrowser({ b: { snapshot: otherSnapshot } })
    const result = await runCli(['test'], {}, join(project, 'packages'), options)
    const images = join(reportFolderIn(project), 'images', 'web')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('')
    expect(withoutTimes(result.stdout)).toBe(
      printed(
        headerOf('test', 2),
        '✓ web  a  N ms',
        '✗ web  b  differs: 100 differ, 20 allowed',
        '1 passed · 1 differs',
      ),
    )
    expect(readdirSync(images).sort()).toEqual(['b.baseline.png', 'b.diff.png', 'b.snapshot.png'])
    expect(new Uint8Array(readFileSync(join(images, 'b.baseline.png')))).toEqual(defaultSnapshot)
    expect(new Uint8Array(readFileSync(join(images, 'b.snapshot.png')))).toEqual(otherSnapshot)
    expect([...readFileSync(join(images, 'b.diff.png')).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(existsSync(join(project, 'packages', 'web', '.visual-check', 'report'))).toBe(false)
  })

  it("names a mode's images by its key", async () => {
    const { project } = await createRun(['a'], { a: defaultSnapshot, 'a.dark': defaultSnapshot })
    const { options } = fakeBrowser(
      { a: darkStory },
      { read: { options: { a: { modes: { dark: twoModes.modes.dark } } } } },
    )
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(readdirSync(join(reportFolderIn(project), 'images', 'web')).sort()).toEqual([
      'a.dark.baseline.png',
      'a.dark.diff.png',
      'a.dark.snapshot.png',
    ])
  })

  it('removes a stale report folder, and writes no image when every snapshot passes', async () => {
    const { project } = await createRun(['a'], { a: defaultSnapshot })

    writeStaleReport(project)

    const result = await runCli(['test'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(existsSync(reportFolderIn(project))).toBe(false)
  })

  it('leaves the report folder alone in update', async () => {
    const { project } = await createRun(['a'], { a: defaultSnapshot })
    const image = writeStaleReport(project)
    const result = await runCli(['update'], {}, project, fakeBrowser({ a: { snapshot: otherSnapshot } }).options)

    expect(result.exitCode).toBe(0)
    expect(readdirSync(join(reportFolderIn(project), 'images', 'web'))).toEqual(['old.diff.png'])
    expect(new Uint8Array(readFileSync(image))).toEqual(defaultSnapshot)
  })

  it("compares by the story's tolerance over the config's", async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultSnapshot, b: defaultSnapshot })
    const threeWhite = new Uint8Array(await greyPng(10, 10, 0, whitePixels(3, 10)))
    const { options } = fakeBrowser(
      { a: { snapshot: threeWhite }, b: { snapshot: threeWhite } },
      { read: { options: { b: { tolerance: { pixels: 0 } } } } },
    )
    const result = await runCli(['test'], {}, project, options)

    expect(withoutTimes(result.stdout)).toBe(
      printed(headerOf('test', 2), '✓ web  a  N ms', '✗ web  b  differs: 3 differ, 0 allowed', '1 passed · 1 differs'),
    )
  })

  it("scales a count of pixels with the viewport's device scale factor, and says so", async () => {
    const { project } = await createRun(['a'], { a: defaultSnapshot })
    const { options } = fakeBrowser(
      { a: { snapshot: otherSnapshot } },
      { read: { options: { a: { viewport: { deviceScaleFactor: 2 } } } } },
    )
    const result = await runCli(['test'], {}, project, options)

    expect(result.stdout).toContain('✗ web  a  differs: 100 differ, 80 allowed (20 at scale 2)\n')
  })

  it('fails a snapshot whose size differs from its baseline, naming both sizes', async () => {
    const { project } = await createRun(['a'], { a: defaultSnapshot })
    const taller = new Uint8Array(await greyPng(10, 12, 0))
    const result = await runCli(['test'], {}, project, fakeBrowser({ a: { snapshot: taller } }).options)

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('✗ web  a  differs: size changed: 10×10 → 10×12\n')
  })

  it("stops with exit 2, naming the baseline, when a differing baseline can't be decoded", async () => {
    const { project } = await createRun(['a'], { a: new TextEncoder().encode('not a PNG file') })
    const result = await runCli(['test'], {}, project, fakeBrowser().options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: printed(headerOf('test', 1)),
      stderr:
        "visual-check couldn't decode the baseline .visual-check/baselines/a.png: Input buffer contains unsupported " +
        'image format. Delete it or restore it from git, then run visual-check again.\n',
    })
  })

  it("stops with exit 2 before any capture when the report folder can't be cleared", async () => {
    const url = await startStorybook(['a'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${url}' } } }\n`,
      'web/button.stories.tsx': '',
      'web/.visual-check/baselines/a.png': defaultSnapshot,
      '.visual-check': '',
    })
    const { options, record } = fakeBrowser()
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        "visual-check couldn't clear .visual-check/report: ENOTDIR: not a directory. " +
        'Check that visual-check can remove it.\n',
    })
    expect(storyIdsOf(record.urls)).toEqual([])
  })
})

describe('runCli update', () => {
  it('writes missing baselines and ones beyond tolerance exactly as captured, and keeps the rest untouched', async () => {
    const { project, folder } = await createRun(['a', 'b', 'c', 'd'], {
      a: defaultSnapshot,
      b: defaultSnapshot,
      c: defaultSnapshot,
    })
    const past = new Date('2001-01-01T00:00:00Z')

    utimesSync(join(folder, 'a.png'), past, past)
    utimesSync(join(folder, 'b.png'), past, past)

    const threeWhite = new Uint8Array(await greyPng(10, 10, 0, whitePixels(3, 10)))
    const newD = new Uint8Array(await greyPng(10, 10, 128))
    const { options } = fakeBrowser({
      b: { snapshot: threeWhite },
      c: { snapshot: otherSnapshot },
      d: { snapshot: newD },
    })
    const result = await runCli(['update'], {}, project, options)

    expect(result).toEqual({
      exitCode: 0,
      stdout: printed(
        headerOf('update', 4),
        '✓ web  a  kept',
        '✓ web  b  kept',
        '✓ web  c  written: differs: 100 differ, 20 allowed',
        '✓ web  d  written: missing',
        '2 written · 2 kept',
        'written .visual-check/baselines/c.png',
        'written .visual-check/baselines/d.png',
      ),
      stderr: '',
    })
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(defaultSnapshot)
    expect(new Uint8Array(readFileSync(join(folder, 'b.png')))).toEqual(defaultSnapshot)
    expect(new Uint8Array(readFileSync(join(folder, 'c.png')))).toEqual(otherSnapshot)
    expect(new Uint8Array(readFileSync(join(folder, 'd.png')))).toEqual(newD)
    expect(statSync(join(folder, 'a.png')).mtimeMs).toBe(past.getTime())
    expect(statSync(join(folder, 'b.png')).mtimeMs).toBe(past.getTime())
  })

  it("compares by the story's tolerance, at the viewport's device scale factor", async () => {
    const { project, folder } = await createRun(['a', 'b'], { a: defaultSnapshot, b: defaultSnapshot })
    const { options } = fakeBrowser(
      { a: { snapshot: otherSnapshot }, b: { snapshot: otherSnapshot } },
      {
        read: {
          options: { a: { tolerance: { pixels: 100 } }, b: { viewport: { deviceScaleFactor: 2 } } },
        },
      },
    )
    const result = await runCli(['update'], {}, project, options)

    expect(result.stdout).toBe(
      printed(
        headerOf('update', 2),
        '✓ web  a  kept',
        '✓ web  b  written: differs: 100 differ, 80 allowed (20 at scale 2)',
        '1 written · 1 kept',
        'written .visual-check/baselines/b.png',
      ),
    )
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(defaultSnapshot)
    expect(new Uint8Array(readFileSync(join(folder, 'b.png')))).toEqual(otherSnapshot)
  })

  it('writes a baseline whose size changed, naming both sizes', async () => {
    const { project, folder } = await createRun(['a'], { a: defaultSnapshot })
    const taller = new Uint8Array(await greyPng(10, 12, 0))
    const result = await runCli(['update'], {}, project, fakeBrowser({ a: { snapshot: taller } }).options)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('✓ web  a  written: differs: size changed: 10×10 → 10×12\n')
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(taller)
  })

  it("stops with exit 2 before any capture, naming the baseline, and keeps it when it can't be decoded", async () => {
    const notPng = new TextEncoder().encode('not a PNG file')
    const { project, folder } = await createRun(['a'], { a: notPng })
    const { options, record } = fakeBrowser()
    const result = await runCli(['update'], {}, project, options)

    expect(storyIdsOf(record.urls)).toEqual([])
    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        "visual-check couldn't decode the baseline .visual-check/baselines/a.png: Input buffer contains unsupported " +
        'image format. Delete it or restore it from git, then run visual-check again.\n',
    })
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(notPng)
  })

  it('writes nothing for a broken story, keeps its old baseline, and exits 1', async () => {
    const { project, folder } = await createRun(['a', 'b', 'c'], { a: otherSnapshot })
    const { options } = fakeBrowser({ a: { broken: true }, b: { broken: true } })
    const result = await runCli(['update'], {}, project, options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(
        headerOf('update', 3),
        `! web  a  ${brokenDetail}`,
        `! web  b  ${brokenDetail}`,
        '✓ web  c  written: missing',
        '1 written · 2 broken',
        'written .visual-check/baselines/c.png',
      ),
      stderr: '',
    })
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(otherSnapshot)
    expect(existsSync(join(folder, 'b.png'))).toBe(false)
  })

  it("writes a missing baseline into its Storybook's folder, whatever folder it runs in", async () => {
    const url = await startStorybook(['a'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'packages/web', url: '${url}' } } }\n`,
      'packages/web/button.stories.tsx': '',
    })
    const result = await runCli(['update'], {}, join(project, 'packages'), fakeBrowser().options)

    expect(result.stdout).toContain('✓ web  a  written: missing\n')
    expect(existsSync(join(project, 'packages', 'web', '.visual-check', 'baselines', 'a.png'))).toBe(true)
  })

  it('writes every missing baseline, deletes every orphan, rewrites failing ones only inside --filter', async () => {
    const { project, folder } = await createRun(['a', 'b', 'c', 'd', 'e', 'f'], {
      a: defaultSnapshot,
      'a.dark': defaultSnapshot,
      c: defaultSnapshot,
      d: defaultSnapshot,
      f: defaultSnapshot,
      gone: defaultSnapshot,
    })
    const { options, record } = fakeBrowser({ a: { snapshot: otherSnapshot }, c: { snapshot: otherSnapshot } })
    const result = await runCli(['update', '--filter', '^[abf]$'], {}, project, options)

    expect(result).toEqual({
      exitCode: 0,
      stdout: printed(
        headerOf('update', 4),
        '✓ web  a  written: differs: 100 differ, 20 allowed',
        '✓ web  b  written: missing',
        '✓ web  e  written: missing',
        '✓ web  f  kept',
        '3 written · 2 deleted · 1 kept',
        'written .visual-check/baselines/a.png',
        'written .visual-check/baselines/b.png',
        'written .visual-check/baselines/e.png',
        'deleted .visual-check/baselines/a.dark.png',
        'deleted .visual-check/baselines/gone.png',
      ),
      stderr: '',
    })
    expect(storyIdsOf(record.urls)).toEqual(['a', 'b', 'e', 'f'])
    expect(readdirSync(folder).sort()).toEqual(['a.png', 'b.png', 'c.png', 'd.png', 'e.png', 'f.png'])
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(otherSnapshot)
    expect(new Uint8Array(readFileSync(join(folder, 'c.png')))).toEqual(defaultSnapshot)
  })

  it('deletes only orphans and exits 0 when every baseline is kept', async () => {
    const { project, folder } = await createRun(['a'], { a: defaultSnapshot, gone: defaultSnapshot })
    const result = await runCli(['update'], {}, project, fakeBrowser().options)

    expect(result).toEqual({
      exitCode: 0,
      stdout: printed(
        headerOf('update', 1),
        '✓ web  a  kept',
        '0 written · 1 deleted · 1 kept',
        'deleted .visual-check/baselines/gone.png',
      ),
      stderr: '',
    })
    expect(readdirSync(folder)).toEqual(['a.png'])
  })

  it("deletes a disabled story's baseline as an orphan", async () => {
    const { project, folder } = await createRun(['a', 'b'], { a: defaultSnapshot, b: defaultSnapshot })
    const { options } = fakeBrowser({}, { read: { options: { b: { disable: true } } } })
    const result = await runCli(['update'], {}, project, options)

    expect(result.stdout).toBe(
      printed(
        headerOf('update', 1),
        '✓ web  a  kept',
        '0 written · 1 deleted · 1 kept',
        'deleted .visual-check/baselines/b.png',
      ),
    )
    expect(readdirSync(folder)).toEqual(['a.png'])
  })

  it('leaves files that are no PNG baseline alone', async () => {
    const { project, folder } = await createRun(['a'], { a: defaultSnapshot })

    writeFileSync(join(folder, 'notes.txt'), 'notes')
    writeFileSync(join(folder, '.visual-check-0a1b2c.tmp'), 'left by a killed run')
    mkdirSync(join(folder, 'old.png'))

    const result = await runCli(['update'], {}, project, fakeBrowser().options)

    expect(result).toEqual({
      exitCode: 0,
      stdout: printed(headerOf('update', 1), '✓ web  a  kept', '0 written · 1 kept'),
      stderr: '',
    })
    expect(readdirSync(folder).sort()).toEqual(['.visual-check-0a1b2c.tmp', 'a.png', 'notes.txt', 'old.png'])
  })

  it('keeps every baseline a story whose stories file failed to load could own, and leaves the story out', async () => {
    const longMode = `b.${'m'.repeat(300)}`
    const { project, folder } = await createRun(
      ['a', 'b'],
      {
        a: defaultSnapshot,
        b: defaultSnapshot,
        'b.dark': defaultSnapshot,
        [shortenedStemOf(longMode)]: defaultSnapshot,
        'b-group': defaultSnapshot,
      },
      '',
      { a: './a.stories.tsx', b: './b.stories.tsx' },
    )
    const { options, record } = fakeBrowser({}, { read: { failed: { './b.stories.tsx': 'SyntaxError' } } })
    const result = await runCli(['update', '--filter', '^a$'], {}, project, options)

    expect(result).toEqual({
      exitCode: 0,
      stdout: printed(
        headerOf('update', 1),
        '✓ web  a  kept',
        '0 written · 1 deleted · 1 kept',
        'deleted .visual-check/baselines/b-group.png',
      ),
      stderr: '',
    })
    expect(storyIdsOf(record.urls)).toEqual(['a'])
    expect(readdirSync(folder).sort()).toEqual(['a.png', 'b.dark.png', `${shortenedStemOf(longMode)}.png`, 'b.png'])
  })

  it('narrows writing and deleting to the Storybook --storybook names', async () => {
    const web = await startStorybook(['a'])
    const docs = await startStorybook(['d', 'e'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${docs}' } } }\n`,
      'web/button.stories.tsx': '',
      'web/.visual-check/baselines/gone.png': defaultSnapshot,
      'docs/button.stories.tsx': '',
      'docs/.visual-check/baselines/e.png': otherSnapshot,
      'docs/.visual-check/baselines/gone.png': defaultSnapshot,
    })
    const docsFolder = join(project, 'docs', '.visual-check', 'baselines')
    const { options, record } = fakeBrowser()
    const result = await runCli(['update', '--storybook', 'web'], {}, project, options)

    expect(result).toEqual({
      exitCode: 0,
      stdout: printed(
        headerOf('update', 1),
        '✓ web  a  written: missing',
        '1 written · 1 deleted',
        'written web/.visual-check/baselines/a.png',
        'deleted web/.visual-check/baselines/gone.png',
      ),
      stderr: '',
    })
    expect(storyIdsOf(record.urls)).toEqual(['a'])
    expect(readdirSync(docsFolder).sort()).toEqual(['e.png', 'gone.png'])
    expect(new Uint8Array(readFileSync(join(docsFolder, 'e.png')))).toEqual(otherSnapshot)
  })

  it('prints written and deleted paths relative to the folder it runs in, with /', async () => {
    const url = await startStorybook(['a'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'packages/web', url: '${url}' } } }\n`,
      'packages/web/button.stories.tsx': '',
      'packages/web/.visual-check/baselines/gone.png': defaultSnapshot,
    })
    const result = await runCli(['update'], {}, join(project, 'packages'), fakeBrowser().options)

    expect(result.stdout).toBe(
      printed(
        headerOf('update', 1),
        '✓ web  a  written: missing',
        '1 written · 1 deleted',
        'written web/.visual-check/baselines/a.png',
        'deleted web/.visual-check/baselines/gone.png',
      ),
    )
  })

  it("stops with exit 2 before any capture, writing and deleting nothing, when a .png can't be decoded", async () => {
    const notPng = new TextEncoder().encode('not a PNG file')
    const { project, folder } = await createRun(['a', 'b'], { a: otherSnapshot, gone: defaultSnapshot, zz: notPng })
    const { options, record } = fakeBrowser()
    const result = await runCli(['update'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        "visual-check couldn't decode the baseline .visual-check/baselines/zz.png: Input buffer contains unsupported " +
        'image format. Delete it or restore it from git, then run visual-check again.\n',
    })
    expect(storyIdsOf(record.urls)).toEqual([])
    expect(readdirSync(folder).sort()).toEqual(['a.png', 'gone.png', 'zz.png'])
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(otherSnapshot)
  })

  it("names the first Storybook's undecodable baseline before the next one's folder that can't be listed", async () => {
    const web = await startStorybook(['a'])
    const docs = await startStorybook(['d'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${docs}' } } }\n`,
      'web/button.stories.tsx': '',
      'web/.visual-check/baselines/b.png': new TextEncoder().encode('not a PNG file'),
      'web/.visual-check/baselines/c.png': new TextEncoder().encode('not a PNG file either'),
      'docs/button.stories.tsx': '',
      'docs/.visual-check/baselines': '',
    })
    const { options, record } = fakeBrowser()
    const result = await runCli(['update'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        "visual-check couldn't decode the baseline web/.visual-check/baselines/b.png: Input buffer contains " +
        'unsupported image format. Delete it or restore it from git, then run visual-check again.\n',
    })
    expect(storyIdsOf(record.urls)).toEqual([])
  })

  it('keeps an orphan that is another name of an expected baseline', async () => {
    const { project, folder } = await createRun(['a'], { a: defaultSnapshot })

    linkSync(join(folder, 'a.png'), join(folder, 'other-name.png'))

    const result = await runCli(['update'], {}, project, fakeBrowser().options)

    expect(result.stdout).toBe(printed(headerOf('update', 1), '✓ web  a  kept', '0 written · 1 kept'))
    expect(readdirSync(folder).sort()).toEqual(['a.png', 'other-name.png'])
  })

  it('takes only the missing mode of a story outside the filter whose default baseline is there', async () => {
    const { project, folder } = await createRun(['a', 'b'], { a: defaultSnapshot, b: defaultSnapshot })
    const { options, record } = fakeBrowser(
      { b: darkStory },
      { read: { options: { b: { modes: { dark: twoModes.modes.dark } } } } },
    )
    const result = await runCli(['update', '--filter', '^a$'], {}, project, options)

    expect(result.stdout).toBe(
      printed(
        headerOf('update', 2),
        '✓ web  a  kept',
        '✓ web  b  dark  written: missing',
        '1 written · 1 kept',
        'written .visual-check/baselines/b.dark.png',
      ),
    )
    expect(storyIdsOf(record.urls)).toEqual(['a', 'b'])
    expect(new Uint8Array(readFileSync(join(folder, 'b.png')))).toEqual(defaultSnapshot)
    expect(new Uint8Array(readFileSync(join(folder, 'b.dark.png')))).toEqual(darkSnapshot)
  })

  it("stops with exit 2 before any capture when the baselines folder can't be listed", async () => {
    const { project, folder } = await createRun(['a'])

    mkdirSync(dirname(folder), { recursive: true })
    writeFileSync(folder, '')

    const { options, record } = fakeBrowser()
    const result = await runCli(['update'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        "visual-check couldn't list the baselines folder .visual-check/baselines: ENOTDIR: not a directory. Check " +
        "that it's a folder visual-check can read.\n",
    })
    expect(storyIdsOf(record.urls)).toEqual([])
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    "stops with exit 2 after every snapshot is taken when an orphan can't be deleted",
    async () => {
      const { project, folder } = await createRun(['a'], { a: defaultSnapshot, gone: defaultSnapshot })

      chmodSync(folder, 0o555)

      try {
        const result = await runCli(['update'], {}, project, fakeBrowser().options)

        expect(result).toEqual({
          exitCode: 2,
          stdout: printed(headerOf('update', 1), '✓ web  a  kept'),
          stderr:
            "visual-check couldn't delete the baseline .visual-check/baselines/gone.png: EACCES: permission denied. " +
            'Check that its folder is writable.\n',
        })
      } finally {
        chmodSync(folder, 0o755)
      }

      expect(readdirSync(folder).sort()).toEqual(['a.png', 'gone.png'])
    },
  )
})

/**
 * Gives the URL of the preview page an options read loads for the Storybook at `url`.
 */
function previewOf(url: string): string {
  return `${url}/iframe.html?viewMode=story`
}

/**
 * The fix the problem for invalid per-story options ends with.
 */
const invalidOptionsFix =
  'Fix parameters.visualCheck where the preview, the stories file or the story sets it, then run visual-check again.\n'

/**
 * The issue of a story whose `disable` is `1`.
 */
const disableIssue = 'visualCheck.disable: must be true or false. Got 1.'

describe('runCli warning about baseline paths over 260 characters', () => {
  const deepFolder = `${'d'.repeat(100)}/${'e'.repeat(100)}`
  const warningHead =
    "These baselines' paths are longer than 260 characters, which git on Windows checks out only with " +
    'core.longpaths set. Run git config core.longpaths true.'

  /**
   * Starts a Storybook with the stories and makes a project whose baselines folder is `deepFolder`, with `baselines`
   * written in it.
   */
  async function createDeepRun(storyIds: string[], baselines: Record<string, Uint8Array> = {}): Promise<string> {
    const url = await startStorybook(storyIds)
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}', baselines: '${deepFolder}' } } }\n`,
      './button.stories.tsx': '',
    })

    mkdirSync(join(project, deepFolder), { recursive: true })

    for (const [id, bytes] of Object.entries(baselines)) {
      writeFileSync(join(project, deepFolder, `${id}.png`), bytes)
    }

    return project
  }

  it('warns on Windows in update about each baseline it wrote with a path over 260 characters, keeping exit 0', async () => {
    const project = await createDeepRun(['a', 'b'])
    const { options } = fakeBrowser()
    const result = await runCli(['update'], {}, project, { ...options, os: 'win32' })

    expect(result).toEqual({
      exitCode: 0,
      stdout: printed(
        headerOf('update', 2),
        '✓ web  a  written: missing',
        '✓ web  b  written: missing',
        '2 written',
        `written ${deepFolder}/a.png`,
        `written ${deepFolder}/b.png`,
      ),
      stderr: printed(warningHead, `  ${deepFolder}/a.png`, `  ${deepFolder}/b.png`),
    })
    expect(join(project, deepFolder, 'a.png').length).toBeGreaterThan(260)
  })

  it('does not warn on another OS', async () => {
    const project = await createDeepRun(['a'])
    const result = await runCli(['update'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('does not warn on Windows when every path written is short', async () => {
    const { project } = await createRun(['a'])
    const result = await runCli(['update'], {}, project, { ...fakeBrowser().options, os: 'win32' })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('does not warn on Windows about a long-path baseline it kept', async () => {
    const project = await createDeepRun(['a'], { a: defaultSnapshot })
    const result = await runCli(['update'], {}, project, { ...fakeBrowser().options, os: 'win32' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('1 kept')
    expect(result.stderr).toBe('')
  })

  it('does not warn in test on Windows', async () => {
    const project = await createDeepRun(['a'], { a: defaultSnapshot })
    const result = await runCli(['test'], {}, project, { ...fakeBrowser().options, os: 'win32' })

    expect(result.stderr).toBe('')
  })
})

describe('runCli per-story options', () => {
  it('reads each Storybook once, before any capture, with every story grouped by file, even with --filter', async () => {
    const web = await startStorybook(['a', 'b', 'c'], {
      a: './a.stories.tsx',
      b: './b.stories.tsx',
      c: './a.stories.tsx',
    })
    const docs = await startStorybook(['d'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${docs}' } } }\n`,
      'web/a.stories.tsx': '',
      'web/b.stories.tsx': '',
      'docs/button.stories.tsx': '',
      'web/.visual-check/baselines/a.png': defaultSnapshot,
      'docs/.visual-check/baselines/d.png': defaultSnapshot,
    })
    const { options, record } = fakeBrowser()
    const result = await runCli(['test', '--filter', '^[ad]$'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(withoutTimes(result.stdout)).toBe(
      printed(headerOf('test', 2), '✓ web  a  N ms', '✓ docs  d  N ms', '2 passed'),
    )
    expect(record.reads).toEqual([
      {
        browser: 1,
        url: previewOf(web),
        files: [
          { importPath: './a.stories.tsx', storyIds: ['a', 'c'] },
          { importPath: './b.stories.tsx', storyIds: ['b'] },
        ],
      },
      { browser: 1, url: previewOf(docs), files: [{ importPath: './button.stories.tsx', storyIds: ['d'] }] },
    ])
    expect(record.urls.slice(0, 2)).toEqual([previewOf(web), previewOf(docs)])
    expect(storyIdsOf(record.urls).sort()).toEqual(['a', 'd'])
  })

  it('exits 2 for invalid options, naming each story and key, and captures nothing', async () => {
    const { project } = await createRun(['a', 'b', 'c'], { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot })
    const { options, record } = fakeBrowser(
      {},
      {
        read: { options: { a: { tolerance: { pixels: -1 } }, b: { tolerance: { pixels: 3 } }, c: { disable: 'yes' } } },
      },
    )
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        'Storybook web has invalid per-story options:\n' +
        "  - a: visualCheck.tolerance.pixels: must be a whole number of 0 or more, or a string from '0%' to '100%'. Got -1.\n" +
        '  - c: visualCheck.disable: must be true or false. Got "yes".\n' +
        invalidOptionsFix,
    })
    expect(storyIdsOf(record.urls)).toEqual([])
    expect(record.closed).toBe(true)
  })

  it('exits 2 for a bad mode name, naming the story and key, and captures nothing', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultSnapshot, b: defaultSnapshot })
    const { options, record } = fakeBrowser({}, { read: { options: { b: { modes: { Dark: { globals: {} } } } } } })
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        'Storybook web has invalid per-story options:\n' +
        '  - b: visualCheck.modes.Dark: a mode name takes lowercase letters, digits and -. Rename it in <configDir>/visual-check.ts.\n' +
        invalidOptionsFix,
    })
    expect(storyIdsOf(record.urls)).toEqual([])
    expect(record.closed).toBe(true)
  })

  it('validates the options of stories the selection leaves out', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultSnapshot })
    const { options } = fakeBrowser({}, { read: { options: { b: { disable: 1 } } } })
    const result = await runCli(['test', '--filter', '^a$'], {}, project, options)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toBe(
      `Storybook web has invalid per-story options:\n  - b: ${disableIssue}\n${invalidOptionsFix}`,
    )
  })

  it('gives a block for each Storybook with invalid options, in config order', async () => {
    const web = await startStorybook(['a'])
    const quick = await startStorybook(['b'])
    const docs = await startStorybook(['c'])
    const project = createProject({
      'visual-check.config.mjs':
        `export default { storybooks: { web: { dir: 'web', url: '${web}' }, ` +
        `quick: { dir: 'quick', url: '${quick}' }, docs: { dir: 'docs', url: '${docs}' } } }\n`,
      'web/button.stories.tsx': '',
      'quick/button.stories.tsx': '',
      'docs/button.stories.tsx': '',
    })
    const { options, record } = fakeBrowser({}, { read: { options: { a: { disable: 1 }, c: { disable: 1 } } } })
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        `Storybook web has invalid per-story options:\n  - a: ${disableIssue}\n` +
        `Storybook docs has invalid per-story options:\n  - c: ${disableIssue}\n` +
        invalidOptionsFix,
    })
    expect(record.reads.map(({ url }) => url)).toEqual([previewOf(web), previewOf(quick), previewOf(docs)])
  })

  it("exits 2 with the read's problem, without reading the Storybooks after it", async () => {
    const web = await startStorybook(['a'])
    const docs = await startStorybook(['b'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${docs}' } }, readyTimeout: 4000 }\n`,
      'web/button.stories.tsx': '',
      'docs/button.stories.tsx': '',
    })
    const { options, record } = fakeBrowser(
      {},
      { read: { answers: { [previewOf(web)]: { outcome: 'timed-out', step: 'preview-start' } } } },
    )
    const result = await runCli(['update'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: printed(
        `Storybook web's preview never started at ${previewOf(web)} within readyTimeout (4000 ms). Open it to see ` +
          'why, or raise readyTimeout.',
      ),
    })
    expect(record.reads.map(({ url }) => url)).toEqual([previewOf(web)])
    expect(storyIdsOf(record.urls)).toEqual([])
    expect(record.closed).toBe(true)
  })

  it('reads again in the relaunched browser when the browser exits during the read, and goes on', async () => {
    const { project, url } = await createRun(['a', 'b'], { a: defaultSnapshot, b: defaultSnapshot }, 'workers: 1')
    const { options, record } = fakeBrowser({}, { read: { exitingBrowsers: [1] } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(withoutTimes(result.stdout)).toBe(
      printed(headerOf('test', 2, 1), '✓ web  a  N ms', '✓ web  b  N ms', '2 passed'),
    )
    expect(result.stderr).toBe(relaunchNotice)
    expect(record.launches).toHaveLength(2)
    expect(record.reads.map(({ browser, url: readUrl }) => [browser, readUrl])).toEqual([
      [1, previewOf(url)],
      [2, previewOf(url)],
    ])
    expect(record.events).toEqual(['close page on 2', 'a on 2', 'b on 2', 'close page on 2', 'close 1', 'close 2'])
  })

  it('says the browser relaunched before the problem of a later read, and closes both browsers', async () => {
    const web = await startStorybook(['a'])
    const docs = await startStorybook(['b'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${docs}' } }, readyTimeout: 4000 }\n`,
      'web/button.stories.tsx': '',
      'docs/button.stories.tsx': '',
    })
    const { options, record } = fakeBrowser(
      {},
      {
        read: {
          exitingBrowsers: [1],
          answers: { [previewOf(docs)]: { outcome: 'timed-out', step: 'preview-ready' } },
        },
      },
    )
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        relaunchNotice +
        printed(
          `Storybook docs's preview started at ${previewOf(docs)} but never became ready within readyTimeout ` +
            '(4000 ms). Open it to see why, or raise readyTimeout.',
        ),
    })
    expect(record.reads.map(({ browser, url }) => [browser, url])).toEqual([
      [1, previewOf(web)],
      [2, previewOf(web)],
      [2, previewOf(docs)],
    ])
    expect(record.driverCloses).toBe(2)
  })

  it('exits 2 when the relaunched browser exits too as it reads the options again', async () => {
    const { project } = await createRun(['a'], { a: defaultSnapshot })
    const { options, record } = fakeBrowser({}, { read: { exitingBrowsers: [1, 2] } })
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({ exitCode: 2, stdout: '', stderr: `${relaunchNotice}${secondExitMessage}` })
    expect(record.launches).toHaveLength(2)
    expect(storyIdsOf(record.urls)).toEqual([])
    expect(record.driverCloses).toBe(2)
  })

  it('takes no snapshot when every selected story is disabled, after one read', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultSnapshot, b: defaultSnapshot })
    const { options, record } = fakeBrowser({}, { read: { options: { a: { disable: true }, b: { disable: true } } } })
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({ exitCode: 0, stdout: printed(headerOf('test', 0), '0 passed'), stderr: '' })
    expect(record.reads).toHaveLength(1)
    expect(storyIdsOf(record.urls)).toEqual([])
    expect(record.viewports).toEqual([])
  })

  it("leaves out a disabled story, and keeps one whose merged options say it isn't", async () => {
    const { project } = await createRun(['a', 'b', 'c'], { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot })
    const { options, record } = fakeBrowser({}, { read: { options: { b: { disable: true }, c: { disable: false } } } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(withoutTimes(result.stdout)).toBe(
      printed(headerOf('test', 2), '✓ web  a  N ms', '✓ web  c  N ms', '2 passed'),
    )
    expect(storyIdsOf(record.urls).sort()).toEqual(['a', 'c'])
  })

  it('writes no baseline for a disabled story in update', async () => {
    const { project, folder } = await createRun(['a', 'b'])
    const { options } = fakeBrowser({}, { read: { options: { b: { disable: true } } } })
    const result = await runCli(['update'], {}, project, options)

    expect(result).toEqual({
      exitCode: 0,
      stdout: printed(
        headerOf('update', 1),
        '✓ web  a  written: missing',
        '1 written',
        'written .visual-check/baselines/a.png',
      ),
      stderr: '',
    })
    expect(existsSync(join(folder, 'b.png'))).toBe(false)
  })

  it('breaks the selected stories of a file that failed to load, captures the others, and exits 1', async () => {
    const { project, url } = await createRun(
      ['a', 'b', 'c'],
      { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot },
      '',
      { a: './a.stories.tsx', b: './b.stories.tsx', c: './a.stories.tsx' },
    )
    const { options, record } = fakeBrowser(
      {},
      { read: { failed: { './a.stories.tsx': "SyntaxError: Unexpected token '<'" } } },
    )
    const result = await runCli(['test'], {}, project, options)
    const broken = "broken: Its stories file ./a.stories.tsx failed to load: SyntaxError: Unexpected token '<'."

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('')
    expect(withoutTimes(result.stdout)).toBe(
      printed(
        headerOf('test', 3),
        `! web  a  ${broken}`,
        '✓ web  b  N ms',
        `! web  c  ${broken}`,
        '1 passed · 2 broken',
      ),
    )
    expect(record.urls).toEqual([previewOf(url), `${url}/iframe.html?id=b&viewMode=story`])
  })

  it('says only that the file failed to load when the page gives no message', async () => {
    const { project } = await createRun(['a'], { a: defaultSnapshot })
    const { options } = fakeBrowser({}, { read: { failed: { './button.stories.tsx': '' } } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.stdout).toBe(
      printed(
        headerOf('test', 1),
        '! web  a  broken: Its stories file ./button.stories.tsx failed to load.',
        '0 passed · 1 broken',
      ),
    )
  })

  it("breaks the stories of a file that didn't load within readyTimeout", async () => {
    const { project } = await createRun(['a'], { a: defaultSnapshot }, 'readyTimeout: 4000')
    const { options } = fakeBrowser({}, { read: { timedOut: ['./button.stories.tsx'] } })
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(
        headerOf('test', 1),
        "! web  a  broken: Its stories file ./button.stories.tsx didn't load within readyTimeout (4000 ms).",
        '0 passed · 1 broken',
      ),
      stderr: '',
    })
  })

  it('reports a story whose file failed to load as broken in test, not missing, when it has no baseline', async () => {
    const { project, url } = await createRun(['a'])
    const { options, record } = fakeBrowser({}, { read: { failed: { './button.stories.tsx': 'Error: boom' } } })
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(
        headerOf('test', 1),
        '! web  a  broken: Its stories file ./button.stories.tsx failed to load: Error: boom.',
        '0 passed · 1 broken',
      ),
      stderr: '',
    })
    expect(record.urls).toEqual([previewOf(url)])
  })

  it('writes nothing in update for a story whose file failed to load, and keeps its old baseline', async () => {
    const { project, folder } = await createRun(['a', 'b'], { a: otherSnapshot })
    const { options, record } = fakeBrowser({}, { read: { failed: { './button.stories.tsx': 'Error: boom' } } })
    const result = await runCli(['update'], {}, project, options)
    const broken = 'broken: Its stories file ./button.stories.tsx failed to load: Error: boom.'

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(headerOf('update', 2), `! web  a  ${broken}`, `! web  b  ${broken}`, '0 written · 2 broken'),
      stderr: '',
    })
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(otherSnapshot)
    expect(existsSync(join(folder, 'b.png'))).toBe(false)
    expect(storyIdsOf(record.urls)).toEqual([])
  })

  it("doesn't read a Storybook with no stories", async () => {
    const web = await startStorybook(['a'])
    const docs = await startStorybook([])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${docs}' } } }\n`,
      'web/button.stories.tsx': '',
    })
    const { options, record } = fakeBrowser()
    const result = await runCli(['update'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(record.reads.map(({ url }) => url)).toEqual([previewOf(web)])
  })

  it('launches no browser when no Storybook has stories', async () => {
    const { project } = await createRun([])

    expect(await runCli(['test'], {}, project, noLaunch)).toEqual({
      exitCode: 0,
      stdout: printed(headerOf('test', 0), '0 passed'),
      stderr: '',
    })
  })
})

/**
 * The options of a story that lists two modes: `dark`, which sets a global, and `mobile`, which sets a viewport, over
 * a viewport of its own.
 */
const twoModes = {
  viewport: { height: 900 },
  modes: {
    dark: { globals: { theme: 'dark' } },
    mobile: { viewport: { width: 375, deviceScaleFactor: 2, touch: true } },
  },
}

/**
 * The snapshot story `a` captures in its `dark` mode, which differs from `defaultSnapshot`.
 */
const darkSnapshot = new Uint8Array(await greyPng(10, 10, 64))

/**
 * How story `a` answers: its `dark` mode, whose URL sets `theme:dark`, captures `darkSnapshot`.
 */
const darkStory: FakeStory = { byGlobals: { 'theme:dark': { snapshot: darkSnapshot } } }

describe('runCli modes', () => {
  it('tests each mode as its own snapshot against its own baseline, the mode in its own column', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultSnapshot, 'a.dark': darkSnapshot, b: otherSnapshot })
    const { options, record } = fakeBrowser({ a: darkStory }, { read: { options: { a: twoModes } } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('')
    expect(withoutTimes(result.stdout)).toBe(
      printed(
        headerOf('test', 4),
        '✓ web  a  N ms',
        '✓ web  a  dark  N ms',
        '✗ web  a  mobile  missing: no baseline yet; run visual-check update to write it',
        '✗ web  b  differs: 100 differ, 20 allowed',
        '2 passed · 1 differs · 1 missing',
      ),
    )
    expect(storyIdsOf(record.urls).sort()).toEqual(['a', 'a', 'b'])
  })

  it("reports a mode's snapshot that breaks as broken, on its own line, and takes the others", async () => {
    const { project } = await createRun(['a'], { a: defaultSnapshot, 'a.dark': defaultSnapshot })
    const { options } = fakeBrowser(
      { a: { byGlobals: { 'theme:dark': { broken: true } } } },
      { read: { options: { a: { modes: { dark: twoModes.modes.dark } } } } },
    )
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(withoutTimes(result.stdout)).toBe(
      printed(headerOf('test', 2), '✓ web  a  N ms', `! web  a  dark  ${brokenDetail}`, '1 passed · 1 broken'),
    )
  })

  it("captures each snapshot at its own viewport, loading a mode's story URL with the mode's globals", async () => {
    const { project, url } = await createRun(['a'], {}, 'workers: 1')
    const { options, record } = fakeBrowser({}, { read: { options: { a: twoModes } } })

    await runCli(['update'], {}, project, options)

    expect(record.viewports).toEqual([
      { width: 1280, height: 900, deviceScaleFactor: 1, touch: false },
      { width: 1280, height: 900, deviceScaleFactor: 1, touch: false },
      { width: 375, height: 900, deviceScaleFactor: 2, touch: true },
    ])
    expect(record.urls).toEqual([
      previewOf(url),
      `${url}/iframe.html?id=a&viewMode=story`,
      `${url}/iframe.html?id=a&viewMode=story&globals=theme%3Adark`,
      `${url}/iframe.html?id=a&viewMode=story`,
    ])
  })

  it("writes each mode's baseline as <story-id>.<mode>.png in update, with the mode's own capture", async () => {
    const { project, folder } = await createRun(['a'])
    const { options } = fakeBrowser({ a: darkStory }, { read: { options: { a: twoModes } } })
    const result = await runCli(['update'], {}, project, options)

    expect(result).toEqual({
      exitCode: 0,
      stdout: printed(
        headerOf('update', 3),
        '✓ web  a  written: missing',
        '✓ web  a  dark  written: missing',
        '✓ web  a  mobile  written: missing',
        '3 written',
        'written .visual-check/baselines/a.png',
        'written .visual-check/baselines/a.dark.png',
        'written .visual-check/baselines/a.mobile.png',
      ),
      stderr: '',
    })
    expect(readdirSync(folder).sort()).toEqual(['a.dark.png', 'a.mobile.png', 'a.png'])
    expect(new Uint8Array(readFileSync(join(folder, 'a.dark.png')))).toEqual(darkSnapshot)
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(defaultSnapshot)
  })

  it('takes every snapshot of a story --filter selects', async () => {
    const { project } = await createRun(['a', 'b'], {
      a: otherSnapshot,
      'a.dark': otherSnapshot,
      'a.mobile': otherSnapshot,
      b: otherSnapshot,
      'b.dark': otherSnapshot,
      'b.mobile': otherSnapshot,
    })
    const { options } = fakeBrowser({}, { read: { options: { a: twoModes, b: twoModes } } })
    const result = await runCli(['update', '--filter', '^a$'], {}, project, options)

    expect(result.stdout).toBe(
      printed(
        headerOf('update', 3),
        '✓ web  a  written: differs: 100 differ, 20 allowed',
        '✓ web  a  dark  written: differs: 100 differ, 20 allowed',
        '✓ web  a  mobile  written: differs: 100 differ, 80 allowed (20 at scale 2)',
        '3 written',
        'written .visual-check/baselines/a.png',
        'written .visual-check/baselines/a.dark.png',
        'written .visual-check/baselines/a.mobile.png',
      ),
    )
  })
})

/**
 * A story ID with `é` as one code point, as NFC encodes it.
 */
const composedId = 'café--primary'.normalize('NFC')

/**
 * The same story ID with `é` as `e` and a combining acute accent, as NFD encodes it. macOS takes both for one file.
 */
const decomposedId = composedId.normalize('NFD')

/**
 * A story ID over 240 bytes, whose baseline's name is shortened.
 */
const longId = `components-${'very-long-'.repeat(25)}story`

/**
 * Gives the shortened stem of an ASCII key over 240 bytes: its first 223 characters, `-` and the first 16 hex
 * characters of its SHA-256.
 */
function shortenedStemOf(key: string): string {
  return `${key.slice(0, 223)}-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`
}

/**
 * Builds the line a run prints for two snapshots of the Storybook whose baselines would be the file.
 */
function clashLineOf(storybook: string, file: string, first: string, second: string): string {
  return `Storybook ${storybook} has two snapshots whose baselines would be one file, ${file}: ${first} and ${second}.`
}

/**
 * The note after a clash's line when the two keys differ only once folded.
 */
const foldedNamesNote = 'Their names differ only in letter case or in how an accented letter is encoded.'

/**
 * The fix the problem for clashing baselines ends with.
 */
const clashFix = 'Rename one of the stories or modes, then run visual-check again.'

describe('runCli baseline file names', () => {
  it('exits 2 in test, before any capture or clearing the report, for two story IDs that differ only in encoding', async () => {
    const { project, folder } = await createRun([composedId, decomposedId])
    const image = writeStaleReport(project)
    const { options, record } = fakeBrowser()
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: printed(clashLineOf('web', `${composedId}.png`, composedId, decomposedId), foldedNamesNote, clashFix),
    })
    expect(storyIdsOf(record.urls)).toEqual([])
    expect(existsSync(image)).toBe(true)
    expect(existsSync(folder)).toBe(false)
  })

  it('exits 2 in update, writing no baseline, for two story IDs that differ only in encoding', async () => {
    const { project, folder } = await createRun([composedId, decomposedId])
    const { options, record } = fakeBrowser()
    const result = await runCli(['update'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: printed(clashLineOf('web', `${composedId}.png`, composedId, decomposedId), foldedNamesNote, clashFix),
    })
    expect(storyIdsOf(record.urls)).toEqual([])
    expect(existsSync(folder)).toBe(false)
  })

  it("exits 2 when a mode's baseline would be another story's, naming the mode, whatever the selection", async () => {
    const { project } = await createRun(['a', 'b', 'a.dark'])
    const { options, record } = fakeBrowser({}, { read: { options: { a: { modes: { dark: {} } } } } })
    const result = await runCli(['update', '--filter', '^b$'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: printed(clashLineOf('web', 'a.dark.png', 'a in mode dark', 'a.dark'), clashFix),
    })
    expect(storyIdsOf(record.urls)).toEqual([])
  })

  it("exits 2 when the key of a story whose stories file didn't load clashes with another story's", async () => {
    const { project } = await createRun(['a', 'A'], {}, '', { a: './a.stories.tsx' })
    const { options, record } = fakeBrowser({}, { read: { failed: { './a.stories.tsx': 'Boom' } } })
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: printed(clashLineOf('web', 'a.png', 'a', 'A'), foldedNamesNote, clashFix),
    })
    expect(storyIdsOf(record.urls)).toEqual([])
  })

  it("names each Storybook's first clash in config order, after saying the browser relaunched", async () => {
    const web = await startStorybook(['a', 'A', 'b', 'B'])
    const docs = await startStorybook([composedId, decomposedId])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${docs}' } } }\n`,
      'web/button.stories.tsx': '',
      'docs/button.stories.tsx': '',
    })
    const { options } = fakeBrowser({}, { read: { exitingBrowsers: [1] } })
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        relaunchNotice +
        printed(
          clashLineOf('web', 'a.png', 'a', 'A'),
          foldedNamesNote,
          clashLineOf('docs', `${composedId}.png`, composedId, decomposedId),
          foldedNamesNote,
          clashFix,
        ),
    })
  })

  it('names the report images of a long-ID story that differs after its shortened stem in test', async () => {
    const stem = shortenedStemOf(longId)
    const { project } = await createRun([longId], { [stem]: otherSnapshot })
    const result = await runCli(['test'], {}, project, fakeBrowser().options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(headerOf('test', 1), `✗ web  ${longId}  differs: 100 differ, 20 allowed`, '0 passed · 1 differs'),
      stderr: '',
    })
    expect(readdirSync(join(reportFolderIn(project), 'images', 'web')).sort()).toEqual([
      `${stem}.baseline.png`,
      `${stem}.diff.png`,
      `${stem}.snapshot.png`,
    ])
  })

  it('writes the baseline of a story with a long ID under its shortened name in update', async () => {
    const shortened = `${shortenedStemOf(longId)}.png`
    const { project, folder } = await createRun([longId])
    const result = await runCli(['update'], {}, project, fakeBrowser().options)

    expect(result).toEqual({
      exitCode: 0,
      stdout: printed(
        headerOf('update', 1),
        `✓ web  ${longId}  written: missing`,
        '1 written',
        `written .visual-check/baselines/${shortened}`,
      ),
      stderr: '',
    })
    expect(readdirSync(folder)).toEqual([shortened])
    expect(new Uint8Array(readFileSync(join(folder, shortened)))).toEqual(defaultSnapshot)
  })
})

/**
 * Installs `storybook` at `version` in the folder, as `node_modules/storybook/package.json`.
 */
function installStorybook(folder: string, version: string): void {
  mkdirSync(join(folder, 'node_modules', 'storybook'), { recursive: true })
  writeFileSync(join(folder, 'node_modules', 'storybook', 'package.json'), JSON.stringify({ version }))
}

/**
 * Builds the warning for a Storybook that seems to ignore the test path, as a run prints it.
 */
function testPathWarningOf(name: string, storybookVersion: string, medianMs: number): string {
  return (
    `Warning: Storybook ${name} (${storybookVersion}) seems to ignore visual-check's StorybookTestRunner user agent: ` +
    `its "completing" render step took a median of ${medianMs} ms, so each capture takes at least 100 ms longer. ` +
    'Snapshots stay correct.\n'
  )
}

describe('runCli warning when a Storybook ignores the test path', () => {
  it('warns once at the end, naming the Storybook and its version, when the median is 50 ms or more', async () => {
    const { project } = await createRun(['a', 'b', 'c'], { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot })

    installStorybook(project, '9.1.2')

    const { options } = fakeBrowser({ a: { completingMs: 101 }, b: { completingMs: 103 }, c: { completingMs: 0 } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(withoutTimes(result.stdout)).toBe(
      printed(headerOf('test', 3), '✓ web  a  N ms', '✓ web  b  N ms', '✓ web  c  N ms', '3 passed'),
    )
    expect(result.stderr).toBe(testPathWarningOf('web', 'storybook 9.1.2', 101))
  })

  it("doesn't warn when the median is below 50 ms", async () => {
    const { project } = await createRun(['a', 'b', 'c'], { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot })

    installStorybook(project, '9.1.2')

    const { options } = fakeBrowser({ a: { completingMs: 0 }, b: { completingMs: 49 }, c: { completingMs: 120 } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('warns for each Storybook in config order, whatever the exit code', async () => {
    const web = await startStorybook(['a', 'b'])
    const docs = await startStorybook(['c'])
    const quick = await startStorybook(['d'])
    const project = createProject({
      'visual-check.config.mjs':
        `export default { storybooks: { web: { dir: 'web', url: '${web}' }, ` +
        `docs: { dir: 'docs', url: '${docs}' }, quick: { dir: 'quick', url: '${quick}' } } }\n`,
      'web/button.stories.tsx': '',
      'docs/button.stories.tsx': '',
      'quick/button.stories.tsx': '',
      'web/.visual-check/baselines/a.png': otherSnapshot,
      'web/.visual-check/baselines/b.png': otherSnapshot,
      'docs/.visual-check/baselines/c.png': otherSnapshot,
      'quick/.visual-check/baselines/d.png': otherSnapshot,
    })

    installStorybook(join(project, 'web'), '10.0.1')
    installStorybook(join(project, 'quick'), '10.0.1')

    const { options } = fakeBrowser({
      a: { completingMs: 110 },
      b: { completingMs: 130 },
      c: { completingMs: 104 },
      d: { completingMs: 1 },
    })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('0 passed · 4 differs')
    expect(result.stderr).toBe(
      testPathWarningOf('web', 'storybook 10.0.1', 120) +
        testPathWarningOf('docs', 'its storybook version is unknown', 104),
    )
  })

  it('warns after an update too', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultSnapshot })

    installStorybook(project, '9.1.2')

    const { options } = fakeBrowser({ a: { completingMs: 100 }, b: { completingMs: 120 } })
    const result = await runCli(['update'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('1 written · 1 kept')
    expect(result.stderr).toBe(testPathWarningOf('web', 'storybook 9.1.2', 110))
  })

  it("leaves out broken stories' times", async () => {
    const { project } = await createRun(['a', 'b', 'c'], { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot })

    installStorybook(project, '9.1.2')

    const { options } = fakeBrowser({
      a: { completingMs: 0 },
      b: { completingMs: 200, broken: true },
      c: { completingMs: 200, broken: true },
    })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('')
  })

  it('warns after the version warnings and the notice of a browser exit', async () => {
    const { project } = await createRun(
      ['a', 'b', 'c'],
      { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot },
      'workers: 1',
    )

    installStorybook(project, '12.0.0')

    const { options } = fakeBrowser({
      a: { completingMs: 100 },
      b: { completingMs: 100, browserExits: true },
      c: { completingMs: 100 },
    })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe(
      'Warning: Storybook web runs storybook 12.0.0, and visual-check supports 9.1 to 11. The run carries on.\n' +
        relaunchNotice +
        testPathWarningOf('web', 'storybook 12.0.0', 100),
    )
  })

  it("doesn't warn when the run stops with exit 2", async () => {
    const { project } = await createRun(
      ['a', 'b', 'c', 'd'],
      { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot, d: defaultSnapshot },
      'workers: 1',
    )

    installStorybook(project, '9.1.2')

    const { options } = fakeBrowser({
      a: { completingMs: 100 },
      b: { browserExits: true },
      c: { completingMs: 100 },
      d: { browserExits: true },
    })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toBe(`${relaunchNotice}${secondExitMessage}`)
  })
})

describe('runCli launching the browser', () => {
  it("launches the browser package's image and headless shell, and writes the pull's progress", async () => {
    const { project } = await createRun(['a'])
    const { options, record, progress } = fakeBrowser()

    await runCli(['update'], {}, project, options)

    expect(record.launches).toEqual([
      {
        in: 'container',
        image: browserPackage.imageReference,
        platform: 'linux/amd64',
        route: 'host',
        executable: browserPackage.headlessShell,
        progress: expect.any(Function),
      },
    ])
    expect(progress).toEqual([`Pulling ${browserPackage.imageReference}\n`])
  })

  it.each([
    ['Docker Desktop on Linux', { probeDocker: desktopProbe }, 'proxy'],
    ['macOS without Docker Desktop', { os: 'darwin' }, 'proxy'],
    ['Linux without Docker Desktop', {}, 'host'],
    [
      'a container Docker knows, which beats Docker Desktop',
      { probeDocker: desktopProbe, findKnownContainer: async () => containerId },
      `container:${containerId}`,
    ],
  ] satisfies [string, RunCliOptions, ContainerRoute][])(
    'routes the browser for %s',
    async (_case, overrides, route) => {
      const { project } = await createRun(['a'])
      const { options, record } = fakeBrowser()

      await runCli(['update'], {}, project, { ...options, ...overrides })

      expect(record.launches).toMatchObject([{ in: 'container', route }])
    },
  )

  it("launches the config's image on the config's platform", async () => {
    const { project } = await createRun(['a'], {}, "image: 'example.com/chromium:custom', platform: 'linux/arm64'")
    const { options, record } = fakeBrowser()

    await runCli(['update'], {}, project, options)

    expect(record.launches).toMatchObject([{ image: 'example.com/chromium:custom', platform: 'linux/arm64' }])
  })

  it('sets every page up as the config says', async () => {
    const { project } = await createRun(
      ['a'],
      {},
      "viewport: { width: 800, height: 600, deviceScaleFactor: 2, touch: true }, timezone: 'Europe/Warsaw', locale: 'pl-PL', colorScheme: 'dark'",
    )
    const { options, record } = fakeBrowser()

    await runCli(['update'], {}, project, options)

    expect(record.viewports).toEqual([{ width: 800, height: 600, deviceScaleFactor: 2, touch: true }])
    expect(record.setups).toMatchObject([
      { timezone: 'Europe/Warsaw', locale: 'pl-PL', colorScheme: 'dark' },
      { timezone: 'Europe/Warsaw', locale: 'pl-PL', colorScheme: 'dark' },
    ])
  })

  it("exits 2 when the browser isn't the browser package's build, naming both versions", async () => {
    const { project } = await createRun(['a', 'b', 'c'])
    const { options, record } = fakeBrowser({}, { version: '156.0.7000.1' })
    const result = await runCli(['update'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: printed(
        `The browser in ${browserPackage.imageReference} is Chromium 156.0.7000.1, but the browser package ` +
          `@visual-check/chromium ${browserPackage.packageVersion} names Chromium ${browserPackage.chromium}.`,
        'Reinstall the browser package @visual-check/chromium, then run visual-check again.',
      ),
    })
    expect(record.launches).toHaveLength(1)
    expect(record.urls).toEqual([])
    expect(record.driverCloses).toBe(1)
  })

  it("says to rebuild a custom image FROM the browser package's image when its browser is another build", async () => {
    const { project } = await createRun(['a'], {}, "image: 'example.com/chromium:custom'")
    const result = await runCli(['update'], {}, project, fakeBrowser({}, { version: '156.0.7000.1' }).options)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toBe(
      printed(
        'The browser in example.com/chromium:custom is Chromium 156.0.7000.1, but the browser package ' +
          `@visual-check/chromium ${browserPackage.packageVersion} names Chromium ${browserPackage.chromium}.`,
        `Rebuild example.com/chromium:custom FROM ${browserPackage.imageReference}.`,
      ),
    )
  })

  it("exits 2 with the next step and the browser's last output when it fails to launch", async () => {
    const { project } = await createRun(['a', 'b', 'c'], {
      a: defaultSnapshot,
      b: defaultSnapshot,
      c: defaultSnapshot,
    })
    const error = new BrowserLaunchError(
      'The browser exited with code 127 before it answered.',
      ['exec: not found', 'bye'],
      { exited: true },
    )
    let launches = 0
    const options: RunCliOptions = {
      ...hostOptions,
      launchBrowser: () => {
        launches += 1

        return Promise.reject(error)
      },
    }

    expect(await runCli(['test'], {}, project, options)).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: printed(
        'The browser exited with code 127 before it answered.',
        "The browser's output below may say why. Check that Docker can run images for linux/amd64, then run " +
          'visual-check again.',
        "The browser's last output:",
        '  exec: not found',
        '  bye',
      ),
    })
    expect(launches).toBe(1)
  })

  it("names the config's platform in the next step when the browser fails to launch without output", async () => {
    const { project } = await createRun(['a'], { a: defaultSnapshot }, "platform: 'linux/arm64'")
    const error = new BrowserLaunchError("The browser didn't answer its version call within 30 s.", [], {
      exited: false,
    })

    expect((await runCli(['test'], {}, project, failingLaunch(error))).stderr).toBe(
      printed(
        "The browser didn't answer its version call within 30 s.",
        'Check that Docker can run images for linux/arm64, then run visual-check again.',
      ),
    )
  })

  it('exits 2 at once when the Docker probe fails, before it reads a Storybook or launches a browser', async () => {
    const down = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${down}' } } }\n`,
    })
    const probeDocker = () => Promise.reject(new ContainerError("Docker's daemon isn't running."))

    expect(await runCli(['test'], {}, project, { ...noLaunch, probeDocker })).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: printed(
        "Docker's daemon isn't running.",
        "Start or install Docker, or set platform: 'host' in the config.",
      ),
    })
  })

  it('asks for Linux containers without the both-fixes line when the probe finds Windows containers', async () => {
    const { project } = await createRun(['a'])
    const probeDocker = () =>
      Promise.reject(new ContainerError('Switch Docker to Linux containers.', 'linux-containers'))

    expect(await runCli(['test'], {}, project, { ...noLaunch, probeDocker, insideContainer: true })).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: printed('Switch Docker to Linux containers.'),
    })
  })

  it("names the browser package's image as the job container when the probe fails inside a container", async () => {
    const { project } = await createRun(['a'])
    const probeDocker = () => Promise.reject(new ContainerError('No docker command.'))
    const result = await runCli(['test'], {}, project, { ...noLaunch, probeDocker, insideContainer: true })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toBe(
      printed(
        'No docker command.',
        "Start or install Docker, or set platform: 'host' in the config.",
        `Inside a container, run visual-check in a job container on visual-check's image, ${browserPackage.imageReference}, which needs no Docker.`,
      ),
    )
  })

  it("names the config's image as the job container when it sets one", async () => {
    const { project } = await createRun(['a'], {}, "image: 'example.com/my-chromium:1'")
    const probeDocker = () => Promise.reject(new ContainerError('No docker command.'))
    const result = await runCli(['test'], {}, project, { ...noLaunch, probeDocker, insideContainer: true })

    expect(result.stderr).toContain("visual-check's image, example.com/my-chromium:1, which needs no Docker.\n")
  })

  it('ends a failed pull with both fixes, and with the job container inside a container', async () => {
    const { project } = await createRun(['a'])
    const error = new ContainerError('docker pull of example.com/chromium for linux/amd64 failed with exit code 1.')
    const result = await runCli(['update'], {}, project, { ...failingLaunch(error), insideContainer: true })

    expect(result.stderr).toBe(
      printed(
        'docker pull of example.com/chromium for linux/amd64 failed with exit code 1.',
        "Start or install Docker, or set platform: 'host' in the config.",
        `Inside a container, run visual-check in a job container on visual-check's image, ${browserPackage.imageReference}, which needs no Docker.`,
      ),
    )
  })

  it("exits 2 with Docker's message when the image can't be pulled", async () => {
    const { project } = await createRun(['a'])
    const error = new ContainerError('docker pull of example.com/chromium for linux/amd64 failed with exit code 1.')

    expect(await runCli(['update'], {}, project, failingLaunch(error))).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: printed(
        'docker pull of example.com/chromium for linux/amd64 failed with exit code 1.',
        "Start or install Docker, or set platform: 'host' in the config.",
      ),
    })
  })

  it("exits 2 with the message alone when the browser can't reach the proxy, even inside a container", async () => {
    const { project } = await createRun(['a'])
    const message = "The browser can't reach the proxy.\nThis runtime has no host.docker.internal."
    const error = new ContainerError(message, 'tested-runtimes')

    expect(await runCli(['update'], {}, project, { ...failingLaunch(error), insideContainer: true })).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: `${message}\n`,
    })
  })

  it('breaks the story in flight when the browser exits, relaunches it for the rest, and exits 1', async () => {
    const { project } = await createRun(
      ['a', 'b', 'c'],
      { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot },
      'workers: 1',
    )
    const { options, record } = fakeBrowser({ b: { browserExits: true } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(withoutTimes(result.stdout)).toBe(
      printed(
        headerOf('test', 3, 1),
        '✓ web  a  N ms',
        `! web  b  ${browserExitedDetail}`,
        '✓ web  c  N ms',
        '2 passed · 1 broken',
      ),
    )
    expect(result.stderr).toBe(relaunchNotice)
    expect(record.launches).toHaveLength(2)
    expect(record.events).toEqual([
      'close page on 1',
      'a on 1',
      'b on 1',
      'c on 2',
      'close page on 2',
      'close 1',
      'close 2',
    ])
  })

  it('breaks every story in flight when the browser exits, and captures the rest in one relaunched browser', async () => {
    const { project } = await createRun(
      ['a', 'b', 'c', 'd'],
      { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot, d: defaultSnapshot },
      'workers: 2',
    )
    const { options, record } = fakeBrowser({
      a: { waitsFor: 'b' },
      b: { browserExits: true, waitsForCapturing: ['a'] },
    })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(withoutTimes(result.stdout)).toBe(
      printed(
        headerOf('test', 4, 2),
        `! web  a  ${browserExitedDetail}`,
        `! web  b  ${browserExitedDetail}`,
        '✓ web  c  N ms',
        '✓ web  d  N ms',
        '2 passed · 2 broken',
      ),
    )
    expect(result.stderr).toBe(relaunchNotice)
    expect(record.launches).toHaveLength(2)
    expect(record.events.filter((event) => !event.startsWith('close')).sort()).toEqual([
      'a on 1',
      'b on 1',
      'c on 2',
      'd on 2',
    ])
    expect(record.events.slice(-2)).toEqual(['close 1', 'close 2'])
    expect(record.driverCloses).toBe(2)
  })

  it('launches the browser twice in all when several workers are capturing as it exits', async () => {
    const { project } = await createRun(['a', 'b', 'c', 'd', 'e', 'f'], {}, 'workers: 3')
    const { options, record } = fakeBrowser({
      a: { waitsFor: 'b' },
      b: { browserExits: true, waitsForCapturing: ['a', 'c'] },
      c: { waitsFor: 'b' },
    })
    const result = await runCli(['update'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe(
      printed(
        headerOf('update', 6, 3),
        `! web  a  ${browserExitedDetail}`,
        `! web  b  ${browserExitedDetail}`,
        `! web  c  ${browserExitedDetail}`,
        '✓ web  d  written: missing',
        '✓ web  e  written: missing',
        '✓ web  f  written: missing',
        '3 written · 3 broken',
        'written .visual-check/baselines/d.png',
        'written .visual-check/baselines/e.png',
        'written .visual-check/baselines/f.png',
      ),
    )
    expect(record.launches).toHaveLength(2)
    expect(record.driverCloses).toBe(2)
  })

  it('relaunches the browser at the next story when it exits between stories, breaking none', async () => {
    const { project } = await createRun(
      ['a', 'b', 'c'],
      { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot },
      'workers: 1',
    )
    const { options, record } = fakeBrowser({ a: { browserExitsAfter: true } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(withoutTimes(result.stdout)).toBe(
      printed(headerOf('test', 3, 1), '✓ web  a  N ms', '✓ web  b  N ms', '✓ web  c  N ms', '3 passed'),
    )
    expect(result.stderr).toBe(relaunchNotice)
    expect(record.events).toEqual([
      'close page on 1',
      'a on 1',
      'close page on 1',
      'b on 2',
      'c on 2',
      'close page on 2',
      'close 1',
      'close 2',
    ])
  })

  it("says the browser wasn't relaunched when it exits after the last story", async () => {
    const { project } = await createRun(['a', 'b'], {}, 'workers: 1')
    const { options, record } = fakeBrowser({ b: { browserExitsAfter: true } })
    const result = await runCli(['update'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe(
      printed(
        'The browser was killed by signal SIGKILL while in use.',
        "No story left needed a capture, so visual-check didn't relaunch the browser.",
        "The browser's last output:",
        '  Out of memory',
        '  bye from browser 1',
      ),
    )
    expect(record.launches).toHaveLength(1)
  })

  it('exits 2 when the relaunched browser exits too, keeping the lines of the snapshots that finished', async () => {
    const { project } = await createRun(
      ['a', 'b', 'c', 'd', 'e'],
      { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot, d: defaultSnapshot, e: defaultSnapshot },
      'workers: 1',
    )
    const { options, record } = fakeBrowser({ b: { browserExits: true }, d: { browserExits: true } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(2)
    expect(withoutTimes(result.stdout)).toBe(
      printed(headerOf('test', 5, 1), '✓ web  a  N ms', `! web  b  ${browserExitedDetail}`, '✓ web  c  N ms'),
    )
    expect(result.stderr).toBe(`${relaunchNotice}${secondExitMessage}`)
    expect(record.launches).toHaveLength(2)
    expect(storyIdsOf(record.urls)).toEqual(['a', 'b', 'c', 'd'])
    expect(record.driverCloses).toBe(2)
  })

  it('exits 2 when the relaunched browser exits with several workers capturing, keeping the lines that finished', async () => {
    const { project } = await createRun(
      ['a', 'b', 'c', 'd', 'e'],
      { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot, d: defaultSnapshot, e: defaultSnapshot },
      'workers: 2',
    )
    const { options, record } = fakeBrowser({
      a: { waitsFor: 'b' },
      b: { browserExits: true, waitsForCapturing: ['a'] },
      d: { browserExits: true, waitsForCapturing: ['e'] },
      e: { waitsFor: 'd' },
    })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(2)
    expect(withoutTimes(result.stdout)).toBe(
      printed(
        headerOf('test', 5, 2),
        `! web  a  ${browserExitedDetail}`,
        `! web  b  ${browserExitedDetail}`,
        '✓ web  c  N ms',
      ),
    )
    expect(result.stderr).toBe(`${relaunchNotice}${secondExitMessage}`)
    expect(record.events.filter((event) => !event.startsWith('close')).sort()).toEqual([
      'a on 1',
      'b on 1',
      'c on 2',
      'd on 2',
      'e on 2',
    ])
    expect(record.launches).toHaveLength(2)
    expect(record.driverCloses).toBe(2)
  })

  it('exits 2 when the relaunched browser has exited before the next story', async () => {
    const { project } = await createRun(
      ['a', 'b', 'c'],
      { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot },
      'workers: 1',
    )
    const { options, record } = fakeBrowser({ a: { browserExitsAfter: true }, b: { browserExitsAfter: true } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(2)
    expect(withoutTimes(result.stdout)).toBe(printed(headerOf('test', 3, 1), '✓ web  a  N ms', '✓ web  b  N ms'))
    expect(result.stderr).toBe(`${relaunchNotice}${secondExitMessage}`)
    expect(record.launches).toHaveLength(2)
    expect(storyIdsOf(record.urls)).toEqual(['a', 'b'])
  })

  it('exits 2 when the relaunch fails with several workers waiting, keeping the lines that finished', async () => {
    const { project } = await createRun(
      ['a', 'b', 'c', 'd'],
      { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot, d: defaultSnapshot },
      'workers: 2',
    )
    const record = newRecord()
    const error = new BrowserLaunchError('The browser exited with code 127 before it answered.', ['exec: not found'], {
      exited: true,
    })
    const launchBrowser: LaunchBrowser = async (launch) => {
      record.launches.push(launch)

      if (record.launches.length > 1) {
        throw error
      }

      return fakeDriverOf({
        stories: { a: { waitsFor: 'b' }, b: { browserExits: true, waitsForCapturing: ['a'] } },
        record,
        version: browserPackage.chromium,
      })
    }
    const result = await runCli(['test'], {}, project, {
      ...hostOptions,
      launchBrowser,
      imageMarkerPath: absentMarkerPath,
    })

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe(
      printed(headerOf('test', 4, 2), `! web  a  ${browserExitedDetail}`, `! web  b  ${browserExitedDetail}`),
    )
    expect(result.stderr).toBe(
      relaunchNotice +
        printed(
          'The browser exited with code 127 before it answered.',
          "The browser's output below may say why. Check that Docker can run images for linux/amd64, then run " +
            'visual-check again.',
          "The browser's last output:",
          '  exec: not found',
        ),
    )
    expect(record.launches).toHaveLength(2)
    expect(record.driverCloses).toBe(1)
  })

  describe("when the browser exits because the machine can't run the platform", () => {
    /**
     * What a run prints for the amd64 platform problem, ahead of the browser's output.
     */
    const amd64Problem =
      "The browser exited before its first capture because its graphics process can't start: this machine can't run " +
      'linux/amd64, as happens when Docker emulates it with QEMU.\n' +
      "Turn on Rosetta in your Docker runtime, or set platform to 'linux/arm64' in the config, which changes it for " +
      'the whole project.\n'

    /**
     * The browser's last output lines in these runs.
     */
    const emulatedOutput = ['qemu: uncaught target signal 5 (Trace/breakpoint trap) - core dumped', 'bye']

    /**
     * What a run prints for the browser's output, after the platform problem.
     */
    const outputBlock = `The browser's last output:\n${emulatedOutput.map((line) => `  ${line}\n`).join('')}`

    /**
     * A launch that fails with a browser whose graphics process couldn't start.
     */
    const launchError = new BrowserLaunchError('The browser exited with code 133 before it answered.', emulatedOutput, {
      exited: true,
      graphicsFailed: true,
    })

    /**
     * A story whose capture the browser exits on, saying its graphics process couldn't start.
     */
    const emulatedExit: FakeStory = { browserExits: true, exitOutput: emulatedOutput, graphicsFailed: true }

    it('exits 2 with the platform problem when the launch fails', async () => {
      const { project } = await createRun(['a'], { a: defaultSnapshot })
      const result = await runCli(['test'], {}, project, failingLaunch(launchError))

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toBe(`${amd64Problem}${outputBlock}`)
    })

    it('exits 2 with the platform problem when the browser exits on the first capture', async () => {
      const { project } = await createRun(['a'], { a: defaultSnapshot }, 'workers: 1')
      const { options } = fakeBrowser({ a: emulatedExit })
      const result = await runCli(['test'], {}, project, options)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toBe(`${amd64Problem}${outputBlock}`)
    })

    it('breaks the story and relaunches as for any exit when the browser exits after another capture finished', async () => {
      const { project } = await createRun(
        ['a', 'b', 'c'],
        { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot },
        'workers: 1',
      )
      const { options, record } = fakeBrowser({ b: emulatedExit })
      const result = await runCli(['test'], {}, project, options)

      expect(result.exitCode).toBe(1)
      expect(withoutTimes(result.stdout)).toBe(
        printed(
          headerOf('test', 3, 1),
          '✓ web  a  N ms',
          `! web  b  ${browserExitedDetail}`,
          '✓ web  c  N ms',
          '2 passed · 1 broken',
        ),
      )
      expect(result.stderr).toContain('visual-check relaunches it once for the rest of the run.')
      expect(result.stderr).not.toContain("this machine can't run")
      expect(record.launches).toHaveLength(2)
    })

    it("doesn't relaunch the browser when it exits before any capture saying this machine can't run the platform", async () => {
      const { project } = await createRun(['a', 'b'], { a: defaultSnapshot, b: defaultSnapshot }, 'workers: 2')
      const { options, record } = fakeBrowser({
        a: { ...emulatedExit, waitsForCapturing: ['b'] },
        b: { ...emulatedExit, waitsForCapturing: ['a'] },
      })
      const result = await runCli(['test'], {}, project, options)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toBe(`${amd64Problem}${outputBlock}`)
      expect(record.launches).toHaveLength(1)
    })

    it("gives the platform problem for the config's platform inside visual-check's image", async () => {
      const { project } = await createRun(['a'], { a: defaultSnapshot })
      const result = await runCli(['test'], {}, project, {
        ...failingLaunch(launchError),
        imageMarkerPath: writeMarker(markerOf('amd64')),
      })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toBe(`${amd64Problem}${outputBlock}`)
    })

    it("gives the usual message inside visual-check's image for platform 'host'", async () => {
      const { project } = await createRun(['a'], { a: defaultSnapshot }, "platform: 'host'")
      const result = await runCli(['test'], {}, project, {
        ...failingLaunch(launchError),
        imageMarkerPath: writeMarker(markerOf('amd64')),
      })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('Check that')
      expect(result.stderr).not.toContain("this machine can't run")
    })

    it('gives the platform problem when a launch rejects with the exit of the browser, as the proxy check does', async () => {
      const { project } = await createRun(['a'], { a: defaultSnapshot })
      const exited = new BrowserExitedError({ code: 133, signal: null, error: undefined }, emulatedOutput, true)
      const result = await runCli(['test'], {}, project, failingLaunch(exited))

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toBe(`${amd64Problem}${outputBlock}`)
    })

    it('gives the platform problem for `update` when the browser exits before any capture', async () => {
      const { project } = await createRun(['a'], {}, 'workers: 1')
      const { options } = fakeBrowser({ a: emulatedExit })
      const result = await runCli(['update'], {}, project, options)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toBe(`${amd64Problem}${outputBlock}`)
    })

    it('gives the platform problem when a story before the exit was broken, as it has no capture', async () => {
      const { project } = await createRun(['a', 'b'], { a: defaultSnapshot, b: defaultSnapshot }, 'workers: 1')
      const { options } = fakeBrowser({ a: { broken: true }, b: emulatedExit })
      const result = await runCli(['test'], {}, project, options)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toBe(`${amd64Problem}${outputBlock}`)
    })

    it('gives the platform problem when a story before the exit has no baseline, as it has no capture', async () => {
      const { project } = await createRun(['a', 'b'], { b: defaultSnapshot }, 'workers: 1')
      const { options } = fakeBrowser({ b: emulatedExit })
      const result = await runCli(['test'], {}, project, options)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toBe(`${amd64Problem}${outputBlock}`)
    })

    it('names linux/amd64 as the fix when the config sets linux/arm64', async () => {
      const { project } = await createRun(['a'], { a: defaultSnapshot }, "platform: 'linux/arm64'")
      const result = await runCli(['test'], {}, project, failingLaunch(launchError))

      expect(result.stderr).toBe(
        "The browser exited before its first capture because its graphics process can't start: this machine can't " +
          'run linux/arm64, as happens when Docker emulates it with QEMU.\n' +
          `Set platform to 'linux/amd64' in the config, which changes it for the whole project.\n${outputBlock}`,
      )
    })
  })

  it('captures with one browser and a page for each worker, printing the lines in selection order', async () => {
    const { project } = await createRun(
      ['a', 'b', 'c'],
      { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot },
      'workers: 2',
    )
    const { options, record } = fakeBrowser({ a: { waitsFor: 'c' } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(withoutTimes(result.stdout)).toBe(
      printed(headerOf('test', 3, 2), '✓ web  a  N ms', '✓ web  b  N ms', '✓ web  c  N ms', '3 passed'),
    )
    expect(result.stderr).toBe('')
    expect(storyIdsOf(record.urls).sort()).toEqual(['a', 'b', 'c'])
    expect(record.events.filter((event) => !event.startsWith('close'))).toEqual(['b on 1', 'c on 1', 'a on 1'])
    expect(record.launches).toHaveLength(1)
    expect(record.setups).toHaveLength(3)
    expect(record.pageCloses).toBe(3)
    expect(record.closed).toBe(true)
  })

  it('opens no more pages than the stories need', async () => {
    const { project } = await createRun(['a'], { a: defaultSnapshot }, 'workers: 3')
    const { options, record } = fakeBrowser()

    await runCli(['test'], {}, project, options)
    expect(record.setups).toHaveLength(2)
    expect(record.reads).toHaveLength(1)
  })

  it("exits 2 for platform 'host' on Windows on Arm before any Storybook, pointing to linux/arm64", async () => {
    const { url, requests } = await startRecordingServer()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } }, platform: 'host' }\n`,
    })
    const windowsOnArm: RunCliOptions = { ...noLaunch, os: 'win32', arch: 'arm64' }

    expect(await runCli(['test'], {}, project, windowsOnArm)).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: printed(
        "Chrome for Testing has no build for Windows on Arm, so platform: 'host' can't run here. " +
          "Set platform to 'linux/arm64' in the config to run the browser in visual-check's container.",
      ),
    })
    expect(requests).toEqual([])
  })

  it("launches the machine's headless shell on the host, sized by the machine and with no Docker", async () => {
    const { project } = await createRun(['a'], {}, "platform: 'host', workers: 'auto'")
    const { options, record, progress } = fakeBrowser()
    let dockerCalls = 0
    const result = await runCli(['update'], hostEnvironment, project, {
      ...options,
      machine: { cpus: 2, memoryBytes: 7e9 },
      os: 'darwin',
      arch: 'arm64',
      probeDocker: async () => {
        dockerCalls += 1

        return { cpus: 4, memoryBytes: 16 * 2 ** 30, desktop: false }
      },
      findKnownContainer: async () => {
        dockerCalls += 1

        return undefined
      },
    })

    expect(result.exitCode).toBe(0)
    expect(firstLineOf(result.stdout)).toBe(headerOf('update', 1, 2))
    expect(record.launches).toEqual([
      {
        in: 'host',
        platform: 'mac-arm64',
        version: browserPackage.chromium,
        sha256: browserPackage.sha256['mac-arm64'],
        packageVersion: browserPackage.packageVersion,
        environment: hostEnvironment,
        progress: expect.any(Function),
      },
    ])
    expect(progress).toEqual([`Downloading Chromium ${browserPackage.chromium}\n`])
    expect(dockerCalls).toBe(0)
  })

  it("exits 2 with the download's message when the headless shell can't be downloaded", async () => {
    const { project } = await createRun(['a'], {}, "platform: 'host'")
    const error = new BrowserDownloadError(
      `The download of Chromium ${browserPackage.chromium} (linux64) failed: ECONNRESET. Run visual-check again.`,
    )

    expect(await runCli(['update'], hostEnvironment, project, failingLaunch(error))).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: printed(error.message),
    })
  })

  it.each([
    ['x64', 'linux64', 'linux/amd64'],
    ['arm64', 'linux-arm64', 'linux/arm64'],
  ] as const)(
    "names the missing library and both fixes on Linux %s, pointing to '%s'",
    async (arch, shell, platform) => {
      const { project } = await createRun(['a'], {}, "platform: 'host'")
      const result = await runCli(['update'], hostEnvironment, project, {
        ...failingLaunch(missingLibraryError()),
        os: 'linux',
        arch,
      })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toBe(
        printed(
          "The browser can't start because libnss3.so is missing.",
          "Install the libraries the headless shell needs, since visual-check doesn't install system packages, or set " +
            `platform to '${platform}' in the config to run the browser in visual-check's container.`,
          `To list every missing library, run: ldd '${hostExecutableOf(shell)}' | grep 'not found'`,
          "The browser's last output:",
          `  ${loaderLine}`,
        ),
      )
    },
  )

  it.each([
    ['container', false, 'Check that Docker can run images for linux/amd64'],
    ["visual-check's image", true, `Check that ${browserPackage.headlessShell} starts in this container`],
  ] as const)(
    'gives the ordinary next step in the %s when the output names a missing library',
    async (_place, inImage, check) => {
      const { project } = await createRun(['a'], { a: defaultSnapshot })
      const result = await runCli(['test'], {}, project, {
        ...failingLaunch(missingLibraryError()),
        ...(inImage ? { imageMarkerPath: writeMarker(markerOf('amd64')) } : {}),
      })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toBe(
        printed(
          'The browser exited with code 127 before it answered.',
          `The browser's output below may say why. ${check}, then run visual-check again.`,
          "The browser's last output:",
          `  ${loaderLine}`,
        ),
      )
    },
  )

  it('names the executable in the next step when the browser fails to launch on the host', async () => {
    const { project } = await createRun(['a'], {}, "platform: 'host'")
    const error = new BrowserLaunchError("The browser didn't answer within 30 s.", [], { exited: false })

    expect((await runCli(['update'], hostEnvironment, project, failingLaunch(error))).stderr).toBe(
      printed(
        "The browser didn't answer within 30 s.",
        `Check that ${hostExecutableOf('linux64')} starts on this machine, then run visual-check again.`,
      ),
    )
  })

  it("names the download's folder and says to remove it when the browser on the host is another build", async () => {
    const { project } = await createRun(['a'], {}, "platform: 'host'")
    const { options } = fakeBrowser({}, { version: '156.0.7000.1' })
    const result = await runCli(['update'], hostEnvironment, project, options)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toBe(
      printed(
        `The browser in ${chromiumFolder} is Chromium 156.0.7000.1, but the browser package ` +
          `@visual-check/chromium ${browserPackage.packageVersion} names Chromium ${browserPackage.chromium}.`,
        `Remove ${chromiumFolder}, then run visual-check again to download it afresh. ` +
          'If it happens again, reinstall the browser package @visual-check/chromium.',
      ),
    )
  })

  it("starts the headless shell directly, with no progress, when the marker of visual-check's image fits", async () => {
    const { project } = await createRun(['a'])
    const { options, record, progress } = fakeBrowser()
    const result = await runCli(['update'], {}, project, {
      ...options,
      imageMarkerPath: writeMarker(markerOf('amd64')),
    })

    expect(result.exitCode).toBe(0)
    expect(record.launches).toEqual([{ in: 'image', executable: browserPackage.headlessShell }])
    expect(progress).toEqual([])
  })

  it("starts the headless shell directly for platform 'host' inside visual-check's image", async () => {
    const { project } = await createRun(['a'], {}, "platform: 'host'")
    const { options, record } = fakeBrowser()

    const result = await runCli(['update'], {}, project, {
      ...options,
      imageMarkerPath: writeMarker(markerOf('arm64')),
    })

    expect(result.exitCode).toBe(0)
    expect(record.launches).toEqual([{ in: 'image', executable: browserPackage.headlessShell }])
  })

  it.each([
    ['linux/amd64', ''],
    ['host', "platform: 'host'"],
  ])(
    "never probes Docker or looks for a container inside visual-check's image, for platform %s",
    async (_platform, config) => {
      const { project } = await createRun(['a'], {}, config)
      const { options, record } = fakeBrowser()
      let probes = 0
      let lookups = 0
      const result = await runCli(['update'], {}, project, {
        ...options,
        probeDocker: async () => {
          probes += 1

          return { cpus: 4, memoryBytes: 16 * 2 ** 30, desktop: true }
        },
        findKnownContainer: async () => {
          lookups += 1

          return containerId
        },
        imageMarkerPath: writeMarker(markerOf('amd64')),
      })

      expect(result.exitCode).toBe(0)
      expect(record.launches).toEqual([{ in: 'image', executable: browserPackage.headlessShell }])
      expect(probes).toBe(0)
      expect(lookups).toBe(0)
    },
  )

  it("exits 2 with the marker's problem before any Storybook request when the image doesn't fit", async () => {
    const { url, requests } = await startRecordingServer()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
    })
    const result = await runCli(['test'], {}, project, { ...noLaunch, imageMarkerPath: writeMarker(markerOf('arm64')) })

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(firstLineOf(result.stderr)).toBe(
      "This container runs visual-check's image for arm64, but the config's platform is linux/amd64.",
    )
    expect(requests).toEqual([])
  })

  it("names the headless shell in the next step when the browser fails to launch inside visual-check's image", async () => {
    const { project } = await createRun(['a'], { a: defaultSnapshot })
    const error = new BrowserLaunchError("The browser didn't answer its version call within 30 s.", [], {
      exited: false,
    })
    const result = await runCli(['test'], {}, project, {
      ...failingLaunch(error),
      imageMarkerPath: writeMarker(markerOf('amd64')),
    })

    expect(result.stderr).toBe(
      printed(
        "The browser didn't answer its version call within 30 s.",
        `Check that ${browserPackage.headlessShell} starts in this container, then run visual-check again.`,
      ),
    )
  })

  it("names this container when the browser inside visual-check's image is another build", async () => {
    const { project } = await createRun(['a'])
    const { options } = fakeBrowser({}, { version: '156.0.7000.1' })
    const result = await runCli(['update'], {}, project, {
      ...options,
      imageMarkerPath: writeMarker(markerOf('amd64')),
    })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toBe(
      printed(
        'The browser in this container is Chromium 156.0.7000.1, but the browser package ' +
          `@visual-check/chromium ${browserPackage.packageVersion} names Chromium ${browserPackage.chromium}.`,
        `Run in ${browserPackage.imageReference}, or rebuild your image FROM it.`,
      ),
    )
  })

  it("exits 2 when a baseline can't be read, keeping the lines printed so far and closing the browser", async () => {
    const { project, folder } = await createRun(
      ['a', 'b', 'c'],
      { a: defaultSnapshot, c: defaultSnapshot },
      'workers: 1',
    )
    const { options, record } = fakeBrowser()

    mkdirSync(join(folder, 'b.png'))

    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(2)
    expect(withoutTimes(result.stdout)).toBe(printed(headerOf('test', 3, 1), '✓ web  a  N ms'))
    expect(result.stderr).toBe(
      printed(
        "visual-check couldn't read the baseline .visual-check/baselines/b.png: EISDIR: illegal operation on a " +
          "directory. Check that it's a file visual-check can read.",
      ),
    )
    expect(record.pageCloses).toBe(2)
    expect(record.closed).toBe(true)
  })

  it('rethrows an error that is a bug, after closing the browser', async () => {
    const { project } = await createRun(['a'])
    const record = newRecord()
    const driver = fakeDriverOf({ stories: {}, record, version: browserPackage.chromium })

    Object.defineProperty(driver, 'version', {
      get: () => {
        throw new Error('A bug in the driver.')
      },
    })

    await expect(
      runCli(['update'], {}, project, {
        ...hostOptions,
        launchBrowser: async () => driver,
        imageMarkerPath: absentMarkerPath,
      }),
    ).rejects.toThrow('A bug in the driver.')
    expect(record.closed).toBe(true)
  })
})
