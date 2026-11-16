import { locateConfig } from '../config/find-config.js'
import type { ReportStorybook } from '../report/report-document.js'
import { ReportError, reportFolderOf, writeErrorReport } from '../report/report-folder.js'
import type { RunOptions, UsageError } from './parse-command-line.js'
import { reportLineOf, stopOutputOf } from './run-output.js'
import { testErrorReportOf } from './run-report.js'
import { reportProblemOf } from './stop-message.js'

/**
 * The hint every usage error ends with.
 */
const usageHint = 'Run visual-check --help to see the commands and options.\n'

/**
 * What stopped a `test` or `update` with exit 2, and what it printed.
 *
 * @public
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
 *
 * @public
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
 * What a stopped run prints on each stream, and its exit code, 2.
 *
 * @public
 */
export interface StoppedOutput {
  /**
   * The exit code: 2.
   */
  exitCode: 2
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
 * Gives the stop of a run stopped by a problem before anything was printed on stdout: the problem on stderr, as the
 * report's message too, with no unreachable Storybook.
 *
 * @public
 */
export function stoppedBy(problem: string, inRun: Pick<RunStop, 'configPath' | 'storybooks'>): { stopped: RunStop } {
  return { stopped: { ...inRun, stdout: '', stderr: problem, message: problem, unreachable: [] } }
}

/**
 * Ends a `test` that exits 2. When the stop names a config, the report folder beside it is replaced with a report
 * holding only the error, wiping any images the run wrote, and the report's path ends stderr; a report folder that
 * can't be written adds its problem instead. With `--reporter json`, stdout holds the error document alone, its
 * `reportDir` `null` when nothing was written.
 *
 * @throws {Error} Any error besides a `ReportError` while writing the report.
 *
 * @public
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
    return { exitCode: 2, ...stopOutputOf(stop, report, options.reporter, '') }
  }

  const folder = reportFolderOf(stop.configPath)

  try {
    await writeErrorReport(folder, report)
  } catch (error) {
    if (error instanceof ReportError) {
      return {
        exitCode: 2,
        ...stopOutputOf(stop, { ...report, reportDir: null }, options.reporter, reportProblemOf(error, cwd)),
      }
    }

    throw error
  }

  return { exitCode: 2, ...stopOutputOf(stop, report, options.reporter, `${reportLineOf(cwd, folder)}\n`) }
}

/**
 * Ends a run whose command line has a usage error: the message and the hint on stderr, exit code 2. For `test`, once
 * its flags parsed, the report folder beside the config the run would load is replaced with a report holding the
 * error, as `stoppedTestOf` says.
 *
 * @throws {Error} Any error besides a `ReportError` while writing the report.
 *
 * @public
 */
export async function usageFailureOf(error: UsageError, cwd: string, version: string): Promise<StoppedOutput> {
  const stderr = `${error.message}\n${usageHint}`

  if (error.run?.command !== 'test') {
    return { exitCode: 2, stdout: '', stderr }
  }

  return await stoppedTestOf(
    {
      stdout: '',
      stderr,
      message: error.message,
      configPath: locateConfig(cwd, error.run.config),
      storybooks: [],
      unreachable: [],
    },
    {
      version,
      cwd,
      options: { consistency: false, shard: undefined, selection: { kind: 'default' }, reporter: error.run.reporter },
    },
  )
}
