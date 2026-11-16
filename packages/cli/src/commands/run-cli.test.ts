import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { BrowserDownloadError } from '../browser-download/browser-download-error.js'
import { BrowserExitedError, BrowserLaunchError } from '../capture/driver/driver.js'
import { ContainerError } from '../container/container-error.js'
import type { StoriesFile } from '../storybook/options-read.js'
import { greyPng, type PixelChange, whitePixels } from '../visual-diff/images.fixture.js'
import type { ContainerRoute } from './browser-route.js'
import type { LaunchBrowser } from './launch-browser.js'
import {
  absentMarkerPath,
  browserPackage,
  chromiumFolder,
  ciStopLine,
  cleanUpRuns,
  consistencyHeaderOf,
  containerId,
  createProject,
  createRun,
  defaultRunSnapshot,
  desktopProbe,
  type FakeBrowserOptions,
  type FakeStory,
  failingLaunch,
  fakeBrowser,
  fakeDriverOf,
  firstLineOf,
  headerOf,
  hostEnvironment,
  hostExecutableOf,
  hostOptions,
  installStorybook,
  listen,
  loaderLine,
  markerOf,
  missingLibraryError,
  missingLineOf,
  newRecord,
  noLaunch,
  noMarker,
  orphanLineOf,
  otherSnapshot,
  printed,
  removeMarkerFolder,
  reportFolderIn,
  startRecordingServer,
  startStorybook,
  storyIdsOf,
  takeUnusedUrl,
  usageHint,
  version,
  withoutTimes,
  writeMarker,
  writeStaleReport,
} from './run-cli.fixture.js'
import { type RunCliOptions, runCli } from './run-cli.js'

afterEach(cleanUpRuns)

afterAll(removeMarkerFolder)

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
  --consistency       Only check for missing baselines, orphans and stories files that fail to load (test only)
  --workers <n>       Capture with this many workers
  --shard <k>/<n>     Run one shard's share of the stories files (test only)

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
      '.visual-check/baselines/button--primary.png': defaultRunSnapshot,
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
      'web/.visual-check/baselines/a.png': defaultRunSnapshot,
    })
    const { options, record } = fakeBrowser()
    const result = await runCli(
      ['test', '--config', 'other.config.mjs', '--storybook', 'web', '--url', url],
      { CI: 'true' },
      project,
      options,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(withoutTimes(result.stdout)).toBe(printed(headerOf('test', 1), '✓ web  a  N ms', '1 passed'))
    expect(record.urls).toEqual([previewOf(url), `${url}/iframe.html?id=a&viewMode=story`])
    expect(record.urls.some((loaded) => loaded.includes(':6007') || loaded.includes(':6008'))).toBe(false)
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

describe('runCli test', () => {
  it('reports a .png nothing calls for as an orphan without decoding it, captures the rest, and exits 1', async () => {
    const { project, folder } = await createRun(['a'], {
      a: defaultRunSnapshot,
      gone: new TextEncoder().encode('not PNG'),
    })
    const { options, record } = fakeBrowser()
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('')
    expect(withoutTimes(result.stdout)).toBe(
      printed(headerOf('test', 1), '✓ web  a  N ms', orphanLineOf('web', 'gone'), '1 passed · 1 orphan'),
    )
    expect(storyIdsOf(record.urls)).toEqual(['a'])
    expect(readdirSync(folder).sort()).toEqual(['a.png', 'gone.png'])
  })

  it("passes a snapshot that holds its baseline's bytes, captured from the story's own page", async () => {
    const { project, url } = await createRun(['button--primary'], { 'button--primary': defaultRunSnapshot })
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
      a: defaultRunSnapshot,
      b: otherSnapshot,
      d: defaultRunSnapshot,
      e: defaultRunSnapshot,
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
    // The differing story is captured again once, by the default retries.
    expect(storyIdsOf(record.urls).sort()).toEqual(['a', 'b', 'b', 'd', 'e'])
  })

  it('prints the configured number of workers in the header, the noun in the right number', async () => {
    const { project: three } = await createRun(['a'], {}, 'workers: 3')
    const { project: one } = await createRun(['a'], {}, 'workers: 1')
    const { project: pair } = await createRun(['a'], { a: defaultRunSnapshot }, 'workers: { local: 5, ci: 2 }')

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
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })

    expect(await runCli(['test', '--filter', 'nothing'], {}, project, fakeBrowser().options)).toEqual({
      exitCode: 0,
      stdout: printed(headerOf('test', 0), '0 passed'),
      stderr: '',
    })
  })
})

describe('runCli visual diff', () => {
  it("leaves a differing snapshot's baseline, snapshot and visual diff in the report folder beside the config file", async () => {
    const url = await startStorybook(['a', 'b'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'packages/web', url: '${url}' } } }\n`,
      'packages/web/button.stories.tsx': '',
      'packages/web/.visual-check/baselines/a.png': defaultRunSnapshot,
      'packages/web/.visual-check/baselines/b.png': defaultRunSnapshot,
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
    expect(new Uint8Array(readFileSync(join(images, 'b.baseline.png')))).toEqual(defaultRunSnapshot)
    expect(new Uint8Array(readFileSync(join(images, 'b.snapshot.png')))).toEqual(otherSnapshot)
    expect([...readFileSync(join(images, 'b.diff.png')).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(existsSync(join(project, 'packages', 'web', '.visual-check', 'report'))).toBe(false)
  })

  it("names a mode's images by its key", async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot, 'a.dark': defaultRunSnapshot })
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
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })

    writeStaleReport(project)

    const result = await runCli(['test'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(existsSync(reportFolderIn(project))).toBe(false)
  })

  it('leaves the report folder alone in update', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const image = writeStaleReport(project)
    const result = await runCli(['update'], {}, project, fakeBrowser({ a: { snapshot: otherSnapshot } }).options)

    expect(result.exitCode).toBe(0)
    expect(readdirSync(join(reportFolderIn(project), 'images', 'web'))).toEqual(['old.diff.png'])
    expect(new Uint8Array(readFileSync(image))).toEqual(defaultRunSnapshot)
  })

  it("compares by the story's tolerance over the config's", async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot })
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
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const { options } = fakeBrowser(
      { a: { snapshot: otherSnapshot } },
      { read: { options: { a: { viewport: { deviceScaleFactor: 2 } } } } },
    )
    const result = await runCli(['test'], {}, project, options)

    expect(result.stdout).toContain('✗ web  a  differs: 100 differ, 80 allowed (20 at scale 2)\n')
  })

  it('fails a snapshot whose size differs from its baseline, naming both sizes', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
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

  it("stops with exit 2, naming the snapshot after the lines printed so far, when a differing snapshot can't be decoded", async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot })
    const notPng = new TextEncoder().encode('not a PNG')
    const { options } = fakeBrowser({ b: { snapshot: notPng } })
    const result = await runCli(['test', '--workers', '1'], {}, project, options)

    expect({ ...result, stdout: withoutTimes(result.stdout) }).toEqual({
      exitCode: 2,
      stdout: printed(headerOf('test', 2, 1), '✓ web  a  N ms'),
      stderr:
        "visual-check couldn't decode the snapshot the browser returned for web  b: Input buffer contains unsupported " +
        'image format. Run visual-check again, and report it if it keeps happening.\n',
    })
  })

  it("stops with exit 2 before any capture when the report folder can't be cleared", async () => {
    const url = await startStorybook(['a'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${url}' } } }\n`,
      'web/button.stories.tsx': '',
      'web/.visual-check/baselines/a.png': defaultRunSnapshot,
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

/**
 * The detail of each story of `./a.stories.tsx` when that stories file fails to load with a syntax error.
 */
const loadFailedDetail = "broken: Its stories file ./a.stories.tsx failed to load: SyntaxError: Unexpected token '<'."

/**
 * How the fake browser answers an options read in which `./a.stories.tsx` fails to load with a syntax error.
 */
const aFileFails: FakeBrowserOptions = { read: { failed: { './a.stories.tsx': "SyntaxError: Unexpected token '<'" } } }

/**
 * The environment of a run in CI.
 */
const ciEnvironment = { CI: 'true' }

describe('runCli consistency check', () => {
  it("reports a missing baseline outside --filter after another story's visual diff, without capturing it, and exits 1", async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot })
    const { options, record } = fakeBrowser({ a: { snapshot: otherSnapshot } })
    const result = await runCli(['test', '--filter', '^a$'], {}, project, options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(
        headerOf('test', 2),
        '✗ web  a  differs: 100 differ, 20 allowed',
        missingLineOf('web', 'b'),
        '0 passed · 1 differs · 1 missing',
      ),
      stderr: '',
    })
    expect(storyIdsOf(record.urls)).toEqual(['a', 'a'])
    expect(readdirSync(join(reportFolderIn(project), 'images', 'web')).sort()).toEqual([
      'a.baseline.png',
      'a.diff.png',
      'a.snapshot.png',
    ])
  })

  it('lists the orphans of every Storybook in config order, then file name order, before the flaky snapshots', async () => {
    const web = await startStorybook(['a'])
    const docs = await startStorybook(['d'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${docs}' } } }\n`,
      'web/button.stories.tsx': '',
      'docs/button.stories.tsx': '',
      'web/.visual-check/baselines/a.png': defaultRunSnapshot,
      'web/.visual-check/baselines/z.png': defaultRunSnapshot,
      'web/.visual-check/baselines/y.dark.png': defaultRunSnapshot,
      'docs/.visual-check/baselines/d.png': defaultRunSnapshot,
      'docs/.visual-check/baselines/x.png': defaultRunSnapshot,
    })
    const { options } = fakeBrowser({ a: { captures: [{ snapshot: otherSnapshot }, {}] } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(withoutTimes(result.stdout)).toBe(
      printed(
        headerOf('test', 2),
        '✓ web  a  N ms · flaky',
        '✓ docs  d  N ms',
        orphanLineOf('web', 'y.dark', 'web/.visual-check/baselines'),
        orphanLineOf('web', 'z', 'web/.visual-check/baselines'),
        orphanLineOf('docs', 'x', 'docs/.visual-check/baselines'),
        flakyHeading,
        '  web  a',
        '2 passed (1 flaky) · 3 orphans',
      ),
    )
  })

  it("reports a disabled story's leftover baseline as an orphan, and exits 1", async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot })
    const { options, record } = fakeBrowser({}, { read: { options: { b: { disable: true } } } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('')
    expect(withoutTimes(result.stdout)).toBe(
      printed(headerOf('test', 1), '✓ web  a  N ms', orphanLineOf('web', 'b'), '1 passed · 1 orphan'),
    )
    expect(storyIdsOf(record.urls)).toEqual(['a'])
  })

  it('breaks every story of a stories file that failed to load, whatever --filter selects, and exits 1', async () => {
    const { project, url } = await createRun(['a', 'b', 'c'], { b: defaultRunSnapshot }, '', {
      a: './a.stories.tsx',
      b: './b.stories.tsx',
      c: './a.stories.tsx',
    })
    const { options, record } = fakeBrowser({}, aFileFails)
    const result = await runCli(['test', '--filter', '^b$'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(withoutTimes(result.stdout)).toBe(
      printed(
        headerOf('test', 3),
        `! web  a  ${loadFailedDetail}`,
        '✓ web  b  N ms',
        `! web  c  ${loadFailedDetail}`,
        '1 passed · 2 broken',
      ),
    )
    expect(record.urls).toEqual([previewOf(url), `${url}/iframe.html?id=b&viewMode=story`])
  })

  it("stops with exit 2, printing nothing, when a baselines folder can't be listed", async () => {
    const { project, folder } = await createRun(['a'])

    mkdirSync(dirname(folder), { recursive: true })
    writeFileSync(folder, '')

    const { options, record } = fakeBrowser()
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        "visual-check couldn't list the baselines folder .visual-check/baselines: ENOTDIR: not a directory. Check " +
        "that it's a folder visual-check can read.\n",
    })
    expect(storyIdsOf(record.urls)).toEqual([])
  })

  it('stops a CI test with an orphan before capturing anything, and exits 1', async () => {
    const { project, url } = await createRun(['a'], { a: defaultRunSnapshot, gone: defaultRunSnapshot })
    const { options, record } = fakeBrowser()
    const result = await runCli(['test'], ciEnvironment, project, options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(consistencyHeaderOf(1), orphanLineOf('web', 'gone'), '0 missing · 1 orphan', ciStopLine),
      stderr: '',
    })
    expect(record.urls).toEqual([previewOf(url)])
    expect(record.viewports).toEqual([])
    expect(record.captures).toEqual([])
  })

  it('stops a CI test with a missing baseline outside --filter before capturing anything', async () => {
    const { project, url } = await createRun(['a', 'b'], { a: defaultRunSnapshot })
    const { options, record } = fakeBrowser()
    const result = await runCli(['test', '--filter', '^a$'], ciEnvironment, project, options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(consistencyHeaderOf(2), missingLineOf('web', 'b'), '1 missing', ciStopLine),
      stderr: '',
    })
    expect(record.urls).toEqual([previewOf(url)])
  })

  it('stops a CI test with a stories file that failed to load, listing missing and broken in planned order, then orphans', async () => {
    const { project, url } = await createRun(
      ['a', 'b', 'c', 'd'],
      { d: defaultRunSnapshot, old: defaultRunSnapshot },
      '',
      {
        a: './a.stories.tsx',
        b: './b.stories.tsx',
        c: './a.stories.tsx',
        d: './b.stories.tsx',
      },
    )
    const { options, record } = fakeBrowser({}, aFileFails)
    const result = await runCli(['test', '--filter', '^d$'], ciEnvironment, project, options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(
        consistencyHeaderOf(4),
        `! web  a  ${loadFailedDetail}`,
        missingLineOf('web', 'b'),
        `! web  c  ${loadFailedDetail}`,
        orphanLineOf('web', 'old'),
        '1 missing · 2 broken · 1 orphan',
        ciStopLine,
      ),
      stderr: '',
    })
    expect(record.urls).toEqual([previewOf(url)])
  })

  it('clears the report folder when it stops a CI test', async () => {
    const { project } = await createRun(['a'])

    writeStaleReport(project)

    const result = await runCli(['test'], ciEnvironment, project, fakeBrowser().options)

    expect(result.exitCode).toBe(1)
    expect(existsSync(reportFolderIn(project))).toBe(false)
  })

  it('goes on with a consistent CI test as with a local one', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot })
    const { options, record } = fakeBrowser({ b: { snapshot: otherSnapshot } })
    const result = await runCli(['test', '--filter', '^[ab]$'], ciEnvironment, project, options)

    expect(result.exitCode).toBe(1)
    expect(withoutTimes(result.stdout)).toBe(
      printed(
        headerOf('test', 2),
        '✓ web  a  N ms',
        '✗ web  b  differs: 100 differ, 20 allowed',
        '1 passed · 1 differs',
      ),
    )
    expect(storyIdsOf(record.urls).sort()).toEqual(['a', 'b', 'b'])
  })
})

