import { parseArgs } from 'node:util'
import { findStorybookUrlProblem, mayHoldLogin, serveStorybookFix } from '../config/find-storybook-url-problem.js'
import type { Shard } from '../sharding/shard.js'

/**
 * A command line that can't be run: an unknown command or flag, a missing, empty or extra argument, a flag that doesn't
 * apply to the command, or flags that clash.
 */
export class UsageError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `UsageError`.
   */
  override name = 'UsageError'

  /**
   * The `test` or `update` run the command line asks for, with what its `--config` and `--reporter` flags give, when
   * the error is in the flags' values or how they combine, or as far as a loose parse tells when they fail to parse.
   * `undefined` for anything else, such as an unknown command or no command.
   */
  readonly run: UsageErrorRun | undefined

  /**
   * Keeps the message and the run it is about, if any.
   */
  constructor(message: string, run?: UsageErrorRun) {
    super(message)
    this.run = run
  }
}

/**
 * The `test` or `update` run a command line with a usage error asks for, as far as its flags tell.
 */
export interface UsageErrorRun {
  /**
   * The command.
   */
  command: 'test' | 'update'
  /**
   * The path `--config` gives, or `undefined` when the flag isn't given.
   */
  config: string | undefined
  /**
   * The reporter `--reporter` names, or `undefined` when the flag isn't given or names no reporter.
   */
  reporter: Reporter | undefined
}

/**
 * Which stories a run covers. `default` is no selection flag: every story until affected stories exist.
 */
export type Selection = { kind: 'default' } | { kind: 'all' } | { kind: 'filter'; pattern: RegExp }

/**
 * How a run reports: `live` and `log` print the human output, `json` prints the report's JSON document on stdout.
 */
export type Reporter = 'live' | 'log' | 'json'

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
  /**
   * The number of workers `--workers` gives, or `undefined` when the flag isn't given.
   */
  workers: number | undefined
  /**
   * Whether `--consistency` is given: `test` only runs the consistency check, over every story, and captures nothing.
   * Always `false` for `update`.
   */
  consistency: boolean
  /**
   * The shard `--shard` gives, or `undefined` when the flag isn't given. Always `undefined` for `update`.
   */
  shard: Shard | undefined
  /**
   * The reporter `--reporter` names, or `undefined` when the flag isn't given.
   */
  reporter: Reporter | undefined
}

/**
 * The options `init` takes.
 */
export interface InitOptions {
  /**
   * Whether `--yes` is given: `init` takes every default and asks nothing.
   */
  yes: boolean
}

/**
 * What the command line asks for.
 */
export type CommandLine =
  | { command: 'help' }
  | { command: 'version' }
  | { command: 'init'; options: InitOptions }
  | { command: 'test' | 'update'; options: RunOptions }

/**
 * The flags `init` doesn't take, in the order a message names the first one given.
 */
const flagsInitRejects = [
  'all',
  'filter',
  'storybook',
  'url',
  'config',
  'workers',
  'consistency',
  'shard',
  'reporter',
] as const

/**
 * The flags that take a value, which can't be empty.
 */
const flagsWithValue = ['filter', 'storybook', 'url', 'config', 'workers', 'shard', 'reporter'] as const

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
 * The CLI's flags, as Node's argument parser takes them.
 */
const flagOptions = {
  all: { type: 'boolean' },
  filter: { type: 'string' },
  storybook: { type: 'string' },
  url: { type: 'string' },
  config: { type: 'string' },
  workers: { type: 'string' },
  consistency: { type: 'boolean' },
  shard: { type: 'string' },
  reporter: { type: 'string' },
  yes: { type: 'boolean' },
  help: { type: 'boolean' },
  version: { type: 'boolean' },
} as const

/**
 * Runs Node's argument parser, strictly, with the CLI's flags.
 */
function parseCommandLineArguments(commandLineArguments: string[]) {
  return parseArgs({ args: commandLineArguments, options: flagOptions, strict: true, allowPositionals: true })
}

/**
 * The flags that take a value, as a command line writes them.
 */
const valueFlags = new Set(flagsWithValue.map((flag) => `--${flag}`))

/**
 * Gives the `test` or `update` run of a command line that fails to parse, as far as a loose parse tells, so a `test`
 * still replaces its report and a run with `--reporter json` still prints its error document. A flag that takes a
 * value counts as missing its value when the next argument is a flag. `undefined` for any other command line.
 */
