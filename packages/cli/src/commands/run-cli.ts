import { readFileSync } from 'node:fs'
import { availableParallelism, totalmem } from 'node:os'
import { checkBrowserPackage } from '../browser/browser-package.js'
import { runImageOf } from '../browser/browser-version.js'
import { chromeForTestingPlatformOf } from '../browser/chrome-for-testing-platform.js'
import { imageMarkerPath } from '../browser/image-marker.js'
import type { BrowserPackage } from '../browser/read-browser-package.js'
import { autoWorkerCount, type BrowserHost } from '../capture/worker-pool.js'
import { ConfigError } from '../config/config-error.js'
import { locateConfig } from '../config/find-config.js'
import { isCi } from '../config/is-ci.js'
import { type LoadConfigOptions, loadConfig } from '../config/load-config.js'
import type { ResolvedConfig, ResolvedStorybook } from '../config/resolve-config.js'
import type { ContainerPlatform } from '../container/browser-container.js'
import { ContainerError } from '../container/container-error.js'
import { type DockerHost, type ProbeDocker, probeDocker } from '../container/docker-probe.js'
import { isInsideContainer } from '../container/inside-container.js'
import { knownContainerIdOf } from '../container/own-container.js'
import { clearReport, ReportError, reportFolderOf, writeReportJson } from '../report/report-folder.js'
import type { Story } from '../storybook/read-stories.js'
import { type BrowserPlace, browserPlaceOf } from './browser-route.js'
import { checkStorybooks } from './check-storybooks.js'
import { dockerProblemOf } from './docker-problem.js'
import { createLaunchBrowser, type LaunchBrowser } from './launch-browser.js'
import { parseCommandLine, type Reporter, type RunOptions, UsageError } from './parse-command-line.js'
import { readImageFit } from './read-image-fit.js'
import { cliOutputOf, documentOutputOf, type RunOutput, reportLineOf } from './run-output.js'
import { type TestReportFacts, testReportFor, updateReportFor } from './run-report.js'
import { runSnapshots } from './run-snapshots.js'
import { selectStories } from './select-stories.js'
import { reportProblemOf } from './stop-message.js'
import { type RunStop, stoppedBy, stoppedTestOf, stoppedUpdateOf, usageFailureOf } from './stopped-run.js'
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
  --reporter <name>   Live or log for people, json for the report's JSON document on stdout

Other options:
  --help     Show this help
  --version  Show the version
