// The end-to-end check of visual-check's Storybook addon: it starts `storybook dev` on a throwaway project with the
// addon, drives the real manager in the headless shell, through the CLI's own driver, and checks what the addon shows and
// does. Run it with `pnpm turbo run e2e:addon --filter @visual-check/test-storybook-10-react`, which builds the packages
// first, with TEST_STORYBOOK_IMAGE naming the browser image. It prints one line per case, then each of its problems, and
// exits 1 when any case fails. What CI keeps of a failure goes to `e2e-output/addon/`: Storybook's output, and a
// screenshot of the manager for each case that failed.
//
// The project is `.addon-e2e/` in this package, so it resolves what this package does. It has copies of three of this
// Storybook's stories files and of their committed baselines. Storybook runs in it on port 6158, without `CI` in its
// environment, and with a cache of its own that starts empty.
//
// With `--host` the checks run the browser on the machine itself, with `platform: 'host'`, and need no
// TEST_STORYBOOK_IMAGE or docker. The baselines are then written by `update` first, since the committed ones need the
// image's fonts. The cases about containers check the headless shell's process, or aren't run.
//
// The manager always runs in the headless shell on the machine itself, which the CLI downloads into its cache.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { basename, dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import type { TestReportEntry } from '@visual-check/cli'
import {
  type Case,
  cliBin,
  committedBaselines,
  descendantsOf,
  diagnosticsDir,
  docker,
  executableOnPath,
  image,
  isRunning,
  localEnvironment,
  newContainers,
  noDockerTexts,
  packageDir,
  problemsOf,
  problemUnless,
  type RunningProcess,
  readBrowserPackage,
  runCases,
  runningProcesses,
  thisMachinesChromeForTestingPlatform,
  visualCheckContainers,
  waitUntil,
  withTemporaryFolder,
} from './e2e-support.ts'

/**
 * Whether the checks run the browser on the machine itself, as the `--host` argument says.
 */
const onHost = process.argv.includes('--host')

/**
 * The port Storybook runs on.
 */
const port = 6158

/**
 * Storybook's own address.
 */
const url = `http://127.0.0.1:${port}`

/**
 * The folder of the project, removed first and last.
 */
const projectDir = join(packageDir, '.addon-e2e')

/**
 * The folder of the project's stories.
 */
const storiesDir = join(projectDir, 'stories')

/**
 * The folder the addon's images go in, beside the baselines.
 */
const visualCheckDir = join(projectDir, '.visual-check')

/**
 * The project's baselines.
 */
const baselinesDir = join(visualCheckDir, 'baselines')

/**
 * The project's config.
 */
const configPath = join(projectDir, 'visual-check.config.ts')

/**
 * The component the project's card story renders in, outside the folder of the stories.
 */
const componentPath = join(projectDir, 'components', 'frame.tsx')

/**
 * Where what CI keeps of a failure goes.
 */
const outputDir = join(diagnosticsDir, 'addon')

/**
 * Storybook's command.
 */
const storybookBin = join(packageDir, 'node_modules', 'storybook', 'dist', 'bin', 'dispatcher.js')

/**
 * The module of the built CLI that launches the browser.
 */
const launcherPath = join(packageDir, 'node_modules', '@visual-check', 'cli', 'dist', 'commands', 'launch-browser.js')

/**
 * The addon's built preset.
 */
const presetPath = join(packageDir, 'node_modules', '@visual-check', 'storybook-addon', 'dist', 'preset.js')

/**
 * The stories files of this package that the project has copies of, without `.stories.tsx`.
 */
const storiesFiles = ['modes', 'card', 'button']

/**
 * A story with a default capture and the modes `dark` and `mobile`.
 */
const modesStory = 'modes--dark-and-mobile'

/**
 * A story with a default capture 500 px wide and the mode `narrow`, 375 px wide.
 */
const sizesStory = 'modes--viewport-precedence'

/**
 * A story with a default capture alone.
 */
const cardStory = 'card--default'

/**
 * A story that its case adds, then keeps from ever ending rendering.
 */
const heldStory = 'held--forever'

/**
 * The stories file of `heldStory`.
 */
const heldPath = join(storiesDir, 'held.stories.tsx')

/**
 * How long things may take, in milliseconds: Storybook to start or stop, `update` to write the baselines, a check, the
 * manager or Storybook to show something, a call in the page, results to turn stale, and processes and containers to go.
 */
const timeouts = {
  start: 180_000,
  stop: 30_000,
  update: 300_000,
  check: 180_000,
  show: 60_000,
  evaluate: 30_000,
  stale: 10_000,
  gone: 30_000,
}

/**
 * How long nothing must run, in milliseconds, for a case to say that nothing started.
 */
const quietMilliseconds = 5_000

/**
 * The size of a page.
 */
interface Viewport {
  /**
   * The width, in CSS pixels.
   */
  width: number
  /**
   * The height, in CSS pixels.
   */
  height: number
  /**
   * How many device pixels make one CSS pixel.
   */
  deviceScaleFactor: number
  /**
   * Whether it emulates a touch device.
   */
  touch: boolean
}

/**
 * How a page is set up.
 */
interface PageSetup {
  /**
   * What its user agent adds to the browser's own.
   */
  userAgentSuffix: string
  /**
   * Its time zone.
   */
  timezone: string
  /**
   * Its locale.
   */
  locale: string
  /**
   * Its colour scheme.
   */
  colorScheme: 'light' | 'dark'
  /**
   * A script that runs first in each of its documents.
   */
  initScript: string
  /**
   * Whether it watches its network requests.
   */
  watchRequests: boolean
}

/**
 * A page in the headless shell, as the CLI's driver gives it.
 */
interface Page {
  /**
   * Sets the size of the page.
   */
  setViewport: (viewport: Viewport) => Promise<void>
  /**
   * Loads a URL.
   */
  goto: (url: string, timeoutMs: number) => Promise<void>
  /**
   * Evaluates an expression and gives its value, or what the promise it gives resolves with.
   */
  evaluate: (expression: string, timeoutMs: number) => Promise<unknown>
  /**
   * Takes a screenshot of the page.
   */
  capture: (area: 'full-page') => Promise<Uint8Array>
}

/**
 * The headless shell, as the CLI's driver gives it.
 */
interface Driver {
  /**
   * Opens a page.
   */
  newPage: (setup: PageSetup) => Promise<Page>
  /**
   * Closes the browser.
   */
  close: () => Promise<void>
}

/**
 * What launching the headless shell on the machine itself needs.
 */
interface HostLaunch {
  /**
   * Where it runs.
   */
  in: 'host'
  /**
   * Chrome for Testing's name for the platform.
   */
  platform: string
  /**
   * The Chromium version.
   */
  version: string
  /**
   * The SHA-256 of the platform's download.
   */
  sha256: string
  /**
   * The version a download with another checksum names.
   */
  packageVersion: string
  /**
   * The environment, for the cache folder, the mirror and the proxy.
   */
  environment: NodeJS.ProcessEnv
  /**
   * Writes the progress of the download.
   */
  progress: (text: string) => void
}

