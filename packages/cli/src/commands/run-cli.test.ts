import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
import { ContainerError } from '../container/container-error.js'
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
}

/**
 * The snapshot a fake story captures when it gives none.
 */
const defaultSnapshot = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])

/**
 * What the fake browser saw.
 */
interface FakeBrowserRecord {
  /**
   * Every launch, in order.
   */
  launches: BrowserLaunch[]
  /**
   * The URL of every story loaded, in order.
   */
  urls: string[]
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
}

/**
 * Builds a fake driver whose pages answer each story, by ID, as the options say. Once the browser exits, `exited`
 * settles and every call fails with the exit, whose output names the browser.
 */
function fakeDriverOf({ stories, record, version, browser = 1, gates = new Map() }: FakeDriverOptions): Driver {
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
          record.urls.push(url)
          id = new URL(url).searchParams.get('id') ?? ''
          story = stories[id] ?? {}
        },
        evaluate: async () => {
          failIfGone()

          return { outcome: 'finished', status: story.broken === true ? 'error' : 'success' }
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
 * Builds options whose every launch writes pull progress and gives a fresh fake driver of the given version, answering
 * each story as `stories` says. Returns them with what the fake browsers saw.
 */
function fakeBrowser(
  stories: Record<string, FakeStory> = {},
  driverVersion: string = browserPackage.chromium,
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

    return fakeDriverOf({ stories, record, version: driverVersion, browser: record.launches.length, gates })
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
function createProject(files: Record<string, string>): string {
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
 * Starts a server on a free port that answers every request with an index of the given stories. Returns its URL.
 */
async function startStorybook(storyIds: string[]): Promise<string> {
  const entries = Object.fromEntries(
    storyIds.map((id) => [
      id,
      { id, title: 'Button', name: id, importPath: './button.stories.tsx', type: 'story', subtype: 'story' },
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
    })

    expect(firstLineOf((await runCli(['test', '--all'], {}, project, noLaunch)).stdout)).toBe(headerOf('test', 2))
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

    expect(await runCli(['test'], {}, project, noLaunch)).toEqual({
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
        noLaunch,
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
  'render throws, when play leaves unhandled errors, or when a check such as accessibility fails.'

/**
 * The detail of a story in flight when the fake browser exited.
 */
const browserExitedDetail =
  'broken: The browser exited while visual-check captured this story: The browser was killed by signal SIGKILL while ' +
  'in use.'

/**
 * What a run prints on stderr when the first fake browser exited and visual-check relaunches it for the stories left.
 */
const relaunchNotice = printed(
  'The browser was killed by signal SIGKILL while in use.',
  'visual-check relaunches it once for the stories left.',
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
 * a story ID mapped to its baseline's bytes. `config` adds keys to the config. Returns the project, the Storybook's
 * URL and the baselines folder.
 */
async function createRun(
  storyIds: string[],
  baselines: Record<string, Uint8Array> = {},
  config = '',
): Promise<{ project: string; url: string; folder: string }> {
  const url = await startStorybook(storyIds)
  const project = createProject({
    'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } }, ${config} }\n`,
    'button.stories.tsx': '',
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
 * Bytes that differ from `defaultSnapshot`.
 */
const otherSnapshot = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2])

describe('runCli test', () => {
  it("passes a snapshot that holds its baseline's bytes, captured from the story's own page", async () => {
    const { project, url } = await createRun(['button--primary'], { 'button--primary': defaultSnapshot })
    const { options, record } = fakeBrowser()
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(withoutTimes(result.stdout)).toBe(printed(headerOf('test', 1), '✓ web  button--primary  N ms', '1 passed'))
    expect(record.urls).toEqual([`${url}/iframe.html?id=button--primary&viewMode=story`])
    expect(record.pageCloses).toBe(1)
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
        "✗ web  b  differs: the snapshot isn't byte-identical to its baseline",
        missingLineOf('web', 'c'),
        `! web  d  ${brokenDetail}`,
        '✓ web  e  N ms',
        '2 passed · 1 differs · 1 broken · 1 missing',
      ),
    )
    expect(record.urls.map((storyUrl) => new URL(storyUrl).searchParams.get('id')).sort()).toEqual(['a', 'b', 'd', 'e'])
  })

  it('prints the configured number of workers in the header, the noun in the right number', async () => {
    const { project: three } = await createRun(['a'], {}, 'workers: 3')
    const { project: one } = await createRun(['a'], {}, 'workers: 1')
    const { project: pair } = await createRun(['a'], {}, 'workers: { local: 5, ci: 2 }')

    expect(firstLineOf((await runCli(['test'], {}, three, noLaunch)).stdout)).toBe(headerOf('test', 1, 3))
    expect(firstLineOf((await runCli(['test'], {}, one, noLaunch)).stdout)).toBe(headerOf('test', 1, 1))
    expect(firstLineOf((await runCli(['test'], { CI: 'true' }, pair, noLaunch)).stdout)).toBe(headerOf('test', 1, 2))
  })

  it('lets --workers beat the config, whether a number or auto', async () => {
    const { project: five } = await createRun(['a'], {}, 'workers: 5')
    const { project: auto } = await createRun(['a'], {}, "workers: 'auto'")

    expect(firstLineOf((await runCli(['test', '--workers', '2'], {}, five, noLaunch)).stdout)).toBe(
      headerOf('test', 1, 2),
    )
    expect(firstLineOf((await runCli(['test', '--workers', '3'], {}, auto, noLaunch)).stdout)).toBe(
      headerOf('test', 1, 3),
    )
    expect(firstLineOf((await runCli(['test', '--workers', '1'], {}, auto, noLaunch)).stdout)).toBe(
      headerOf('test', 1, 1),
    )
  })

  it("sizes 'auto' workers from the Docker host the probe finds", async () => {
    const { project } = await createRun(['a'], {}, "workers: 'auto'")
    const smallHost = { ...noLaunch, probeDocker: async () => ({ cpus: 2, memoryBytes: 7e9, desktop: false }) }

    expect(firstLineOf((await runCli(['test'], {}, project, noLaunch)).stdout)).toBe(headerOf('test', 1, 4))
    expect(firstLineOf((await runCli(['test'], {}, project, smallHost)).stdout)).toBe(headerOf('test', 1, 2))
  })

  it("sizes 'auto' workers from the machine inside visual-check's image, for any platform", async () => {
    const { project } = await createRun(['a'], {}, "workers: 'auto'")
    const { project: host } = await createRun(['a'], {}, "workers: 'auto', platform: 'host'")
    const inImage = {
      ...noLaunch,
      machine: { cpus: 2, memoryBytes: 7e9 },
      imageMarkerPath: writeMarker(markerOf('amd64')),
    }

    expect(firstLineOf((await runCli(['test'], {}, project, inImage)).stdout)).toBe(headerOf('test', 1, 2))
    expect(firstLineOf((await runCli(['test'], {}, host, inImage)).stdout)).toBe(headerOf('test', 1, 2))
  })

  it('launches no browser when every selected baseline is missing', async () => {
    const { project } = await createRun(['a', 'b'])
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
    expect(record.launches).toEqual([])
  })

  it('prints only the header and the counts when the selection is empty', async () => {
    const { project } = await createRun(['a'])

    expect(await runCli(['test', '--filter', 'nothing'], {}, project, noLaunch)).toEqual({
      exitCode: 0,
      stdout: printed(headerOf('test', 0), '0 passed'),
      stderr: '',
    })
  })
})

describe('runCli update', () => {
  it('writes missing and differing baselines exactly as captured, and leaves an identical one untouched', async () => {
    const { project, folder } = await createRun(['a', 'b', 'c'], { a: defaultSnapshot, b: otherSnapshot })
    const past = new Date('2001-01-01T00:00:00Z')

    utimesSync(join(folder, 'a.png'), past, past)

    const newB = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 3])
    const newC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4])
    const { options } = fakeBrowser({ b: { snapshot: newB }, c: { snapshot: newC } })
    const result = await runCli(['update'], {}, project, options)

    expect(result).toEqual({
      exitCode: 0,
      stdout: printed(
        headerOf('update', 3),
        '✓ web  a  kept',
        '✓ web  b  written .visual-check/baselines/b.png',
        '✓ web  c  written .visual-check/baselines/c.png',
        '2 written · 1 kept',
      ),
      stderr: '',
    })
    expect(new Uint8Array(readFileSync(join(folder, 'b.png')))).toEqual(newB)
    expect(new Uint8Array(readFileSync(join(folder, 'c.png')))).toEqual(newC)
    expect(statSync(join(folder, 'a.png')).mtimeMs).toBe(past.getTime())
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
        '✓ web  c  written .visual-check/baselines/c.png',
        '1 written · 2 broken',
      ),
      stderr: '',
    })
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(otherSnapshot)
    expect(existsSync(join(folder, 'b.png'))).toBe(false)
  })

  it('prints written paths relative to the folder it runs in, with /', async () => {
    const url = await startStorybook(['a'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'packages/web', url: '${url}' } } }\n`,
      'packages/web/button.stories.tsx': '',
    })
    const result = await runCli(['update'], {}, join(project, 'packages'), fakeBrowser().options)

    expect(result.stdout).toContain('✓ web  a  written web/.visual-check/baselines/a.png\n')
    expect(existsSync(join(project, 'packages', 'web', '.visual-check', 'baselines', 'a.png'))).toBe(true)
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
      "viewport: { width: 800, height: 600, deviceScaleFactor: 2 }, timezone: 'Europe/Warsaw', locale: 'pl-PL', colorScheme: 'dark'",
    )
    const { options, record } = fakeBrowser()

    await runCli(['update'], {}, project, options)

    expect(record.viewports).toEqual([{ width: 800, height: 600, deviceScaleFactor: 2 }])
    expect(record.setups).toMatchObject([{ timezone: 'Europe/Warsaw', locale: 'pl-PL', colorScheme: 'dark' }])
  })

  it("exits 2 when the browser isn't the browser package's build, naming both versions", async () => {
    const { project } = await createRun(['a', 'b', 'c'])
    const { options, record } = fakeBrowser({}, '156.0.7000.1')
    const result = await runCli(['update'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: printed(headerOf('update', 3)),
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
    const result = await runCli(['update'], {}, project, fakeBrowser({}, '156.0.7000.1').options)

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
      stdout: printed(headerOf('test', 3)),
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
      stdout: printed(headerOf('update', 1)),
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
      stdout: printed(headerOf('update', 1)),
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
    expect(record.events).toEqual(['a on 1', 'b on 1', 'c on 2', 'close page on 2', 'close 1', 'close 2'])
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
        '✓ web  d  written .visual-check/baselines/d.png',
        '✓ web  e  written .visual-check/baselines/e.png',
        '✓ web  f  written .visual-check/baselines/f.png',
        '3 written · 3 broken',
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
    expect(record.urls).toHaveLength(4)
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
    expect(record.urls).toHaveLength(2)
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
      expect(result.stderr).toContain('visual-check relaunches it once for the stories left.')
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
    expect(record.urls.map((storyUrl) => new URL(storyUrl).searchParams.get('id')).sort()).toEqual(['a', 'b', 'c'])
    expect(record.events.filter((event) => !event.startsWith('close'))).toEqual(['b on 1', 'c on 1', 'a on 1'])
    expect(record.launches).toHaveLength(1)
    expect(record.setups).toHaveLength(2)
    expect(record.pageCloses).toBe(2)
    expect(record.closed).toBe(true)
  })

  it('opens no more pages than the stories need', async () => {
    const { project } = await createRun(['a'], { a: defaultSnapshot }, 'workers: 3')
    const { options, record } = fakeBrowser()

    await runCli(['test'], {}, project, options)
    expect(record.setups).toHaveLength(1)
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
      stdout: printed(headerOf('update', 1)),
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
    const { options } = fakeBrowser({}, '156.0.7000.1')
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
    const { options } = fakeBrowser({}, '156.0.7000.1')
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
    expect(record.pageCloses).toBe(1)
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