/**
 * The line the consistency output ends with when nothing is missing, broken or an orphan.
 */
const consistentLine = 'Consistent: every baseline the stories call for is there, and none is an orphan.'

/**
 * Checks that a run opened no story page, took no viewport and captured nothing, as `test --consistency` doesn't.
 */
function expectNothingCaptured(record: {
  urls: readonly string[]
  viewports: readonly unknown[]
  captures: readonly unknown[]
}): void {
  expect(storyIdsOf(record.urls)).toEqual([])
  expect(record.viewports).toEqual([])
  expect(record.captures).toEqual([])
}

describe('runCli test --consistency', () => {
  it('prints the consistent output, captures nothing and exits 0 when every baseline is there and none is an orphan', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot })
    const { options, record } = fakeBrowser()
    const result = await runCli(['test', '--consistency'], {}, project, options)

    expect(result).toEqual({
      exitCode: 0,
      stdout: printed(consistencyHeaderOf(2), consistentLine),
      stderr: '',
    })
    expectNothingCaptured(record)
  })

  it('reports a missing baseline and exits 1 without capturing', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot })
    const { options, record } = fakeBrowser()
    const result = await runCli(['test', '--consistency'], {}, project, options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(consistencyHeaderOf(2), missingLineOf('web', 'b'), '1 missing'),
      stderr: '',
    })
    expectNothingCaptured(record)
  })

  it('reports an orphan and exits 1 without capturing', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot, gone: defaultRunSnapshot })
    const { options, record } = fakeBrowser()
    const result = await runCli(['test', '--consistency'], {}, project, options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(consistencyHeaderOf(1), orphanLineOf('web', 'gone'), '0 missing · 1 orphan'),
      stderr: '',
    })
    expectNothingCaptured(record)
  })

  it('reports each story of a stories file that failed to load and exits 1 without capturing', async () => {
    const { project } = await createRun(['a', 'b', 'c'], { b: defaultRunSnapshot }, '', {
      a: './a.stories.tsx',
      b: './b.stories.tsx',
      c: './a.stories.tsx',
    })
    const { options, record } = fakeBrowser({}, aFileFails)
    const result = await runCli(['test', '--consistency'], {}, project, options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(
        consistencyHeaderOf(3),
        `! web  a  ${loadFailedDetail}`,
        `! web  c  ${loadFailedDetail}`,
        '0 missing · 2 broken',
      ),
      stderr: '',
    })
    expectNothingCaptured(record)
  })

  it("exits 2, printing nothing, when a baselines folder can't be listed", async () => {
    const { project, folder } = await createRun(['a'])

    mkdirSync(dirname(folder), { recursive: true })
    writeFileSync(folder, '')

    const { options, record } = fakeBrowser()
    const result = await runCli(['test', '--consistency'], {}, project, options)

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain("visual-check couldn't list the baselines folder .visual-check/baselines")
    expectNothingCaptured(record)
  })

  it("exits 2 when the Storybook doesn't answer", async () => {
    const down = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${down}' } } }\n`,
    })
    const result = await runCli(['test', '--consistency'], {}, project, noLaunch)

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain("Storybook web doesn't answer at ")
  })

  it.each([['--all'], ['--filter', 'x']])('exits 2 for --consistency with %s', async (...selectionFlags) => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const { options, record } = fakeBrowser()
    const result = await runCli(['test', '--consistency', ...selectionFlags], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        '--consistency covers every story, so it takes no --all or --filter. Use --storybook to narrow it.\n' +
        'Run visual-check --help to see the commands and options.\n',
    })
    expectNothingCaptured(record)
  })

  it('passes right after an update that wrote every baseline', async () => {
    const { project } = await createRun(['a', 'b'])
    const { options } = fakeBrowser()

    expect((await runCli(['update', '--all'], {}, project, options)).exitCode).toBe(0)

    const { options: checkOptions, record } = fakeBrowser()
    const result = await runCli(['test', '--consistency'], {}, project, checkOptions)

    expect(result).toEqual({ exitCode: 0, stdout: printed(consistencyHeaderOf(2), consistentLine), stderr: '' })
    expectNothingCaptured(record)
  })

  it('clears the report folder', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })

    writeStaleReport(project)

    const result = await runCli(['test', '--consistency'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(existsSync(reportFolderIn(project))).toBe(false)
  })

  it('prints the same output in CI, with no CI line', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, gone: defaultRunSnapshot })
    const local = await runCli(['test', '--consistency'], {}, project, fakeBrowser().options)
    const inCi = await runCli(['test', '--consistency'], ciEnvironment, project, fakeBrowser().options)

    expect(inCi).toEqual(local)
    expect(inCi.exitCode).toBe(1)
    expect(inCi.stdout).not.toContain(ciStopLine)
  })
})

/**
 * Creates a project with two Storybooks, `web` whose baselines are all there, and `docs` that has an orphan and a
 * missing baseline, so a run that covers `docs` finds both.
 */