/**
 * The module of the built CLI that launches the browser.
 */
interface Launcher {
  /**
   * Makes the launcher of one run.
   */
  createLaunchBrowser: () => (launch: HostLaunch) => Promise<Driver>
}

/**
 * What a check that finished came to.
 */
interface CheckedOutcome {
  /**
   * That it finished.
   */
  result: 'checked'
  /**
   * The story's snapshots.
   */
  snapshots: TestReportEntry[]
}

/**
 * What a check that a problem stopped came to.
 */
interface StoppedOutcome {
  /**
   * That it was stopped.
   */
  result: 'stopped'
  /**
   * The problem.
   */
  message: string
}

/**
 * A story's latest result, as the addon's state holds it.
 */
interface StoryResult {
  /**
   * The ID of the click that gave it.
   */
  id: string
  /**
   * What it came to.
   */
  outcome: CheckedOutcome | StoppedOutcome
}

/**
 * The run in flight.
 */
interface StoryRun {
  /**
   * How far it is.
   */
  step: string
}

/**
 * The addon's state, which the server holds.
 */
interface AddonState {
  /**
   * The run in flight, or `null`.
   */
  run: StoryRun | null
  /**
   * Each story's latest result, by the story's ID.
   */
  results: Record<string, StoryResult | undefined>
}

/**
 * The manager's channel.
 */
interface ManagerChannel {
  /**
   * Calls the listener at the next event with this name.
   */
  once: (name: string, listener: (payload: AddonState) => void) => void
  /**
   * Emits an event.
   */
  emit: (name: string) => void
}

/**
 * The addon's child process and what it started.
 */
interface Engine {
  /**
   * The child, or `undefined` when there is none.
   */
  child: RunningProcess | undefined
  /**
   * Everything that descends from the child.
   */
  started: RunningProcess[]
  /**
   * Those of them that are the browser itself, or the docker client of its container. Chromium's own processes, which
   * come and go with its pages, aren't among them.
   */
  browser: RunningProcess[]
}

/**
 * What a config sets of the project's Storybook.
 */
interface StorybookSettings {
  /**
   * Its URL. Its own address when not given.
   */
  url?: string
  /**
   * Its config folder. The default when not given.
   */
  configDir?: string
}

/**
 * What an image URL answers.
 */
interface ImageAnswer {
  /**
   * The status.
   */
  status: number | undefined
  /**
   * The `Content-Type`.
   */
  type: string | undefined
}

/**
 * Storybook, once it has started.
 */
let storybook: ChildProcess | undefined

/**
 * The browser the manager is open in, once it has launched.
 */
let driver: Driver | undefined

/**
 * The manager's page, once it's open.
 */
let manager: Page | undefined

/**
 * The containers that were there before, which don't count.
 */
const containersBefore = new Set(onHost ? [] : visualCheckContainers('all'))

/**
 * Lists what the check needs and doesn't have: the built packages, outside `--host` the name of the browser image, and
 * a free port.
 */
async function findSetupProblems(): Promise<string[]> {
  const built = [cliBin, launcherPath, presetPath].every(existsSync)

  return [
    ...problemUnless(
      built,
      'The packages are not built: run the check with pnpm turbo run e2e:addon --filter @visual-check/test-storybook-10-react, which builds them first.',
    ),
    ...problemUnless(
      onHost || Boolean(image),
      'TEST_STORYBOOK_IMAGE is not set: set it to the browser image, such as visual-check-chromium:amd64, or give --host.',
    ),
    ...problemUnless(await isPortFree(), `Port ${port} is in use: stop what serves it, since Storybook starts there.`),
  ]
}

/**
 * Whether the port is free, on every address and on the loopback one, which another server may hold apart.
 */
async function isPortFree(): Promise<boolean> {
  return (await canListen('::')) && (await canListen('127.0.0.1'))
}

/**
 * Whether a server can listen on the port at this address. One the machine doesn't have counts as free.
 */
async function canListen(host: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = createServer()

    server.on('error', (error: NodeJS.ErrnoException) => resolve(error.code !== 'EADDRINUSE'))
    server.listen(port, host, () => server.close(() => resolve(true)))
  })
}

/**
 * Whether Storybook answers with its index, and lists the story when one is given.
 */
