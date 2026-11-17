import { readFileSync } from 'node:fs'
import { availableParallelism, totalmem } from 'node:os'
import { checkBrowserPackage } from '../browser/browser-package.js'
import { runImageOf } from '../browser/browser-version.js'
import { chromeForTestingPlatformOf } from '../browser/chrome-for-testing-platform.js'
import { imageMarkerPath } from '../browser/image-marker.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import { autoWorkerCount, type BrowserHost } from '../capture/worker-pool.js'
import { ConfigError } from '../config/config-error.js'
import { isCi } from '../config/is-ci.js'
import { type LoadConfigOptions, loadConfig } from '../config/load-config.js'
import type { ResolvedConfig } from '../config/resolve-config.js'
import type { ContainerPlatform } from '../container/browser-container.js'
import { ContainerError } from '../container/container-error.js'
import { type DockerHost, type ProbeDocker, probeDocker } from '../container/docker-probe.js'
import { isInsideContainer } from '../container/inside-container.js'
import { knownContainerIdOf } from '../container/own-container.js'
import { type ListFiles, listProjectFiles } from '../init/find-storybooks.js'
import { defaultsPrompter } from '../init/prompter.js'
import { createRunCommand, type RunCommand } from '../init/run-command.js'
import { type InitResult, type InitTools, runInit } from '../init/run-init.js'
import { plainSetupProgress, type SetupProgress } from '../init/setup-progress.js'
import { type FindUnlistedDependencies, findUnlistedDependencies } from '../init/unlisted-dependencies.js'
import { type BrowserPlace, browserPlaceOf } from './browser-route.js'
import { checkStorybooks } from './check-storybooks.js'
import { dockerProblemOf } from './docker-problem.js'
import { createLaunchBrowser, type LaunchBrowser } from './launch-browser.js'
import { parseCommandLine, type RunOptions, UsageError } from './parse-command-line.js'
import { readImageFit } from './read-image-fit.js'
import { runSnapshots } from './run-snapshots.js'
import { selectStories } from './select-stories.js'
import { defaultRecaptureDelayMs } from './update-snapshot.js'

/**
 * The help text `--help` prints.
 */
const helpText = `Usage: visual-check <command> [options]

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

Options for init:
  --yes               Take every default

Other options:
  --help     Show this help
  --version  Show the version
`

/**
 * What a CLI run produced: the exit code and the text for each output stream.
 *
 * @public
 */
export interface CliResult {
  /**
   * The process exit code.
   */
  exitCode: number
  /**
   * Text for standard output.
   */
  stdout: string
  /**
   * Text for standard error.
   */
  stderr: string
}

/**
 * What the CLI's caller gives a run besides its arguments, environment and folder.
 *
 * @public
 */
