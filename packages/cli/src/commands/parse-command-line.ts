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
const flagsInitRejects = ['all', 'filter', 'storybook', 'url', 'config', 'workers', 'consistency', 'shard'] as const

/**
 * The flags that take a value, which can't be empty.
 */
const flagsWithValue = ['filter', 'storybook', 'url', 'config', 'workers', 'shard'] as const

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
      workers: { type: 'string' },
      consistency: { type: 'boolean' },
      shard: { type: 'string' },
      yes: { type: 'boolean' },
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
 * Reads the command line into the command it names and its options.
 *
 * @throws {UsageError} For an unknown command or flag, a missing, empty or extra argument, a flag that doesn't apply to
 * the command, flags that clash, a `--url` that isn't an http(s) URL or holds a login, a `--filter` that isn't a
 * regular expression, a `--workers` that isn't a whole number of 1 or more, `--consistency` on `update` or with `--all`
 * or `--filter`, a `--shard` that isn't `k/n` with 1 ≤ k ≤ n, or is on `update` or with `--consistency`, and `--yes` on
 * `test` or `update`.
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

    return { command: 'init', options: { yes: values.yes === true } }
  }

  checkYesFlag(values.yes)

  checkUrlFlag(values.url)

  const consistency = consistencyFlagOf(command, values)
  const shard = shardFlagOf(command, values)

  return {
    command,
    options: {
      selection: selectionOf(values.all, values.filter),
      storybook: values.storybook,
      url: values.url,
      config: values.config,
      workers: workersFlagOf(values.workers),
      consistency,
      shard,
    },
  }
}
