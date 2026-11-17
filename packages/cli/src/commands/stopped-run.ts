import { locateConfig } from '../config/find-config.js'
import type { ReportStorybook } from '../report/report-document.js'
import { ReportError, reportFolderOf, writeErrorReport } from '../report/report-folder.js'
import type { RunOptions, UsageError } from './parse-command-line.js'
import { type RunOutput, reportLineOf, runOutputOf } from './run-output.js'
import { testErrorReportOf, updateErrorReportOf } from './run-report.js'
import { crashOf, reportProblemOf } from './stop-message.js'

/**
 * The hint every usage error ends with.
 */
const usageHint = 'Run visual-check --help to see the commands and options.\n'

/**
 * What stopped a `test` or `update` with exit 2, and what it printed.
 */
export interface RunStop {
  /**
   * The lines the run printed on stdout before it stopped.
   */
  stdout: string
  /**
   * What the run prints on stderr: warnings and notices, then the problem.
   */
  stderr: string
  /**
   * The problem, for the report, without warnings, notices or the usage hint.
   */
  message: string
  /**
   * The config whose report folder the error report replaces, or `undefined` when none is written: no config was
   * found, or the report folder itself failed.
   */
  configPath: string | undefined
  /**
   * The Storybooks in the run, in config order. None before the config is loaded.
   */
  storybooks: readonly ReportStorybook[]
  /**
   * The Storybooks where nothing answers, in config order.
   */
  unreachable: readonly ReportStorybook[]
}

/**
 * What ending a `test` that exits 2 needs to know about the run, apart from what stopped it.
 */
export interface StoppedTest {
  /**
   * The CLI's version.
   */
  version: string
  /**
   * The folder the CLI runs in. Printed paths are relative to it.
   */
  cwd: string
  /**
   * The run's options the report reads.
   */
  options: Pick<RunOptions, 'consistency' | 'shard' | 'selection' | 'reporter'>
}

/**
 * What ending an `update` that exits 2 needs to know about the run, apart from what stopped it.
 */
export interface StoppedUpdate {
  /**
   * The CLI's version.
   */
  version: string
  /**
   * The run's options the error document reads.
   */
  options: Pick<RunOptions, 'selection' | 'reporter'>
}

/**
 * What a stopped run prints, and its exit code, 2.
 */
export interface StoppedOutput extends RunOutput {
  /**
   * The exit code: 2.
   */
  exitCode: 2
}

/**
 * Gives the stop of a run stopped by a problem before anything was printed on stdout: the problem on stderr, as the
 * report's message too, with no unreachable Storybook.
 */
export function stoppedBy(problem: string, inRun: Pick<RunStop, 'configPath' | 'storybooks'>): { stopped: RunStop } {
  return { stopped: { ...inRun, stdout: '', stderr: problem, message: problem, unreachable: [] } }
}

/**
 * Gives the stop of a run that an error ended which is a bug, not a problem visual-check knows: what the run printed
 * so far, then the error's stack trace on stderr, with its message for the report.
 */
export function crashedBy(
  error: unknown,
  inRun: Pick<RunStop, 'stdout' | 'stderr' | 'configPath' | 'storybooks'>,
): { stopped: RunStop } {
  const crash = crashOf(error)

  return { stopped: { ...inRun, stderr: `${inRun.stderr}${crash.stderr}`, message: crash.message, unreachable: [] } }
}

/**
 * Ends a `test` that exits 2. When the stop names a config, the report folder beside it is replaced with a report
 * holding only the error, wiping any images the run wrote, and the report's path is the report line, for stderr; a
 * report folder that can't be written adds its problem to stderr instead. With `--reporter json`, stdout holds the
 * error document alone, its `reportDir` `null` when nothing was written.
 *
 * @throws {Error} Any error besides a `ReportError` while writing the report.
 */
export async function stoppedTestOf(stop: RunStop, test: StoppedTest): Promise<StoppedOutput> {
  const { options, cwd } = test
  const report = testErrorReportOf({
    version: test.version,
    consistencyOnly: options.consistency,
    shard: options.shard,
    selection: options.selection,
    storybooks: stop.storybooks,
    message: stop.message,
    unreachable: stop.unreachable,
    written: stop.configPath !== undefined,
  })

  if (stop.configPath === undefined) {
    return { exitCode: 2, ...runOutputOf(stop, report, options.reporter, undefined) }
  }

  const folder = reportFolderOf(stop.configPath)

  try {
    await writeErrorReport(folder, report)
  } catch (error) {
    if (error instanceof ReportError) {
      return {
        exitCode: 2,
        ...runOutputOf(
          { stdout: stop.stdout, stderr: `${stop.stderr}${reportProblemOf(error, cwd)}` },
          { ...report, reportDir: null },
          options.reporter,
          undefined,
        ),
      }
    }

    throw error
  }

  return {
    exitCode: 2,
    ...runOutputOf(stop, report, options.reporter, { stream: 'stderr', text: reportLineOf(cwd, folder) }),
  }
}

/**
 * Ends an `update` that exits 2 with what it printed. It never touches the report folder. With `--reporter json`,
 * stdout holds `update`'s error document alone, with no report folder.
 */
export function stoppedUpdateOf(stop: RunStop, update: StoppedUpdate): StoppedOutput {
  const report = updateErrorReportOf({
    version: update.version,
    selection: update.options.selection,
    storybooks: stop.storybooks,
    message: stop.message,
    unreachable: stop.unreachable,
  })

  return { exitCode: 2, ...runOutputOf(stop, report, update.options.reporter, undefined) }
}

/**
 * Ends a run whose command line has a usage error: the message and the hint on stderr, exit code 2. For an error that
 * names its `test` run, the report folder beside the config the run would load is replaced with a report holding the
 * error, as `stoppedTestOf` says. For one that names its `update` run, it ends as `stoppedUpdateOf` says.
 *
 * @throws {Error} Any error besides a `ReportError` while writing the report.
 */
export async function usageFailureOf(error: UsageError, cwd: string, version: string): Promise<StoppedOutput> {
  const stderr = `${error.message}\n${usageHint}`
  const stop = { stdout: '', stderr, message: error.message, storybooks: [], unreachable: [] }

  if (error.run === undefined) {
    return { exitCode: 2, stdout: '', stderr }
  }

  if (error.run.command === 'update') {
    return stoppedUpdateOf(
      { ...stop, configPath: undefined },
      { version, options: { selection: { kind: 'default' }, reporter: error.run.reporter } },
    )
  }

  return await stoppedTestOf(
    { ...stop, configPath: locateConfig(cwd, error.run.config) },
    {
      version,
      cwd,
      options: { consistency: false, shard: undefined, selection: { kind: 'default' }, reporter: error.run.reporter },
    },
  )
}