export interface RunCliOptions {
  /**
   * Where the marker of visual-check's image is read from. `/etc/visual-check/chromium.json` by default. A test gives
   * another.
   */
  imageMarkerPath?: string
  /**
   * The CPUs and memory of the machine the CLI runs on, which `workers: 'auto'` reads when the browser runs inside
   * visual-check's image or on the host. By default `os.availableParallelism()` and `os.totalmem()`. A test gives its
   * own.
   */
  machine?: BrowserHost
  /**
   * The OS the CLI runs on, which decides between host networking and the proxy, whether `update` warns about baseline
   * paths too long for Windows, with `arch` picks the headless shell `platform: 'host'` downloads, and whether `init`'s
   * Docker warning adds the WSL sentence. `process.platform` by default. A test gives its own.
   */
  os?: NodeJS.Platform
  /**
   * The CPU architecture of the machine the CLI runs on, which with `os` picks the headless shell `platform: 'host'`
   * downloads. `process.arch` by default. A test gives its own.
   */
  arch?: NodeJS.Architecture
  /**
   * Whether visual-check runs inside a container. By default it looks for the file Docker and Podman leave in a
   * container's root, and for `KUBERNETES_SERVICE_HOST`, which Kubernetes sets in every pod. A test gives its answer.
   */
  insideContainer?: boolean
  /**
   * How long after a snapshot's first capture `update` captures the same page again, to check it isn't still changing,
   * in ms. 1,000 by default. A test gives a shorter one.
   */
  recaptureDelayMs?: number
  /**
   * Whether `init` runs in a terminal: by default, when standard input and standard output are TTYs and `CI` is unset,
   * empty, `0` or `false`. There, with no `prompter` given, `init` draws its terminal UI, which it loads only then.
   * Elsewhere it prints plain text, and without `--yes` it stops, since it has nowhere to ask. A test gives its answer.
   */
  interactive?: boolean
  /**
   * Asks `init`'s questions and shows its notes. By default, in a terminal the terminal UI, which also shows the setup
   * steps and the end of the run; elsewhere a prompter that takes every default and collects the notes, which `init`
   * reaches only with `--yes`. A test gives a scripted one.
   */
  prompter?: InitTools['prompter']
  /**
   * The Node version `init` checks, such as `22.23.1`. `process.versions.node` by default. A test gives its own.
   */
  nodeVersion?: string
  /**
   * Writes progress as it happens, such as an image pull's, a download's, or the commands `init` runs and their output
   * when it prints plain text. `init`'s terminal UI shows its own. Progress is dropped when it isn't given.
   */
  progress?: (text: string) => void
  /**
   * Launches the browser that `test` and `update` capture in. By default, in visual-check's container the image is
   * pulled when Docker lacks it and the browser starts in the container, reaching a Storybook by the launch's route;
   * inside visual-check's image the browser starts directly as a child process; and on the host the headless shell is
   * downloaded at the first launch, then starts as a child process with Chromium's sandbox, or without it when it exits
   * at launch. Each way it connects over CDP. A test gives a fake.
   */
  launchBrowser?: LaunchBrowser
  /**
   * Asks Docker what its engine has, before a run whose browser runs in visual-check's container reaches a Storybook.
   * It also tells whether the engine is Docker Desktop's, which decides the browser's route to a Storybook. Inside
   * visual-check's image and on the host no Docker is used, so it isn't asked. `init` asks it once, to warn when Docker
   * can't run the browser. By default it runs `docker info`. A test gives a fake.
   */
  probeDocker?: ProbeDocker
  /**
   * Finds the ID of the container the CLI runs in, when the Docker daemon knows it. By default it reads
   * `/proc/self/mountinfo` and asks `docker inspect`. A test gives a fake.
   */
  findKnownContainer?: () => Promise<string | undefined>
  /**
   * Lists the files of a project, where `init` looks for Storybooks. By default it runs `git ls-files`. A test gives a
   * fake.
   */
  listFiles?: ListFiles
  /**
   * Runs the package manager and `storybook add` for `init`. By default it spawns the command and writes its output to
   * `progress`. A test gives a fake.
   */
  runCommand?: RunCommand
  /**
   * Asks Fallow for the packages a project imports and doesn't list, which `init` warns about. By default it runs
   * Fallow. A test gives a fake.
   */
  findUnlistedDependencies?: FindUnlistedDependencies
}

/**
 * Runs the CLI with the given arguments, environment and folder, and returns what it prints on each stream. Only
 * progress is written as it happens, through `options.progress`; `update` also writes and deletes baselines, and `init`
 * writes the setup files and runs the package manager. Problems with the command line, the config, the run's setup or
 * the browser exit with code 2. Other errors are thrown.
 *
 * @public
 */
export async function runCli(
  commandLineArguments: string[],
  environment: Record<string, string | undefined>,
  cwd: string,
  options: RunCliOptions = {},
): Promise<CliResult> {
  try {
    const commandLine = parseCommandLine(commandLineArguments)

    switch (commandLine.command) {
      case 'help':
        return { exitCode: 0, stdout: helpText, stderr: '' }
      case 'version':
        return { exitCode: 0, stdout: `${readCliManifest().version}\n`, stderr: '' }
      case 'init':
        return await runInitCommand(commandLine.options.yes, environment, cwd, options)
      case 'test':
      case 'update':
        return await runTestOrUpdate(commandLine.command, commandLine.options, environment, cwd, options)
    }
  } catch (error) {
    if (error instanceof UsageError) {
      return failure(`${error.message}\nRun visual-check --help to see the commands and options.`)
    }

    if (error instanceof ConfigError) {
      return failure(error.message)
    }

    throw error
  }
}