async function answers(storyId?: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/index.json`, { signal: AbortSignal.timeout(timeouts.evaluate) })
    const index = (await response.json()) as { entries: Record<string, unknown> }

    return storyId === undefined || storyId in index.entries
  } catch {
    return false
  }
}

/**
 * Writes the project's config: its Storybook, at its own address unless the settings give another, the image outside
 * `--host`, and with it the platform `host`, unless the platform is to be the default one.
 */
function writeConfig(settings: StorybookSettings = {}, defaultPlatform = false): void {
  const config = {
    storybooks: { web: { url, ...settings } },
    image: onHost ? undefined : image,
    platform: onHost && !defaultPlatform ? 'host' : undefined,
  }

  writeFileSync(configPath, `export default ${JSON.stringify(config, null, 2)}\n`)
}

/**
 * Makes the project: Storybook's config with the addon, the stories, visual-check's config, and outside `--host` the
 * committed baselines of the stories.
 */
function createProject(): void {
  const storybookConfigDir = join(projectDir, '.storybook')

  rmSync(projectDir, { recursive: true, force: true })
  rmSync(outputDir, { recursive: true, force: true })

  for (const folder of [storybookConfigDir, storiesDir, dirname(componentPath), baselinesDir, outputDir]) {
    mkdirSync(folder, { recursive: true })
  }

  writeFileSync(
    join(storybookConfigDir, 'main.ts'),
    [
      "import { testStorybookConfig } from '../../.storybook/test-storybook-config.ts'",
      '',
      'export default {',
      '  ...testStorybookConfig(import.meta.url),',
      "  stories: [{ directory: '../stories', files: '*.stories.tsx' }],",
      "  addons: ['@visual-check/storybook-addon'],",
      '}',
      '',
    ].join('\n'),
  )
  cpSync(join(packageDir, '.storybook', 'visual-check.ts'), join(storybookConfigDir, 'visual-check.ts'))
  writeConfig()
  copyFiles(
    join(packageDir, 'stories'),
    storiesDir,
    storiesFiles.map((file) => `${file}.stories.tsx`),
  )
  addComponent()
  copyFiles(committedBaselines, baselinesDir, onHost ? [] : readdirSync(committedBaselines).filter(isOfProject))
}

/**
 * Copies these files of a folder into another.
 */
function copyFiles(from: string, to: string, names: string[]): void {
  for (const name of names) {
    cpSync(join(from, name), join(to, name))
  }
}

/**
 * Writes the component, which renders what it's given as it is, and has the project's card story render in it, so the
 * story's stories file imports it.
 *
 * @throws {Error} When the card story's file isn't as expected.
 */
function addComponent(): void {
  const storiesPath = join(storiesDir, 'card.stories.tsx')
  const source = readFileSync(storiesPath, 'utf8')
  const changed = source.replace('  component: Card,\n', '$&  decorators: [(Story) => <Frame><Story /></Frame>],\n')

  if (changed === source) {
    throw new Error("card.stories.tsx has no line for its component, which the project's copy adds a decorator after")
  }

  writeFileSync(storiesPath, `import { Frame } from '../components/frame.tsx'\n${changed}`)
  writeFileSync(
    componentPath,
    "import type { ReactNode } from 'react'\n\nexport const Frame = ({ children }: { children: ReactNode }) => <>{children}</>\n",
  )
}

/**
 * Whether a baseline is of a story the project has.
 */
function isOfProject(name: string): boolean {
  return storiesFiles.some((file) => name.startsWith(`${file}--`))
}

/**
 * Writes the project's baselines on the machine itself, with the CLI's `update`.
 *
 * @throws {Error} When `update` fails.
 */
function writeBaselines(): void {
  const run = spawnSync(process.execPath, [cliBin, 'update', '--all'], {
    cwd: projectDir,
    env: localEnvironment(),
    encoding: 'utf8',
    timeout: timeouts.update,
    killSignal: 'SIGKILL',
  })

  if (run.status !== 0) {
    throw new Error(`update exited ${run.status ?? run.signal}: ${run.stderr.trim() || run.stdout.trim()}`)
  }
}

/**
 * Changes the baselines the cases need changed: the `mobile` one of `modesStory` is missing and its `dark` one is the
 * default capture's, and the `narrow` one of `sizesStory` is its default capture's, which is wider.
 */
function changeBaselines(): void {
  const pathOf = (stem: string): string => join(baselinesDir, `${stem}.png`)

  rmSync(pathOf(`${modesStory}.mobile`))
  cpSync(pathOf(modesStory), pathOf(`${modesStory}.dark`))
  cpSync(pathOf(sizesStory), pathOf(`${sizesStory}.narrow`))
}

/**
 * Starts Storybook in the project, with this `PATH`, and waits until it answers.
 *
 * @throws {Error} When it ends first, or doesn't answer in time.
 */
async function startStorybook(path = process.env.PATH): Promise<void> {
  const output = openSync(join(outputDir, 'storybook.log'), 'a')
  const args = ['dev', '-p', String(port), '--exact-port', '--ci', '--no-open']
  const child = spawn(process.execPath, [storybookBin, ...args], {
    cwd: projectDir,
    env: {
      ...localEnvironment(),
      PATH: path,
      CACHE_DIR: join(projectDir, '.cache'),
      // Storybook doesn't start when it finds no package manager, and the PATH may have none.
      npm_config_user_agent: 'pnpm',
    },
    stdio: ['ignore', output, output],
  })

  closeSync(output)
  storybook = child

  await until(
    'Storybook answers',
    async () => {
      if (hasEnded(child)) {
        throw new Error(`Storybook ended before it answered: ${child.signalCode ?? child.exitCode}`)
      }

      return await answers()
    },
    timeouts.start,
  )
}

/**
 * Whether a process has ended.
 */
function hasEnded(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

/**
 * Ends Storybook with this signal, when it runs, and waits until it has gone, killing it when it hasn't in time. Gives
 * whether the signal alone ended it, or it didn't run.
 */
async function endStorybook(signal: NodeJS.Signals): Promise<boolean> {
  const child = storybook

  if (child === undefined || hasEnded(child)) {
    return true
  }

  child.kill(signal)

  const ended = await waitUntil(() => hasEnded(child), timeouts.stop)

  if (!ended) {
    child.kill('SIGKILL')
    await waitUntil(() => hasEnded(child), timeouts.stop)
  }

  return ended
}

/**
 * Gives Storybook's process ID.
 *
 * @throws {Error} When Storybook doesn't run.
 */
function storybookPid(): number {
  if (storybook?.pid === undefined || hasEnded(storybook)) {
    throw new Error("Storybook doesn't run")
  }

  return storybook.pid
}

/**
 * Opens the page the manager is driven in.
 */
async function openBrowser(): Promise<void> {
  const { createLaunchBrowser } = (await import(pathToFileURL(launcherPath).href)) as Launcher
  const { chromium, sha256 } = readBrowserPackage()
  const platform = thisMachinesChromeForTestingPlatform()

  driver = await createLaunchBrowser()({
    in: 'host',
    platform,
    version: chromium,
    sha256: sha256[platform] ?? '',
    // Only a download with another checksum names it.
    packageVersion: '0.0.0',
    environment: process.env,
    progress: (text) => process.stderr.write(text),
  })
  manager = await driver.newPage({
    userAgentSuffix: '',
    timezone: 'UTC',
    locale: 'en-US',
    colorScheme: 'light',
    initScript: '',
    watchRequests: false,
  })
  // Wide enough for the panel to show the images beside the rows, and tall enough for the sidebar to show every story.
  await manager.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1, touch: false })
}

/**
 * Gives the manager's page.
 *
 * @throws {Error} When it isn't open.
 */
function managerPage(): Page {
  if (manager === undefined) {
    throw new Error("The manager's page isn't open")
  }

  return manager
}

/**
 * Runs a function in the manager's page and gives what it gives. The function is sent as its own source, so it can use
 * nothing but its arguments and the page's globals.
 */
async function inManager<Args extends unknown[], Value>(
  run: (...args: Args) => Value | Promise<Value>,
  ...args: Args
): Promise<Value> {
  const argumentList = args.map((argument) => JSON.stringify(argument)).join(', ')

  return (await managerPage().evaluate(`(${run})(${argumentList})`, timeouts.evaluate)) as Value
}

/**
 * Waits until the condition holds.
 *
 * @throws {Error} When it doesn't in time, with what the panel says.
 */
async function until(
  what: string,
  condition: () => boolean | Promise<boolean>,
  timeoutMilliseconds = timeouts.show,
): Promise<void> {
  if (!(await waitUntil(condition, timeoutMilliseconds))) {
    throw new Error(`not within ${timeoutMilliseconds / 1000} s: ${what} (${await panelSays()})`)
  }
}

/**
 * Says what the panel shows, for the message of a wait that ran out.
 */
async function panelSays(): Promise<string> {
  if (manager === undefined) {
    return 'the manager is not open'
  }

  const texts = await textsOf(['run', 'empty', 'stale', 'error', 'disabled', 'row']).catch((error) => [String(error)])

  return `the panel says: ${texts.join(', ')}`
}

/**
 * Gives the CSS selector of a part of the addon's panel or menu item.
 */
function partOf(name: string): string {
  return `[data-visual-check="${name}"]`
}

/**
 * Gives the text of each of these parts of the panel that shows.
 */
async function textsOf(names: string[]): Promise<string[]> {
  return await inManager(
    (selector) =>
      [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((element) => element.checkVisibility())
        .map((element) => element.textContent.replace(/\s+/g, ' ').trim()),
    names.map(partOf).join(', '),
  )
}

/**
 * Whether an element shows.
 */
async function shows(selector: string): Promise<boolean> {
  return await inManager(
    (selector) => [...document.querySelectorAll(selector)].some((element) => element.checkVisibility()),
    selector,
  )
}

/**
 * Whether an image shows and has loaded.
 */
async function showsImage(name: string): Promise<boolean> {
  return await inManager((selector) => {
    const found = document.querySelector<HTMLImageElement>(selector)

    return found?.checkVisibility() === true && found.complete && found.naturalWidth > 0
  }, partOf(name))
}

/**
 * Waits until an element shows, then clicks it.
 */
async function click(selector: string): Promise<void> {
  await until(`${selector} shows`, () => shows(selector))
  await inManager((selector) => {
    const found = [...document.querySelectorAll<HTMLElement>(selector)].find((element) => element.checkVisibility())

    found?.click()
  }, selector)
}

/**
 * Clicks the panel's Check button once it can be used.
 */
async function clickCheck(): Promise<void> {
  await click(`${partOf('check')}[aria-disabled="false"]`)
}

/**
 * Loads the manager on a story, also when it's on it already, and shows the panel.
 */
async function openStory(storyId: string): Promise<void> {
  const tab = '[role="tab"][id$="visual-check/panel"]'

  await managerPage().goto(`${url}/?path=/story/${storyId}`, timeouts.show)
  await until('the Visual check tab is there', () => shows(tab))

  if (!(await shows(partOf('check')))) {
    await click(tab)
  }

  // The button can be used once the manager knows the story, and nothing runs.
  await until('the panel is on the story', () => shows(`${partOf('check')}[aria-disabled="false"]`))
}

/**
 * Reads the addon's state from the server, over the manager's channel.
 */
async function readState(): Promise<AddonState> {
  return await inManager(
    () =>
      new Promise<AddonState>((resolve) => {
        const channel = (globalThis as unknown as { __STORYBOOK_ADDONS_CHANNEL__: ManagerChannel })
          .__STORYBOOK_ADDONS_CHANNEL__

        channel.once('visual-check/state', resolve)
        channel.emit('visual-check/get-state')
      }),
  )
}

/**
 * Starts a check of a story, the one the panel is on unless `start` starts another's, and gives its result.
 */
async function checkStory(storyId: string, start: () => Promise<void> = clickCheck): Promise<StoryResult> {
  const earlier = (await readState()).results[storyId]
  let result: StoryResult | undefined

  await start()
  await until(
    `a check of ${storyId} ends with a result`,
    async () => {
      const { run, results } = await readState()

      result = results[storyId]

      return run === null && result !== undefined && result.id !== earlier?.id
    },
    timeouts.check,
  )

  return result as StoryResult
}

/**
 * Gives the problem unless the result is of a check in which every snapshot passed, and the panel says so.
 */
async function passedProblems(result: StoryResult): Promise<string[]> {
  const { outcome } = result

  if (outcome.result === 'stopped') {
    return [`the check stopped: ${outcome.message}`]
  }

  const failed = outcome.snapshots.filter(({ status }) => status !== 'passed')

  return [
    ...failed.map(({ id, status, message }) => `${id} is ${status}: ${message}`),
    ...problemUnless(outcome.snapshots.length > 0, 'the check took no snapshot'),
    ...(await shownProblems('the panel says Passed', async () => (await textsOf(['run'])).includes('Passed'))),
  ]
}

/**
 * Gives the problem unless the condition holds in time.
 */
async function shownProblems(
  what: string,
  condition: () => boolean | Promise<boolean>,
  timeoutMilliseconds = timeouts.show,
): Promise<string[]> {
  return problemUnless(
    await waitUntil(condition, timeoutMilliseconds),
    `not within ${timeoutMilliseconds / 1000} s: ${what}`,
  )
}

/**
 * Gives the problem when a run starts within `quietMilliseconds`, or the story's result changes.
 */
async function quietProblems(storyId: string, resultId: string | undefined): Promise<string[]> {
  const changed = await waitUntil(async () => {
    const { run, results } = await readState()

    return run !== null || results[storyId]?.id !== resultId
  }, quietMilliseconds)

  return problemUnless(!changed, `a run started, or ${storyId}'s result changed`)
}