`

/**
 * What a CLI run produced: the exit code, the text for each output stream, and the report line to write after both.
 *
 * @public
 */
export interface CliResult extends RunOutput {
  /**
   * The process exit code.
   */
  exitCode: number
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
   * paths too long for Windows, and with `arch` picks the headless shell `platform: 'host'` downloads.
   * `process.platform` by default. A test gives its own.
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
   * Writes progress as it happens, such as an image pull's or a download's. Progress is dropped when it isn't given.
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
   * visual-check's image and on the host no Docker is used, so it isn't asked. By default it runs `docker info`. A test
   * gives a fake.
   */
  probeDocker?: ProbeDocker
  /**
   * Finds the ID of the container the CLI runs in, when the Docker daemon knows it. By default it reads
   * `/proc/self/mountinfo` and asks `docker inspect`. A test gives a fake.
   */
  findKnownContainer?: () => Promise<string | undefined>
}

/**
 * Runs the CLI with the given arguments, environment and folder, and returns what it prints on each stream. Only
 * progress is written as it happens, through `options.progress`; `update` also writes and deletes baselines, and
 * `test` writes the report folder. Problems with the command line, the config, the run's setup or the browser exit
 * with code 2. A usage error of `test` whose flags parsed writes its error report beside the config the run would
 * load. Other errors are thrown.
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
        return { exitCode: 0, stdout: `${readVersion()}\n`, stderr: '' }
      case 'init':
        return failure("visual-check init isn't available yet. Write visual-check.config.ts by hand for now.")
      case 'test':
      case 'update':
        return await runTestOrUpdate(commandLine.command, commandLine.options, environment, cwd, options)
    }
  } catch (error) {
    if (error instanceof UsageError) {
      return await usageFailureOf(error, cwd, readVersion())
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
 * Right after the config loads, `test` clears the report folder, `.visual-check/report` beside the config file; one it
 * can't clear exits 2. Every `test` that exits 0 or 1, `test --consistency`, a CI stop and each shard included, then
 * writes `report.json` there and gives the report's path, relative to the folder the CLI runs in, as the report line
 * for stdout. A `test` that exits 2 with its config found, or named by the config error, replaces the folder with a
 * `report.json` holding only the error, naming the Storybooks where nothing answers, and gives the report line for
 * stderr; with no config found, or when the report folder itself is what failed, nothing is written. With
 * `--reporter json`, stdout then holds the error document alone. `update` never touches the report folder. With
 * `--reporter json`, its stdout holds its own document alone, the error document when it exits 2. Whatever the
 * command and exit code, `--reporter json` moves the human lines to stderr, before what the run prints there.
 *
 * @throws {Error} Any error besides the problems that stop the run with exit 2.
 */
async function runTestOrUpdate(
  command: 'test' | 'update',
  options: RunOptions,
  environment: Record<string, string | undefined>,
  cwd: string,
  cliOptions: RunCliOptions,
): Promise<CliResult> {
  const ci = isCi(environment)
  const outcome =
    command === 'update' && ci
      ? stoppedBy(
          'visual-check update only runs locally, and the CI environment variable is set. ' +
            'Run it on your machine and commit the baselines, or unset CI.\n',
          { configPath: undefined, storybooks: [] },
        )
      : await runOutcomeOf({ command, options, environment, cwd, cliOptions, ci })

  if ('finished' in outcome) {
    return outcome.finished
  }

  if (command === 'update') {
    return stoppedUpdateOf(outcome.stopped, { version: readVersion(), options })
  }

  return await stoppedTestOf(outcome.stopped, { version: readVersion(), cwd, options })
}

/**
 * How a `test` or `update` ended: finished with exit 0 or 1, its report written for `test`, or stopped with exit 2.
 */
type RunOutcome = { finished: CliResult } | { stopped: RunStop }

/**
 * What a `test` or `update` run is given: its command, options, environment and folder, what the CLI's caller gives,
 * and whether it runs in CI.
 */
interface RunContext {
  /**
   * The command.
   */
  command: 'test' | 'update'
  /**
   * Its options.
   */
  options: RunOptions
  /**
   * The environment.
   */
  environment: Record<string, string | undefined>
  /**
   * The folder the CLI runs in.
   */
  cwd: string
  /**
   * What the CLI's caller gives the run.
   */
  cliOptions: RunCliOptions
  /**
   * Whether the `CI` environment variable says the run is in CI.
   */
  ci: boolean
}

/**
 * Runs `test` or `update` as `runTestOrUpdate` says, and gives how it ended.
 *
 * @throws {Error} Any error besides the problems that stop the run with exit 2.
 */
async function runOutcomeOf(context: RunContext): Promise<RunOutcome> {
  const browserCheck = checkBrowserPackage(context.environment)

  if ('problem' in browserCheck) {
    return stoppedBy(browserCheck.problem, {
      configPath: locateConfig(context.cwd, context.options.config),
      storybooks: [],
    })
  }

  const loaded = await loadedConfigOf(context)

  if ('stopped' in loaded) {
    return loaded
  }

  return await configuredOutcomeOf(context, loaded.config, browserCheck.browserPackage)
}

/**
 * Loads the run's config, or gives the stop a `ConfigError` makes, naming the config when it was found.
 *
 * @throws {Error} Any error besides a `ConfigError`.
 */
async function loadedConfigOf(context: RunContext): Promise<{ config: ResolvedConfig } | { stopped: RunStop }> {
  try {
    return { config: await loadConfig(loadConfigOptionsOf(context.options, context.ci, context.cwd)) }
  } catch (error) {
    if (error instanceof ConfigError) {
      return stoppedBy(`${error.message}\n`, { configPath: error.configPath, storybooks: [] })
    }

    throw error
  }
}

/**
 * Runs `test` or `update` once its config is loaded: clears the report folder for `test`, places the browser, checks
 * the Storybooks, then takes the snapshots.
 *
 * @throws {Error} Any error besides the problems that stop the run with exit 2.
 */
async function configuredOutcomeOf(
  context: RunContext,
  config: ResolvedConfig,
  browserPackage: BrowserPackage,
): Promise<RunOutcome> {
  const inRun = { configPath: config.path, storybooks: config.storybooks }
  const clearProblem = await clearReportProblemOf(context.command, config, context.cwd)

  if (clearProblem !== undefined) {
    return stoppedBy(clearProblem, { ...inRun, configPath: undefined })
  }

  const insideContainer = insideContainerOf(context.cliOptions, context.environment)
  const placement = await placeAndProbe(config, browserPackage, insideContainer, context.cliOptions)

  if ('problem' in placement) {
    return stoppedBy(placement.problem, inRun)
  }

  const checks = await checkStorybooks(config.storybooks, context.cwd)
  const warnings = checks.warnings.map((warning) => `${warning}\n`).join('')

  if ('problems' in checks) {
    const problems = checks.problems.map((problem) => `${problem}\n`).join('')

    return {
      stopped: {
        ...inRun,
        stdout: '',
        stderr: `${warnings}${problems}`,
        message: problems,
        unreachable: checks.unreachable,
      },
    }
  }

  return await snapshotsOutcomeOf(context, config, {
    browserPackage,
    insideContainer,
    placement,
    storybooks: checks.storybooks,
    warnings,
  })
}

/**
 * What the checks before the snapshots found: the browser package, where the browser runs, and each Storybook with
 * its version and stories, with the warnings they printed.
 */
interface CheckedRun {
  /**
   * The installed browser package.
   */
  browserPackage: BrowserPackage
  /**
   * Whether visual-check runs inside a container.
   */
  insideContainer: boolean
  /**
   * Where the browser runs, and the CPUs and memory there.
   */
  placement: { place: BrowserPlace; host: BrowserHost }
  /**
   * Each Storybook in the run, in config order, with its version and stories.
   */
  storybooks: { storybook: ResolvedStorybook; version: string | undefined; stories: Story[] }[]
  /**
   * The warnings the checks printed, each on its own line.
   */
  warnings: string
}

/**
 * Takes the snapshots, then for `test` writes the report of a run that exits 0 or 1, and for `update` prints its
 * document with `--reporter json`. Gives the stop of a run that stopped with exit 2.
 *
 * @throws {Error} Any error besides the problems that stop the run with exit 2.
 */
async function snapshotsOutcomeOf(
  context: RunContext,
  config: ResolvedConfig,
  checked: CheckedRun,
): Promise<RunOutcome> {
  const { command, options } = context
  const version = readVersion()
  const result = await runSnapshots({
    command,
    version,
    ci: context.ci,
    consistencyOnly: options.consistency,
    shard: options.shard,
    config,
    workers: workersOf(options, config, checked.placement.host),
    place: checked.placement.place,
    browserPackage: checked.browserPackage,
    selections: checked.storybooks.map(({ storybook, version, stories }) => ({
      storybook,
      version,
      stories: selectStories(stories, options.selection),
      allStories: stories,
    })),
    cwd: context.cwd,
    insideContainer: checked.insideContainer,
    environment: context.environment,
    ...runDefaultsOf(context.cliOptions),
  })
  const output = { stdout: result.stdout, stderr: `${checked.warnings}${result.stderr}` }

  if ('stopMessage' in result) {
    return {
      stopped: {
        ...output,
        message: result.stopMessage,
        // The report folder that failed can't take an error report either.
        configPath: result.reportFailed ? undefined : config.path,
        storybooks: config.storybooks,
        unreachable: [],
      },
    }
  }

  const facts = {
    version,
    configPath: config.path,
    selection: options.selection,
    storybooks: checked.storybooks.map(({ storybook }) => storybook),
    exitCode: result.exitCode,
    findings: result.findings,
  }

  if (command === 'update') {
    // update writes no report.json, so its document is built only to be printed.
    if (options.reporter !== 'json') {
      return { finished: { exitCode: result.exitCode, ...output } }
    }

    return {
      finished: { exitCode: result.exitCode, ...documentOutputOf(output, updateReportFor(facts), 'json', undefined) },
    }
  }

  return await withTestReport(
    { exitCode: result.exitCode, ...output },
    context.cwd,
    { ...facts, consistencyOnly: options.consistency, shard: options.shard },
    options.reporter,
  )
}

/**
 * Clears the report folder beside the config for `test`, so an old report never lingers. Gives what to print when it
 * can't. `update` never touches the folder.
 *
 * @throws {Error} Any error besides a `ReportError`.
 */
async function clearReportProblemOf(
  command: 'test' | 'update',
  config: ResolvedConfig,
  cwd: string,
): Promise<string | undefined> {
  if (command === 'update') {
    return undefined
  }

  try {
    await clearReport(reportFolderOf(config.path))
  } catch (error) {
    if (error instanceof ReportError) {
      return reportProblemOf(error, cwd)
    }

    throw error
  }

  return undefined
}

/**
 * Writes the report of a `test` that exits 0 or 1, then gives the report's path as the report line for stdout. With
 * `--reporter json` stdout holds the report's JSON document alone, the human lines move to stderr, and the report
 * line is for stderr. When the report can't be written, the run stops with exit 2 with what went wrong after its
 * stderr, and no error report is written.
 *
 * @throws {Error} Any error besides a `ReportError`.
 */
async function withTestReport(
  result: CliResult,
  cwd: string,
  facts: TestReportFacts,
  reporter: Reporter | undefined,
): Promise<RunOutcome> {
  const folder = reportFolderOf(facts.configPath)

  try {
    const report = await testReportFor(facts)

    await writeReportJson(folder, report)

    return { finished: { ...result, ...cliOutputOf(result, report, reporter, reportLineOf(cwd, folder)) } }
  } catch (error) {
    if (error instanceof ReportError) {
      const problem = reportProblemOf(error, cwd)

      return {
        stopped: {
          stdout: result.stdout,
          stderr: `${result.stderr}${problem}`,
          message: problem,
          configPath: undefined,
          storybooks: facts.storybooks,
          unreachable: [],
        },
      }
    }

    throw error
  }
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
 * Reads the version from the package's `package.json`.
 */
function readVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string
  }

  return manifest.version
}

/**
 * Builds the result for a problem: the message on standard error, exit code 2.
 */
function failure(message: string): CliResult {
  return { exitCode: 2, stdout: '', stderr: `${message}\n` }
}
