import { readFileSync } from 'node:fs'
import { checkBrowserPackage } from '../browser/browser-package.js'
import { ConfigError } from '../config/config-error.js'
import { isCi } from '../config/is-ci.js'
import { type LoadConfigOptions, loadConfig } from '../config/load-config.js'
import { checkStorybooks } from './check-storybooks.js'
import { parseCommandLine, type RunOptions, UsageError } from './parse-command-line.js'
import { selectStories } from './select-stories.js'

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
 * Runs the CLI with the given arguments, environment and folder, and returns its result without writing anything.
 * Problems with the command line, the config or the run's setup exit with code 2. Other errors are thrown.
 *
 * @public
 */
export async function runCli(
  commandLineArguments: string[],
  environment: Record<string, string | undefined>,
  cwd: string,
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
        return await runTestOrUpdate(commandLine.command, commandLine.options, environment, cwd)
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
 * installed, the config is found, valid and usable, and every Storybook in the run answers with an index. Then it
 * reports how many stories each Storybook's selection covers.
 *
 * @throws {ConfigError} When the config can't be found, loaded or used.
 */
async function runTestOrUpdate(
  command: 'test' | 'update',
  options: RunOptions,
  environment: Record<string, string | undefined>,
  cwd: string,
): Promise<CliResult> {
  const ci = isCi(environment)

  if (command === 'update' && ci) {
    return failure(
      'visual-check update only runs locally, and the CI environment variable is set. ' +
        'Run it on your machine and commit the baselines, or unset CI.',
    )
  }

  const browserProblem = checkBrowserPackage(environment)

  if (browserProblem !== undefined) {
    return { exitCode: 2, stdout: '', stderr: browserProblem }
  }

  const config = await loadConfig(loadConfigOptionsOf(options, ci, cwd))
  const checks = await checkStorybooks(config.storybooks, cwd)
  const warnings = checks.warnings.map((warning) => `${warning}\n`).join('')

  if ('problems' in checks) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `${warnings}${checks.problems.map((problem) => `${problem}\n`).join('')}`,
    }
  }

  const stdout = checks.storybooks
    .map(
      ({ name, stories }) => `Storybook ${name}: ${storyCountOf(selectStories(stories, options.selection).length)}\n`,
    )
    .join('')

  return { exitCode: 0, stdout, stderr: warnings }
}

/**
 * Writes a number of stories as a count, with the noun in the right number.
 */
function storyCountOf(count: number): string {
  return `${count} ${count === 1 ? 'story' : 'stories'}`
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