async function createWebAndDocsProject(): Promise<string> {
  const web = await startStorybook(['a'])
  const docs = await startStorybook(['d', 'e'])

  return createProject({
    'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${docs}' } } }\n`,
    'web/button.stories.tsx': '',
    'docs/button.stories.tsx': '',
    'web/.visual-check/baselines/a.png': defaultRunSnapshot,
    'docs/.visual-check/baselines/d.png': defaultRunSnapshot,
    'docs/.visual-check/baselines/gone.png': defaultRunSnapshot,
  })
}

describe('runCli test --consistency with --storybook', () => {
  it("leaves out the findings of a Storybook that isn't given, and counts only the snapshots of the one that is", async () => {
    const project = await createWebAndDocsProject()
    const { options, record } = fakeBrowser()
    const result = await runCli(['test', '--consistency', '--storybook', 'web'], {}, project, options)

    expect(result).toEqual({ exitCode: 0, stdout: printed(consistencyHeaderOf(1), consistentLine), stderr: '' })
    expectNothingCaptured(record)
  })

  it('finds them all when every Storybook is covered', async () => {
    const project = await createWebAndDocsProject()
    const result = await runCli(['test', '--consistency'], {}, project, fakeBrowser().options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(
        consistencyHeaderOf(3),
        missingLineOf('docs', 'e'),
        orphanLineOf('docs', 'gone', 'docs/.visual-check/baselines'),
        '1 missing · 1 orphan',
      ),
      stderr: '',
    })
  })

  it("doesn't report the findings of the other Storybook in a local test with --storybook", async () => {
    const project = await createWebAndDocsProject()
    const result = await runCli(['test', '--storybook', 'web'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(withoutTimes(result.stdout)).toBe(printed(headerOf('test', 1), '✓ web  a  N ms', '1 passed'))
  })
})

/**
 * Builds the header a shard prints, with how many stories files it was dealt. A run with no `workers` in its config
 * gets 4 workers from the fake probe's and machine's 4 CPUs.
 */
function shardHeaderOf(shard: string, files: number, count: number, workers = 4): string {
  const storiesFiles = `${files} ${files === 1 ? 'stories file' : 'stories files'}`
  const snapshots = `${count} ${count === 1 ? 'snapshot' : 'snapshots'}`

  return `visual-check ${version} · test · shard ${shard} · ${storiesFiles} · ${snapshots} · ${workers} workers`
}

/**
 * The note every shard prints after its header.
 */
const shardNote = 'Missing baselines and orphans are left to test --consistency.'

/**
 * The stories files of the sharded project, by story ID: `a` holds three stories, `b` and `d` two each, `c` one, so
 * four shards are dealt `a`, `b`, `d` and `c` in turn.
 */
const shardedImportPaths: Record<string, string> = {
  a1: './a.stories.tsx',
  a2: './a.stories.tsx',
  a3: './a.stories.tsx',
  b1: './b.stories.tsx',
  b2: './b.stories.tsx',
  c1: './c.stories.tsx',
  d1: './d.stories.tsx',
  d2: './d.stories.tsx',
}

/**
 * The story IDs of the sharded project, in `index.json` order.
 */
const shardedStoryIds = Object.keys(shardedImportPaths)

/**
 * Makes a project whose one Storybook has the stories of `shardedImportPaths`, each with its baseline. `extra` adds
 * baselines, by stem.
 */
async function createShardedRun(extra: Record<string, Uint8Array> = {}): Promise<{ project: string; url: string }> {
  const baselines = Object.fromEntries(shardedStoryIds.map((id) => [id, defaultRunSnapshot]))

  return await createRun(shardedStoryIds, { ...baselines, ...extra }, '', shardedImportPaths)
}

/**
 * Gives the import paths of every stories file the options reads asked for, in order.
 */
function readFilesOf(record: { reads: readonly { files: readonly StoriesFile[] }[] }): string[] {
  return record.reads.flatMap(({ files }) => files.map(({ importPath }) => importPath))
}

/**
 * Gives the story IDs of every capture, sorted.
 */
function capturedIdsOf(record: { captures: readonly { id: string }[] }): string[] {
  return record.captures.map(({ id }) => id).sort()
}

describe('runCli test --shard', () => {
  it('captures every snapshot exactly once across four shards, each exiting 0', async () => {
    const { project } = await createShardedRun()
    const whole = fakeBrowser()

    expect((await runCli(['test'], {}, project, whole.options)).exitCode).toBe(0)

    const captured: string[] = []

    for (const shard of ['1/4', '2/4', '3/4', '4/4']) {
      const { options, record } = fakeBrowser()
      const result = await runCli(['test', '--shard', shard], {}, project, options)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      captured.push(...capturedIdsOf(record))
    }

    const sorted = captured.sort()

    expect(sorted).toEqual(capturedIdsOf(whole.record))
    expect(sorted).toEqual([...shardedStoryIds].sort())
  })

  it("loads only the shard's own stories files", async () => {
    const { project } = await createShardedRun()
    const shares = {
      '1/4': ['./a.stories.tsx'],
      '2/4': ['./b.stories.tsx'],
      '3/4': ['./d.stories.tsx'],
      '4/4': ['./c.stories.tsx'],
    }

    for (const [shard, files] of Object.entries(shares)) {
      const { options, record } = fakeBrowser()

      await runCli(['test', '--shard', shard], {}, project, options)

      expect(readFilesOf(record)).toEqual(files)
    }
  })

  it('reads no Storybook that has no stories file in the shard, and one split spans every Storybook', async () => {
    const web = await startStorybook(['a1', 'a2', 'a3', 'b1'], {
      a1: './a.stories.tsx',
      a2: './a.stories.tsx',
      a3: './a.stories.tsx',
      b1: './b.stories.tsx',
    })
    const docs = await startStorybook(['d1'], { d1: './d.stories.tsx' })
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${docs}' } } }\n`,
      'web/a.stories.tsx': '',
      'web/b.stories.tsx': '',
      'docs/d.stories.tsx': '',
      ...Object.fromEntries(
        ['a1', 'a2', 'a3', 'b1'].map((id) => [`web/.visual-check/baselines/${id}.png`, defaultRunSnapshot]),
      ),
      'docs/.visual-check/baselines/d1.png': defaultRunSnapshot,
    })
    const first = fakeBrowser()
    const second = fakeBrowser()
    const firstResult = await runCli(['test', '--shard', '1/2'], {}, project, first.options)
    const secondResult = await runCli(['test', '--shard', '2/2'], {}, project, second.options)

    expect(first.record.reads.map(({ url }) => url)).toEqual([previewOf(web)])
    expect(readFilesOf(first.record)).toEqual(['./a.stories.tsx'])
    expect(firstLineOf(firstResult.stdout)).toBe(shardHeaderOf('1/2', 1, 3))
    expect(second.record.reads.map(({ url }) => url)).toEqual([previewOf(web), previewOf(docs)])
    expect(readFilesOf(second.record)).toEqual(['./b.stories.tsx', './d.stories.tsx'])
    expect(firstLineOf(secondResult.stdout)).toBe(shardHeaderOf('2/2', 2, 2))
  })

  it('prints the shard header and the note that the consistency check is left to test --consistency', async () => {
    const { project } = await createShardedRun()
    const result = await runCli(['test', '--shard', '3/4'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(withoutTimes(result.stdout)).toBe(
      printed(shardHeaderOf('3/4', 1, 2), shardNote, '✓ web  d1  N ms', '✓ web  d2  N ms', '2 passed'),
    )
  })

  it('runs no consistency check: an orphan fails no shard, locally or in CI', async () => {
    const { project } = await createShardedRun({ gone: defaultRunSnapshot })

    for (const environment of [{}, ciEnvironment]) {
      const { options, record } = fakeBrowser()
      const result = await runCli(['test', '--shard', '4/4'], environment, project, options)

      expect(result.exitCode).toBe(0)
      expect(withoutTimes(result.stdout)).toBe(
        printed(shardHeaderOf('4/4', 1, 1), shardNote, '✓ web  c1  N ms', '1 passed'),
      )
      expect(capturedIdsOf(record)).toEqual(['c1'])
    }
  })

  it('clears the report folder', async () => {
    const { project } = await createShardedRun()

    writeStaleReport(project)

    const result = await runCli(['test', '--shard', '1/2'], {}, project, fakeBrowser().options)

    expect(result.exitCode).toBe(0)
    expect(existsSync(reportFolderIn(project))).toBe(false)
  })

  it('still reports a missing baseline of its own stories, and only those', async () => {
    const { project } = await createRun(['a', 'b'], {}, '', { a: './a.stories.tsx', b: './b.stories.tsx' })
    const result = await runCli(['test', '--shard', '1/2'], {}, project, fakeBrowser().options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(shardHeaderOf('1/2', 1, 1), shardNote, missingLineOf('web', 'a'), '0 passed · 1 missing'),
      stderr: '',
    })
  })

  it('exits 0 with a note, launching no browser, when the shard is dealt no stories file', async () => {
    const { project } = await createRun(['a', 'b', 'c'], { a: defaultRunSnapshot }, '', {
      a: './a.stories.tsx',
      b: './b.stories.tsx',
      c: './c.stories.tsx',
    })

    expect(await runCli(['test', '--shard', '4/4'], {}, project, noLaunch)).toEqual({
      exitCode: 0,
      stdout: printed(shardHeaderOf('4/4', 0, 0), shardNote, 'Shard 4/4 has nothing to capture.', '0 passed'),
      stderr: '',
    })
  })

  it('exits 0 with a note when every story of its stories files is disabled', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot }, '', {
      a: './a.stories.tsx',
      b: './b.stories.tsx',
    })
    const { options, record } = fakeBrowser({}, { read: { options: { b: { disable: true } } } })
    const result = await runCli(['test', '--shard', '2/2'], {}, project, options)

    expect(result).toEqual({
      exitCode: 0,
      stdout: printed(shardHeaderOf('2/2', 1, 0), shardNote, 'Shard 2/2 has nothing to capture.', '0 passed'),
      stderr: '',
    })
    expect(record.captures).toEqual([])
  })

  it('splits only the stories --filter selects', async () => {
    const { project } = await createShardedRun()
    const captured: string[] = []
    const headers: (string | undefined)[] = []

    for (const shard of ['1/3', '2/3', '3/3']) {
      const { options, record } = fakeBrowser()
      const result = await runCli(['test', '--filter', '^[ab]1$', '--shard', shard], {}, project, options)

      expect(result.exitCode).toBe(0)
      captured.push(...capturedIdsOf(record))
      headers.push(firstLineOf(result.stdout))
    }

    expect(captured.sort()).toEqual(['a1', 'b1'])
    expect(headers).toEqual([shardHeaderOf('1/3', 1, 1), shardHeaderOf('2/3', 1, 1), shardHeaderOf('3/3', 0, 0)])
  })

  it.each([
    [['test', '--shard', '0/4'], "--shard takes k/n, two whole numbers with 1 ≤ k ≤ n, such as 2/4. Got '0/4'."],
    [['test', '--shard', '1/2', '--consistency'], '--consistency runs in a job of its own, so it takes no --shard.'],
    [['update', '--shard', '1/2'], '--shard applies only to test.'],
  ])('exits 2 for %j', async (commandLine, message) => {
    const { project } = await createShardedRun()

    expect(await runCli(commandLine, {}, project, noLaunch)).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: `${message}\n${usageHint}`,
    })
  })

  it("exits 2 when the Storybook doesn't answer", async () => {
    const down = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${down}' } } }\n`,
    })
    const result = await runCli(['test', '--shard', '1/2'], {}, project, noLaunch)

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain("Storybook web doesn't answer at ")
  })

  it("exits 2, printing nothing and launching no browser, when a baselines folder can't be listed", async () => {
    const { project, folder } = await createRun(['a'])

    mkdirSync(dirname(folder), { recursive: true })
    writeFileSync(folder, '')

    expect(await runCli(['test', '--shard', '1/2'], {}, project, noLaunch)).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        "visual-check couldn't list the baselines folder .visual-check/baselines: ENOTDIR: not a directory. Check " +
        "that it's a folder visual-check can read.\n",
    })
  })
})

