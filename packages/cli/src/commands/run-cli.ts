import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const usage = 'Usage: visual-check --version'

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
 * Runs the CLI with the given arguments and returns its result without writing anything.
 *
 * @public
 */
export function runCli(commandLineArguments: string[]): CliResult {
  let version: boolean | undefined
  try {
    version = parseArgs({ args: commandLineArguments, options: { version: { type: 'boolean' } }, strict: true }).values
      .version
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error))
  }
  if (!version) {
    return usageError('No command given.')
  }
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
  return { exitCode: 0, stdout: `${manifest.version}\n`, stderr: '' }
}

/**
 * Builds the result for a usage error: the message and the usage line on standard error, exit code 2.
 */
function usageError(message: string): CliResult {
  return { exitCode: 2, stdout: '', stderr: `${message}\n${usage}\n` }
}
