// The agent skill's runner script. An agent runs it instead of the visual-check CLI:
//
//   node .agents/skills/visual-check/scripts/run.mjs test [flags]
//
// It runs the CLI command from the skill's setup.json in its folder, with the caller's command and flags plus
// `--reporter json`. stdout carries the CLI's JSON report unchanged, stderr carries everything else, and the exit code
// is the CLI's. When the CLI exits 2 because Storybooks it needs are unreachable, the script starts those, waits until
// they answer and runs the CLI again. It runs every process tree it starts, the CLI's and each Storybook's, under a
// keeper, which stops the whole tree once the script is done, on an interrupt, or when the script itself is killed. It
// never stops a Storybook it didn't start.
//
// `visual-check init` installs this file, and local runs refresh it. It must stay plain JavaScript that imports only
// Node's built-in modules.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { constants } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

/**
 * The flag that makes the script a keeper: `node run.mjs --keep-tree '<json {argv, cwd}>'`.
 */
const keepTreeFlag = '--keep-tree'

/**
 * How long a keeper waits for a process group to go after SIGTERM before it sends SIGKILL, in milliseconds.
 */
const stopGraceMilliseconds = 5_000

/**
 * How long a keeper's whole stop may take before the keeper gives up on the tree and exits, in milliseconds.
 */
const stopDeadlineMilliseconds = stopGraceMilliseconds + 5_000

/**
 * How often a keeper checks whether a process group it stops is gone, in milliseconds.
 */
const stopPollMilliseconds = 100

/**
 * Whether the script runs on Windows, where every command runs through `cmd.exe` and a tree stops with `taskkill`.
 */
const windows = process.platform === 'win32'

/**
 * The signals that interrupt the script and stop a keeper's tree.
 *
 * @type {NodeJS.Signals[]}
 */
const interruptSignals = windows ? ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] : ['SIGINT', 'SIGTERM', 'SIGHUP']

/**
 * The path of this file, which a keeper runs again.
 */
const scriptPath = fileURLToPath(import.meta.url)

/**
 * How long the script waits for an exited keeper's pipes to close before it stops reading them, in milliseconds.
 */
const pipeCloseGraceMilliseconds = 1_000

/**
 * How long the script waits for a Storybook it started to answer, from its start, in milliseconds.
 */
const storybookStartTimeoutMilliseconds = 180_000

/**
 * How often the script asks a Storybook it started whether it answers yet, in milliseconds.
 */
const storybookPollMilliseconds = 500

/**
 * How long one request for a Storybook's index may take, in milliseconds.
 */
const probeTimeoutMilliseconds = 10_000

/**
 * How many lines of a Storybook's output a failed start shows.
 */
const outputTailLimit = 15

/**
 * A command the script runs: its words, the program first, and its absolute working directory.
 *
 * @typedef {object} Command
 * @property {string[]} argv The command's words, the program first.
 * @property {string} cwd The absolute folder the command runs in.
 */

/**
 * What the skill's `setup.json` says: the CLI command and each Storybook's start command, keyed by its config name.
 *
 * @typedef {object} Setup
 * @property {Command} cli The command that runs the visual-check CLI.
 * @property {Record<string, Command>} storybooks Each Storybook's start command, keyed by its config name.
 */

/**
 * A process tree the script started under a keeper.
 *
 * @typedef {object} Tree
 * @property {import('node:child_process').ChildProcess} child The keeper.
 * @property {Promise<number>} exited Settles with the keeper's exit code, the tree's own, once the keeper has exited
 *   and its pipes have closed, or `pipeCloseGraceMilliseconds` after it exited.
 * @property {() => boolean} hasExited Whether the keeper has exited.
 * @property {() => Promise<number>} stop Stops the tree and settles as `exited` does.
 */

/**
 * What a CLI run gave: its exit code and the bytes it wrote on stdout.
 *
 * @typedef {object} CliRun
 * @property {number} exitCode The CLI's exit code.
 * @property {Buffer} stdout What the CLI wrote on stdout, its JSON report.
 */

/**
 * A Storybook as the CLI's report names it.
 *
 * @typedef {object} StorybookRef
 * @property {string} name The Storybook's config name.
 * @property {string} url The Storybook's URL.
 */

/**
 * What the script reads of the CLI's report.
 *
 * @typedef {object} ReportFacts
 * @property {StorybookRef[]} storybooks The Storybooks of the run.
 * @property {StorybookRef[]} unreachable The Storybooks where nothing answers, which made the run error.
 * @property {boolean} runError Whether the run ended in a run error.
 */

/**
 * The end of a Storybook's output, kept as it comes in chunks.
 *
 * @typedef {object} OutputTail
 * @property {(chunk: string) => string[]} add Adds a chunk of output and returns the non-empty lines it completed.
 * @property {() => string[]} lines The last non-empty lines so far, the partial last one included.
 */

/**
 * How the start of a Storybook ended: its tree answers, another server answers in its place, it failed with a message,
 * or the script stopped waiting for it because of an interrupt or another start's failure.
 *
 * @typedef {{ kind: 'started' } | { kind: 'reused' } | { kind: 'failed'; message: string } | { kind: 'aborted' }} StorybookStart
 */

/**
 * The output of a Storybook's tree, as the script watches it while it waits.
 *
 * @typedef {object} StorybookOutput
 * @property {OutputTail} tail The end of the output.
 * @property {AbortSignal} mismatch Aborts once a line says the Storybook started on another port than its URL's.
 * @property {() => number | undefined} startedPort The other port it started on, once a line says so.
 */

/**
 * A tree the registry holds.
 *
 * @typedef {object} RegisteredTree
 * @property {Tree} tree The tree.
 * @property {string | undefined} storybook The name of the Storybook the tree serves, or `undefined` for the CLI's.
 * @property {Promise<boolean> | undefined} stopping Settles with whether the tree still ran when its stop began, once
 *   it is gone. `undefined` until the stop begins.
 */

