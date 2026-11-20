// The agent skill's runner script. An agent runs it instead of the visual-check CLI:
//
//   node .agents/skills/visual-check/scripts/run.mjs test [flags]
//
// It runs the CLI command from the skill's setup.json in its folder, with the caller's command and flags plus
// `--reporter json`. stdout carries the CLI's JSON report unchanged, stderr carries everything else, and the exit code
// is the CLI's. It runs the CLI's process tree under a keeper, which stops the whole tree on an interrupt, or when the
// script itself is killed.
//
// `visual-check init` installs this file, and local runs refresh it. It must stay plain JavaScript that imports only
// Node's built-in modules.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { constants } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

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
 * @property {Promise<number>} exited Settles with the keeper's exit code, the tree's own, once the keeper has closed.
 * @property {() => boolean} hasExited Whether the keeper has closed.
 * @property {() => Promise<number>} stop Stops the tree and settles with the keeper's exit code once it has closed.
 */

/**
 * What a CLI run gave: its exit code and the bytes it wrote on stdout.
 *
 * @typedef {object} CliRun
 * @property {number} exitCode The CLI's exit code.
 * @property {Buffer} stdout What the CLI wrote on stdout, its JSON report.
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
    if (stopping || tree.pid === undefined) {
      return
    }

    stopping = true
    setTimeout(() => giveUpStopping(command), stopDeadlineMilliseconds)

    if (windows) {
      if (tree.exitCode === null && tree.signalCode === null && !killWindowsTree(tree.pid, environment)) {
        giveUpStopping(command)

        return
      }
    } else {
      await stopGroup(tree.pid)
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
 * bare name is looked up in the current folder first. Returns whether `taskkill` succeeded.
 *
 * @param {number} pid The root's pid.
 * @param {NodeJS.ProcessEnv} environment The keeper's environment, which names the Windows folder.
 * @returns {boolean}
 */
function killWindowsTree(pid, environment) {
  const taskkill = join(environment.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
  const result = spawnSync(taskkill, ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })

  return result.error === undefined && result.status === 0
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
  const keeper = spawn(process.execPath, [scriptPath, keepTreeFlag, JSON.stringify(command)], {
    detached: !windows,
    windowsHide: true,
    stdio: output === 'cli' ? ['pipe', 'pipe', 'inherit'] : ['pipe', 'pipe', 'pipe'],
  })
  let closed = false

  /** @type {Promise<number>} */
  const exited = new Promise((resolveExit) => {
    keeper.on('close', (code, signal) => {
      closed = true
      resolveExit(exitCodeOf(code, signal))
    })
    keeper.on('error', (error) => {
      closed = true
      process.stderr.write(`Couldn't run ${command.argv.join(' ')} in ${command.cwd}: ${error.message}\n`)
      resolveExit(2)
    })
  })

  // The keeper may already be gone when the script ends its stdin.
  keeper.stdin?.on('error', () => undefined)

  return {
    child: keeper,
    exited,
    hasExited: () => closed,
    stop: () => {
      keeper.stdin?.end()

      return exited
    },
  }
}

/**
 * Runs the CLI with the caller's arguments under a keeper and collects its stdout. Stops its tree when `interruption`
 * aborts.
 *
 * @param {Setup} setup The skill's setup.
 * @param {string[]} args The caller's command and flags.
 * @param {AbortSignal} interruption Aborts on an interrupt.
 * @returns {Promise<CliRun>}
 */
async function runCli(setup, args, interruption) {
  const tree = startTree({ argv: cliArgvOf(setup.cli.argv, args), cwd: setup.cli.cwd }, 'cli')

  /** @type {Buffer[]} */
  const chunks = []

  tree.child.stdout?.on('data', (/** @type {Buffer} */ chunk) => {
    chunks.push(chunk)
  })

  const stopTree = () => {
    void tree.stop()
  }

  if (interruption.aborted) {
    stopTree()
  } else {
    interruption.addEventListener('abort', stopTree, { once: true })
  }

  const exitCode = await tree.exited

  interruption.removeEventListener('abort', stopTree)

  return { exitCode, stdout: Buffer.concat(chunks) }
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
 * Runs the CLI as the skill's `setup.json` says, with the caller's arguments and the JSON reporter, writes its stdout
 * and sets its exit code. On an interrupt it stops the CLI's tree, writes the CLI's stdout so far and exits `128 +` the
 * signal's number. A failure of the script itself goes on stderr and exits 2, with nothing on stdout.
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

    const cli = await runCli(setup, args, interrupts.signal)
    const interruptedBy = interrupts.interruptedBy()

    process.exitCode = interruptedBy === undefined ? cli.exitCode : exitCodeOf(null, interruptedBy)
    await writeStdout(cli.stdout)
  } finally {
    interrupts.dispose()
  }
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