/**
 * Runs `test` or `update` after the checks that come first: `update` runs only locally, the browser package is
 * installed and readable, the config is found, valid and usable, the browser has a place to run (inside visual-check's
 * image when its marker fits the browser package and the platform, else on the host for `platform: 'host'` when Chrome
 * for Testing builds for the machine, else in a container), Docker answers `docker info` with a running engine of Linux
 * containers when the browser runs in a container, every Storybook in the run has a supported `storybook` version
 * installed, and every Storybook in the run answers with an index. In a container, the browser reaches a Storybook by
 * the route the five rules give, from the container the CLI runs in, Docker's engine and the OS. Then it reads and
 * checks the per-story options of every story each Storybook's index lists, whatever the selection. `test` then runs
 * the consistency check of every Storybook in the run, reports each missing baseline, each story whose stories file
 * failed to load and each orphan it finds, whatever the selection, and exits 1 when it finds any. Locally, and in CI
 * when it finds nothing, it captures the selected stories that aren't disabled. When the `CI` environment variable says
 * the run is in CI, a `test` whose check finds anything prints the check's findings and exits 1 without capturing.
 * `test --consistency` stops after the check, in CI or not: it captures nothing, prints the check's output, and exits 0
 * when it finds nothing, else 1. `test --shard k/n` takes only its share of the stories files, worked out from each
 * Storybook's index and baselines folder, and runs no consistency check. `update` captures the selected stories that
 * aren't disabled and the snapshots outside the selection whose baselines are missing, then deletes the orphans of the
 * Storybooks in the run. A finished `update` ends stderr with a warning for the hosts its stories send real network
 * requests to and the hosts whose remote content they show, grouped by host with the first story IDs of each. The
 * config's `silenceHosts` leaves hosts out. `test` never watches requests. The warning never changes the exit code.
 *
 * @throws {ConfigError} When the config can't be found, loaded or used.
 */
async function runTestOrUpdate(
  command: 'test' | 'update',
  options: RunOptions,
  environment: Record<string, string | undefined>,
  cwd: string,
  cliOptions: RunCliOptions,
): Promise<CliResult> {
  const ci = isCi(environment)

  if (command === 'update' && ci) {
    return failure(
      'visual-check update only runs locally, and the CI environment variable is set. ' +
        'Run it on your machine and commit the baselines, or unset CI.',
    )
  }

  const browserCheck = checkBrowserPackage(environment)

  if ('problem' in browserCheck) {
    return { exitCode: 2, stdout: '', stderr: browserCheck.problem }
  }

  const config = await loadConfig(loadConfigOptionsOf(options, ci, cwd))
  const insideContainer = insideContainerOf(cliOptions, environment)
  const placement = await placeAndProbe(config, browserCheck.browserPackage, insideContainer, cliOptions)

  if ('problem' in placement) {
    return { exitCode: 2, stdout: '', stderr: placement.problem }
  }

  const checks = await checkStorybooks(config.storybooks, cwd)
  const warnings = checks.warnings.map((warning) => `${warning}\n`).join('')

  if ('problems' in checks) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `${warnings}${checks.problems.map((problem) => `${problem}\n`).join('')}`,
    }
  }

  const result = await runSnapshots({
    command,
    version: readCliManifest().version,
    ci,
    consistencyOnly: options.consistency,
    shard: options.shard,
    config,
    workers: workersOf(options, config, placement.host),
    place: placement.place,
    browserPackage: browserCheck.browserPackage,
    selections: checks.storybooks.map(({ storybook, version, stories }) => ({
      storybook,
      version,
      stories: selectStories(stories, options.selection),
      allStories: stories,
    })),
    cwd,
    insideContainer,
    environment,
    ...runDefaultsOf(cliOptions),
  })

  return { ...result, stderr: `${warnings}${result.stderr}` }
}

/**
 * Gives what the CLI's caller can give a `test` or `update` run once its checks have passed, each with its default
 * when the caller gives none: the OS, how the browser is launched, how long `update` waits before it captures a page
 * again, and where progress goes.
 */
function runDefaultsOf(
  cliOptions: RunCliOptions,
): Required<Pick<RunCliOptions, 'os' | 'launchBrowser' | 'recaptureDelayMs' | 'progress'>> {
  return {
    os: cliOptions.os ?? process.platform,
    launchBrowser: cliOptions.launchBrowser ?? createLaunchBrowser(),
    recaptureDelayMs: cliOptions.recaptureDelayMs ?? defaultRecaptureDelayMs,
    progress: cliOptions.progress ?? (() => undefined),
  }
}