/**
 * Every tree the script started, so it can stop them all.
 *
 * @typedef {object} TreeRegistry
 * @property {(command: Command, output: 'cli' | 'storybook', storybook?: string) => Tree} start Starts a tree and holds
 *   it. A tree started after an interrupt is stopped at once.
 * @property {() => Promise<Set<string>>} stopAll Stops every tree it holds, in parallel, and settles once they are gone.
 *   Says `Stopped Storybook <name>.` for each Storybook that still ran, in start order, and settles with their names. A
 *   Storybook whose tree ended by itself isn't among them: what answered for it was another server.
 */

/**
 * How the script's run went.
 *
 * @typedef {object} RunOutcome
 * @property {CliRun} last The last CLI run.
 * @property {boolean} failed Whether the script itself failed, which makes it exit 2.
 */

/**
 * The script's watch for interrupt signals.
 *
 * @typedef {object} InterruptWatch
 * @property {AbortSignal} signal Aborts on the first interrupt signal.
 * @property {() => NodeJS.Signals | undefined} interruptedBy The first interrupt signal the script got, if any.
 * @property {() => void} dispose Stops listening for interrupt signals.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Setup: reading the skill's setup.json.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Reads the skill's `setup.json` text. Every `cwd` is resolved against `setupDir`, the folder holding `setup.json`, so
 * a relative one is relative to it and an absolute one stays.
 *
 * Throws an `Error` whose message is the reason the text isn't a setup.
 *
 * @public
 * @param {string} text The text of `setup.json`.
 * @param {string} setupDir The folder holding `setup.json`.
 * @returns {Setup}
 */
export function setupOf(text, setupDir) {
  /** @type {unknown} */
  let parsed

  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`it isn't valid JSON (${messageOf(error)})`)
  }

  const root = isRecord(parsed) ? parsed : {}
  const cli = commandOf(root.cli, 'cli', setupDir)

  if (!isRecord(root.storybooks)) {
    throw new Error("storybooks must map each Storybook's name to its start command and folder")
  }

  /** @type {Record<string, Command>} */
  const storybooks = {}

  for (const [name, entry] of Object.entries(root.storybooks)) {
    storybooks[name] = commandOf(entry, `storybooks.${name}`, setupDir)
  }

  return { cli, storybooks }
}

/**
 * Reads one command of `setup.json`, `{ command, cwd }`, named `name` in the reasons it throws.
 *
 * @param {unknown} value The command's entry in `setup.json`.
 * @param {string} name Where the entry sits in `setup.json`, such as `cli` or `storybooks.web`.
 * @param {string} setupDir The folder holding `setup.json`.
 * @returns {Command}
 */
function commandOf(value, name, setupDir) {
  const entry = isRecord(value) ? value : {}
  const words = entry.command

  if (!Array.isArray(words) || words.length === 0 || !words.every((word) => typeof word === 'string' && word !== '')) {
    throw new Error(`${name}.command must be a list of words, starting with the program`)
  }

  if (typeof entry.cwd !== 'string' || entry.cwd === '') {
    throw new Error(`${name}.cwd must be a folder`)
  }

  return { argv: /** @type {string[]} */ ([...words]), cwd: resolve(setupDir, entry.cwd) }
}

/**
 * Reads the skill's `setup.json`, beside the `scripts/` folder. Throws an `Error` whose message says why it can't.
 *
 * @returns {Setup}
 */
function readSetup() {
  const path = join(import.meta.dirname, '..', 'setup.json')

  try {
    /** @type {string} */
    let text

    try {
      text = readFileSync(path, 'utf8')
    } catch (error) {
      throw /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT' ? new Error("it doesn't exist") : error
    }

    return setupOf(text, dirname(path))
  } catch (error) {
    throw new Error(
      `Can't read the skill's setup.json at ${folderOf(path)}: ${messageOf(error)}. Run visual-check init again to write it.`,
    )
  }
}

/**
 * Whether `value` is a plain object, not `null` nor a list.
 *
 * @param {unknown} value The value to check.
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The message of a thrown value.
 *
 * @param {unknown} error The thrown value.
 * @returns {string}
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * `path` relative to the script's working directory, with `/` separators, or `.` when it is that folder.
 *
 * @param {string} path The absolute path.
 * @returns {string}
 */
function folderOf(path) {
  return relative(process.cwd(), path).split(sep).join('/') || '.'
}

/**
 * The CLI's argv: the command from `setup.json`, the caller's arguments in order, then `--reporter json`, which wins
 * over a reporter the caller gives, since the CLI takes the last one.
 *
 * @public
 * @param {string[]} command The CLI command from `setup.json`, the program first.
 * @param {string[]} args The caller's command and flags.
 * @returns {string[]}
 */
export function cliArgvOf(command, args) {
  return [...command, ...args, '--reporter', 'json']
}

// ---------------------------------------------------------------------------------------------------------------------
// Windows command line: how a command's words reach cmd.exe.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The command line `cmd.exe` runs for `argv` on Windows. Each word goes in double quotes, inside which `cmd.exe` takes
 * `& | < > ^ ( )` literally, also when a `.cmd` shim passes them on. A word's trailing backslashes are doubled, so they
 * don't escape the closing quote.
 *
 * Throws an `Error` naming the first word that can't be passed safely: one holding a double quote or a line break, or
 * a name between percent signs, such as `%PATH%`, which `cmd.exe` expands even inside double quotes.
 *
 * @public
 * @param {string[]} argv The command's words, the program first.
 * @returns {string}
 */