describe('runCli update', () => {
  it('writes missing baselines and ones beyond tolerance exactly as captured, and keeps the rest untouched', async () => {
    const { project, folder } = await createRun(['a', 'b', 'c', 'd'], {
      a: defaultRunSnapshot,
      b: defaultRunSnapshot,
      c: defaultRunSnapshot,
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
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(defaultRunSnapshot)
    expect(new Uint8Array(readFileSync(join(folder, 'b.png')))).toEqual(defaultRunSnapshot)
    expect(new Uint8Array(readFileSync(join(folder, 'c.png')))).toEqual(otherSnapshot)
    expect(new Uint8Array(readFileSync(join(folder, 'd.png')))).toEqual(newD)
    expect(statSync(join(folder, 'a.png')).mtimeMs).toBe(past.getTime())
    expect(statSync(join(folder, 'b.png')).mtimeMs).toBe(past.getTime())
  })

  it("compares by the story's tolerance, at the viewport's device scale factor", async () => {
    const { project, folder } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot })
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
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(defaultRunSnapshot)
    expect(new Uint8Array(readFileSync(join(folder, 'b.png')))).toEqual(otherSnapshot)
  })

  it('writes a baseline whose size changed, naming both sizes', async () => {
    const { project, folder } = await createRun(['a'], { a: defaultRunSnapshot })
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
      a: defaultRunSnapshot,
      'a.dark': defaultRunSnapshot,
      c: defaultRunSnapshot,
      d: defaultRunSnapshot,
      f: defaultRunSnapshot,
      gone: defaultRunSnapshot,
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
    // Every baseline written takes two loads, and a kept one takes one.
    expect(storyIdsOf(record.urls).sort()).toEqual(['a', 'a', 'b', 'b', 'e', 'e', 'f'])
    expect(readdirSync(folder).sort()).toEqual(['a.png', 'b.png', 'c.png', 'd.png', 'e.png', 'f.png'])
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(otherSnapshot)
    expect(new Uint8Array(readFileSync(join(folder, 'c.png')))).toEqual(defaultRunSnapshot)
  })

  it('deletes only orphans and exits 0 when every baseline is kept', async () => {
    const { project, folder } = await createRun(['a'], { a: defaultRunSnapshot, gone: defaultRunSnapshot })
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
    const { project, folder } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot })
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
    const { project, folder } = await createRun(['a'], { a: defaultRunSnapshot })

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

  it('keeps every baseline a story whose stories file failed to load could own, and leaves it out when its baseline is there', async () => {
    const longMode = `b.${'m'.repeat(300)}`
    const { project, folder } = await createRun(
      ['a', 'b'],
      {
        a: defaultRunSnapshot,
        b: defaultRunSnapshot,
        'b.dark': defaultRunSnapshot,
        [shortenedStemOf(longMode)]: defaultRunSnapshot,
        'b-group': defaultRunSnapshot,
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

  it('breaks a story outside --filter whose stories file failed to load and has no baseline, and exits 1', async () => {
    const { project, folder } = await createRun(
      ['a', 'b'],
      { a: defaultRunSnapshot, 'b.dark': defaultRunSnapshot },
      '',
      {
        a: './a.stories.tsx',
        b: './b.stories.tsx',
      },
    )
    const { options, record } = fakeBrowser({}, { read: { failed: { './b.stories.tsx': 'SyntaxError' } } })
    const result = await runCli(['update', '--filter', '^a$'], {}, project, options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(
        headerOf('update', 2),
        '✓ web  a  kept',
        '! web  b  broken: Its stories file ./b.stories.tsx failed to load: SyntaxError.',
        '0 written · 1 kept · 1 broken',
      ),
      stderr: '',
    })
    expect(storyIdsOf(record.urls)).toEqual(['a'])
    expect(readdirSync(folder).sort()).toEqual(['a.png', 'b.dark.png'])
  })

  it('narrows writing and deleting to the Storybook --storybook names', async () => {
    const web = await startStorybook(['a'])
    const docs = await startStorybook(['d', 'e'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${docs}' } } }\n`,
      'web/button.stories.tsx': '',
      'web/.visual-check/baselines/gone.png': defaultRunSnapshot,
      'docs/button.stories.tsx': '',
      'docs/.visual-check/baselines/e.png': otherSnapshot,
      'docs/.visual-check/baselines/gone.png': defaultRunSnapshot,
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
    expect(storyIdsOf(record.urls)).toEqual(['a', 'a'])
    expect(readdirSync(docsFolder).sort()).toEqual(['e.png', 'gone.png'])
    expect(new Uint8Array(readFileSync(join(docsFolder, 'e.png')))).toEqual(otherSnapshot)
  })

  it('prints written and deleted paths relative to the folder it runs in, with /', async () => {
    const url = await startStorybook(['a'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'packages/web', url: '${url}' } } }\n`,
      'packages/web/button.stories.tsx': '',
      'packages/web/.visual-check/baselines/gone.png': defaultRunSnapshot,
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
    const { project, folder } = await createRun(['a', 'b'], { a: otherSnapshot, gone: defaultRunSnapshot, zz: notPng })
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
    const { project, folder } = await createRun(['a'], { a: defaultRunSnapshot })

    linkSync(join(folder, 'a.png'), join(folder, 'other-name.png'))

    const result = await runCli(['update'], {}, project, fakeBrowser().options)

    expect(result.stdout).toBe(printed(headerOf('update', 1), '✓ web  a  kept', '0 written · 1 kept'))
    expect(readdirSync(folder).sort()).toEqual(['a.png', 'other-name.png'])
  })

  it('keeps a baseline named in another case where the file system takes it for the expected one, else replaces it', async () => {
    const { project, folder } = await createRun(['a'], { A: defaultRunSnapshot })
    const caseInsensitive = existsSync(join(folder, 'a.png'))
    const result = await runCli(['update'], {}, project, fakeBrowser().options)

    expect(result).toEqual({
      exitCode: 0,
      stdout: caseInsensitive
        ? printed(headerOf('update', 1), '✓ web  a  kept', '0 written · 1 kept')
        : printed(
            headerOf('update', 1),
            '✓ web  a  written: missing',
            '1 written · 1 deleted',
            'written .visual-check/baselines/a.png',
            'deleted .visual-check/baselines/A.png',
          ),
      stderr: '',
    })
    expect(readdirSync(folder)).toHaveLength(1)
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(defaultRunSnapshot)
  })

  it('takes only the missing mode of a story outside the filter whose default baseline is there', async () => {
    const { project, folder } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot })
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
    expect(storyIdsOf(record.urls).sort()).toEqual(['a', 'b', 'b'])
    expect(new Uint8Array(readFileSync(join(folder, 'b.png')))).toEqual(defaultRunSnapshot)
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
      const { project, folder } = await createRun(['a'], { a: defaultRunSnapshot, gone: defaultRunSnapshot })

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
  /**
   * Three folders of 100 characters each, so a baseline's path passes 260 characters whatever the temporary folder's
   * length: a short `/tmp` on Linux as well as macOS's long one.
   */
  const deepFolder = `${'d'.repeat(100)}/${'e'.repeat(100)}/${'f'.repeat(100)}`
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
    const project = await createDeepRun(['a'], { a: defaultRunSnapshot })
    const result = await runCli(['update'], {}, project, { ...fakeBrowser().options, os: 'win32' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('1 kept')
    expect(result.stderr).toBe('')
  })

  it('does not warn in test on Windows', async () => {
    const project = await createDeepRun(['a'], { a: defaultRunSnapshot })
    const result = await runCli(['test'], {}, project, { ...fakeBrowser().options, os: 'win32' })

    expect(result.stderr).toBe('')
  })
})

describe('runCli warning about real network requests and remote content', () => {
  const requestWarning = (host: string, ids: string): string =>
    `${host}: ${ids}. ${ids.includes(',') ? 'These stories make' : 'This story makes'} ` +
    'real network requests and may be unreliable.\n'
  const remoteWarning = (host: string, ids: string): string =>
    `${host}: ${ids} ${ids.includes(',') ? 'show' : 'shows'} remote content. ` +
    'A CDN can serve it differently on another machine, so CI may fail.\n'
  /**
   * The remote content a story's page gives: one item per host, each with a box.
   */
  const shown = (...hosts: string[]): NonNullable<FakeStory['remote']> =>
    hosts.map((host) => ({ host, x: 0, y: 0, width: 10, height: 10 }))

  it('lists in update the hosts whose stories make real requests, and no line for a story that makes none', async () => {
    const { project } = await createRun(['a', 'b', 'c'])
    const { options } = fakeBrowser({
      a: { requestHosts: ['api.example.com'] },
      b: { requestHosts: [] },
      c: { requestHosts: ['api.example.com', 'other.example.com:8443'] },
    })
    const result = await runCli(['update'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe(
      requestWarning('api.example.com', '2 stories (a, c)') + requestWarning('other.example.com:8443', '1 story (c)'),
    )
  })

  it('lists in update the hosts of the remote content, and no line for a story that shows none', async () => {
    const { project } = await createRun(['a', 'b'])
    const { options } = fakeBrowser({
      a: { remote: shown('images.example.com') },
      b: { remote: shown() },
    })
    const result = await runCli(['update'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe(remoteWarning('images.example.com', '1 story (a)'))
  })

  it('puts the request lines before the remote content lines, after the other warnings', async () => {
    const { project } = await createRun(['a'])
    const { options } = fakeBrowser({
      a: { requestHosts: ['api.example.com'], remote: shown('a.example.com'), completingMs: 80 },
    })
    const result = await runCli(['update'], {}, project, options)

    expect(result.stderr).toMatch(/^Warning: Storybook web /)
    expect(
      result.stderr.endsWith(
        requestWarning('api.example.com', '1 story (a)') + remoteWarning('a.example.com', '1 story (a)'),
      ),
    ).toBe(true)
  })

  it('lists a host a kept baseline reaches too', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const { options } = fakeBrowser({ a: { requestHosts: ['api.example.com'] } })
    const result = await runCli(['update'], {}, project, options)

    expect(result.stdout).toContain('1 kept')
    expect(result.stderr).toBe(requestWarning('api.example.com', '1 story (a)'))
  })

  it('is silenced for an exact host and for a wildcard, in both kinds', async () => {
    const stories = {
      a: { requestHosts: ['api.example.com'], remote: shown('images.example.com') },
      b: { requestHosts: ['kept.test'], remote: shown('kept.test') },
    }
    const exact = await createRun(['a', 'b'], {}, "silenceHosts: ['api.example.com', 'images.example.com'],")
    const wildcard = await createRun(['a', 'b'], {}, "silenceHosts: ['*.example.com'],")
    const kept = requestWarning('kept.test', '1 story (b)') + remoteWarning('kept.test', '1 story (b)')

    expect((await runCli(['update'], {}, exact.project, fakeBrowser(stories).options)).stderr).toBe(kept)
    expect((await runCli(['update'], {}, wildcard.project, fakeBrowser(stories).options)).stderr).toBe(kept)
  })

  it('never changes the exit code', async () => {
    const { project } = await createRun(['a'])
    const { options } = fakeBrowser({ a: { requestHosts: ['api.example.com'] } })
    const result = await runCli(['update'], {}, project, options)

    expect(result.stderr).not.toBe('')
    expect(result.exitCode).toBe(0)
  })

  it('counts a broken story for nothing, and never captures its page', async () => {
    const { project } = await createRun(['a'])
    const { options, record } = fakeBrowser({
      a: { broken: true, requestHosts: ['api.example.com'], remote: shown('x.test') },
    })
    const result = await runCli(['update'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('')
    expect(record.captures).toEqual([])
  })

  it('never lists hosts in test, and sets up every page without watching requests', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const { options, record } = fakeBrowser({ a: { requestHosts: ['api.example.com'], remote: shown('x.test') } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(record.setups.length).toBeGreaterThan(0)
    expect(record.setups.map((setup) => setup.watchRequests)).toEqual(record.setups.map(() => false))
  })

  it('watches requests in update on the capture pages and not on the options read page', async () => {
    const { project } = await createRun(['a'])
    const { options, record } = fakeBrowser()

    await runCli(['update'], {}, project, options)

    expect(record.setups[0]?.watchRequests).toBe(false)
    expect(record.setups.slice(1).length).toBeGreaterThan(0)
    expect(record.setups.slice(1).every((setup) => setup.watchRequests)).toBe(true)
  })

  it('asks every capture in update for the remote content the story shows', async () => {
    const { project } = await createRun(['a', 'b'])
    const { options, record } = fakeBrowser()

    await runCli(['update'], {}, project, options)

    // Each missing baseline takes two loads.
    expect(record.preparations.map(({ findRemote }) => findRemote)).toEqual([true, true, true, true])
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
      'web/.visual-check/baselines/a.png': defaultRunSnapshot,
      'web/.visual-check/baselines/b.png': defaultRunSnapshot,
      'web/.visual-check/baselines/c.png': defaultRunSnapshot,
      'docs/.visual-check/baselines/d.png': defaultRunSnapshot,
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
    const { project } = await createRun(['a', 'b', 'c'], {
      a: defaultRunSnapshot,
      b: defaultRunSnapshot,
      c: defaultRunSnapshot,
    })
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
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot })
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
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot })
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
    const { project, url } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'workers: 1')
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
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const { options, record } = fakeBrowser({}, { read: { exitingBrowsers: [1, 2] } })
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({ exitCode: 2, stdout: '', stderr: `${relaunchNotice}${secondExitMessage}` })
    expect(record.launches).toHaveLength(2)
    expect(storyIdsOf(record.urls)).toEqual([])
    expect(record.driverCloses).toBe(2)
  })

  it('takes no snapshot when every selected story is disabled, after one read', async () => {
    const { project } = await createRun(['a', 'b'])
    const { options, record } = fakeBrowser({}, { read: { options: { a: { disable: true }, b: { disable: true } } } })
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({ exitCode: 0, stdout: printed(headerOf('test', 0), '0 passed'), stderr: '' })
    expect(record.reads).toHaveLength(1)
    expect(storyIdsOf(record.urls)).toEqual([])
    expect(record.viewports).toEqual([])
  })

  it("leaves out a disabled story, and keeps one whose merged options say it isn't", async () => {
    const { project } = await createRun(['a', 'b', 'c'], { a: defaultRunSnapshot, c: defaultRunSnapshot })
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
      { a: defaultRunSnapshot, b: defaultRunSnapshot, c: defaultRunSnapshot },
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
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
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
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, 'readyTimeout: 4000')
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
 * The snapshot story `a` captures in its `dark` mode, which differs from `defaultRunSnapshot`.
 */
const darkSnapshot = new Uint8Array(await greyPng(10, 10, 64))

/**
 * How story `a` answers: its `dark` mode, whose URL sets `theme:dark`, captures `darkSnapshot`.
 */
const darkStory: FakeStory = { byGlobals: { 'theme:dark': { snapshot: darkSnapshot } } }

describe('runCli modes', () => {
  it('tests each mode as its own snapshot against its own baseline, the mode in its own column', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, 'a.dark': darkSnapshot, b: otherSnapshot })
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
    // The differing story is captured again once, by the default retries.
    expect(storyIdsOf(record.urls).sort()).toEqual(['a', 'a', 'b', 'b'])
  })

  it("reports a mode's snapshot that breaks as broken, on its own line, and takes the others", async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot, 'a.dark': defaultRunSnapshot })
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

    // Each missing baseline takes two loads, one after the other.
    expect(record.viewports).toEqual([
      { width: 1280, height: 900, deviceScaleFactor: 1, touch: false },
      { width: 1280, height: 900, deviceScaleFactor: 1, touch: false },
      { width: 1280, height: 900, deviceScaleFactor: 1, touch: false },
      { width: 1280, height: 900, deviceScaleFactor: 1, touch: false },
      { width: 375, height: 900, deviceScaleFactor: 2, touch: true },
      { width: 375, height: 900, deviceScaleFactor: 2, touch: true },
    ])
    expect(record.urls).toEqual([
      previewOf(url),
      `${url}/iframe.html?id=a&viewMode=story`,
      `${url}/iframe.html?id=a&viewMode=story`,
      `${url}/iframe.html?id=a&viewMode=story&globals=theme%3Adark`,
      `${url}/iframe.html?id=a&viewMode=story&globals=theme%3Adark`,
      `${url}/iframe.html?id=a&viewMode=story`,
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
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(defaultRunSnapshot)
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
 * A black PNG file of 10 × 12 pixels, whose size differs from `defaultRunSnapshot`'s.
 */
const tallerSnapshot = new Uint8Array(await greyPng(10, 12, 0))

/**
 * The heading of the list of flaky snapshots.
 */
const flakyHeading = 'Flaky snapshots, which passed on a retry:'

describe('runCli retries and flaky snapshots', () => {
  it("passes a snapshot that differs once and then passes, flaky, keeping its first capture's images", async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const { options, record } = fakeBrowser({ a: { captures: [{ snapshot: otherSnapshot }, {}] } })
    const result = await runCli(['test'], {}, project, options)
    const images = join(reportFolderIn(project), 'images', 'web')

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(withoutTimes(result.stdout)).toBe(
      printed(headerOf('test', 1), '✓ web  a  N ms · flaky', flakyHeading, '  web  a', '1 passed (1 flaky)'),
    )
    expect(storyIdsOf(record.urls)).toEqual(['a', 'a'])
    expect(readdirSync(images).sort()).toEqual(['a.baseline.png', 'a.diff.png', 'a.snapshot.png'])
    expect(new Uint8Array(readFileSync(join(images, 'a.baseline.png')))).toEqual(defaultRunSnapshot)
    expect(new Uint8Array(readFileSync(join(images, 'a.snapshot.png')))).toEqual(otherSnapshot)
    expect([...readFileSync(join(images, 'a.diff.png')).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('captures a differing snapshot once with retries set to 0', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, 'retries: 0')
    const { options, record } = fakeBrowser({ a: { captures: [{ snapshot: otherSnapshot }, {}] } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe(
      printed(headerOf('test', 1), '✗ web  a  differs: 100 differ, 20 allowed', '0 passed · 1 differs'),
    )
    expect(storyIdsOf(record.urls)).toEqual(['a'])
  })

  it('captures a differing snapshot up to retries more times, passing it flaky on the last', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, 'retries: 2')
    const { options, record } = fakeBrowser({
      a: { captures: [{ snapshot: otherSnapshot }, { snapshot: otherSnapshot }, {}] },
    })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(withoutTimes(result.stdout)).toBe(
      printed(headerOf('test', 1), '✓ web  a  N ms · flaky', flakyHeading, '  web  a', '1 passed (1 flaky)'),
    )
    expect(storyIdsOf(record.urls)).toEqual(['a', 'a', 'a'])
  })

  it("fails a snapshot that differs on every capture with its first capture's message and images", async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, 'retries: 2')
    const { options, record } = fakeBrowser({
      a: { captures: [{ snapshot: otherSnapshot }, { snapshot: tallerSnapshot }] },
    })
    const result = await runCli(['test'], {}, project, options)
    const images = join(reportFolderIn(project), 'images', 'web')

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe(
      printed(headerOf('test', 1), '✗ web  a  differs: 100 differ, 20 allowed', '0 passed · 1 differs'),
    )
    expect(storyIdsOf(record.urls)).toEqual(['a', 'a', 'a'])
    expect(new Uint8Array(readFileSync(join(images, 'a.baseline.png')))).toEqual(defaultRunSnapshot)
    expect(new Uint8Array(readFileSync(join(images, 'a.snapshot.png')))).toEqual(otherSnapshot)

    // The visual diff of a run that captures the first snapshot only, with no retry.
    const { project: once } = await createRun(['a'], { a: defaultRunSnapshot }, 'retries: 0')

    await runCli(['test'], {}, once, fakeBrowser({ a: { snapshot: otherSnapshot } }).options)

    const firstDiff = readFileSync(join(reportFolderIn(once), 'images', 'web', 'a.diff.png'))

    expect(readFileSync(join(images, 'a.diff.png'))).toEqual(firstDiff)
  })

  it("stops with exit 2 when the relaunched browser exits during a retry, keeping the first capture's images", async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'workers: 1')
    const { options, record } = fakeBrowser({
      a: { browserExits: true },
      b: { captures: [{ snapshot: otherSnapshot }, { browserExits: true }] },
    })
    const result = await runCli(['test'], {}, project, options)
    const images = join(reportFolderIn(project), 'images', 'web')

    expect(result).toEqual({
      exitCode: 2,
      stdout: printed(headerOf('test', 2, 1), `! web  a  ${browserExitedDetail}`),
      stderr: `${relaunchNotice}${secondExitMessage}`,
    })
    expect(record.launches).toHaveLength(2)
    expect(storyIdsOf(record.urls)).toEqual(['a', 'b', 'b'])
    expect(readdirSync(images).sort()).toEqual(['b.baseline.png', 'b.diff.png', 'b.snapshot.png'])
    expect(new Uint8Array(readFileSync(join(images, 'b.snapshot.png')))).toEqual(otherSnapshot)
  })

  it('retries a snapshot whose size differs from its baseline', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const { options, record } = fakeBrowser({ a: { captures: [{ snapshot: tallerSnapshot }, {}] } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(withoutTimes(result.stdout)).toContain('✓ web  a  N ms · flaky\n')
    expect(storyIdsOf(record.urls)).toEqual(['a', 'a'])
  })

  it("doesn't retry a broken story, and captures its page as it broke", async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const { options, record } = fakeBrowser({ a: { captures: [{ broken: true }, {}] } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe(printed(headerOf('test', 1), `! web  a  ${brokenDetail}`, '0 passed · 1 broken'))
    expect(storyIdsOf(record.urls)).toEqual(['a'])
    expect(record.captures.map(({ id, onLoad }) => [id, onLoad])).toEqual([['a', 1]])
  })

  it("stops retrying at a broken retry, failing the snapshot with its first capture's message", async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, 'retries: 2')
    const { options, record } = fakeBrowser({ a: { captures: [{ snapshot: otherSnapshot }, { broken: true }, {}] } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe(
      printed(headerOf('test', 1), '✗ web  a  differs: 100 differ, 20 allowed', '0 passed · 1 differs'),
    )
    expect(storyIdsOf(record.urls)).toEqual(['a', 'a'])
    // The broken retry's page isn't captured: the snapshot keeps its first capture's images.
    expect(record.captures.map(({ id, onLoad }) => [id, onLoad])).toEqual([['a', 1]])
  })

  it('never captures a missing baseline', async () => {
    const { project } = await createRun(['a'])
    const { options, record } = fakeBrowser({ a: { captures: [{ snapshot: otherSnapshot }, {}] } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.stdout).toBe(printed(headerOf('test', 1), missingLineOf('web', 'a'), '0 passed · 1 missing'))
    expect(storyIdsOf(record.urls)).toEqual([])
  })

  it('searches for remote content only on retries, never on a first capture', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'retries: 2')
    const { options, record } = fakeBrowser({ b: { snapshot: otherSnapshot } })

    await runCli(['test'], {}, project, options)

    const searchesOf = (id: string): unknown[] =>
      record.preparations.flatMap((preparation) => (preparation.id === id ? [preparation.findRemote] : []))

    expect(searchesOf('a')).toEqual([false])
    expect(searchesOf('b')).toEqual([false, true, true])
  })

  it('lists every flaky snapshot by name in snapshot order, with its mode, and counts them among the passes', async () => {
    const { project } = await createRun(['a', 'b', 'c'], {
      a: defaultRunSnapshot,
      'a.dark': darkSnapshot,
      b: defaultRunSnapshot,
      c: defaultRunSnapshot,
    })
    const { options } = fakeBrowser(
      {
        a: { byGlobals: { 'theme:dark': { captures: [{ snapshot: otherSnapshot }, { snapshot: darkSnapshot }] } } },
        b: { captures: [{ snapshot: otherSnapshot }, {}] },
        c: { snapshot: otherSnapshot },
      },
      { read: { options: { a: { modes: { dark: twoModes.modes.dark } } } } },
    )
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(1)
    expect(withoutTimes(result.stdout)).toBe(
      printed(
        headerOf('test', 4),
        '✓ web  a  N ms',
        '✓ web  a  dark  N ms · flaky',
        '✓ web  b  N ms · flaky',
        '✗ web  c  differs: 100 differ, 20 allowed',
        flakyHeading,
        '  web  a  dark',
        '  web  b',
        '3 passed (2 flaky) · 1 differs',
      ),
    )
  })
})

/**
 * The heading `update` lists its flaky snapshots under.
 */
const updateFlakyHeading = 'Flaky snapshots, whose loads disagreed:'

/**
 * A mid grey PNG file of the same size as `defaultRunSnapshot`, whose 100 pixels all differ from `defaultRunSnapshot`'s and
 * from `otherSnapshot`'s.
 */
const greySnapshot = new Uint8Array(await greyPng(10, 10, 128))

/**
 * The detail of a story whose page changed by 100 pixels in the second after its first capture.
 */
const changedDetail =
  'broken: The story changed in the second after its capture: 100 differ, 20 allowed. Use its wait hook to wait ' +
  'until it settles.'

/**
 * The detail of a story none of whose 3 loads agreed.
 */
const unstableDetail = "broken: No two of the story's 3 loads agreed, so its baseline wasn't written."

describe('runCli update stability checks', () => {
  it('lists the flaky snapshots after the written and deleted paths, and exits 0', async () => {
    const { project, folder } = await createRun(['a', 'b', 'c'], { a: defaultRunSnapshot, gone: defaultRunSnapshot })
    const { options, record } = fakeBrowser({
      a: { captures: [{ snapshot: otherSnapshot }, {}] },
      b: { captures: [{}, { snapshot: otherSnapshot }, { snapshot: otherSnapshot }] },
    })
    const result = await runCli(['update'], {}, project, options)

    expect(result).toEqual({
      exitCode: 0,
      stdout: printed(
        headerOf('update', 3),
        '✓ web  a  kept · flaky',
        '✓ web  b  written: missing · flaky',
        '✓ web  c  written: missing',
        '2 written · 1 deleted · 1 kept',
        'written .visual-check/baselines/b.png',
        'written .visual-check/baselines/c.png',
        'deleted .visual-check/baselines/gone.png',
        updateFlakyHeading,
        '  web  a',
        '  web  b',
      ),
      stderr: '',
    })
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(defaultRunSnapshot)
    expect(new Uint8Array(readFileSync(join(folder, 'b.png')))).toEqual(otherSnapshot)
    expect(storyIdsOf(record.urls).sort()).toEqual(['a', 'a', 'b', 'b', 'b', 'c', 'c'])
  })

  it('breaks a story that changed after its capture and ones whose loads never agree, writes nothing, and exits 1', async () => {
    const { project, folder } = await createRun(['a', 'b', 'c'], { a: otherSnapshot, c: otherSnapshot })
    const { options, record } = fakeBrowser({
      a: { snapshotLater: greySnapshot },
      b: { captures: [{}, { snapshot: otherSnapshot }, { snapshot: greySnapshot }] },
      c: { captures: [{}, { snapshot: greySnapshot }, { snapshot: otherSnapshot }] },
    })
    const result = await runCli(['update'], {}, project, options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(
        headerOf('update', 3),
        `! web  a  ${changedDetail}`,
        `! web  b  ${unstableDetail}`,
        `! web  c  ${unstableDetail}`,
        '0 written · 3 broken',
      ),
      stderr: '',
    })
    expect(readdirSync(folder).sort()).toEqual(['a.png', 'c.png'])
    expect(new Uint8Array(readFileSync(join(folder, 'a.png')))).toEqual(otherSnapshot)
    expect(new Uint8Array(readFileSync(join(folder, 'c.png')))).toEqual(otherSnapshot)
    expect(storyIdsOf(record.urls).sort()).toEqual(['a', 'b', 'b', 'b', 'c', 'c', 'c'])
  })

  it('loads a story at most 3 times, whatever retries says', async () => {
    const { project } = await createRun(['a'], {}, 'retries: 5')
    const { options, record } = fakeBrowser({
      a: { captures: [{}, { snapshot: otherSnapshot }, { snapshot: greySnapshot }] },
    })
    const result = await runCli(['update'], {}, project, options)

    expect(result.stdout).toBe(printed(headerOf('update', 1), `! web  a  ${unstableDetail}`, '0 written · 1 broken'))
    expect(storyIdsOf(record.urls)).toEqual(['a', 'a', 'a'])
  })

  it('keeps a baseline within tolerance after one load and one capture', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const { options, record } = fakeBrowser({ a: { snapshotLater: otherSnapshot } })
    const result = await runCli(['update'], {}, project, options)

    expect(result.stdout).toBe(printed(headerOf('update', 1), '✓ web  a  kept', '0 written · 1 kept'))
    expect(record.captures.map(({ id, onLoad }) => [id, onLoad])).toEqual([['a', 1]])
  })

  it('captures the same page again on the first load only, the delay after its first capture', async () => {
    const { project } = await createRun(['a'])
    const { options, record } = fakeBrowser()
    const result = await runCli(['update'], {}, project, { ...options, recaptureDelayMs: 50 })
    const times = record.captures.map(({ at }) => at)

    expect(result.exitCode).toBe(0)
    expect(record.captures.map(({ onLoad }) => onLoad)).toEqual([1, 2, 1])
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(45)
  })

  it('never captures a page twice on one load in test', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot })
    const { options, record } = fakeBrowser({
      a: { snapshotLater: otherSnapshot },
      b: { snapshotLater: otherSnapshot, captures: [{ snapshot: otherSnapshot }, {}] },
    })
    const result = await runCli(['test'], {}, project, options)

    expect(withoutTimes(result.stdout)).toBe(
      printed(
        headerOf('test', 2),
        '✓ web  a  N ms',
        '✓ web  b  N ms · flaky',
        flakyHeading,
        '  web  b',
        '2 passed (1 flaky)',
      ),
    )
    expect(record.captures.map(({ id, onLoad }) => [id, onLoad]).sort()).toEqual([
      ['a', 1],
      ['b', 1],
      ['b', 1],
    ])
  })
})

/**
 * Makes changes to white over the square of `size` × `size` pixels whose top left pixel is at `x`, `y`.
 */
function whiteSquare(x: number, y: number, size: number): PixelChange[] {
  return Array.from({ length: size * size }, (_, index) => ({
    x: x + (index % size),
    y: y + Math.floor(index / size),
    rgba: [255, 255, 255, 255],
  }))
}

/**
 * A black PNG file of the same size as `defaultRunSnapshot`, with a white square of 5 × 5 pixels from 2, 2: 25 pixels
 * that differ, beyond the default tolerance at scale 1.
 */
const squareSnapshot = new Uint8Array(await greyPng(10, 10, 0, whiteSquare(2, 2, 5)))

/**
 * The line of story `a` when its snapshot is `squareSnapshot`.
 */
const squareLine = '✗ web  a  differs: 25 differ, 20 allowed'

/**
 * Remote content from `images.unsplash.com` that covers the white square of `squareSnapshot` exactly.
 */
const squareRemote = [{ host: 'images.unsplash.com', x: 2, y: 2, width: 5, height: 5 }]

/**
 * Remote content from `images.unsplash.com` in a corner, far from the white square of `squareSnapshot`.
 */
const cornerRemote = [{ host: 'images.unsplash.com', x: 9, y: 9, width: 1, height: 1 }]

/**
 * The hint under a snapshot's line when it differs only inside remote content from `images.unsplash.com`.
 */
const unsplashHint = [
  '  hint: Differs only inside remote content from images.unsplash.com. A CDN can serve different bytes to different ' +
    'machines. Mask it by host:',
  "    { host: 'images.unsplash.com' }",
  '  See https://visual-check.vercel.app/docs/remote-content',
]

describe('runCli remote content hint', () => {
  it('hints at a host mask when a retry differs only inside remote content, and still fails the snapshot', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const { options } = fakeBrowser({
      a: { captures: [{ snapshot: squareSnapshot }, { snapshot: squareSnapshot, remote: squareRemote }] },
    })
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({
      exitCode: 1,
      stdout: printed(headerOf('test', 1), squareLine, ...unsplashHint, '0 passed · 1 differs'),
      stderr: '',
    })
  })

  it('gives no hint when the first capture or the last retry differs in size', async () => {
    const whole = [{ host: 'images.unsplash.com', x: 0, y: 0, width: 10, height: 12 }]
    const runs = [
      [{ snapshot: tallerSnapshot }, { snapshot: squareSnapshot, remote: whole }],
      [{ snapshot: squareSnapshot }, { snapshot: tallerSnapshot, remote: whole }],
    ]

    for (const captures of runs) {
      const { project } = await createRun(['a'], { a: defaultRunSnapshot })
      const result = await runCli(['test'], {}, project, fakeBrowser({ a: { captures } }).options)

      expect(result.exitCode).toBe(1)
      expect(result.stdout).not.toContain('hint:')
    }
  })

  it('gives no hint when a differing pixel lies more than 1 px outside the remote content', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const remote = [{ host: 'images.unsplash.com', x: 4, y: 4, width: 3, height: 3 }]
    const { options } = fakeBrowser({
      a: { captures: [{ snapshot: squareSnapshot }, { snapshot: squareSnapshot, remote }] },
    })
    const result = await runCli(['test'], {}, project, options)

    expect(result.stdout).toBe(printed(headerOf('test', 1), squareLine, '0 passed · 1 differs'))
  })

  it('counts a differing pixel within 1 px of the remote content as inside it, for anti-aliased edges', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const remote = [{ host: 'images.unsplash.com', x: 3, y: 3, width: 3, height: 3 }]
    const { options } = fakeBrowser({
      a: { captures: [{ snapshot: squareSnapshot }, { snapshot: squareSnapshot, remote }] },
    })
    const result = await runCli(['test'], {}, project, options)

    expect(result.stdout).toBe(printed(headerOf('test', 1), squareLine, ...unsplashHint, '0 passed · 1 differs'))
  })

  it('hints by remote content that reaches past the image', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const remote = [{ host: 'images.unsplash.com', x: -3, y: -3, width: 10, height: 10 }]
    const { options } = fakeBrowser({
      a: { captures: [{ snapshot: squareSnapshot }, { snapshot: squareSnapshot, remote }] },
    })
    const result = await runCli(['test'], {}, project, options)

    expect(result.stdout).toBe(printed(headerOf('test', 1), squareLine, ...unsplashHint, '0 passed · 1 differs'))
  })

  it('grows the margin with the device scale factor, rounded up', async () => {
    // The remote content covers image pixels 6 to 13 at scale 2, and 4 to 15 with the margin of 2.
    const remote = [{ host: 'images.unsplash.com', x: 3, y: 3, width: 4, height: 4 }]
    const hintsOf = async (snapshot: Uint8Array): Promise<boolean> => {
      const { project } = await createRun(['a'], { a: new Uint8Array(await greyPng(20, 20, 0)) })
      const { options } = fakeBrowser(
        { a: { captures: [{ snapshot }, { snapshot, remote }] } },
        { read: { options: { a: { viewport: { deviceScaleFactor: 2 } } } } },
      )
      const result = await runCli(['test'], {}, project, options)

      expect(result.exitCode).toBe(1)

      return result.stdout.includes('hint:')
    }

    expect(await hintsOf(new Uint8Array(await greyPng(20, 20, 0, whiteSquare(4, 4, 10))))).toBe(true)
    expect(await hintsOf(new Uint8Array(await greyPng(20, 20, 0, whiteSquare(3, 3, 11))))).toBe(false)
  })

  it('gives no hint with retries set to 0', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, 'retries: 0')
    const { options } = fakeBrowser({ a: { snapshot: squareSnapshot, remote: squareRemote } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.stdout).toBe(printed(headerOf('test', 1), squareLine, '0 passed · 1 differs'))
  })

  it('gives no hint to a snapshot that passes on a retry', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const { options } = fakeBrowser({ a: { captures: [{ snapshot: squareSnapshot }, { remote: squareRemote }] } })
    const result = await runCli(['test'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).not.toContain('hint:')
  })

  it('gives no hint when the last retry is broken', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, 'retries: 2')
    const { options } = fakeBrowser({
      a: {
        captures: [{ snapshot: squareSnapshot }, { snapshot: squareSnapshot, remote: squareRemote }, { broken: true }],
      },
    })
    const result = await runCli(['test'], {}, project, options)

    expect(result.stdout).toBe(printed(headerOf('test', 1), squareLine, '0 passed · 1 differs'))
  })

  it('names each host whose remote content holds a differing pixel once, in the order of its boxes', async () => {
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
    const remote = [
      { host: 'b.com', x: 2, y: 2, width: 2, height: 5 },
      { host: 'a.com', x: 9, y: 9, width: 1, height: 1 },
      { host: 'b.com', x: 4, y: 2, width: 1, height: 5 },
      { host: 'c.com', x: 5, y: 2, width: 2, height: 5 },
    ]
    const { options } = fakeBrowser({
      a: { captures: [{ snapshot: squareSnapshot }, { snapshot: squareSnapshot, remote }] },
    })
    const result = await runCli(['test'], {}, project, options)

    expect(result.stdout).toBe(
      printed(
        headerOf('test', 1),
        squareLine,
        '  hint: Differs only inside remote content from b.com and c.com. A CDN can serve different bytes to different ' +
          'machines. Mask it by host:',
        "    { host: 'b.com' }",
        "    { host: 'c.com' }",
        '  See https://visual-check.vercel.app/docs/remote-content',
        '0 passed · 1 differs',
      ),
    )
  })

  it("hints by the last retry's remote content alone", async () => {
    const hintsOf = async (captures: FakeStory[]): Promise<boolean> => {
      const { project } = await createRun(['a'], { a: defaultRunSnapshot }, 'retries: 2')
      const result = await runCli(['test'], {}, project, fakeBrowser({ a: { captures } }).options)

      return result.stdout.includes('hint:')
    }
    const first = { snapshot: squareSnapshot, remote: squareRemote }

    expect(
      await hintsOf([
        first,
        { snapshot: squareSnapshot, remote: squareRemote },
        { snapshot: squareSnapshot, remote: cornerRemote },
      ]),
    ).toBe(false)
    expect(
      await hintsOf([
        first,
        { snapshot: squareSnapshot, remote: cornerRemote },
        { snapshot: squareSnapshot, remote: squareRemote },
      ]),
    ).toBe(true)
  })

  it('prints the hint of a finished snapshot when the run stops with exit 2', async () => {
    const { project } = await createRun(
      ['a', 'b', 'c'],
      { a: defaultRunSnapshot, b: defaultRunSnapshot, c: defaultRunSnapshot },
      'workers: 1',
    )
    const { options } = fakeBrowser({
      a: { captures: [{ snapshot: squareSnapshot }, { snapshot: squareSnapshot, remote: squareRemote }] },
      b: { browserExits: true },
      c: { browserExits: true },
    })
    const result = await runCli(['test'], {}, project, options)

    expect(result).toEqual({
      exitCode: 2,
      stdout: printed(headerOf('test', 3, 1), squareLine, ...unsplashHint, `! web  b  ${browserExitedDetail}`),
      stderr: `${relaunchNotice}${secondExitMessage}`,
    })
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
    expect(new Uint8Array(readFileSync(join(folder, shortened)))).toEqual(defaultRunSnapshot)
  })
})

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

describe('runCli capture area and masks', () => {
  const options = {
    a: {
      element: '#card',
      masks: {
        clock: { selector: '.clock' },
        ads: { host: 'ads.example.com' },
        gone: null,
        ghost: { selector: '.ghost' },
      },
    },
    b: { element: null, masks: null },
  }

  it('captures each story with its element and its masks, leaving out one set to null', async () => {
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot })
    const { options: run, record } = fakeBrowser({}, { read: { options } })
    const result = await runCli(['test'], {}, project, run)

    expect(result.exitCode).toBe(0)
    expect(record.preparations.sort((one, other) => one.id.localeCompare(other.id))).toEqual([
      {
        id: 'a',
        element: '#card',
        masks: [
          { name: 'clock', selector: '.clock' },
          { name: 'ads', host: 'ads.example.com' },
          { name: 'ghost', selector: '.ghost' },
        ],
        findRemote: false,
      },
      { id: 'b', element: null, masks: [], findRemote: false },
    ])
  })

  it('does the same in update', async () => {
    const { project } = await createRun(['a', 'b'])
    const { options: run, record } = fakeBrowser({}, { read: { options } })
    const result = await runCli(['update'], {}, project, run)

    expect(result.exitCode).toBe(0)
    // Each missing baseline takes two loads.
    expect(record.preparations.map(({ id, element }) => [id, element]).sort()).toEqual([
      ['a', '#card'],
      ['a', '#card'],
      ['b', null],
      ['b', null],
    ])
  })
})

describe('runCli warning when a Storybook ignores the test path', () => {
  it('warns once at the end, naming the Storybook and its version, when the median is 50 ms or more', async () => {
    const { project } = await createRun(['a', 'b', 'c'], {
      a: defaultRunSnapshot,
      b: defaultRunSnapshot,
      c: defaultRunSnapshot,
    })

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
    const { project } = await createRun(['a', 'b', 'c'], {
      a: defaultRunSnapshot,
      b: defaultRunSnapshot,
      c: defaultRunSnapshot,
    })

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
    const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot })

    installStorybook(project, '9.1.2')

    const { options } = fakeBrowser({ a: { completingMs: 100 }, b: { completingMs: 120 } })
    const result = await runCli(['update'], {}, project, options)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('1 written · 1 kept')
    expect(result.stderr).toBe(testPathWarningOf('web', 'storybook 9.1.2', 110))
  })

  it("leaves out broken stories' times", async () => {
    const { project } = await createRun(['a', 'b', 'c'], {
      a: defaultRunSnapshot,
      b: defaultRunSnapshot,
      c: defaultRunSnapshot,
    })

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
      { a: defaultRunSnapshot, b: defaultRunSnapshot, c: defaultRunSnapshot },
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
      { a: defaultRunSnapshot, b: defaultRunSnapshot, c: defaultRunSnapshot, d: defaultRunSnapshot },
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

    // The missing baseline takes two loads.
    expect(record.viewports).toEqual([
      { width: 800, height: 600, deviceScaleFactor: 2, touch: true },
      { width: 800, height: 600, deviceScaleFactor: 2, touch: true },
    ])
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
      a: defaultRunSnapshot,
      b: defaultRunSnapshot,
      c: defaultRunSnapshot,
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
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, "platform: 'linux/arm64'")
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
      { a: defaultRunSnapshot, b: defaultRunSnapshot, c: defaultRunSnapshot },
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
      { a: defaultRunSnapshot, b: defaultRunSnapshot, c: defaultRunSnapshot, d: defaultRunSnapshot },
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
      { a: defaultRunSnapshot, b: defaultRunSnapshot, c: defaultRunSnapshot },
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
    // b's missing baseline takes two loads, so the browser exits after the second load's capture, the run's last.
    const { options, record } = fakeBrowser({ b: { captures: [{}, { browserExitsAfter: true }] } })
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
      {
        a: defaultRunSnapshot,
        b: defaultRunSnapshot,
        c: defaultRunSnapshot,
        d: defaultRunSnapshot,
        e: defaultRunSnapshot,
      },
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
      {
        a: defaultRunSnapshot,
        b: defaultRunSnapshot,
        c: defaultRunSnapshot,
        d: defaultRunSnapshot,
        e: defaultRunSnapshot,
      },
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
      { a: defaultRunSnapshot, b: defaultRunSnapshot, c: defaultRunSnapshot },
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
      { a: defaultRunSnapshot, b: defaultRunSnapshot, c: defaultRunSnapshot, d: defaultRunSnapshot },
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
      const { project } = await createRun(['a'], { a: defaultRunSnapshot })
      const result = await runCli(['test'], {}, project, failingLaunch(launchError))

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toBe(`${amd64Problem}${outputBlock}`)
    })

    it('exits 2 with the platform problem when the browser exits on the first capture', async () => {
      const { project } = await createRun(['a'], { a: defaultRunSnapshot }, 'workers: 1')
      const { options } = fakeBrowser({ a: emulatedExit })
      const result = await runCli(['test'], {}, project, options)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toBe(`${amd64Problem}${outputBlock}`)
    })

    it('breaks the story and relaunches as for any exit when the browser exits after another capture finished', async () => {
      const { project } = await createRun(
        ['a', 'b', 'c'],
        { a: defaultRunSnapshot, b: defaultRunSnapshot, c: defaultRunSnapshot },
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
      const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'workers: 2')
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
      const { project } = await createRun(['a'], { a: defaultRunSnapshot })
      const result = await runCli(['test'], {}, project, {
        ...failingLaunch(launchError),
        imageMarkerPath: writeMarker(markerOf('amd64')),
      })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toBe(`${amd64Problem}${outputBlock}`)
    })

    it("gives the usual message inside visual-check's image for platform 'host'", async () => {
      const { project } = await createRun(['a'], { a: defaultRunSnapshot }, "platform: 'host'")
      const result = await runCli(['test'], {}, project, {
        ...failingLaunch(launchError),
        imageMarkerPath: writeMarker(markerOf('amd64')),
      })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('Check that')
      expect(result.stderr).not.toContain("this machine can't run")
    })

    it('gives the platform problem when a launch rejects with the exit of the browser, as the proxy check does', async () => {
      const { project } = await createRun(['a'], { a: defaultRunSnapshot })
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
      const { project } = await createRun(['a', 'b'], { a: defaultRunSnapshot, b: defaultRunSnapshot }, 'workers: 1')
      const { options } = fakeBrowser({ a: { broken: true }, b: emulatedExit })
      const result = await runCli(['test'], {}, project, options)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toBe(`${amd64Problem}${outputBlock}`)
    })

    it('gives the platform problem when a story before the exit has no baseline, as it has no capture', async () => {
      const { project } = await createRun(['a', 'b'], { b: defaultRunSnapshot }, 'workers: 1')
      const { options } = fakeBrowser({ b: emulatedExit })
      const result = await runCli(['test'], {}, project, options)

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toBe(`${amd64Problem}${outputBlock}`)
    })

    it('names linux/amd64 as the fix when the config sets linux/arm64', async () => {
      const { project } = await createRun(['a'], { a: defaultRunSnapshot }, "platform: 'linux/arm64'")
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
      { a: defaultRunSnapshot, b: defaultRunSnapshot, c: defaultRunSnapshot },
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
    const { project } = await createRun(['a'], { a: defaultRunSnapshot }, 'workers: 3')
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
      const { project } = await createRun(['a'], { a: defaultRunSnapshot })
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
    const { project } = await createRun(['a'], { a: defaultRunSnapshot })
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
      { a: defaultRunSnapshot, c: defaultRunSnapshot },
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