/**
 * Gives how many workers the run captures with: `--workers`, else the config's number, and for `'auto'` what the CPUs
 * and memory where the browser runs allow.
 */
function workersOf(options: RunOptions, config: ResolvedConfig, host: BrowserHost): number {
  const requested = options.workers ?? config.workers

  return requested === 'auto' ? autoWorkerCount(host) : requested
}

/**
 * Whether the run is inside a container: the option when a test gives it, else what the environment and the root's
 * marker files say.
 */
function insideContainerOf(cliOptions: RunCliOptions, environment: Record<string, string | undefined>): boolean {
  return cliOptions.insideContainer ?? isInsideContainer(environment)
}

/**
 * Decides where the run's browser runs and reads the CPUs and memory there: inside visual-check's image and on the
 * host the machine's own, with no Docker used, and in visual-check's container Docker's engine's, which the Docker
 * probe reads. In a container, the route to a Storybook comes from the container the CLI runs in, whether the engine
 * is Docker Desktop's, and the OS. Gives the place with them, or what to print when the browser has no place to run or
 * Docker can't run it.
 *
 * @throws {Error} Any error the probe throws besides a `ContainerError`.
 */
async function placeAndProbe(
  config: ResolvedConfig,
  browserPackage: BrowserPackage,
  insideContainer: boolean,
  cliOptions: RunCliOptions,
): Promise<{ place: BrowserPlace; host: BrowserHost } | { problem: string }> {
  const imageFit = readImageFit(config.platform, browserPackage, cliOptions.imageMarkerPath ?? imageMarkerPath)

  if ('problem' in imageFit) {
    return { problem: `${imageFit.problem}\n` }
  }

  if (imageFit.insideImage) {
    return { place: browserPlaceOf({ insideImage: true }), host: cliOptions.machine ?? machineOf() }
  }

  if (imageFit.platform === 'host') {
    return hostPlaceOf(cliOptions)
  }

  let docker: DockerHost

  try {
    docker = await (cliOptions.probeDocker ?? probeDocker)()
  } catch (error) {
    if (error instanceof ContainerError) {
      return { problem: dockerProblemOf(error, { insideContainer, image: runImageOf(browserPackage, config.image) }) }
    }

    throw error
  }

  return { place: await containerPlaceOf(imageFit.platform, docker, cliOptions), host: docker }
}

/**
 * Places the browser on the host, as the headless shell Chrome for Testing builds for the machine's OS and CPU
 * architecture, with the machine's CPUs and memory. No Docker is used. Gives the problem that exits 2 when Chrome for
 * Testing has no build for the machine.
 */
function hostPlaceOf(cliOptions: RunCliOptions): { place: BrowserPlace; host: BrowserHost } | { problem: string } {
  const download = chromeForTestingPlatformOf(cliOptions.os ?? process.platform, cliOptions.arch ?? process.arch)

  if ('problem' in download) {
    return { problem: `${download.problem}\n` }
  }

  return { place: { in: 'host', platform: download.platform }, host: cliOptions.machine ?? machineOf() }
}

/**
 * Gives the place of a browser in visual-check's container on this platform, with the route the five rules give it
 * from the container the CLI runs in, whether Docker's engine is Docker Desktop's, and the OS.
 */
async function containerPlaceOf(
  platform: ContainerPlatform,
  docker: DockerHost,
  cliOptions: RunCliOptions,
): Promise<BrowserPlace> {
  return browserPlaceOf({
    insideImage: false,
    platform,
    containerId: await (cliOptions.findKnownContainer ?? knownContainerIdOf)(),
    dockerDesktop: docker.desktop,
    os: cliOptions.os ?? process.platform,
  })
}

/**
 * Reads the CPUs and memory of the machine the CLI runs on.
 */
function machineOf(): BrowserHost {
  return { cpus: availableParallelism(), memoryBytes: totalmem() }
}

/**
 * Builds the options for `loadConfig`, leaving out each flag that isn't given.
 */
function loadConfigOptionsOf(options: RunOptions, ci: boolean, cwd: string): LoadConfigOptions {
  return {
    cwd,
    ci,
    ...(options.config === undefined ? {} : { path: options.config }),
    ...(options.storybook === undefined ? {} : { storybook: options.storybook }),
    ...(options.url === undefined ? {} : { url: options.url }),
  }
}