export function windowsCommandLineOf(argv) {
  return argv
    .map((word) => {
      if (/["\r\n]|%[^%]+%/.test(word)) {
        throw new Error(
          `On Windows the script can't pass an argument that holds a double quote, a line break or a %name%: ${word}`,
        )
      }

      return `"${word.replace(/(\\+)$/, '$1$1')}"`
    })
    .join(' ')
}

// ---------------------------------------------------------------------------------------------------------------------
// Storybooks: what the report says of them, how to start them, what they print, and the messages about them.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Reads what the script needs of the CLI's JSON report: the Storybooks of the run, those where nothing answers, and
 * whether the run ended in a run error. `undefined` when `stdout` isn't a report. Entries without a string `name` and
 * `url` are left out.
 *
 * @public
 * @param {string} stdout What the CLI wrote on stdout.
 * @returns {ReportFacts | undefined}
 */
export function reportOf(stdout) {
  /** @type {unknown} */
  let parsed

  try {
    parsed = JSON.parse(stdout.trim())
  } catch {
    return undefined
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.storybooks)) {
    return undefined
  }

  const error = parsed.error

  return {
    storybooks: storybookRefsOf(parsed.storybooks),
    unreachable: isRecord(error) ? storybookRefsOf(error.storybooks) : [],
    runError: error !== null,
  }
}

/**
 * The entries of `value` that name a Storybook, with a string `name` and `url`. None when `value` isn't a list.
 *
 * @param {unknown} value The report's list of Storybooks.
 * @returns {StorybookRef[]}
 */
function storybookRefsOf(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((entry) => isRecord(entry) && typeof entry.name === 'string' && typeof entry.url === 'string')
    .map((entry) => ({ name: entry.name, url: entry.url }))
}

/**
 * The argv that starts a Storybook: its start command with `--ci --exact-port`, so it never prompts and exits rather
 * than serve on another port. Under npm they go after `--`, which npm needs to pass them on to the script; other package
 * managers pass a `--` on as it is, so it goes in only for npm.
 *
 * @public
 * @param {string[]} argv The Storybook's start command, the program first.
 * @returns {string[]}
 */
export function storybookArgvOf(argv) {
  const program = basename(argv[0] ?? '')
    .toLowerCase()
    .replace(/\.(cmd|exe)$/, '')
  const separator = program === 'npm' && !argv.includes('--') ? ['--'] : []

  return [...argv, ...separator, '--ci', '--exact-port']
}

/**
 * The URL of a Storybook's `index.json`, as the CLI asks for it: the Storybook's URL without its query, hash and
 * credentials, as a folder.
 *
 * @public
 * @param {string} url The Storybook's URL.
 * @returns {string}
 */
export function indexUrlOf(url) {
  const { origin, pathname } = new URL(url)
  const folder = pathname.endsWith('/') ? pathname : `${pathname}/`

  return `${origin}${folder}index.json`
}

/**
 * The port a URL points at: its own, else the scheme's default.
 *
 * @public
 * @param {string} url The URL.
 * @returns {number}
 */
export function portOf(url) {
  const parsed = new URL(url)

  if (parsed.port !== '') {
    return Number(parsed.port)
  }

  return parsed.protocol === 'https:' ? 443 : 80
}

/**
 * The port a line of Storybook's output says it started on, from the local URL of its started banner, such as
 * `- Local:   http://127.0.0.1:6006/`. `undefined` for any other line.
 *
 * @public
 * @param {string} line A line of Storybook's output.
 * @returns {number | undefined}
 */
export function startedPortOf(line) {
  const match = /\bLocal:\s+(https?:\/\/[^\s│]+)/.exec(stripVTControlCharacters(line))

  if (match?.[1] === undefined) {
    return undefined
  }

  try {
    return portOf(match[1])
  } catch {
    return undefined
  }
}

/**
 * Keeps the last `limit` non-empty lines of an output that comes in chunks, without colours, carriage returns and
 * trailing whitespace.
 *
 * @public
 * @param {number} limit How many lines to keep.
 * @returns {OutputTail}
 */
export function outputTail(limit) {
  /** @type {string[]} */
  const kept = []
  let partial = ''

  /**
   * A line of output without colours, carriage returns and trailing whitespace.
   *
   * @param {string} line The line as it came.
   * @returns {string}
   */
  const clean = (line) => stripVTControlCharacters(line).replaceAll('\r', '').trimEnd()

  return {
    add: (chunk) => {
      const parts = `${partial}${chunk}`.split('\n')

      partial = parts.pop() ?? ''

      const completed = parts.map(clean).filter((line) => line !== '')

      kept.push(...completed)
      kept.splice(0, Math.max(0, kept.length - limit))

      return completed
    },
    lines: () => {
      const last = clean(partial)

      return (last === '' ? kept : [...kept, last]).slice(-limit)
    },
  }
}

/**
 * Says that a Storybook started on another port than its URL's.
 *
 * @public
 * @param {string} name The Storybook's config name.
 * @param {number} startedPort The port it started on.
 * @param {string} url Its URL.
 * @returns {string}
 */
export function portMismatchMessageOf(name, startedPort, url) {
  return `Storybook ${name} started on port ${startedPort}, but its URL ${url} is on port ${portOf(url)}. Make its start command and its URL use the same port.`
}

/**
 * Says that a Storybook the script started never answered, because it exited or ran out of time, with the end of its
 * output, each line indented two spaces.
 *
 * @public
 * @param {string} name The Storybook's config name.
 * @param {{ exitCode: number } | { timeout: true }} reason Why it never answered.
 * @param {string} index The URL of its `index.json`.
 * @param {string[]} tail The end of its output.
 * @returns {string}
 */
export function failedStartMessageOf(name, reason, index, tail) {
  const what =
    'exitCode' in reason
      ? `Storybook ${name} exited with code ${reason.exitCode} before it answered at ${index}`
      : `Storybook ${name} didn't answer at ${index} within ${storybookStartTimeoutMilliseconds / 1000} s`

  if (tail.length === 0) {
    return `${what}, and printed nothing.`
  }

  return [`${what}. The end of its output:`, ...tail.map((line) => `  ${line}`)].join('\n')
}

