import { readFileSync } from 'node:fs'
import { availableParallelism, totalmem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { type FindReachedFiles, findReachedFilesWithFallow } from '../affected-stories/fallow-graph.js'
import { InvalidBaseError } from '../affected-stories/git-changes.js'
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
import { type ListFiles, listProjectFiles } from '../init/find-storybooks.js'
import { defaultsPrompter } from '../init/prompter.js'
import { createRunCommand, type RunCommand } from '../init/run-command.js'
import { type InitResult, type InitTools, runInit } from '../init/run-init.js'
import { plainSetupProgress, type SetupProgress } from '../init/setup-progress.js'
import { type FindUnlistedDependencies, findUnlistedDependencies } from '../init/unlisted-dependencies.js'
import type { Report } from '../report/report-document.js'
import { clearReport, ReportError, reportFolderOf, writeReportJson } from '../report/report-folder.js'
import { testEndLinesOf } from '../reporter/end-block.js'
import { logReporterOf } from '../reporter/log-reporter.js'
import { reporterOf } from '../reporter/reporter-choice.js'
import type { RunReporter } from '../reporter/run-event.js'
import { appendStepSummary, StepSummaryError } from '../step-summary/step-summary.js'
import type { Story } from '../storybook/read-stories.js'
import { type BrowserPlace, browserPlaceOf } from './browser-route.js'
import { checkStorybooks } from './check-storybooks.js'
import { dockerProblemOf } from './docker-problem.js'
import { createLaunchBrowser, type LaunchBrowser } from './launch-browser.js'
import { parseCommandLine, type RunOptions, UsageError } from './parse-command-line.js'
import { readImageFit } from './read-image-fit.js'
import { type RunOutput, reportLineOf, runOutputOf } from './run-output.js'
import { type TestReportFacts, testReportFor, updateReportFor } from './run-report.js'
import { effectiveSelectionOf, type RunSelection, workOutRunSelection } from './run-selection.js'
import { runSnapshots, type SnapshotRunResult } from './run-snapshots.js'
import { reportProblemOf } from './stop-message.js'
import { crashedBy, type RunStop, stoppedBy, stoppedTestOf, stoppedUpdateOf, usageFailureOf } from './stopped-run.js'
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
  --affected          Cover the stories the changed files can alter (default without CI)
  --all               Cover every story (default in CI)
  --filter <regex>    Cover every story whose ID matches
  --base <ref>        Measure changed files from the merge base with this ref
  --storybook <name>  Cover only this Storybook
  --url <url>         Use this URL for the Storybook (with several Storybooks, needs --storybook)
  --config <path>     Use this config instead of searching for one
  --consistency       Only check for missing baselines, orphans and stories files that fail to load (test only)
  --workers <n>       Capture with this many workers
  --shard <k>/<n>     Run one shard's share of the stories files (test only)
  --reporter <name>   live (default in a terminal), log (default in CI or without one), or json for the report's JSON
                      document on stdout

Options for init:
  --yes               Take every default

Other options:
  --help     Show this help
  --version  Show the version
`

/**
 * What a CLI run produced: the exit code, the text for each output stream, which comes after what was written as it
 * happened, and the report line to write after both.
 *
 * @public
 */
export interface CliResult extends Omit<RunOutput, 'report'> {
  /**
   * The process exit code.
   */
  exitCode: number
}

/**
 * What a `test` or `update` run produced: the CLI's result, with the report or document it built.
 */
interface RunResult extends CliResult {
  /**
   * The report, or `update`'s document, which the step summary is written from. Absent for a usage error that names
   * no run.
   */
  report?: Report
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
   * Whether standard output is a TTY, which with `CI` unset makes `live` the default reporter. `process.stdout.isTTY`
   * by default. A test gives its answer.
   */
  tty?: boolean
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
   * Tells the time in ms, which a run's elapsed time counts with. `performance.now` by default. A test gives its own.
   */
  now?: () => number
  /**
   * Writes progress as it happens, such as an image pull's, a download's, or the commands `init` runs and their output
   * when it prints plain text. `init`'s terminal UI shows its own. Progress is dropped when it isn't given.
   */
  progress?: (text: string) => void
  /**
   * Writes what a `test` or `update` run's `log` or `json` reporter prints as it happens: the header, a shard's notes
   * and each snapshot's line as it finishes, on stdout, or on stderr with `--reporter json`. The `live` reporter draws
   * on stdout itself, until the run's snapshots are taken. When it isn't given, that text is kept, and the result's
   * text for each stream starts with it. A test leaves it out.
   */
  write?: (stream: 'stdout' | 'stderr', text: string) => void
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
  /**
   * Finds the files the changed files reach, which a run that covers the affected stories asks once. By default it
   * runs Fallow. A test gives a fake.
   */
  findReachedFiles?: FindReachedFiles
}

/**
 * Runs the CLI with the given arguments, environment and folder, and returns what it prints on each stream. Progress is
 * written as it happens, through `options.progress`, and so are a `test` or `update` run's header and snapshot lines,
 * through `options.write`, or drawn on stdout by the `live` reporter; the result holds the rest, which comes after
 * them. `update` also writes and deletes baselines, `test` writes the report folder, and `init` writes the setup files
 * and runs the package manager. Problems with the command line, the config, the run's setup or the browser exit with
 * code 2. A usage error of a `test` command line, even one whose flags fail to parse, writes its error report beside
 * the config the run would load. Once a `test` or `update` has loaded its config, an error that is a bug exits 2 too,
 * with its stack trace on stderr, as an error report for `test` and an error document with `--reporter json`. Other
 * errors are thrown. Whenever `GITHUB_STEP_SUMMARY` is set, every `test` and `update` run, a usage error that names one
 * included, appends its step summary to the file it names, whatever the reporter.
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
        return await withStepSummary(
          await runTestOrUpdate(commandLine.command, commandLine.options, environment, cwd, options),
          environment,
          cwd,
        )
    }
  } catch (error) {
    if (error instanceof UsageError) {
      return await withStepSummary(await usageFailureOf(error, cwd, readCliManifest().version), environment, cwd)
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
 * checks the per-story options of every story each Storybook's index lists, whatever the selection.
 *
 * With no selection flag, a run covers the affected stories, unless the `CI` environment variable says it's in CI or
 * it's a shard, when it covers every story without reading git or the graph. Affected stories are worked out once for
 * every Storybook in the run, before anything is captured: when git or the graph can't answer, the run covers every
 * story, with a warning on stderr that says why; when no story is affected, a note after the header says so and
 * hints at `--all`; and a `--base` that names no commit stops the run with exit 2. The report's `selection` says what
 * picked the stories, with the base, the number of changed files and why it fell back.
 *
 * `test` then runs the consistency check of every Storybook in the run, reports each missing baseline, each story whose
 * stories file failed to load and each orphan it finds, whatever the selection, and exits 1 when it finds any. Locally,
 * and in CI when it finds nothing, it captures the selected stories that aren't disabled. When the `CI` environment
 * variable says the run is in CI, a `test` whose check finds anything prints the check's findings and exits 1 without
 * capturing. `test --consistency` stops after the check, in CI or not: it captures nothing, prints the check's output,
 * and exits 0 when it finds nothing, else 1. `test --shard k/n` takes only its share of the stories files, worked out
 * from each Storybook's index and baselines folder, and runs no consistency check. `update` captures the selected
 * stories that aren't disabled and the snapshots outside the selection whose baselines are missing, then deletes the
 * orphans of the Storybooks in the run. A finished `update` ends stderr with a warning for the hosts its stories send
 * real network requests to and the hosts whose remote content they show, grouped by host with the first story IDs of
 * each. The config's `silenceHosts` leaves hosts out. `test` never watches requests. The warning never changes the exit
 * code.
 *
 * Right after the config loads, `test` clears the report folder, `.visual-check/report` beside the config file; one it
 * can't clear exits 2. Every `test` that exits 0 or 1, `test --consistency`, a CI stop and each shard included, then
 * writes `report.json` there and gives the report's path, relative to the folder the CLI runs in, as the report line
 * for stdout. Each of them that captured, so neither `test --consistency` nor a CI stop, ends stdout with its end
 * block, built from the report: its failures, its flaky snapshots, and its counts with how long the run took, counted
 * from the start of the run by `now`. A `test` that exits 2 with its config found, or named by the config error,
 * replaces the folder with a `report.json` holding only the error, naming the Storybooks where nothing answers, and
 * gives the report line for stderr; with no config found, or when the report folder itself is what failed, nothing is
 * written. With `--reporter json`, stdout then holds the error document alone. `update` never touches the report
 * folder. With `--reporter json`, its stdout holds its own document alone, the error document when it exits 2. Whatever
 * the command and exit code, `--reporter json` moves the human lines to stderr, before what the run prints there. An
 * error that is a bug, once the config loads, ends the run as a problem would, with its stack trace and its message.
 *
 * @throws {Error} Any error besides the problems that stop the run with exit 2, before the config loads.
 */
async function runTestOrUpdate(
  command: 'test' | 'update',
  parsed: RunOptions,
  environment: Record<string, string | undefined>,
  cwd: string,
  cliOptions: RunCliOptions,
): Promise<RunResult> {
  const now = cliOptions.now ?? (() => performance.now())
  const startedAt = now()
  const elapsedMs = (): number => now() - startedAt
  const ci = isCi(environment)
  const options: RunOptions = {
    ...parsed,
    selection: effectiveSelectionOf(parsed.selection, {
      ci,
      sharded: parsed.shard !== undefined,
      consistencyOnly: parsed.consistency,
    }),
    reporter: reporterOf(parsed.reporter, { ci, tty: cliOptions.tty ?? process.stdout.isTTY === true }),
  }
  const kept = { stdout: '', stderr: '' }
  const write =
    cliOptions.write ??
    ((stream: 'stdout' | 'stderr', text: string) => {
      kept[stream] += text
    })
  const outcome =
    command === 'update' && ci
      ? stoppedBy(
          'visual-check update only runs locally, and the CI environment variable is set. ' +
            'Run it on your machine and commit the baselines, or unset CI.\n',
          { configPath: undefined, storybooks: [] },
        )
      : await runOutcomeOf({ command, options, environment, cwd, cliOptions, ci, elapsedMs, write })

  if ('finished' in outcome) {
    return withKept(kept, outcome.finished)
  }

  if (command === 'update') {
    return withKept(kept, stoppedUpdateOf(outcome.stopped, { version: readCliManifest().version, options }))
  }

  return withKept(kept, await stoppedTestOf(outcome.stopped, { version: readCliManifest().version, cwd, options }))
}

/**
 * Starts each stream of the result with the text the run's reporter wrote to it as it happened and that was kept,
 * since the CLI's caller gave no `write`.
 */
function withKept(kept: { stdout: string; stderr: string }, result: RunResult): RunResult {
  return { ...result, stdout: `${kept.stdout}${result.stdout}`, stderr: `${kept.stderr}${result.stderr}` }
}

/**
 * Appends the step summary of the report or document the run built to the file `GITHUB_STEP_SUMMARY` names, relative
 * to `cwd`, when it is set, and gives the CLI's result. A summary that can't be written adds a warning to stderr and
 * leaves the exit code as it is.
 *
 * @throws {Error} Any error besides a `StepSummaryError`.
 */
async function withStepSummary(
  result: RunResult,
  environment: Record<string, string | undefined>,
  cwd: string,
): Promise<CliResult> {
  const { report, ...cliResult } = result
  const path = environment.GITHUB_STEP_SUMMARY

  if (report === undefined || path === undefined || path === '') {
    return cliResult
  }

  try {
    await appendStepSummary(resolve(cwd, path), report)
  } catch (error) {
    if (error instanceof StepSummaryError) {
      // The path as the environment gives it, which the person set, rather than the resolved one.
      const warning =
        `Warning: visual-check couldn't write the GitHub step summary to ${path}: ${error.reason}. ` +
        "The run's result is unchanged.\n"

      return { ...cliResult, stderr: `${cliResult.stderr}${warning}` }
    }

    throw error
  }

  return cliResult
}