/**
 * Gives the label of a story's status icon in the sidebar, or `null` when it has none.
 */
async function statusOf(storyId: string): Promise<string | null> {
  return await inManager(
    (selector) => document.querySelector(selector)?.getAttribute('aria-label') ?? null,
    `${sidebarItemOf(storyId)} [data-testid="tree-status-button"]`,
  )
}

/**
 * Gives the CSS selector of a story's item in the sidebar.
 */
function sidebarItemOf(storyId: string): string {
  return `[data-item-id="${storyId}"]`
}

/**
 * Gives the problem unless the story's status icon has this label in time, or no icon for `null`.
 */
async function statusProblems(storyId: string, label: string | null, within?: number): Promise<string[]> {
  return await shownProblems(
    label === null ? `${storyId} has no status icon` : `${storyId}'s status icon says ${label}`,
    async () => (await statusOf(storyId)) === label,
    within,
  )
}

/**
 * Finds the addon's child process among Storybook's, and what the child started.
 *
 * @throws {Error} When Storybook doesn't run.
 */
function findEngine(): Engine {
  const processes = runningProcesses()
  const under = (pid: number): RunningProcess[] => {
    const descendants = descendantsOf(pid, processes)

    return processes.filter((running) => descendants.includes(running.pid))
  }
  const child = under(storybookPid()).find(({ command }) => command.includes('addon-child'))
  const started = child === undefined ? [] : under(child.pid)

  return { child, started, browser: started.filter(({ command }) => !command.includes(' --type=')) }
}

/**
 * Gives the name of the container the addon's browser runs in, from its docker client's command line.
 *
 * @throws {Error} When there is none.
 */
function engineContainer(): string {
  const name = findEngine()
    .browser.map(({ command }) => / --name[ =](visual-check-[0-9a-f]{12}) /.exec(command)?.[1])
    .find((found) => found !== undefined)

  if (name === undefined) {
    throw new Error("the addon's browser runs in no container")
  }

  return name
}

/**
 * Gives the problem unless the addon's child process and its one browser, and the browser's container, are these.
 */
