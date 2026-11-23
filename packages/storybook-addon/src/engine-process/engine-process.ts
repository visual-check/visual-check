import { type ChildProcess, fork } from 'node:child_process'
import { createRequire } from 'node:module'
import type { Socket } from 'node:net'
import type { AddonOutcome, AddonProgress, AddonRequest, CheckRequest } from '@visual-check/cli/internal/addon-protocol'
import { readAddonMessage } from './read-message.js'

/**
 * How many of the last lines of the child's standard error are kept.
 */
const keptLines = 50

/**
 * How many of the last characters of the child's standard error are kept.
 */
const keptCharacters = 16_000

/**
 * How long the child's last messages and output may take to be read once it has exited, in milliseconds.
 */
const drainTimeoutMs = 1_000

/**
 * Takes what a check says.
 *
 * @public
 */
export interface EngineListener {
  /**
   * Takes how far the check is.
   */
  progress: (progress: AddonProgress) => void
  /**
   * Takes how the check ended. Called once, and maybe before `check` returns, when no child could be started.
   */
  finished: (outcome: AddonOutcome) => void
}

/**
 * The CLI's child process, which runs checks.
 *
 * @public
 */
export interface EngineProcess {
  /**
   * Asks the child for a check, starting it first when none runs.
   */
  check: (request: Omit<CheckRequest, 'kind'>, listener: EngineListener) => void
  /**
   * Cancels the check with this ID. One that doesn't end within the timeout is cancelled by killing the child. Ignored
   * when it isn't running.
   */
  cancel: (id: string) => void
}

/**
 * What `createEngineProcess` makes the process with.
 */
interface EngineProcessOptions {
  /**
   * The version of the CLI it runs, which is the addon's own.
   */
  version: string
  /**
   * How long a cancelled check may take to end, in milliseconds. 10 s by default.
   */
  cancelTimeoutMs?: number
  /**
   * Finds the script that is forked. The installed CLI's by default. A test gives another.
   */
  entry?: () => string
}

/**
 * A check in flight.
 */
interface Run {
  /**
   * Takes what it says.
   */
  listener: EngineListener
  /**
   * Kills the child when the check was cancelled and hasn't ended.
   */
  cancelTimer?: NodeJS.Timeout
}

/**
 * A forked child.
 */
interface Engine {
  /**
   * The process.
   */
  child: ChildProcess
  /**
   * The end of what it wrote to its standard error.
   */
  lastOutput: string
  /**
   * Its checks in flight, by ID.
   */
  runs: Map<string, Run>
}

/**
 * Finds the script of the CLI installed beside the addon.
 *
 * @throws {Error} When no CLI is there, or it doesn't have the script.
 */
function findEntry(): string {
  return createRequire(import.meta.url).resolve('@visual-check/cli/internal/addon-child')
}

/**
 * Gives the first line of an error's message. What follows it when a module isn't found is the stack of `require`s.
 */
function firstLineOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n', 1).join()
}

/**
 * The outcome of a check that had no child to run it, or lost it.
 */
function stoppedBy(message: string): AddonOutcome {
  return { result: 'stopped', cause: 'run', message, notices: [] }
}

/**
 * Says that the child couldn't be started.
 */
function startMessageOf(error: unknown): string {
  return `visual-check's process couldn't start: ${firstLineOf(error)}`
}

/**
 * Says that the child exited during a check, and what it last wrote.
 */
function exitMessageOf({ child, lastOutput }: Engine): string {
  const { exitCode, signalCode } = child
  const end = signalCode === null ? `exited with code ${exitCode}` : `was killed by signal ${signalCode}`
  const lines = lastOutput.trimEnd().split('\n').slice(-keptLines)
  const message = `visual-check's process ${end} while it checked the story.`

  return lines.join('') === '' ? message : [message, 'Its last output:', ...lines].join('\n')
}

/**
 * Ends a check of the child, unless it has ended.
 */
function finish({ runs }: Engine, id: string, outcome: AddonOutcome): void {
  const run = runs.get(id)

  if (run !== undefined) {
    runs.delete(id)
    clearTimeout(run.cancelTimer)
    run.listener.finished(outcome)
  }
}

/**
 * Ends every check of the child.
 */
function finishAll(engine: Engine, outcome: AddonOutcome): void {
  for (const id of [...engine.runs.keys()]) {
    finish(engine, id, outcome)
  }
}