/**
 * How a `test` or `update` ended: finished with exit 0 or 1, its report written for `test`, or stopped with exit 2.
 */
type RunOutcome = { finished: RunResult } | { stopped: RunStop }

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
  /**
   * Gives how long the run has taken so far, in ms.
   */
  elapsedMs: () => number
  /**
   * Writes what the run's reporter prints as it happens: the caller's `write`, else one that keeps the text.
   */
  write: (stream: 'stdout' | 'stderr', text: string) => void
}

/**
 * Runs `test` or `update` as `runTestOrUpdate` says, and gives how it ended. Once the config loads, an error that is
 * a bug stops the run too, with its stack trace and its message.
 *
 * @throws {Error} Any error besides the problems that stop the run with exit 2, before the config loads.
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

  try {
    return await configuredOutcomeOf(context, loaded.config, browserCheck.browserPackage)
  } catch (error) {
    // A bug once the config loaded still leaves test's error report and prints the error document.
    return crashedBy(error, {
      stdout: '',
      stderr: '',
      configPath: loaded.config.path,
      storybooks: loaded.config.storybooks,
    })
  }
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
 * Works out the stories the run takes, then takes the snapshots as `selectedOutcomeOf` says. Gives the stop of a run
 * that stopped with exit 2. An error that is a bug, once the stories are worked out, stops the run after the warnings,
 * with how it picked them.
 *
 * @throws {Error} Any error besides the problems that stop the run with exit 2, before the stories are worked out.
 */