/**
 * Says that a Storybook stopped answering during the run.
 *
 * @public
 * @param {StorybookRef} storybook The Storybook.
 * @returns {string}
 */
export function stoppedMidRunMessageOf(storybook) {
  return `Storybook ${storybook.name} stopped answering at ${storybook.url} during the run, so the run's results can't be trusted. Another session may have stopped it. Run the script again.`
}

/**
 * Says that the run used a Storybook the script didn't start.
 *
 * @public
 * @param {StorybookRef} storybook The Storybook.
 * @returns {string}
 */
export function reusedLineOf(storybook) {
  return `Reused Storybook ${storybook.name}, which was already running at ${storybook.url}.`
}

// ---------------------------------------------------------------------------------------------------------------------
// Keeper: the script run again as `run.mjs --keep-tree`, which starts one process tree and always stops it.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The exit code of a process that exited with `code` or was ended by `signal`: the code when there is one, else
 * `128 +` the signal's number, else 2.
 *
 * @public
 * @param {number | null} code The process's exit code, or `null` when a signal ended it.
 * @param {string | null} signal The signal that ended the process, or `null`.
 * @returns {number}
 */
export function exitCodeOf(code, signal) {
  if (typeof code === 'number') {
    return code
  }

  const signals = /** @type {Record<string, number | undefined>} */ (constants.signals)
  const number = signal === null ? undefined : signals[signal]

  return number === undefined ? 2 : 128 + number
}

/**
 * Runs as a keeper: starts the process tree of `command` and stops it when the keeper's stdin from the script closes,
 * or on an interrupt signal. So the tree goes even when the script dies without running any handler. When the tree's
 * root exits by itself, the keeper ends what's left of its process group and exits with the root's code.
 *
 * Outside Windows the tree runs in a process group of its own, which the stop ends with SIGTERM, then SIGKILL after
 * `stopGraceMilliseconds`. On Windows the tree runs through `cmd.exe` and the stop ends it with `taskkill /T /F`. A
 * stop that hasn't seen the tree go within `stopDeadlineMilliseconds`, or a `taskkill` that fails, gives up on it.
 *
 * @param {Command} command The command whose tree the keeper starts.
 * @param {NodeJS.ProcessEnv} environment The keeper's environment, which names the Windows folder.
 */
function keepTree(command, environment) {
  if (!existsSync(command.cwd)) {
    failToRun(command, new Error("the folder doesn't exist"))

    return
  }

  /** @type {import('node:child_process').ChildProcess} */
  let root

  try {
    root = spawnTree(command)
  } catch (error) {
    failToRun(command, error)

    return
  }

  const tree = root
  const rootIsRunning = () => tree.exitCode === null && tree.signalCode === null
  let stopping = false

  /** @type {Promise<number>} */
  const rootExited = new Promise((resolveExit) => {
    tree.on('exit', (code, signal) => {
      resolveExit(exitCodeOf(code, signal))
    })
  })

  tree.on('error', (error) => {
    if (tree.pid === undefined) {
      failToRun(command, error)
    }
  })

  tree.on('exit', (code, signal) => {
    if (stopping) {
      return
    }

    if (!windows && tree.pid !== undefined) {
      signalGroup(tree.pid, 'SIGKILL')
    }

    process.exit(exitCodeOf(code, signal))
  })

  const stop = async () => {
    // A tree that didn't spawn has nothing to stop, and `failToRun` exits once its message is out.
    const pid = tree.pid

    if (stopping || pid === undefined) {
      return
    }

    stopping = true
    setTimeout(() => giveUpStopping(command), stopDeadlineMilliseconds)

    if (windows) {
      // A root that exits just before `taskkill` runs makes it fail with "not found". `taskkill` runs asynchronously,
      // so the root's exit is seen by then, and only a root that still runs means the tree didn't stop.
      if (rootIsRunning() && !(await killWindowsTree(pid, environment)) && rootIsRunning()) {
        giveUpStopping(command)

        return
      }
    } else {
      await stopGroup(pid)
    }

    process.exit(await rootExited)
  }

  process.stdin.on('end', () => void stop())
  process.stdin.on('error', () => void stop())
  process.stdin.resume()

  for (const signal of interruptSignals) {
    process.on(signal, () => void stop())
  }
}

/**
 * Spawns the process tree of `command`, with its stdout and stderr going straight into the keeper's. Outside Windows
 * the root leads a process group of its own. On Windows the command runs through `cmd.exe`, since package managers are
 * `.cmd` shims there.
 *
 * @param {Command} command The command to spawn.
 * @returns {import('node:child_process').ChildProcess}
 */