function sameBrowserProblems(engine: Engine, containers: string[]): string[] {
  const now = findEngine()
  const isSame = isDeepStrictEqual(
    [now.child, now.browser, runningContainers()],
    [engine.child, engine.browser, containers],
  )

  return problemUnless(
    isSame && engine.browser.length === 1,
    `the next check runs in another browser or process (${JSON.stringify(engine)}, then ${JSON.stringify(now)})`,
  )
}

/**
 * Lists the containers the checks started that run, none on the machine itself.
 */
function runningContainers(): string[] {
  return onHost ? [] : newContainers('running', containersBefore)
}

/**
 * Gives the problem unless every container the checks started goes in time.
 */
async function containersGoneProblems(): Promise<string[]> {
  if (onHost) {
    return []
  }

  return await shownProblems(
    'no container of visual-check is left',
    () => newContainers('all', containersBefore).length === 0,
    timeouts.gone,
  )
}

/**
 * Lists the files under a folder, as paths relative to it, sorted. None when the folder is missing.
 */
function filesIn(folder: string): string[] {
  if (!existsSync(folder)) {
    return []
  }

  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(folder.length + 1))
    .sort()
}

/**
 * Gives the baselines' bytes, by file name.
 */
function readBaselines(): Map<string, Buffer> {
  return new Map(filesIn(baselinesDir).map((name) => [name, readFileSync(join(baselinesDir, name))]))
}

/**
 * Starts Storybook, writes the baselines on the machine itself, and opens the manager: the panel has nothing to show,
 * and the addon has started no process.
 */
async function checkStart(): Promise<string[]> {
  await startStorybook()

  if (onHost) {
    writeBaselines()
  }

  changeBaselines()
  await openBrowser()
  await openStory(modesStory)

  return [
    ...(await shownProblems("the panel says the story isn't checked yet", () => shows(partOf('empty')))),
    ...problemUnless(findEngine().child === undefined, 'the addon started its process before the first check'),
  ]
}

/**
 * A check of a story with a passing, a changed and a missing baseline gives three rows and writes its images, and no
 * baseline. A second check uses the same browser.
 */
async function checkThreeRows(): Promise<string[]> {
  const baselines = readBaselines()

  await openStory(modesStory)

  await checkStory(modesStory)

  const rows = ['Default Passed', 'dark Visual diff', 'mobile Missing baseline']
  const problems = [
    ...(await shownProblems(`the rows say ${rows.join(', ')}`, async () =>
      isDeepStrictEqual(await textsOf(['row']), rows),
    )),
    ...(await statusProblems(modesStory, 'Test status: Error')),
  ]
  const containers = runningContainers()
  const engine = findEngine()

  await click(`li:nth-child(3) > ${partOf('row')}`)
  problems.push(
    ...(await shownProblems("mobile's snapshot shows", () => showsImage('image-snapshot'))),
    ...imageFilesProblems(),
    ...problemUnless(isDeepStrictEqual(readBaselines(), baselines), 'the check wrote a baseline'),
    ...problemUnless(onHost || containers.length === 1, `${containers.length} containers run, expected 1`),
  )

  await checkStory(modesStory)

  return [...problems, ...sameBrowserProblems(engine, containers)]
}

/**
 * Gives the problem unless the images of `modesStory`'s checks, and no others, are where the addon writes them.
 */
function imageFilesProblems(): string[] {
  const snapshots = filesIn(join(visualCheckDir, 'snapshots'))
  const diffs = filesIn(join(visualCheckDir, 'diffs'))

  return [
    ...problemUnless(
      isDeepStrictEqual(snapshots, [
        join('web', `${modesStory}.dark.baseline.png`),
        join('web', `${modesStory}.dark.snapshot.png`),
        join('web', `${modesStory}.mobile.snapshot.png`),
      ]),
      `.visual-check/snapshots holds ${snapshots.join(', ')}`,
    ),
    ...problemUnless(
      isDeepStrictEqual(diffs, [join('web', `${modesStory}.dark.png`)]),
      `.visual-check/diffs holds ${diffs.join(', ')}`,
    ),
  ]
}

/**
 * The viewer of a visual diff: the slider, the visual diff alone, a size difference, the images' URLs, and an image whose
 * file is gone.
 */
async function checkViewer(): Promise<string[]> {
  await openStory(modesStory)
  await checkStory(modesStory)
  await click(`li:nth-child(2) > ${partOf('row')}`)

  return [
    ...(await sliderProblems()),
    ...(await diffViewProblems()),
    ...(await imageUrlProblems()),
    ...(await goneImageProblems()),
    ...(await sizeDifferenceProblems()),
  ]
}

/**
 * The slider shows both images over each other, and moving it moves where they are cut.
 */
async function sliderProblems(): Promise<string[]> {
  const shown = async (): Promise<boolean> =>
    (await showsImage('image-baseline')) && (await showsImage('image-snapshot'))
  const problems = [
    ...(await shownProblems('the baseline and the snapshot show', shown)),
    ...(await shownProblems('the stage has a size', async () => {
      const { width, height } = await boxOf('stage')

      return width > 0 && height > 0
    })),
  ]
  const before = await clipOf()

  await inManager((selector) => {
    const slider = document.querySelector<HTMLInputElement>(selector)

    slider?.focus()
    slider?.stepUp(20)
    slider?.dispatchEvent(new Event('input', { bubbles: true }))
  }, partOf('slider'))

  return [
    ...problems,
    ...problemUnless(before === 'inset(0px 0px 0px 50%)', `the snapshot is first cut as ${before}`),
    ...(await shownProblems(
      'the slider moves the cut to 70%',
      async () => (await clipOf()) === 'inset(0px 0px 0px 70%)',
    )),
  ]
}

/**
 * Gives where the snapshot is cut under the slider.
 */
async function clipOf(): Promise<string> {
  return await inManager((selector) => {
    const layer = document.querySelector(selector)

    return layer === null ? 'nothing' : getComputedStyle(layer).clipPath
  }, partOf('layer-snapshot'))
}

/**
 * Gives the size of a part of the panel on the page, zero when it isn't there.
 */
async function boxOf(name: string): Promise<Pick<DOMRect, 'width' | 'height'>> {
  return await inManager((selector) => {
    const { width = 0, height = 0 } = document.querySelector(selector)?.getBoundingClientRect() ?? {}

    return { width, height }
  }, partOf(name))
}

/**
 * The visual diff shows alone, with no slider, and the slider is back after.
 */
async function diffViewProblems(): Promise<string[]> {
  await click(partOf('view-diff'))

  const problems = [
    ...(await shownProblems('the visual diff shows', () => showsImage('image-diff'))),
    ...problemUnless(!(await shows(partOf('slider'))), 'the slider shows with the visual diff'),
  ]

  await click(partOf('view-slider'))

  return [
    ...problems,
    ...(await shownProblems('the slider is back', () => shows(partOf('slider')))),
    ...problemUnless(!(await shows(partOf('image-diff'))), 'the visual diff shows with the slider'),
  ]
}