async function snapshotsOutcomeOf(
  context: RunContext,
  config: ResolvedConfig,
  checked: CheckedRun,
): Promise<RunOutcome> {
  const selected = await runSelectionOf(context, config, checked)

  if ('stopped' in selected) {
    return selected
  }

  try {
    return await selectedOutcomeOf(context, config, checked, selected.selection)
  } catch (error) {
    // A bug once the stories are worked out still leaves test's error report with how the run picked them.
    return crashedBy(error, {
      stdout: '',
      stderr: `${checked.warnings}${selected.selection.warning}`,
      configPath: config.path,
      storybooks: config.storybooks,
      selection: selected.selection.report,
    })
  }
}

/**
 * Takes the snapshots of the stories the run takes, with the run's reporter showing their progress as it happens and
 * ended once they are taken, then for `test` writes the report of a run that exits 0 or 1, and for `update` prints its
 * document with `--reporter json`. Gives the stop of a run that stopped with exit 2.
 *
 * @throws {Error} Any error besides the problems that stop the run with exit 2.
 */
async function selectedOutcomeOf(
  context: RunContext,
  config: ResolvedConfig,
  checked: CheckedRun,
  selection: RunSelection,
): Promise<RunOutcome> {
  const { command, options } = context
  const version = readCliManifest().version
  const warnings = `${checked.warnings}${selection.warning}`
  const reporter = await runReporterOf(context)
  let result: SnapshotRunResult

  try {
    result = await runSnapshots({
      command,
      version,
      ci: context.ci,
      consistencyOnly: options.consistency,
      shard: options.shard,
      config,
      workers: workersOf(options, config, checked.placement.host),
      place: checked.placement.place,
      browserPackage: checked.browserPackage,
      selections: selection.selections,
      selectionNotes: selection.notes,
      cwd: context.cwd,
      insideContainer: checked.insideContainer,
      environment: context.environment,
      ...runDefaultsOf(context.cliOptions),
      events: (event) => reporter.event(event),
    })
  } catch (error) {
    // The run's error says what went wrong, so a reporter that also fails to end can't hide it.
    await reporter.finish().catch(() => undefined)

    throw error
  }

  await reporter.finish()

  if ('stopMessage' in result) {
    return {
      stopped: {
        // The lines of the snapshots that finished before the stop are already written.
        stdout: '',
        stderr: `${warnings}${result.stderr}`,
        message: result.stopMessage,
        // The report folder that failed can't take an error report either.
        configPath: result.reportFailed ? undefined : config.path,
        storybooks: config.storybooks,
        unreachable: [],
        selection: selection.report,
      },
    }
  }

  const output = { stdout: result.stdout, stderr: `${warnings}${result.stderr}` }
  const facts = {
    version,
    configPath: config.path,
    selection: selection.report,
    storybooks: checked.storybooks.map(({ storybook }) => storybook),
    exitCode: result.exitCode,
    findings: result.findings,
  }

  if (command === 'update') {
    // update writes no report.json: its document is for --reporter json and the step summary.
    return {
      finished: {
        exitCode: result.exitCode,
        ...runOutputOf(output, updateReportFor(facts), options.reporter, undefined),
      },
    }
  }

  return await withTestReport(
    { exitCode: result.exitCode, ...output },
    context,
    { ...facts, consistencyOnly: options.consistency, shard: options.shard },
    result.checkedOnly,
  )
}