function looseRunOf(commandLineArguments: string[]): UsageErrorRun | undefined {
  const { values, positionals } = parseArgs({
    args: commandLineArguments.map((argument, index) =>
      valueFlags.has(argument) && commandLineArguments[index + 1]?.startsWith('-') ? `${argument}=` : argument,
    ),
    options: flagOptions,
    strict: false,
    allowPositionals: true,
  })
  const [command] = positionals
  const { config, reporter } = values

  if (command !== 'test' && command !== 'update') {
    return undefined
  }

  // A loose parse gives `true` to a flag missing its value.
  return {
    command,
    config: typeof config === 'string' && config !== '' ? config : undefined,
    reporter: typeof reporter === 'string' && isReporter(reporter) ? reporter : undefined,
  }
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
 * Reads the `--workers` flag into a number: a whole number of 1 or more, written in digits.
 *
 * @throws {UsageError} When the value is anything else.
 */
function workersFlagOf(workers: string | undefined): number | undefined {
  if (workers === undefined) {
    return undefined
  }

  const count = Number(workers)

  if (!/^[1-9]\d*$/.test(workers) || !Number.isSafeInteger(count)) {
    throw new UsageError(`--workers takes a whole number of 1 or more. Got '${workers}'.`)
  }

  return count
}

/**
 * Reads the `--consistency` flag for `test` or `update`. It covers every story, so every flag that selects stories must
 * be rejected here, `--all` and `--filter` today, and any added later, such as `--affected`.
 *
 * @throws {UsageError} When it's given to `update`, or with `--all` or `--filter`.
 */
function consistencyFlagOf(
  command: 'test' | 'update',
  values: { consistency?: boolean | undefined; all?: boolean | undefined; filter?: string | undefined },
): boolean {
  if (!values.consistency) {
    return false
  }

  if (command === 'update') {
    throw new UsageError('--consistency applies only to test.')
  }

  if (values.all || values.filter !== undefined) {
    throw new UsageError(
      '--consistency covers every story, so it takes no --all or --filter. Use --storybook to narrow it.',
    )
  }

  return true
}

/**
 * Checks the `--yes` flag for `test` or `update`, which don't take it.
 *
 * @throws {UsageError} When it's given.
 */
function checkYesFlag(yes: boolean | undefined): void {
  if (yes) {
    throw new UsageError('--yes applies only to init.')
  }
}

/**
 * Reads a `k/n` shard: two whole numbers of 1 or more, written in digits, with k no greater than n.
 */
function parseShard(value: string): Shard | undefined {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value)

  if (!match) {
    return undefined
  }

  const index = Number(match[1])
  const total = Number(match[2])

  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || index > total) {
    return undefined
  }

  return { index, total }
}

/**
 * Reads the `--shard` flag for `test` into a shard: `k/n`, two whole numbers written in digits, with 1 ≤ k ≤ n.
 * `--filter`, `--all` and `--storybook` narrow the run before the split, so they are accepted. `--consistency` runs in
 * a job of its own, so it is rejected, as `--affected` must be once it exists: affected stories differ between
 * machines, so the shards wouldn't agree on the split.
 *
 * @throws {UsageError} When it's given to `update` or with `--consistency`, or the value isn't `k/n` in range.
 */
function shardFlagOf(
  command: 'test' | 'update',
  values: { shard?: string | undefined; consistency?: boolean | undefined },
): Shard | undefined {
  const { shard } = values

  if (shard === undefined) {
    return undefined
  }

  if (command === 'update') {
    throw new UsageError('--shard applies only to test.')
  }

  if (values.consistency) {
    throw new UsageError('--consistency runs in a job of its own, so it takes no --shard.')
  }

  const parsed = parseShard(shard)

  if (parsed === undefined) {
    throw new UsageError(`--shard takes k/n, two whole numbers with 1 ≤ k ≤ n, such as 2/4. Got '${shard}'.`)
  }

  return parsed
}

/**
 * Reads the `--reporter` flag: `live`, `log` or `json`.
 *
 * @throws {UsageError} When the value is anything else.
 */
function reporterFlagOf(reporter: string | undefined): Reporter | undefined {
  if (reporter === undefined) {
    return undefined
  }

  if (!isReporter(reporter)) {
    throw new UsageError(`--reporter takes live, log or json. Got '${reporter}'.`)
  }

  return reporter
}

/**
 * Reads the command line into the command it names and its options.
 *
 * @throws {UsageError} For an unknown command or flag, a missing, empty or extra argument, a flag that doesn't apply to
 * the command, flags that clash, a `--url` that isn't an http(s) URL or holds a login, a `--filter` that isn't a
 * regular expression, a `--workers` that isn't a whole number of 1 or more, `--consistency` on `update` or with `--all`
 * or `--filter`, a `--reporter` that isn't `live`, `log` or `json`, a `--shard` that isn't `k/n` with 1 ≤ k ≤ n, or
 * is on `update` or with `--consistency`, and `--yes` on `test` or `update`. Once the flags parse, an error of a `test`
 * or `update` command line names its run; one whose flags fail to parse names it as far as a loose parse tells.
 * `--help` anywhere before a `--` separator wins, so it never throws.
 */