function spawnTree(command) {
  if (windows) {
    return spawn(windowsCommandLineOf(command.argv), {
      cwd: command.cwd,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
  }

  return spawn(command.argv[0] ?? '', command.argv.slice(1), {
    cwd: command.cwd,
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
}

/**
 * Writes why the keeper couldn't run `command` and exits 2.
 *
 * @param {Command} command The command that couldn't run.
 * @param {unknown} error Why it couldn't run.
 */
function failToRun(command, error) {
  process.stderr.write(`Couldn't run ${command.argv.join(' ')} in ${command.cwd}: ${messageOf(error)}\n`, () => {
    process.exit(2)
  })
}

/**
 * Writes that the keeper couldn't stop the tree of `command` and exits as if SIGKILL had ended it.
 *
 * @param {Command} command The command whose tree didn't stop.
 */
function giveUpStopping(command) {
  process.stderr.write(
    `Couldn't stop ${command.argv.join(' ')} within ${stopDeadlineMilliseconds / 1000} s. Some of its processes may still run.\n`,
    () => {
      process.exit(exitCodeOf(null, 'SIGKILL'))
    },
  )
}

/**
 * Ends the process tree rooted at `pid` on Windows with `taskkill /T /F`, run from System32 by its full path, since a
 * bare name is looked up in the current folder first. Settles with whether `taskkill` succeeded.
 *
 * @param {number} pid The root's pid.
 * @param {NodeJS.ProcessEnv} environment The keeper's environment, which names the Windows folder.
 * @returns {Promise<boolean>}
 */
function killWindowsTree(pid, environment) {
  const path = join(environment.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')

  return new Promise((resolveKill) => {
    const taskkill = spawn(path, ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })

    taskkill.on('error', () => {
      resolveKill(false)
    })
    taskkill.on('close', (code) => {
      resolveKill(code === 0)
    })
  })
}

/**
 * Ends the process group `pgid`: SIGTERM, then SIGKILL once `stopGraceMilliseconds` have passed, and settles once the
 * group is gone. The keeper's stop deadline bounds the wait.
 *
 * @param {number} pgid The process group's id, its leader's pid.
 * @returns {Promise<void>}
 */
async function stopGroup(pgid) {
  signalGroup(pgid, 'SIGTERM')

  const killAt = Date.now() + stopGraceMilliseconds
  let killed = false

  while (groupIsAlive(pgid)) {
    if (!killed && Date.now() >= killAt) {
      signalGroup(pgid, 'SIGKILL')
      killed = true
    }

    await sleep(stopPollMilliseconds)
  }
}

/**
 * Sends `signal` to the process group `pgid`. A group that is already gone is fine.
 *
 * @param {number} pgid The process group's id.
 * @param {NodeJS.Signals} signal The signal to send.
 */
function signalGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal)
  } catch {
    // The group is already gone (ESRCH), which is what a stop wants.
  }
}

/**
 * Whether any process of the group `pgid` is still alive.
 *
 * @param {number} pgid The process group's id.
 * @returns {boolean}
 */
function groupIsAlive(pgid) {
  try {
    process.kill(-pgid, 0)

    return true
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM'
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Trees: the script's side of a keeper.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Starts the process tree of `command` under a keeper. The keeper of the CLI passes its stderr through to the
 * script's, and the script reads its stdout. The script reads both of a Storybook's keeper.
 *
 * @param {Command} command The command whose tree to start.
 * @param {'cli' | 'storybook'} output Whose tree it is, which sets what the script reads of it.
 * @returns {Tree}
 */
function startTree(command, output) {
  // The keeper runs in the script's working directory, so a missing `command.cwd` fails in the keeper, which names it.
  // It is detached, so it outlives the script to stop its tree: outside Windows it leaves the script's process group,
  // which a terminal's Ctrl+C or a group kill reaches. On Windows Node puts a child that isn't detached into a job that
  // kills it when the script dies, and the keeper's own job then kills only `cmd.exe`, not the tree below it.
  const keeper = spawn(process.execPath, [scriptPath, keepTreeFlag, JSON.stringify(command)], {
    detached: true,
    windowsHide: true,
    stdio: output === 'cli' ? ['pipe', 'pipe', 'inherit'] : ['pipe', 'pipe', 'pipe'],
  })
  let hasExited = false

  /** @type {Promise<number>} */
  const exited = new Promise((resolveExit) => {
    keeper.on('exit', (code, signal) => {
      hasExited = true

      const exitCode = exitCodeOf(code, signal)
      // Wait until the keeper's pipes close, so all its output is read, but not for long: a process its tree left
      // behind, which Windows doesn't end with the tree's root, may hold them open. Then stop reading them.
      const giveUp = setTimeout(() => {
        keeper.stdout?.destroy()
        keeper.stderr?.destroy()
        resolveExit(exitCode)
      }, pipeCloseGraceMilliseconds)

      keeper.once('close', () => {
        clearTimeout(giveUp)
        resolveExit(exitCode)
      })
    })
    keeper.on('error', (error) => {
      hasExited = true
      process.stderr.write(`Couldn't run ${command.argv.join(' ')} in ${command.cwd}: ${error.message}\n`)
      resolveExit(2)
    })
  })

  // The keeper may already be gone when the script ends its stdin.
  keeper.stdin?.on('error', () => undefined)

  return {
    child: keeper,
    exited,
    hasExited: () => hasExited,
    stop: () => {
      keeper.stdin?.end()

      return exited
    },
  }
}

/**
 * Holds every tree the script starts, the CLI's and each Storybook's, so that the end of the run, an interrupt or a
 * failure stops them all. An interrupt stops them at once, and so a tree started after one.
 *
 * @param {AbortSignal} interruption Aborts on an interrupt.
 * @returns {TreeRegistry}
 */
function treeRegistry(interruption) {
  /** @type {RegisteredTree[]} */
  const registered = []

  /** @type {Set<string>} */
  const stopped = new Set()

  const stopAll = async () => {
    for (const entry of registered) {
      entry.stopping ??= stopRunning(entry.tree)
    }

    for (const entry of registered) {
      const wasRunning = await entry.stopping

      if (wasRunning && entry.storybook !== undefined && !stopped.has(entry.storybook)) {
        stopped.add(entry.storybook)
        process.stderr.write(`Stopped Storybook ${entry.storybook}.\n`)
      }
    }

    return stopped
  }

  interruption.addEventListener('abort', () => void stopAll(), { once: true })

  return {
    start: (command, output, storybook) => {
      const tree = startTree(command, output)

      registered.push({ tree, storybook, stopping: undefined })

      if (interruption.aborted) {
        void stopAll()
      }

      return tree
    },
    stopAll,
  }
}

/**
 * Stops `tree` and settles, once it is gone, with whether it still ran when the stop began. A tree that ended by
 * itself has nothing to stop.
 *
 * @param {Tree} tree The tree to stop.
 * @returns {Promise<boolean>}
 */
async function stopRunning(tree) {
  const wasRunning = !tree.hasExited()

  await tree.stop()

  return wasRunning
}

/**
 * Runs the CLI with the caller's arguments under a keeper and collects its stdout. The registry stops its tree on an
 * interrupt.
 *
 * @param {Setup} setup The skill's setup.
 * @param {string[]} args The caller's command and flags.
 * @param {TreeRegistry} trees The registry that holds the CLI's tree.
 * @returns {Promise<CliRun>}
 */
async function runCli(setup, args, trees) {
  const tree = trees.start({ argv: cliArgvOf(setup.cli.argv, args), cwd: setup.cli.cwd }, 'cli')

  /** @type {Buffer[]} */
  const chunks = []

  tree.child.stdout?.on('data', (/** @type {Buffer} */ chunk) => {
    chunks.push(chunk)
  })

  return { exitCode: await tree.exited, stdout: Buffer.concat(chunks) }
}

// ---------------------------------------------------------------------------------------------------------------------
// Storybooks: start and wait.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Asks a Storybook for its index once. `ready` when it answers 200 with a Storybook index, `refused` when nothing
 * listens on its port, else `not-ready`: an error, a timeout, another answer, or a server that is still starting.
 *
 * @param {string} url The Storybook's URL.
 * @param {number} timeoutMilliseconds How long the request may take.
 * @param {AbortSignal} [signal] Aborts the request early, which gives `not-ready`.
 * @returns {Promise<'ready' | 'refused' | 'not-ready'>}
 */
async function probe(url, timeoutMilliseconds, signal) {
  const timeout = AbortSignal.timeout(timeoutMilliseconds)

  try {
    const response = await fetch(indexUrlOf(url), {
      signal: signal === undefined ? timeout : AbortSignal.any([timeout, signal]),
      redirect: 'manual',
    })

    if (response.status !== 200) {
      await response.body?.cancel()

      return 'not-ready'
    }

    const index = await response.json()

    return isRecord(index) && isRecord(index.entries) ? 'ready' : 'not-ready'
  } catch (error) {
    const cause = error instanceof Error ? /** @type {NodeJS.ErrnoException | undefined} */ (error.cause) : undefined

    return cause?.code === 'ECONNREFUSED' ? 'refused' : 'not-ready'
  }
}

/**
 * Sleeps `milliseconds`, or less when `signal` aborts.
 *
 * @param {number} milliseconds How long to sleep.
 * @param {AbortSignal} signal Ends the sleep early.
 * @returns {Promise<void>}
 */
async function pause(milliseconds, signal) {
  try {
    await sleep(milliseconds, undefined, { signal })
  } catch {
    // The signal aborted, which ends the sleep: the caller checks why.
  }
}

/**
 * Starts the Storybook `storybook` with its start command and waits until it answers at its URL. Its tree goes into
 * `trees`, which stops it. Its output is drained until then, so it never blocks on a full pipe, and its lines are
 * scanned for the port it started on: another port than its URL's fails the start at once.
 *
 * When its tree exits before it answers, something else may serve a Storybook on its port: the start ends `reused` once
 * that answers. A port that refuses, or nothing that answers before the deadline, fails the start with the end of its
 * output.
 *
 * @param {StorybookRef} storybook The Storybook to start.
 * @param {Command} command Its start command from `setup.json`.
 * @param {TreeRegistry} trees The registry that holds its tree.
 * @param {AbortSignal} signal Aborts the wait on an interrupt or another start's failure.
 * @returns {Promise<StorybookStart>}
 */
async function startStorybook(storybook, command, trees, signal) {
  const startCommand = { argv: storybookArgvOf(command.argv), cwd: command.cwd }

  process.stderr.write(
    `Starting Storybook ${storybook.name} in ${folderOf(startCommand.cwd)}: ${startCommand.argv.join(' ')}\n`,
  )

  const startedAt = Date.now()
  const tree = trees.start(startCommand, 'storybook', storybook.name)
  const output = watchOutput(tree, portOf(storybook.url))
  const wait = AbortSignal.any([output.mismatch, signal])

  while (!wait.aborted) {
    const state = await stateOf(storybook, tree, wait)

    if (state === 'started') {
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)

      process.stderr.write(`Storybook ${storybook.name} answers at ${storybook.url} after ${seconds}s.\n`)
    }

    if (state === 'started' || state === 'reused') {
      return { kind: state }
    }

    if (state === 'exited' || Date.now() - startedAt >= storybookStartTimeoutMilliseconds) {
      return { kind: 'failed', message: await failedStartOf(storybook, tree, output.tail) }
    }

    await pause(storybookPollMilliseconds, wait)
  }

  const startedPort = output.startedPort()

  if (startedPort !== undefined) {
    return { kind: 'failed', message: portMismatchMessageOf(storybook.name, startedPort, storybook.url) }
  }

  return { kind: 'aborted' }
}

/**
 * Drains the output of a Storybook's tree into its tail, and watches its lines for the port it started on.
 *
 * @param {Tree} tree The Storybook's tree.
 * @param {number} expectedPort The port of the Storybook's URL.
 * @returns {StorybookOutput}
 */
function watchOutput(tree, expectedPort) {
  const tail = outputTail(outputTailLimit)
  const mismatch = new AbortController()

  /** @type {number | undefined} */
  let startedPort

  /**
   * Adds a chunk of the output to the tail, and aborts on the first line that names a port other than `expectedPort`.
   *
   * @param {string} chunk The chunk.
   */
  const read = (chunk) => {
    const otherPort = tail
      .add(chunk)
      .map(startedPortOf)
      .find((port) => port !== undefined && port !== expectedPort)

    if (startedPort === undefined && otherPort !== undefined) {
      startedPort = otherPort
      mismatch.abort()
    }
  }

  for (const stream of [tree.child.stdout, tree.child.stderr]) {
    stream?.setEncoding('utf8')
    stream?.on('data', read)
  }

  return { tail, mismatch: mismatch.signal, startedPort: () => startedPort }
}

/**
 * Where the start of a Storybook stands after one request for its index: its own tree answers (`started`), another
 * server answers since its tree is gone (`reused`), its tree is gone and nothing listens on its port (`exited`), or
 * neither yet (`waiting`).
 *
 * @param {StorybookRef} storybook The Storybook.
 * @param {Tree} tree Its tree.
 * @param {AbortSignal} signal Ends the request early.
 * @returns {Promise<'started' | 'reused' | 'exited' | 'waiting'>}
 */
async function stateOf(storybook, tree, signal) {
  const exitedBefore = tree.hasExited()
  const answer = await probe(storybook.url, probeTimeoutMilliseconds, signal)

  if (answer === 'ready') {
    return tree.hasExited() ? 'reused' : 'started'
  }

  return exitedBefore && answer === 'refused' ? 'exited' : 'waiting'
}

/**
 * Says why the start of a Storybook failed: its tree exited, or it ran out of time, with the end of its output.
 *
 * @param {StorybookRef} storybook The Storybook.
 * @param {Tree} tree Its tree.
 * @param {OutputTail} tail The end of its output.
 * @returns {Promise<string>}
 */
async function failedStartOf(storybook, tree, tail) {
  const reason = tree.hasExited() ? { exitCode: await tree.exited } : { timeout: /** @type {const} */ (true) }

  return failedStartMessageOf(storybook.name, reason, indexUrlOf(storybook.url), tail.lines())
}

/**
 * Starts the Storybooks of `unreachable` in parallel and waits until each answers. The first that fails ends the wait
 * for the others and prints its message. A Storybook without a start command in `setup.json`, or, on Windows, whose
 * start command can't be passed, fails them all before any starts. Settles with whether every one answers, its own tree
 * or another server in its place.
 *
 * @param {StorybookRef[]} unreachable The Storybooks to start.
 * @param {Setup} setup The skill's setup, which holds their start commands.
 * @param {TreeRegistry} trees The registry that holds their trees.
 * @param {AbortSignal} interruption Aborts on an interrupt.
 * @returns {Promise<boolean>}
 */
async function startStorybooks(unreachable, setup, trees, interruption) {
  const problems = storybookStartProblems(unreachable, setup)

  if (problems.length > 0) {
    process.stderr.write(`${problems.join('\n')}\n`)

    return false
  }

  const failure = new AbortController()
  const signal = AbortSignal.any([failure.signal, interruption])

  const starts = await Promise.all(
    unreachable.map(async (storybook) => {
      const command = /** @type {Command} */ (setup.storybooks[storybook.name])
      const start = await startStorybook(storybook, command, trees, signal)

      if (start.kind === 'failed') {
        process.stderr.write(`${start.message}\n`)
        failure.abort()
      }

      return start
    }),
  )

  return starts.every((start) => start.kind === 'started' || start.kind === 'reused')
}

// ---------------------------------------------------------------------------------------------------------------------
// Run: the script's own flow.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Listens for interrupt signals. The first one aborts the watch's signal, a later one changes nothing.
 *
 * @returns {InterruptWatch}
 */
function watchInterrupts() {
  const controller = new AbortController()

  /** @type {NodeJS.Signals | undefined} */
  let interruptedBy

  /**
   * Records the first interrupt signal and aborts what the script waits for.
   *
   * @param {NodeJS.Signals} signal The signal the script got.
   */
  const onSignal = (signal) => {
    if (interruptedBy === undefined) {
      interruptedBy = signal
      controller.abort()
    }
  }

  for (const signal of interruptSignals) {
    process.on(signal, onSignal)
  }

  return {
    signal: controller.signal,
    interruptedBy: () => interruptedBy,
    dispose: () => {
      for (const signal of interruptSignals) {
        process.off(signal, onSignal)
      }
    },
  }
}

/**
 * Reads the setup and checks that the CLI's argv can be passed on this system. Throws an `Error` whose message says
 * why the script can't run.
 *
 * @param {string[]} args The caller's command and flags.
 * @returns {Setup}
 */
function prepare(args) {
  const setup = readSetup()

  if (windows) {
    windowsCommandLineOf(cliArgvOf(setup.cli.argv, args))
  }

  return setup
}

/**
 * Writes `bytes` on stdout and settles once they are handed to the system, or once stdout fails, such as when the
 * reader has gone.
 *
 * @param {Buffer} bytes What to write.
 * @returns {Promise<void>}
 */
function writeStdout(bytes) {
  return new Promise((resolveWrite) => {
    if (bytes.length === 0) {
      resolveWrite()

      return
    }

    process.stdout.once('error', () => {
      resolveWrite()
    })
    process.stdout.write(bytes, () => {
      resolveWrite()
    })
  })
}

/**
 * Runs the CLI as the skill's `setup.json` says, with the caller's arguments and the JSON reporter. When the CLI exits
 * 2 because Storybooks it needs are unreachable, starts those, waits until they answer and runs the CLI once more.
 * Then stops every tree it started, says which Storybooks the run reused, writes the last CLI run's stdout and sets its
 * exit code.
 *
 * On an interrupt it stops every tree, writes the CLI's stdout so far and exits `128 +` the signal's number. A failure
 * of the script itself, such as a Storybook that fails to start, goes on stderr and exits 2.
 *
 * @param {string[]} args The caller's command and flags.
 */
async function run(args) {
  const interrupts = watchInterrupts()

  try {
    /** @type {Setup} */
    let setup

    try {
      setup = prepare(args)
    } catch (error) {
      process.stderr.write(`${messageOf(error)}\n`)
      process.exitCode = 2

      return
    }

    const trees = treeRegistry(interrupts.signal)

    /** @type {RunOutcome} */
    let outcome

    /** @type {Set<string>} */
    let stopped

    try {
      outcome = await runWithStorybooks(setup, args, trees, interrupts.signal)
    } finally {
      stopped = await trees.stopAll()
    }

    const interruptedBy = interrupts.interruptedBy()
    const { last, failed } = outcome
    const report = reportOf(last.stdout.toString())

    if (!failed && interruptedBy === undefined && report?.runError === false) {
      for (const storybook of report.storybooks.filter((each) => !stopped.has(each.name))) {
        process.stderr.write(`${reusedLineOf(storybook)}\n`)
      }
    }

    if (interruptedBy !== undefined) {
      process.exitCode = exitCodeOf(null, interruptedBy)
    } else {
      process.exitCode = failed ? 2 : last.exitCode
    }

    await writeStdout(last.stdout)
  } finally {
    interrupts.dispose()
  }
}

/**
 * Runs the CLI, and when it exits 2 naming unreachable Storybooks, starts those and runs it once more. Settles with
 * the last CLI run and whether the script failed. The trees stay running for the caller to stop.
 *
 * @param {Setup} setup The skill's setup.
 * @param {string[]} args The caller's command and flags.
 * @param {TreeRegistry} trees The registry that holds every tree started.
 * @param {AbortSignal} interruption Aborts on an interrupt.
 * @returns {Promise<RunOutcome>}
 */
async function runWithStorybooks(setup, args, trees, interruption) {
  const first = await runCli(setup, args, trees)

  if (interruption.aborted) {
    return { last: first, failed: false }
  }

  const down = unreachableOf(first)

  if (down.length === 0) {
    return checkedOutcomeOf(first, [], interruption)
  }

  if (!(await startStorybooks(down, setup, trees, interruption)) || interruption.aborted) {
    return { last: first, failed: true }
  }

  const last = await runCli(setup, args, trees)

  if (interruption.aborted) {
    return { last, failed: false }
  }

  return checkedOutcomeOf(last, down, interruption)
}

/**
 * The Storybooks a CLI run that exited 2 names unreachable. None for any other run.
 *
 * @param {CliRun} cliRun The CLI run.
 * @returns {StorybookRef[]}
 */
function unreachableOf(cliRun) {
  if (cliRun.exitCode !== 2) {
    return []
  }

  return reportOf(cliRun.stdout.toString())?.unreachable ?? []
}

/**
 * The outcome of the last CLI run, checked for Storybooks that stopped answering during it, each of which it names on
 * stderr and which fail the script. The trees the script started still run, so they aren't mistaken for stopped ones.
 *
 * @param {CliRun} last The last CLI run.
 * @param {StorybookRef[]} down The Storybooks the script started or found answering before it.
 * @param {AbortSignal} interruption Aborts on an interrupt, which stops the Storybooks, so none counts as stopped mid-run.
 * @returns {Promise<RunOutcome>}
 */
async function checkedOutcomeOf(last, down, interruption) {
  const stoppedMidRun = await storybooksStoppedMidRun(last, down, interruption)

  for (const storybook of stoppedMidRun) {
    process.stderr.write(`${stoppedMidRunMessageOf(storybook)}\n`)
  }

  return { last, failed: stoppedMidRun.length > 0 }
}

/**
 * Why the script can't start the Storybooks of `down`: one has no start command in `setup.json`, or, on Windows, its
 * start command holds an argument that can't be passed. None when it can start them all.
 *
 * @param {StorybookRef[]} down The Storybooks to start.
 * @param {Setup} setup The skill's setup.
 * @returns {string[]}
 */
function storybookStartProblems(down, setup) {
  return down.flatMap((storybook) => {
    const command = setup.storybooks[storybook.name]

    if (command === undefined) {
      return [
        `setup.json has no start command for Storybook ${storybook.name}. Run visual-check init again to refresh it.`,
      ]
    }

    if (!windows) {
      return []
    }

    try {
      windowsCommandLineOf(storybookArgvOf(command.argv))

      return []
    } catch (error) {
      return [messageOf(error)]
    }
  })
}

/**
 * The Storybooks that stopped answering during the last CLI run. When it exits 2, those of `down`, which the script
 * started or found answering, that its report names unreachable. When it exits 1 without a run error, those of its
 * report that now refuse connections: stories failed because their Storybook went. None when it exits 0, since every
 * snapshot passed. None after an interrupt either, which stops the Storybooks the script started.
 *
 * @param {CliRun} last The last CLI run.
 * @param {StorybookRef[]} down The Storybooks the script started or found answering before it.
 * @param {AbortSignal} interruption Aborts on an interrupt.
 * @returns {Promise<StorybookRef[]>}
 */
async function storybooksStoppedMidRun(last, down, interruption) {
  const report = reportOf(last.stdout.toString())

  if (report === undefined) {
    return []
  }

  if (last.exitCode === 2) {
    return report.unreachable.filter((storybook) => down.some((each) => each.name === storybook.name))
  }

  if (last.exitCode !== 1 || report.runError) {
    return []
  }

  const answers = await Promise.all(
    report.storybooks.map((storybook) => probe(storybook.url, probeTimeoutMilliseconds, interruption)),
  )

  if (interruption.aborted) {
    return []
  }

  return report.storybooks.filter((_storybook, index) => answers[index] === 'refused')
}

// ---------------------------------------------------------------------------------------------------------------------
// Entry: runs only when this file is the process's entry, so importing it runs nothing.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Whether this file is the process's entry.
 *
 * @returns {boolean}
 */
function isEntry() {
  try {
    return realpathSync(process.argv[1] ?? '') === scriptPath
  } catch {
    return false
  }
}

if (isEntry()) {
  if (process.argv[2] === keepTreeFlag) {
    keepTree(/** @type {Command} */ (JSON.parse(process.argv[3] ?? '')), process.env)
  } else {
    try {
      await run(process.argv.slice(2))
    } catch (error) {
      // A fault of the script itself. `run` has stopped every tree it started by now.
      process.stderr.write(
        `The runner script failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      )
      process.exitCode = 2
    }
  }
}
