import { type ChildProcessByStdio, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { constants } from 'node:os'
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createDotReader, type ImportGraph } from './import-graph.js'
import { filesReachedFrom } from './walk-back.js'

/**
 * The files a change can alter the rendering of.
 */
export interface ReachedFiles {
  /**
   * Every graph file reached by walking back from the changed files, the changed files in the graph included. Paths
   * are relative to the project root, `/`-separated.
   */
  reached: ReadonlySet<string>
}

/**
 * Why the graph can't tell which files a change reaches.
 */
export interface CantAnswer {
  /**
   * The reason, a short phrase that reads after "…covers every story: ".
   */
  cantAnswer: string
}

/**
 * Finds the files that changing `changedFiles` can alter in the project at `root`. Changed files are relative to the
 * root, `/`-separated. It never rejects: anything that keeps it from answering gives `CantAnswer`.
 *
 * @public
 */
export type FindReachedFiles = (root: string, changedFiles: readonly string[]) => Promise<ReachedFiles | CantAnswer>

/**
 * How `readFallowGraph` runs Fallow.
 */
interface FallowGraphOptions {
  /**
   * The longest Fallow may run, in milliseconds. 120 s when not given.
   */
  timeoutMs?: number
  /**
   * Gives the path of Fallow's script, or throws when it isn't installed. Resolves `fallow/bin/fallow` when not given.
   */
  resolveBin?: () => string
}

/**
 * The longest Fallow may run by default, in milliseconds.
 */
const defaultTimeoutMs = 120_000

/**
 * How many of the last lines of Fallow's stderr to keep for the reason.
 */
const keptStderrLines = 20

/**
 * visual-check's own Fallow config, so a project's `.fallowrc.json` can't drop files from the graph. It sits at the
 * package root, two folders up from both `src/affected-stories/` and `dist/affected-stories/`.
 */
const configPath = fileURLToPath(new URL('../../fallow-graph.json', import.meta.url))

/**
 * Resolves the script of the Fallow that visual-check depends on.
 */
function resolveFallowBin(): string {
  return createRequire(import.meta.url).resolve('fallow/bin/fallow')
}

/**
 * Gives an error's message, or the value as text.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Gives a sentence as a phrase, without its final full stop.
 */
function phraseOf(sentence: string): string {
  return sentence.replace(/\.$/, '')
}

/**
 * Picks the line of Fallow's stderr that says why it failed: the last one that starts with `Error`, else the last
 * non-empty one, trimmed.
 */
export function failureLineOf(lines: readonly string[]): string | undefined {
  const trimmed = lines.map((line) => line.trim()).filter((line) => line !== '')

  return trimmed.findLast((line) => line.startsWith('Error')) ?? trimmed.at(-1)
}

/**
 * Names the signal that stopped Fallow: the one its process got, or the one its exit code names. Fallow's launcher
 * exits with 128 plus the signal's number when a signal stops its binary.
 */
function signalOf(code: number | null, signal: NodeJS.Signals | null): string | undefined {
  if (signal !== null) {
    return signal
  }

  if (code === null || code <= 128) {
    return undefined
  }

  const signalNumber = code - 128

  return Object.entries(constants.signals).find(([, number]) => number === signalNumber)?.[0]
}

/**
 * Words why a run of Fallow that didn't exit 0 failed.
 */
function failureOf(code: number | null, signal: NodeJS.Signals | null, stderr: readonly string[]): string {
  const stoppedBy = signalOf(code, signal)

  if (stoppedBy === 'SIGKILL') {
    return 'Fallow was stopped by SIGKILL, which happens when it runs out of memory'
  }

  if (stoppedBy !== undefined) {
    return `Fallow was stopped by ${stoppedBy}`
  }

  const line = failureLineOf(stderr)

  return line === undefined ? `Fallow failed with exit code ${code}` : `Fallow failed: ${line}`
}

/**
 * Asks Fallow once for the project's import graph, run with visual-check's own config and `--no-cache`, so Fallow
 * writes no `.fallow/` folder into the project. It reads Fallow's DOT output line by line as it comes, never holding
 * it whole. Anything that keeps it from giving a graph gives `CantAnswer`, and stops Fallow when it still runs.
 */
export function readFallowGraph(root: string, options: FallowGraphOptions = {}): Promise<ImportGraph | CantAnswer> {
  const { timeoutMs = defaultTimeoutMs, resolveBin = resolveFallowBin } = options
  let bin: string

  try {
    bin = resolveBin()
  } catch {
    return Promise.resolve({ cantAnswer: "Fallow isn't installed" })
  }

  return new Promise((resolve) => {
    const args = [bin, 'viz', '--viz-format', 'dot', '--no-cache', '-c', configPath, '--root', root]
    let child: ChildProcessByStdio<null, Readable, Readable>

    try {
      child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ cantAnswer: `Fallow couldn't start: ${messageOf(error)}` })

      return
    }

    const reader = createDotReader()
    const stderr: string[] = []
    const stdoutLines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY })
    const stderrLines = createInterface({ input: child.stderr, crlfDelay: Number.POSITIVE_INFINITY })
    let settled = false

    /**
     * Gives the result once, and stops waiting for the timeout.
     */
    const settle = (result: ImportGraph | CantAnswer) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    /**
     * Stops Fallow and its output, then gives the reason. It doesn't wait for the output to close, since a process
     * Fallow's launcher started may still hold it open. Only Fallow's Node launcher is killed; the native binary it runs
     * exits on a broken pipe when it writes its output.
     */
    const stop = (reason: string) => {
      settle({ cantAnswer: reason })
      child.kill('SIGKILL')
      stdoutLines.close()
      stderrLines.close()
      child.stdout.destroy()
      child.stderr.destroy()
    }

    const timer = setTimeout(() => stop(`Fallow didn't finish within ${timeoutMs / 1000} s`), timeoutMs)

    stdoutLines.on('line', (line) => {
      if (settled) {
        return
      }

      try {
        reader.readLine(line)
      } catch (error) {
        stop(phraseOf(messageOf(error)))
      }
    })
    stderrLines.on('line', (line) => {
      stderr.push(line)

      if (stderr.length > keptStderrLines) {
        stderr.shift()
      }
    })
    // A stream error shows up as the child's failure or exit too, so the listeners only keep it from throwing.
    stdoutLines.on('error', () => undefined)
    stderrLines.on('error', () => undefined)
    child.on('error', (error) => stop(`Fallow couldn't start: ${messageOf(error)}`))
    child.on('close', (code, signal) => {
      if (code !== 0) {
        settle({ cantAnswer: failureOf(code, signal, stderr) })

        return
      }

      try {
        settle(reader.graph())
      } catch (error) {
        settle({ cantAnswer: phraseOf(messageOf(error)) })
      }
    })
  })
}

/**
 * Finds the reached files with one run of Fallow's graph, walked back in memory from the changed files.
 *
 * @public
 */
export const findReachedFilesWithFallow: FindReachedFiles = async (root, changedFiles) => {
  const graph = await readFallowGraph(root)

  if ('cantAnswer' in graph) {
    return graph
  }

  return { reached: filesReachedFrom(graph, changedFiles) }
}