export function parseCommandLine(commandLineArguments: string[]): CommandLine {
  if (asksForHelp(commandLineArguments)) {
    return { command: 'help' }
  }

  let parsed: ReturnType<typeof parseCommandLineArguments>

  try {
    parsed = parseCommandLineArguments(commandLineArguments)
  } catch (error) {
    throw new UsageError(messageOf(error), looseRunOf(commandLineArguments))
  }

  const { values, positionals } = parsed

  if (values.version) {
    return { command: 'version' }
  }

  try {
    return commandLineOf(values, positionals)
  } catch (error) {
    throw withRunOf(error, positionals[0], values)
  }
}

/**
 * The flags as Node's argument parser reads them.
 */
type ParsedFlags = ReturnType<typeof parseCommandLineArguments>['values']

/**
 * Gives the error to throw for an error of a parsed command line: a `UsageError` of `test` or `update` names its run,
 * with what `--config` and `--reporter` give. Anything else is given back as it is.
 */
function withRunOf(error: unknown, command: string | undefined, values: ParsedFlags): unknown {
  if (!(error instanceof UsageError) || (command !== 'test' && command !== 'update')) {
    return error
  }

  return new UsageError(error.message, {
    command,
    config: values.config,
    reporter: isReporter(values.reporter) ? values.reporter : undefined,
  })
}

/**
 * Whether a `--reporter` value names a reporter.
 */
function isReporter(reporter: string | undefined): reporter is Reporter {
  return reporter === 'live' || reporter === 'log' || reporter === 'json'
}

/**
 * The commands the CLI runs.
 */
const commands = ['init', 'test', 'update'] as const

/**
 * Whether a positional names one of the CLI's commands.
 */
function isCommand(command: string): command is (typeof commands)[number] {
  return (commands as readonly string[]).includes(command)
}

/**
 * Says that a command is unknown, showing it unless it may hold a password.
 */
function unknownCommandMessageOf(command: string): string {
  const shown = mayHoldLogin(command)
    ? 'Unknown command (not shown: it may hold a password).'
    : `Unknown command '${command}'.`

  return `${shown} The commands are init, test and update.`
}

/**
 * Says that an argument is unexpected, showing it unless it may hold a password.
 */
function unexpectedArgumentMessageOf(extra: string): string {
  return mayHoldLogin(extra)
    ? 'Unexpected argument (not shown: it may hold a password).'
    : `Unexpected argument '${extra}'.`
}

/**
 * Reads the command the positionals name, after checking that no flag that takes a value is empty.
 *
 * @throws {UsageError} For an empty flag value, no command, an unknown command or an extra argument.
 */
function commandOf(values: ParsedFlags, positionals: string[]): (typeof commands)[number] {
  const empty = flagsWithValue.find((flag) => values[flag] === '')

  if (empty !== undefined) {
    throw new UsageError(`--${empty} needs a value.`)
  }

  const [command, extra] = positionals

  if (command === undefined) {
    throw new UsageError('No command given.')
  }

  if (!isCommand(command)) {
    throw new UsageError(unknownCommandMessageOf(command))
  }

  if (extra !== undefined) {
    throw new UsageError(unexpectedArgumentMessageOf(extra))
  }

  return command
}

/**
 * Reads the parsed flags and positionals into the command they name and its options.
 *
 * @throws {UsageError} As `parseCommandLine` says, for anything after the flags parsed.
 */
function commandLineOf(values: ParsedFlags, positionals: string[]): CommandLine {
  const command = commandOf(values, positionals)

  if (command === 'init') {
    const rejected = flagsInitRejects.find((flag) => values[flag] !== undefined)

    if (rejected !== undefined) {
      throw new UsageError(`--${rejected} doesn't apply to init.`)
    }

    return { command: 'init', options: { yes: values.yes === true } }
  }

  return { command, options: runOptionsOf(command, values) }
}

/**
 * Reads the options of `test` or `update` from the parsed flags.
 *
 * @throws {UsageError} As `parseCommandLine` says, for a flag of a run.
 */
function runOptionsOf(command: 'test' | 'update', values: ParsedFlags): RunOptions {
  checkYesFlag(values.yes)

  checkUrlFlag(values.url)

  const consistency = consistencyFlagOf(command, values)
  const shard = shardFlagOf(command, values)

  return {
    selection: selectionOf(values.all, values.filter),
    storybook: values.storybook,
    url: values.url,
    config: values.config,
    workers: workersFlagOf(values.workers),
    consistency,
    shard,
    reporter: reporterFlagOf(values.reporter),
  }
}