/**
 * An image's URL answers, but not with `..` in its path, and not for a page of another site.
 */
async function imageUrlProblems(): Promise<string[]> {
  const path = new URL(
    await inManager(
      (selector) => document.querySelector<HTMLImageElement>(selector)?.src ?? '',
      partOf('image-baseline'),
    ),
  ).pathname
  const imagesRoot = path.slice(0, path.indexOf('/snapshots/'))
  const expected: [what: string, answer: ImageAnswer, status: number][] = [
    ['an image', await answerOf(path), 200],
    ['a path with ..', await answerOf(`${imagesRoot}/snapshots/../../visual-check.config.ts`), 404],
    ['a path with %2e%2e', await answerOf(`${imagesRoot}/snapshots/%2e%2e/%2e%2e/visual-check.config.ts`), 404],
    ['another site', await answerOf(path, { 'Sec-Fetch-Site': 'cross-site' }), 403],
  ]

  return [
    ...expected.flatMap(([what, { status }, wanted]) =>
      problemUnless(status === wanted, `${what} answers ${status}, expected ${wanted}`),
    ),
    ...problemUnless(expected[0]?.[1].type === 'image/png', `an image's type is ${expected[0]?.[1].type}`),
  ]
}

/**
 * Asks Storybook for a path as it is, which `fetch` would normalise.
 */
async function answerOf(path: string, headers: Record<string, string> = {}): Promise<ImageAnswer> {
  return await new Promise((resolve, reject) => {
    const request = get({ host: '127.0.0.1', port, path, headers, timeout: timeouts.evaluate }, (response) => {
      response.resume()
      resolve({ status: response.statusCode, type: response.headers['content-type'] })
    })

    request.on('timeout', () => request.destroy(new Error(`${path} didn't answer`)))
    request.on('error', reject)
  })
}

/**
 * With the snapshot's file gone, the slider says so in place of the images, and the visual diff still shows. The next
 * check brings it back.
 */
async function goneImageProblems(): Promise<string[]> {
  rmSync(join(visualCheckDir, 'snapshots', 'web', `${modesStory}.dark.snapshot.png`))
  await openStory(modesStory)
  await click(`li:nth-child(2) > ${partOf('row')}`)

  const gone = async (): Promise<boolean> => (await textsOf(['gone'])).includes('This image is gone. Check again.')
  const problems = [
    ...(await shownProblems('the panel says the image is gone', gone)),
    ...problemUnless(!(await shows(partOf('stage'))), 'the stage shows with an image gone'),
  ]

  await click(partOf('view-diff'))
  problems.push(...(await shownProblems('the visual diff shows', () => showsImage('image-diff'))))
  await click(partOf('view-slider'))
  await checkStory(modesStory)

  return [...problems, ...(await shownProblems('the snapshot is back', () => showsImage('image-snapshot')))]
}

/**
 * A baseline and a snapshot of different sizes show at one scale: a snapshot of 375 px takes three quarters of a stage
 * as wide as a baseline of 500 px.
 */
async function sizeDifferenceProblems(): Promise<string[]> {
  await openStory(sizesStory)
  await checkStory(sizesStory)

  const problems = await shownProblems('the snapshot of another size shows', () => showsImage('image-snapshot'))
  const [stage, baseline, snapshot] = [
    await boxOf('stage'),
    await boxOf('image-baseline'),
    await boxOf('image-snapshot'),
  ]

  return [
    ...problems,
    ...problemUnless(
      isAbout(baseline.width, stage.width) && isAbout(snapshot.width, stage.width * 0.75) && snapshot.width > 0,
      `the images are ${baseline.width} and ${snapshot.width} wide on a stage of ${stage.width}`,
    ),
  ]
}

/**
 * Whether two lengths are within 2 px, for the stage's border.
 */
function isAbout(one: number, other: number): boolean {
  return Math.abs(one - other) <= 2
}

/**
 * A change to a stories file, which changes Storybook's index too, marks the result stale, and so does one to a
 * component, which only the preview hears of.
 */
async function checkStale(): Promise<string[]> {
  await openStory(cardStory)
  // It hears of changes from here on.
  await until('the preview shows the card', () =>
    inManager(() => {
      const preview = document.querySelector<HTMLIFrameElement>('#storybook-preview-iframe')

      return Boolean(preview?.contentDocument?.querySelector('.card'))
    }),
  )

  return [...(await staleProblems(join(storiesDir, 'card.stories.tsx'))), ...(await staleProblems(componentPath))]
}

/**
 * A change to this file after a check marks the card story's result stale and takes its status icon, and nothing runs.
 */
async function staleProblems(path: string): Promise<string[]> {
  const result = await checkStory(cardStory)
  const problems = [
    ...(await passedProblems(result)),
    ...(await statusProblems(cardStory, 'Test status: Success')),
    ...problemUnless(!(await shows(partOf('stale'))), 'the result is stale before anything changed'),
  ]

  appendFileSync(path, '\n// visual-check e2e: a change\n')
  problems.push(
    ...(await shownProblems('the panel says the result is stale', () => shows(partOf('stale')), timeouts.stale)),
    ...(await statusProblems(cardStory, null, timeouts.stale)),
    ...(await quietProblems(cardStory, result.id)),
  )

  return problems.map((problem) => `${basename(path)}: ${problem}`)
}

/**
 * The item of a story's menu checks it, Storybook's own button runs nothing, and the results outlive the manager's page.
 */
async function checkSidebar(): Promise<string[]> {
  const item = sidebarItemOf(cardStory)

  await openStory(modesStory)

  if (!(await shows(item))) {
    await click('#card')
  }

  const result = await checkStory(cardStory, async () => {
    await click(`${item} [data-testid="context-menu"]`)
    await click(`${partOf('menu-check')}[aria-disabled="false"]`)
  })
  const path = await inManager(() => new URLSearchParams(location.search).get('path'))
  const problems = [
    ...(await passedProblems(result)),
    ...problemUnless(path === `/story/${cardStory}`, `the menu item leaves the manager on ${path}`),
    ...(await statusProblems(cardStory, 'Test status: Success')),
  ]

  await click('button[aria-label="Run tests"]')
  problems.push(...(await quietProblems(cardStory, result.id)))
  await openStory(cardStory)

  return [
    ...problems,
    ...(await shownProblems('the reloaded manager shows the result', async () =>
      isDeepStrictEqual(await textsOf(['row']), ['Default Passed']),
    )),
    ...(await statusProblems(cardStory, 'Test status: Success')),
    ...problemUnless(
      (await readState()).results[cardStory]?.id === result.id,
      'the reloaded manager shows another result',
    ),
  ]
}