/**
 * Whether the child takes no check any more, or never started.
 */
function isGone({ child }: Engine): boolean {
  return child.pid === undefined || child.exitCode !== null || child.signalCode !== null || !child.connected
}

/**
 * Passes a message of the child on to the check it's about.
 */
function receive(engine: Engine, received: unknown): void {
  const message = readAddonMessage(received)

  switch (message?.kind) {
    case 'progress':
      engine.runs.get(message.id)?.listener.progress(message.progress)
      break
    case 'finished':
      finish(engine, message.id, message.outcome)
      break
  }
}

/**
 * Sends a request to the child, unless its channel has closed.
 */
function send({ child }: Engine, request: AddonRequest): void {
  if (child.connected) {
    // With a callback, a channel that breaks meanwhile raises no error. The child's end follows.
    child.send(request, () => undefined)
  }
}

/**
 * Ends the child's checks once it has exited and its last messages and output have been read. A process it started may
 * hold its standard error open, so that takes 1 s at most.
 */
function watchExit(engine: Engine): void {
  const { child } = engine
  let timer: NodeJS.Timeout | undefined

  const end = (): void => {
    clearTimeout(timer)
    finishAll(engine, stoppedBy(exitMessageOf(engine)))
  }

  child.on('exit', () => {
    timer = setTimeout(end, drainTimeoutMs).unref()
  })
  // It comes once every message and all of the output have been read.
  child.on('close', end)
}

/**
 * Forks the script. The child, its channel and its standard error never keep this process alive.
 *
 * @throws {Error} When the system refuses at once.
 */
function startEngine(entryPath: string): Engine {
  const child = fork(entryPath, [], {
    execArgv: [],
    serialization: 'json',
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    windowsHide: true,
  })
  const engine: Engine = { child, lastOutput: '', runs: new Map() }
  const stderr = child.stderr as Socket | null

  child.unref()
  child.channel?.unref()
  stderr?.unref()
  stderr?.setEncoding('utf8').on('data', (text: string) => {
    engine.lastOutput = `${engine.lastOutput}${text}`.slice(-keptCharacters)
  })
  // A read error is dropped: the child's exit says what happened.
  stderr?.on('error', () => undefined)
  child.on('message', (message) => receive(engine, message))
  watchExit(engine)
  child.on('error', (error) => {
    // The other errors, such as of a kill that fails, don't end the child.
    if (child.pid === undefined) {
      finishAll(engine, stoppedBy(startMessageOf(error)))
    }
  })

  return engine
}

/**
 * Makes what runs checks in the CLI's child process. It starts the child at the first check, and at the next one after
 * the child has exited.
 *
 * @public
 */
export function createEngineProcess({
  version,
  entry = findEntry,
  cancelTimeoutMs = 10_000,
}: EngineProcessOptions): EngineProcess {
  let current: Engine | undefined

  const entryPathOrProblem = (): { path: string } | { problem: string } => {
    try {
      return { path: entry() }
    } catch (error) {
      const problem =
        `The Storybook addon couldn't find the @visual-check/cli ${version} it runs: ${firstLineOf(error)}. ` +
        'Install it, then restart Storybook.'

      return { problem }
    }
  }

  const engineOrProblem = (): { engine: Engine } | { problem: string } => {
    if (current !== undefined && !isGone(current)) {
      return { engine: current }
    }

    const found = entryPathOrProblem()

    if ('problem' in found) {
      return found
    }

    try {
      current = startEngine(found.path)

      return { engine: current }
    } catch (error) {
      return { problem: startMessageOf(error) }
    }
  }

  const kill = (engine: Engine): void => {
    engine.child.kill('SIGKILL')

    if (current === engine) {
      current = undefined
    }

    finishAll(engine, { result: 'cancelled' })
  }

  return {
    check: (request, listener) => {
      const started = engineOrProblem()

      if ('problem' in started) {
        listener.finished(stoppedBy(started.problem))

        return
      }

      started.engine.runs.set(request.id, { listener })
      send(started.engine, { kind: 'check', ...request })
    },
    cancel: (id) => {
      const engine = current
      const run = engine?.runs.get(id)

      if (engine === undefined || run === undefined || run.cancelTimer !== undefined) {
        return
      }

      run.cancelTimer = setTimeout(kill, cancelTimeoutMs, engine).unref()
      send(engine, { kind: 'cancel', id })
    },
  }
}
