import { type ChildProcess, spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { finished, PassThrough, type Readable, type Writable } from 'node:stream'
import {
  type BrowserProcess,
  browserThatFailedToStart,
  type ProcessExit,
  type StartBrowser,
} from '../capture/driver/driver.js'

/**
 * What starting the browser as a child process needs.
 *
 * @public
 */
export interface BrowserExecutable {
  /**
   * The path of the headless shell's executable.
   */
  executable: string
  /**
   * The profile folder the launch arguments name. It's removed once the browser has exited.
   */
  profileDir: string
}

/**
 * Removes the profile folder, ignoring a removal that fails.
 */
async function removeProfile(profileDir: string): Promise<void> {
  try {
    await rm(profileDir, { recursive: true, force: true })
  } catch {
    // A profile folder that can't be removed doesn't change how the browser ended.
  }
}

/**
 * Spawns the browser in a process group of its own, with pipes for its stdout, stderr and the two CDP fds, or returns
 * the error when `spawn` throws at once, such as for a path with a NUL byte.
 */
function spawnBrowser(executable: string, browserArguments: readonly string[]): ChildProcess | Error {
  try {
    return spawn(executable, browserArguments, { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'], detached: true })
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * Merges the child's stdout and stderr into one stream, which ends once both have finished, whether they ended, closed
 * or failed. A read error is dropped: the child's exit says what happened.
 */
function mergedOutputOf(child: ChildProcess): Readable {
  const output = new PassThrough()
  let openStreams = 2

  for (const stream of [child.stdout as Readable, child.stderr as Readable]) {
    stream.on('error', () => undefined)
    stream.pipe(output, { end: false })
    finished(stream, () => {
      openStreams -= 1

      if (openStreams === 0) {
        output.end()
      }
    })
  }

  return output
}

/**
 * Ends the browser's whole process group with SIGKILL, so the zygote, GPU and renderer processes that hold its output
 * go with it. It does nothing while the browser has no pid, because it didn't start, and `process.kill(-0)` would
 * signal the CLI's own group. A group that is already gone is fine.
 */
function killProcessGroup(child: ChildProcess): void {
  if (child.pid === undefined) {
    return
  }

  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    // The group is already gone (ESRCH), which is what kill wants.
  }
}

/**
 * Provides the browser as a `StartBrowser` that runs the executable as a child process of the CLI, with the CLI's
 * environment. CDP travels over the child's fds 3 and 4, as Chromium's `--remote-debugging-pipe` reads and writes
 * them, and its stdout and stderr merge into `output`. `exited` settles once the child has gone and the profile folder
 * is removed.
 *
 * The browser runs in a process group of its own, which `kill()` ends whole. Chromium also quits by itself when its CDP
 * pipe reaches EOF, such as when the CLI is killed.
 *
 * @public
 */
export function startBrowserProcess(options: BrowserExecutable): StartBrowser {
  return (browserArguments) => {
    const spawned = spawnBrowser(options.executable, browserArguments)

    if (spawned instanceof Error) {
      const failed = browserThatFailedToStart(spawned)

      return { ...failed, exited: removeProfile(options.profileDir).then(() => failed.exited) }
    }

    const child = spawned

    // A promise settles once, so `error` and `close` both firing keeps the first.
    const exit = new Promise<ProcessExit>((resolve) => {
      child.on('error', (error) => resolve({ code: null, signal: null, error }))
      child.on('close', (code, signal) => resolve({ code, signal, error: undefined }))
    })
    const exited = exit.then(async (processExit) => {
      await removeProfile(options.profileDir)

      return processExit
    })

    const browser: BrowserProcess = {
      toBrowser: child.stdio[3] as Writable,
      fromBrowser: child.stdio[4] as Readable,
      output: mergedOutputOf(child),
      exited,
      kill: () => killProcessGroup(child),
    }

    return browser
  }
}