/**
 * Cancels the run in flight once it's at this step. Gives the problems with how it ended: the panel doesn't say it was
 * cancelled, or the story's result isn't the one it had.
 */
async function cancelProblems(storyId: string, step: string): Promise<string[]> {
  const earlier = (await readState()).results[storyId]

  if (earlier === undefined) {
    return [`${storyId} has no result to keep`]
  }

  await clickCheck()
  await until(`the check is ${step}`, async () => (await readState()).run?.step === step, timeouts.check)
  await click(partOf('cancel'))
  await until('the cancelled run ends', async () => (await readState()).run === null, timeouts.check)

  return [
    ...(await shownProblems('the panel says Cancelled', async () => (await textsOf(['run'])).includes('Cancelled'))),
    ...problemUnless(
      isDeepStrictEqual((await readState()).results[storyId], earlier),
      `a check cancelled while ${step} changed the result of ${storyId}`,
    ),
  ]
}

/**
 * Writes the stories file of `heldStory`, with this play function.
 */
function writeHeldStory(play: string): void {
  writeFileSync(heldPath, `export default { title: 'Held' }\n\nexport const Forever = { play: ${play} }\n`)
}

/**
 * Whether the stories file of `heldStory`, as Storybook serves it, has this text.
 */
async function servesHeldStory(text: string): Promise<boolean> {
  const response = await fetch(`${url}/stories/held.stories.tsx`, { signal: AbortSignal.timeout(timeouts.evaluate) })

  return (await response.text()).includes(text)
}

/**
 * A check of `heldStory`, which ends, then one after a change that keeps the story from ever ending rendering, cancelled
 * while it captures. Gives the problems with how that ended.
 */
async function cancelCapturingProblems(): Promise<string[]> {
  writeHeldStory('() => undefined')
  await until('Storybook lists the added story', () => answers(heldStory))
  await openStory(heldStory)
  await checkStory(heldStory)
  writeHeldStory('() => new Promise(() => undefined)')
  await until('Storybook serves the changed story', () => servesHeldStory('new Promise'))
  await until("the changed story's result is stale", () => shows(partOf('stale')))

  return await cancelProblems(heldStory, 'capturing')
}

/**
 * A check can be cancelled while its config loads, here one that never does, and while it captures, here a story that
 * never ends rendering, so neither can be too late. Each leaves the story's result as it was, and the next check uses the
 * same browser.
 */
async function checkCancel(): Promise<string[]> {
  await openStory(cardStory)

  const problems = await passedProblems(await checkStory(cardStory))
  const containers = runningContainers()
  const engine = findEngine()

  try {
    writeFileSync(configPath, 'export default new Promise(() => setInterval(() => undefined, 60_000))\n')
    problems.push(...(await cancelProblems(cardStory, 'preparing')))
    writeConfig()
    problems.push(...(await cancelCapturingProblems()))
  } finally {
    writeConfig()
    rmSync(heldPath, { force: true })
  }

  await until('Storybook lists the added story no more', async () => !(await answers(heldStory)) && (await answers()))
  await openStory(cardStory)
  problems.push(...(await passedProblems(await checkStory(cardStory))))

  return [...problems, ...sameBrowserProblems(engine, containers)]
}

/**
 * Checks the card story with the config as it is, and gives the problem unless the check stops with this text and the
 * hint at `visual-check init`, in the panel too.
 */
async function configStopProblems(text: string): Promise<string[]> {
  const { outcome } = await checkStory(cardStory)

  return [
    ...problemUnless(
      outcome.result === 'stopped' && outcome.message.includes(text),
      `the check doesn't stop saying "${text}": ${JSON.stringify(outcome)}`,
    ),
    ...(await shownProblems(`the panel says "${text}"`, async () => (await errorText()).includes(text))),
    ...(await shownProblems('the panel hints at visual-check init', async () =>
      (await textsOf(['init-hint'])).join().includes('visual-check init'),
    )),
  ]
}

/**
 * Gives the problem the panel shows.
 */
async function errorText(): Promise<string> {
  return (await textsOf(['error'])).join()
}

/**
 * The config is read anew at every check: one for another Storybook or none stops the check with the CLI's message, and
 * a good one again needs no restart. A `url` at another port makes a notice.
 */
async function checkConfig(): Promise<string[]> {
  const problems: string[] = []
  const otherUrl = `http://127.0.0.1:${port + 1}`
  const notice = `This Storybook runs at ${url}. CLI runs check ${otherUrl}, the config's url.`
  // The search for a config stops at this folder, so it doesn't find this package's own.
  const searchEnd = join(projectDir, '.git')

  await openStory(cardStory)

  try {
    writeConfig({ configDir: 'other' })
    problems.push(
      ...(await configStopProblems(
        'visual-check.config.ts lists no Storybook whose config folder is .storybook. It lists web (other).',
      )),
    )
    rmSync(configPath)
    mkdirSync(searchEnd)
    problems.push(...(await configStopProblems('No visual-check.config.ts (or .mts, .js, .mjs) found')))
    writeConfig({ url: otherUrl })
    problems.push(
      ...(await passedProblems(await checkStory(cardStory))),
      ...(await shownProblems(`the panel says "${notice}"`, async () => (await textsOf(['notice'])).includes(notice))),
    )
  } finally {
    rmSync(searchEnd, { recursive: true, force: true })
    writeConfig()
  }

  return problems
}

/**
 * With the browser's container killed between two checks, the next one starts another and passes.
 */
async function checkBrowserExit(): Promise<string[]> {
  await openStory(cardStory)

  const problems = await passedProblems(await checkStory(cardStory))
  const container = engineContainer()

  docker(['kill', container])
  // The child has noticed once the client that ran the container has ended.
  await until("the killed container's client is gone", () => findEngine().started.length === 0)
  problems.push(...(await passedProblems(await checkStory(cardStory))))

  return [
    ...problems,
    ...problemUnless(engineContainer() !== container, 'the next check runs in the container that was killed'),
  ]
}

/**
 * This signal after a check ends Storybook, and the child process, the browser and its container are then gone. Starts
 * Storybook when it doesn't run.
 */
async function checkKilled(signal: NodeJS.Signals): Promise<string[]> {
  if (storybook === undefined || hasEnded(storybook)) {
    await startStorybook()
  }

  await openStory(cardStory)

  const problems = await passedProblems(await checkStory(cardStory))
  const { child, started } = findEngine()
  const processes = [child, ...started].filter((running) => running !== undefined)
  const browserRuns = started.some(({ command }) => command.includes(onHost ? 'chrome-headless-shell' : 'docker'))
  const ended = await endStorybook(signal)

  problems.push(
    ...problemUnless(ended, `Storybook still ran ${timeouts.stop / 1000} s after ${signal}`),
    ...problemUnless(browserRuns, "the check's browser isn't among the addon's processes"),
    ...(await shownProblems(
      `the addon's processes are gone (${processes.map(({ pid }) => pid).join(', ')})`,
      () => !processes.some(({ pid }) => isRunning(pid)),
      timeouts.gone,
    )),
    ...(await containersGoneProblems()),
  )
  killProcesses(processes)

  return problems
}