/**
 * What the CLI's own `package.json` says that a run needs.
 */
interface CliManifest {
  /**
   * The CLI's version.
   */
  version: string
  /**
   * The range of `@visual-check/chromium` the CLI takes as a peer.
   */
  browserRange: string
}

/**
 * Reads the version and the browser package's peer range from the CLI's `package.json`.
 */
function readCliManifest(): CliManifest {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string
    peerDependencies: { '@visual-check/chromium': string }
  }

  return { version: manifest.version, browserRange: manifest.peerDependencies['@visual-check/chromium'] }
}

/**
 * How `init` talks to the person: whether it runs in a terminal, what asks the questions, and what shows the steps.
 */
type InitIo = Pick<InitTools, 'interactive' | 'prompter' | 'progress'>

/**
 * Runs `init`. In a terminal, unless the caller gives a prompter, it loads the terminal UI, which asks the questions,
 * shows the steps and the end of the run, so the result carries only the exit code. Elsewhere it runs with the
 * caller's prompter, else the one that takes every default, and plain progress, and the result carries the text.
 *
 * @throws Any error `runInit` throws, after the terminal UI has stopped drawing.
 */
async function runInitCommand(
  yes: boolean,
  environment: Record<string, string | undefined>,
  cwd: string,
  cliOptions: RunCliOptions,
): Promise<CliResult> {
  const interactive = cliOptions.interactive ?? isTerminal(environment)

  if (!interactive || cliOptions.prompter !== undefined) {
    const prompter = cliOptions.prompter ?? defaultsPrompter()
    const progress = plainSetupProgress(cliOptions.progress ?? (() => undefined))

    return await runInit(cwd, initToolsOf(yes, { interactive, prompter, progress }, cliOptions))
  }

  // Loaded only here, so `test` and `update` never load React and Ink.
  const { startInitView } = await import('../terminal-ui/init-view.js')
  const view = startInitView({
    version: readCliManifest().version,
    yes,
    environment,
    stdin: process.stdin,
    stdout: process.stdout,
  })
  let result: InitResult

  try {
    result = await runInit(cwd, initToolsOf(yes, { interactive, prompter: view, progress: view.progress }, cliOptions))
  } catch (error) {
    await view.finish({ exitCode: 2, stdout: '', stderr: '' })

    throw error
  }

  await view.finish(result)

  return { exitCode: result.exitCode, stdout: '', stderr: '' }
}

/**
 * Whether the CLI runs in a terminal a person answers in: standard input and standard output are TTYs, and the `CI`
 * environment variable doesn't say this is a CI run.
 */
function isTerminal(environment: Record<string, string | undefined>): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true && !isCi(environment)
}

/**
 * Gives `init` what it runs with: how it talks to the person, then what the CLI's caller gives, else the defaults.
 */
function initToolsOf(yes: boolean, io: InitIo, cliOptions: RunCliOptions): InitTools {
  const { version, browserRange } = readCliManifest()

  return {
    yes,
    ...io,
    nodeVersion: cliOptions.nodeVersion ?? process.versions.node,
    os: cliOptions.os ?? process.platform,
    cliVersion: version,
    browserRange,
    ...initAdaptersOf(cliOptions, io.progress),
  }
}

/**
 * Gives the tools `init` reaches outside the process with: the caller's, else the ones that run Docker, git, the
 * package manager and Fallow.
 */
function initAdaptersOf(
  cliOptions: RunCliOptions,
  progress: SetupProgress,
): Pick<InitTools, 'probeDocker' | 'listFiles' | 'runCommand' | 'findUnlistedDependencies'> {
  return {
    probeDocker: cliOptions.probeDocker ?? probeDocker,
    listFiles: cliOptions.listFiles ?? listProjectFiles,
    runCommand: cliOptions.runCommand ?? createRunCommand((text) => progress.output(text)),
    findUnlistedDependencies: cliOptions.findUnlistedDependencies ?? findUnlistedDependencies,
  }
}

/**
 * Builds the result for a problem: the message on standard error, exit code 2.
 */
function failure(message: string): CliResult {
  return { exitCode: 2, stdout: '', stderr: `${message}\n` }
}
