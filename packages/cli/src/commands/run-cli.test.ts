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
import { afterEach, describe, expect, it } from 'vitest'
import {
  BrowserExitedError,
  BrowserLaunchError,
  type Driver,
  type PageSetup,
  type PageViewport,
} from '../capture/driver/driver.js'
import { ContainerError } from '../container/container-error.js'
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
  }

  return { packageVersion, ...json, imageReference: `${json.image.tag}@${json.image.digest}` }
})()

/**
 * Options that fail the run if it launches a browser, for runs that must stop before the launch.
 */
const noLaunch: RunCliOptions = {
  launchBrowser: () => Promise.reject(new Error('The run launched a browser.')),
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
}

/**
 * Makes an empty record of what a fake browser saw.
 */
function newRecord(): FakeBrowserRecord {
  return { launches: [], urls: [], setups: [], viewports: [], pageCloses: 0, closed: false }
}

/**
 * Builds a fake driver whose pages answer each story, by ID, as `stories` says.
 */
function fakeDriverOf(stories: Record<string, FakeStory>, record: FakeBrowserRecord, driverVersion: string): Driver {
  return {
    version: driverVersion,
    exited: new Promise(() => undefined),
    newPage: async (setup) => {
      let story: FakeStory = {}

      record.setups.push(setup)

      return {
        setViewport: async (viewport) => {
          record.viewports.push(viewport)
        },
        goto: async (url) => {
          record.urls.push(url)
          story = stories[new URL(url).searchParams.get('id') ?? ''] ?? {}
        },
        evaluate: async () => ({ outcome: 'finished', status: story.broken === true ? 'error' : 'success' }),
        captureFullPage: async () => {
          if (story.browserExits === true) {
            throw new BrowserExitedError({ code: null, signal: 'SIGKILL', error: undefined }, ['Out of memory', 'bye'])
          }

          return story.snapshot ?? defaultSnapshot
        },
        close: async () => {
          record.pageCloses += 1
        },
      }
    },
    close: async () => {
      record.closed = true
    },
  }
}

/**
 * Builds options whose launch writes pull progress and gives a fake driver of the given version, answering each story
 * as `stories` says. Returns them with what the fake browser saw.
 */
function fakeBrowser(
  stories: Record<string, FakeStory> = {},
  driverVersion: string = browserPackage.chromium,
): { options: Required<RunCliOptions>; record: FakeBrowserRecord; progress: string[] } {
  const record = newRecord()
  const progress: string[] = []
  const launchBrowser: LaunchBrowser = async (launch) => {
    record.launches.push(launch)
    if (launch.in === 'container') {
      launch.progress(`Pulling ${launch.image}\n`)
    }

    return fakeDriverOf(stories, record, driverVersion)
  }

  return { options: { launchBrowser, progress: (text) => progress.push(text) }, record, progress }
}

/**
 * Builds options whose launch fails with `error`.
 */
function failingLaunch(error: Error): RunCliOptions {
  return { launchBrowser: () => Promise.reject(error) }
}

/**
 * Builds the header a run prints.
 */