/**
 * Works out the stories the run takes in each Storybook, as `workOutRunSelection` says, finding what the changed files
 * reach with the caller's `findReachedFiles`, else with Fallow. Gives the stop of a `--base` that names no commit, with
 * the checks' warnings before the problem on stderr.
 *
 * @throws {Error} Any error besides an `InvalidBaseError`.
 */
async function runSelectionOf(
  context: RunContext,
  config: ResolvedConfig,
  checked: CheckedRun,
): Promise<{ selection: RunSelection } | { stopped: RunStop }> {
  try {
    return {
      selection: await workOutRunSelection({
        selection: context.options.selection,
        baseRef: context.options.baseRef,
        environment: context.environment,
        cwd: context.cwd,
        storybooks: checked.storybooks,
        configPath: config.path,
        affected: config.affected,
        findReachedFiles: context.cliOptions.findReachedFiles ?? findReachedFilesWithFallow,
      }),
    }
  } catch (error) {
    if (error instanceof InvalidBaseError) {
      const problem = `${error.message}\n`

      return {
        stopped: {
          stdout: '',
          stderr: `${checked.warnings}${problem}`,
          message: problem,
          configPath: config.path,
          storybooks: config.storybooks,
          unreachable: [],
        },
      }
    }

    throw error
  }
}

