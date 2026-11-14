import { parseArgs } from 'node:util'
import { findStorybookUrlProblem, mayHoldLogin, serveStorybookFix } from '../config/find-storybook-url-problem.js'

/**
 * A command line that can't be run: an unknown command or flag, a missing, empty or extra argument, a flag that doesn't
 * apply to the command, or flags that clash.
 */
export class UsageError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `UsageError`.
   */
  override name = 'UsageError'
}

/**
 * Which stories a run covers. `default` is no selection flag: every story until affected stories exist.
 */
export type Selection = { kind: 'default' } | { kind: 'all' } | { kind: 'filter'; pattern: RegExp }

/**
 * The options `test` and `update` share.
 */
export interface RunOptions {
  /**
   * Which stories the run covers.
   */
  selection: Selection
  /**
   * The Storybook `--storybook` names, or `undefined` when the flag isn't given.
   */
  storybook: string | undefined
  /**
   * The URL `--url` gives, or `undefined` when the flag isn't given.
   */
  url: string | undefined
  /**
   * The path `--config` gives, or `undefined` when the flag isn't given.
   */
  config: string | undefined
}

/**
 * What the command line asks for.
 */
export type CommandLine =
  | { command: 'help' }
  | { command: 'version' }
  | { command: 'init' }
  | { command: 'test' | 'update'; options: RunOptions }

/**
 * The flags `init` doesn't take, in the order a message names the first one given.
 */
const flagsInitRejects = ['all', 'filter', 'storybook', 'url', 'config'] as const

/**
 * The flags that take a value, which can't be empty.
 */
const flagsWithValue = ['filter', 'storybook', 'url', 'config'] as const

/**
 * Turns a thrown value into its message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Builds the selection from `--all` and `--filter`.
 *
 * @throws {UsageError} When both are given, or `--filter` isn't a regular expression.
 */
function selectionOf(all: boolean | undefined, filter: string | undefined): Selection {
  if (all && filter !== undefined) {
    throw new UsageError("--all and --filter can't be used together. Pick one.")
  }

  if (all) {
    return { kind: 'all' }
  }

  if (filter === undefined) {
    return { kind: 'default' }
  }

  try {
    return { kind: 'filter', pattern: new RegExp(filter) }
  } catch (error) {
    throw new UsageError(`--filter takes a regular expression: ${messageOf(error)}`)
  }
}

/**
 * Runs Node's argument parser, strictly, with the CLI's flags.
 */
function parseCommandLineArguments(commandLineArguments: string[]) {
  return parseArgs({
    args: commandLineArguments,
    options: {
      all: { type: 'boolean' },
      filter: { type: 'string' },
      storybook: { type: 'string' },
      url: { type: 'string' },
      config: { type: 'string' },
      help: { type: 'boolean' },
      version: { type: 'boolean' },
    },
    strict: true,
    allowPositionals: true,
  })
}

/**
 * Whether a `--help` token appears before any `--` separator, so `--help` wins over whatever else is on the line.
 */
function asksForHelp(commandLineArguments: string[]): boolean {
  const separatorIndex = commandLineArguments.indexOf('--')

  return (separatorIndex === -1 ? commandLineArguments : commandLineArguments.slice(0, separatorIndex)).includes(
    '--help',
  )
}

/**
 * Checks the `--url` flag: an http(s) URL that holds no login. A message never shows a login.
 *
 * @throws {UsageError} When the URL isn't an http(s) URL, or holds a user name or password.
 */
function checkUrlFlag(url: string | undefined): void {
  if (url === undefined) {
    return
  }

  const problem = findStorybookUrlProblem(url)

  if (problem === 'login') {
    throw new UsageError(
      "--url can't hold a user name or password. " +
        `visual-check sends no login: ${serveStorybookFix} and point --url at that.`,
    )
  }

  if (problem === 'not-http') {
    const got = mayHoldLogin(url) ? '' : ` Got '${url}'.`

    throw new UsageError(`--url takes an http: or https: URL, such as 'http://127.0.0.1:6006'.${got}`)
  }
}

/**
 * Reads the command line into the command it names and its options.
 *
 * @throws {UsageError} For an unknown command or flag, a missing, empty or extra argument, a flag that doesn't apply to
 * the command, flags that clash, a `--url` that isn't an http(s) URL or holds a login, and a `--filter` that isn't a
 * regular expression. `--help` anywhere before a `--` separator wins, so it never throws.
 */
export function parseCommandLine(commandLineArguments: string[]): CommandLine {
  if (asksForHelp(commandLineArguments)) {
    return { command: 'help' }
  }

  let parsed: ReturnType<typeof parseCommandLineArguments>

  try {
    parsed = parseCommandLineArguments(commandLineArguments)
  } catch (error) {
    throw new UsageError(messageOf(error))
  }

  const { values, positionals } = parsed

  if (values.version) {
    return { command: 'version' }
  }

  const empty = flagsWithValue.find((flag) => values[flag] === '')

  if (empty !== undefined) {
    throw new UsageError(`--${empty} needs a value.`)
  }

  const [command, extra] = positionals

  if (command === undefined) {
    throw new UsageError('No command given.')
  }

  if (command !== 'init' && command !== 'test' && command !== 'update') {
    const shown = mayHoldLogin(command)
      ? 'Unknown command (not shown: it may hold a password).'
      : `Unknown command '${command}'.`

    throw new UsageError(`${shown} The commands are init, test and update.`)
  }

  if (extra !== undefined) {
    throw new UsageError(
      mayHoldLogin(extra)
        ? 'Unexpected argument (not shown: it may hold a password).'
        : `Unexpected argument '${extra}'.`,
    )
  }

  if (command === 'init') {
    const rejected = flagsInitRejects.find((flag) => values[flag] !== undefined)

    if (rejected !== undefined) {
      throw new UsageError(`--${rejected} doesn't apply to init.`)
    }

    return { command: 'init' }
  }

  checkUrlFlag(values.url)

  return {
    command,
    options: {
      selection: selectionOf(values.all, values.filter),
      storybook: values.storybook,
      url: values.url,
      config: values.config,
    },
  }
}