function headerOf(command: 'test' | 'update', count: number): string {
  return `visual-check ${version} · ${command} · ${count} ${count === 1 ? 'snapshot' : 'snapshots'} · 1 worker`
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

    expect(await runCli(['update'], { CI: 'true' }, project)).toEqual({
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
    const result = await runCli(['test'], {}, project)

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
    const result = await runCli(['test'], {}, project)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/^Warning: Storybook web runs storybook 12\.0\.0.*\nStorybook web doesn't answer at /)
  })

  it('fails a Storybook older than 9.1 without reaching its index', async () => {
    const { url, requests } = await startRecordingServer()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
      'node_modules/storybook/package.json': JSON.stringify({ version: '9.0.0' }),
    })
    const result = await runCli(['test'], {}, project)

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
    const result = await runCli(['test'], {}, project)

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
    const result = await runCli(['test'], {}, project)

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
    const result = await runCli(['test'], {}, project)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("Storybook web doesn't answer")
    expect(result.stderr).not.toContain('--storybook')
  })

  it('exits 2 with the config error for a broken config', async () => {
    const project = createProject({
      'visual-check.config.mjs': "export default { storybooks: { web: { url: 'http://127.0.0.1:6006' } }, nope: 1 }\n",
    })
    const result = await runCli(['test'], {}, project)

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
    expect(record.urls.map((storyUrl) => new URL(storyUrl).searchParams.get('id'))).toEqual(['a', 'b', 'd', 'e'])
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
        executable: browserPackage.headlessShell,
        progress: expect.any(Function),
      },
    ])
    expect(progress).toEqual([`Pulling ${browserPackage.imageReference}\n`])
  })

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
    const { project } = await createRun(['a'])
    const { options, record } = fakeBrowser({}, '156.0.7000.1')
    const result = await runCli(['update'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: printed(headerOf('update', 1)),
      stderr: printed(
        `The browser in ${browserPackage.imageReference} is Chromium 156.0.7000.1, but the browser package ` +
          `@visual-check/chromium ${browserPackage.packageVersion} names Chromium ${browserPackage.chromium}.`,
        'Reinstall the browser package @visual-check/chromium, then run visual-check again.',
      ),
    })
    expect(record.urls).toEqual([])
    expect(record.closed).toBe(true)
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
    const { project } = await createRun(['a'], { a: defaultSnapshot })
    const error = new BrowserLaunchError('The browser exited with code 127 before it answered.', [
      'exec: not found',
      'bye',
    ])

    expect(await runCli(['test'], {}, project, failingLaunch(error))).toEqual({
      exitCode: 2,
      stdout: printed(headerOf('test', 1)),
      stderr: printed(
        'The browser exited with code 127 before it answered.',
        "The browser's output below may say why. Check that Docker can run images for linux/amd64, then run " +
          'visual-check again.',
        "The browser's last output:",
        '  exec: not found',
        '  bye',
      ),
    })
  })

  it("names the config's platform in the next step when the browser fails to launch without output", async () => {
    const { project } = await createRun(['a'], { a: defaultSnapshot }, "platform: 'linux/arm64'")
    const error = new BrowserLaunchError("The browser didn't answer within 30 s.", [])

    expect((await runCli(['test'], {}, project, failingLaunch(error))).stderr).toBe(
      printed(
        "The browser didn't answer within 30 s.",
        'Check that Docker can run images for linux/arm64, then run visual-check again.',
      ),
    )
  })

  it("exits 2 with Docker's message when the image can't be pulled", async () => {
    const { project } = await createRun(['a'])
    const error = new ContainerError('docker pull of example.com/chromium for linux/amd64 failed with exit code 1.')

    expect(await runCli(['update'], {}, project, failingLaunch(error))).toEqual({
      exitCode: 2,
      stdout: printed(headerOf('update', 1)),
      stderr: printed('docker pull of example.com/chromium for linux/amd64 failed with exit code 1.'),
    })
  })

  it('exits 2 when the browser exits mid-run, keeping the lines printed so far', async () => {
    const { project } = await createRun(['a', 'b', 'c'], { a: defaultSnapshot, b: defaultSnapshot, c: defaultSnapshot })
    const { options, record } = fakeBrowser({ b: { browserExits: true } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(2)
    expect(withoutTimes(result.stdout)).toBe(printed(headerOf('test', 3), '✓ web  a  N ms'))
    expect(result.stderr).toBe(
      printed(
        'The browser was killed by signal SIGKILL while in use.',
        "The browser's output below may say why. Running out of memory is a common cause. Run visual-check again.",
        "The browser's last output:",
        '  Out of memory',
        '  bye',
      ),
    )
    expect(record.urls).toHaveLength(2)
    expect(record.closed).toBe(true)
  })

  it("exits 2 for platform 'host' before reaching any Storybook", async () => {
    const { url, requests } = await startRecordingServer()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } }, platform: 'host' }\n`,
    })

    expect(await runCli(['test'], {}, project, noLaunch)).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: printed(
        "visual-check can't run the browser on the host yet. Set platform to 'linux/amd64' or 'linux/arm64' in the config.",
      ),
    })
    expect(requests).toEqual([])
  })

  it("exits 2 when a baseline can't be read, keeping the lines printed so far and closing the browser", async () => {
    const { project, folder } = await createRun(['a', 'b', 'c'], { a: defaultSnapshot, c: defaultSnapshot })
    const { options, record } = fakeBrowser()

    mkdirSync(join(folder, 'b.png'))

    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(2)
    expect(withoutTimes(result.stdout)).toBe(printed(headerOf('test', 3), '✓ web  a  N ms'))
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
    const driver = fakeDriverOf({}, record, browserPackage.chromium)

    Object.defineProperty(driver, 'version', {
      get: () => {
        throw new Error('A bug in the driver.')
      },
    })

    await expect(runCli(['update'], {}, project, { launchBrowser: async () => driver })).rejects.toThrow(
      'A bug in the driver.',
    )
    expect(record.closed).toBe(true)
  })
})