/**
 * Starts the reporter that shows the run's progress stream as it happens. `live` draws it on stdout in the terminal
 * UI, which it loads only then. `log` and `json` write the `log` lines through the run's `write`: on stdout, or on
 * stderr with `--reporter json`, whose stdout holds its document alone.
 */
async function runReporterOf(context: RunContext): Promise<RunReporter> {
  if (context.options.reporter === 'live') {
    // Loaded only here, so log and json never load React and Ink.
    const { startLiveView } = await import('../terminal-ui/live-view.js')

    return startLiveView({ environment: context.environment, stdout: process.stdout, elapsedMs: context.elapsedMs })
  }

  const stream = context.options.reporter === 'json' ? 'stderr' : 'stdout'

  return logReporterOf((text) => context.write(stream, text))
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
 * Writes the report of a `test` that exits 0 or 1, then, unless the run stopped after its consistency check, ends
 * stdout with the end block built from the report: the failures, the flaky snapshots, and the counts with how long the
 * run took. It gives the report's path as the report line for stdout. With `--reporter json` stdout holds the report's
 * JSON document alone, the human lines, the end block included, move to stderr, and the report line is for stderr.
 * When the report can't be written, the run stops with exit 2 with what went wrong after its stderr, and no error
 * report is written. An error that is a bug stops it too, after what it printed.
 */
async function withTestReport(
  result: RunResult,
  context: RunContext,
  facts: TestReportFacts,
  checkedOnly: boolean,
): Promise<RunOutcome> {
  const { cwd } = context
  const folder = reportFolderOf(facts.configPath)

  try {
    const report = await testReportFor(facts)

    await writeReportJson(folder, report)

    const endLines = checkedOnly
      ? []
      : testEndLinesOf(report, { cwd, configFolder: dirname(facts.configPath), elapsedMs: context.elapsedMs() })
    const output = { stdout: `${result.stdout}${endLines.map((line) => `${line}\n`).join('')}`, stderr: result.stderr }

    return {
      finished: {
        ...result,
        ...runOutputOf(output, report, context.options.reporter, { stream: 'stdout', text: reportLineOf(cwd, folder) }),
      },
    }
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
          selection: facts.selection,
        },
      }
    }

    return crashedBy(error, {
      ...result,
      configPath: facts.configPath,
      storybooks: facts.storybooks,
      selection: facts.selection,
    })
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
 * caller's prompter, else the one that takes every default, and plain progress, and the result carries the text,
 * without the messages and the summary only the terminal UI shows.
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

    const { exitCode, stdout, stderr } = await runInit(
      cwd,
      initToolsOf(yes, { interactive, prompter, progress }, cliOptions),
    )

    return { exitCode, stdout, stderr }
  }

  // Loaded only here, so `test` and `update` never load init's view.
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
    await view.finish({ exitCode: 2, stdout: '', stderr: '', messages: [] })

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