/**
 * Kills those of these processes that still run.
 */
function killProcesses(processes: RunningProcess[]): void {
  const running = runningProcesses()

  for (const { pid, command } of processes) {
    // Another process may have taken the ID.
    if (running.some((other) => other.pid === pid && other.command === command)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // It has just ended.
      }
    }
  }
}

/**
 * Makes a folder of links to the commands Storybook uses, for a `PATH` without docker.
 */
function linkCommands(folder: string): void {
  for (const name of ['node', 'git', 'sh']) {
    const path = executableOnPath(name)

    if (path !== undefined) {
      symlinkSync(path, join(folder, name))
    }
  }
}

/**
 * Starts Storybook with this `PATH` and the config's default platform, and shows the panel, runs `use` and ends Storybook
 * however `use` ends.
 */
async function withPath<T>(path: string, use: () => Promise<T>): Promise<T> {
  writeConfig({}, true)
  await endStorybook('SIGKILL')

  try {
    await startStorybook(path)
    await openStory(cardStory)

    return await use()
  } finally {
    await endStorybook('SIGKILL')
    writeConfig()
  }
}

/**
 * Neither Storybook's start nor the panel runs docker, here a stub that notes its calls, and the first check does.
 */
async function checkNoProbe(): Promise<string[]> {
  return await withTemporaryFolder(async (folder) => {
    const calls = join(folder, 'calls.txt')

    linkCommands(folder)
    writeFileSync(join(folder, 'docker'), `#!/bin/sh\necho "$@" >> '${calls}'\n`, { mode: 0o755 })

    return await withPath(folder, async () => {
      const problems = problemUnless(!existsSync(calls), 'docker ran before the first check')

      await clickCheck()

      return [
        ...problems,
        ...(await shownProblems('the check runs docker', () => existsSync(calls), timeouts.check)),
        ...problemUnless(findEngine().child !== undefined, 'the check started no process'),
      ]
    })
  })
}

/**
 * With no docker, the check stops with the CLI's message.
 */
async function checkNoDocker(): Promise<string[]> {
  return await withTemporaryFolder(async (folder) => {
    linkCommands(folder)

    return await withPath(folder, async () => {
      const { outcome } = await checkStory(cardStory)

      return [
        ...problemUnless(outcome.result === 'stopped', 'the check ran'),
        ...(await shownProblems(`the panel says ${noDockerTexts.join(' ')}`, async () => {
          const text = await errorText()

          return noDockerTexts.every((part) => text.includes(part))
        })),
      ]
    })
  })
}

/**
 * The cases, in order. Each one opens the story it needs, and those after the first need the Storybook it starts.
 */
function addonCases(): Case[] {
  return [
    { name: 'start: the panel has nothing to show, and the addon starts no process', run: checkStart },
    {
      name: `three rows: a check of ${modesStory} gives a pass, a visual diff and a missing baseline, writes their images and no baseline, and a second check uses the same browser`,
      run: checkThreeRows,
    },
    {
      name: "viewer: the slider moves the cut, the visual diff shows alone, an image's URL answers only its own page and path, an image whose file is gone says so, a size difference shows",
      run: checkViewer,
    },
    {
      name: 'stale: a changed stories file, and a changed component, marks the result stale and takes its status icon, and nothing runs',
      run: checkStale,
    },
    {
      name: "sidebar: the story's menu item checks it, its status icon shows, Run tests runs nothing, a reload keeps the results",
      run: checkSidebar,
    },
    {
      name: 'cancel: a check cancelled while its config loads or while it captures leaves the result as it was, and the next one uses the same browser',
      run: checkCancel,
    },
    {
      name: "config: one for another Storybook or none shows the CLI's message and the hint, a good one again needs no restart, another url makes a notice",
      run: checkConfig,
    },
    ...(onHost
      ? []
      : [
          {
            name: 'browser exit: with its container killed between checks, the next one passes in another',
            run: checkBrowserExit,
          },
        ]),
    ...(['SIGKILL', 'SIGTERM'] as const).map((signal) => ({
      name: `${signal}: Storybook's end takes the addon's process, the browser and its container along`,
      run: () => checkKilled(signal),
    })),
    { name: 'no probe: neither the start nor the panel runs docker, the first check does', run: checkNoProbe },
    { name: "no docker: the check shows the CLI's message", run: checkNoDocker },
    ...(onHost ? [] : [{ name: 'the end: no container is left', run: containersGoneProblems }]),
  ]
}

/**
 * Gives the case, so that a failure leaves a screenshot of the manager.
 */
function withScreenshot(testCase: Case, index: number): Case {
  return {
    name: testCase.name,
    run: async () => {
      const problems = await problemsOf(testCase)

      if (problems.length > 0) {
        await takeScreenshot(join(outputDir, `case-${index}.png`))
      }

      return problems
    },
  }
}

/**
 * Takes a screenshot of the manager, if it can.
 */
async function takeScreenshot(path: string): Promise<void> {
  try {
    writeFileSync(path, await managerPage().capture('full-page'))
  } catch (error) {
    console.error(`No screenshot: ${error}`)
  }
}

/**
 * Ends Storybook, whose end takes the addon's process along, and the browser, then removes the project.
 */
async function cleanUp(): Promise<void> {
  await Promise.all([endStorybook('SIGTERM'), driver?.close()])
  // A process that is ending may still write into it.
  rmSync(projectDir, { recursive: true, force: true, maxRetries: 10 })
}

/**
 * Runs the cases and resolves with whether all of them passed. However they end, Storybook, the browser and the project
 * are gone after, and what CI keeps is too when they passed.
 */
async function runAddonCases(): Promise<boolean> {
  let passed = false

  // The last resort, when the clean-up didn't end.
  process.on('exit', () => storybook?.kill('SIGKILL'))

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => {
      await Promise.race([cleanUp(), sleep(timeouts.stop)])
      process.exit(1)
    })
  }

  createProject()

  try {
    passed = await runCases(addonCases().map(withScreenshot))
  } finally {
    await cleanUp()
  }

  if (passed) {
    rmSync(outputDir, { recursive: true, force: true })
  }

  return passed
}

const setupProblems = await findSetupProblems()

if (setupProblems.length > 0) {
  console.error(setupProblems.join('\n'))
  process.exitCode = 1
} else {
  process.exitCode = (await runAddonCases()) ? 0 : 1
}
