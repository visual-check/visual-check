import { type ChildProcessByStdio, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { Readable, Writable } from 'node:stream'
import { browserThatFailedToStart, type ProcessExit, type StartBrowser } from '../capture/driver/driver.js'

/**
 * The shell script the container runs the browser through. With `sh -c script arg0 args…`, `$0` is the browser's
 * executable and `"$@"` its arguments. The browser's CDP input (fd 3) reads the container's stdin, its CDP output
 * (fd 4) writes the container's stdout, and its own stdout goes to stderr, so no CDP message mixes with its output.
 */
const browserScript = 'exec "$0" "$@" 3<&0 4>&1 1>&2'

/**
 * How long `kill()` waits for `docker run` to exit by itself, which it does once the container is removed, before it
 * ends the `docker run` client. It stays under the 5 s the driver's `close()` waits after a kill.
 */
const defaultKillGraceMilliseconds = 3000

/**
 * A platform the container runs on.
 *
 * @public
 */
export type ContainerPlatform = 'linux/amd64' | 'linux/arm64'

/**
 * The network the browser's container runs on: `host`, or `container:<id>` to join the network of the container the CLI
 * runs in.
 *
 * @public
 */
export type ContainerNetwork = 'host' | `container:${string}`

/**
 * What the container needs to run the browser.
 *
 * @public
 */
export interface ContainerBrowser {
  /**
   * The image to run, such as `ghcr.io/visual-check/chromium@sha256:…`.
   */
  image: string
  /**
   * The platform the container runs on, which the browser's snapshots belong to.
   */
  platform: ContainerPlatform
  /**
   * The path of the headless shell's executable inside the image.
   */
  executable: string
  /**
   * The value of `docker run --network`: `host`, or `container:<id>` to join the network of the container the CLI runs
   * in.
   */
  network: ContainerNetwork
  /**
   * How long `kill()` lets `docker run` exit by itself before ending it, in milliseconds. 3000 by default.
   */
  killGraceMilliseconds?: number
}

/**
 * Builds the arguments of the `docker run` that runs the browser in a container of this name.
 */
export function containerRunArguments(
  options: Pick<ContainerBrowser, 'image' | 'platform' | 'executable' | 'network'> & { name: string },
  browserArguments: readonly string[],
): string[] {
  return [
    'run',
    '-i',
    '--rm',
    '--pull=never',
    '--name',
    options.name,
    '--platform',
    options.platform,
    '--user',
    'ubuntu',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--network',
    options.network,
    options.image,
    'sh',
    '-c',
    browserScript,
    options.executable,
    ...browserArguments,
  ]
}

/**
 * Picks a container name no other run shares.
 */
function newContainerName(): string {
  return `visual-check-${randomBytes(6).toString('hex')}`
}

/**
 * Provides the browser as a `StartBrowser` that runs it in a container. Each start is one `docker run -i --rm`
 * container of its own. CDP travels over the container's stdin and stdout. When the `docker run` client goes, its pipe
 * closes, Chromium quits and `--rm` removes the container.
 *
 * @public
 */
export function startBrowserInContainer(options: ContainerBrowser): StartBrowser {
  const graceMilliseconds = options.killGraceMilliseconds ?? defaultKillGraceMilliseconds

  return (browserArguments) => {
    const name = newContainerName()
    const spawned = spawnClient(containerRunArguments({ ...options, name }, browserArguments))

    if (spawned instanceof Error) {
      return browserThatFailedToStart(spawned)
    }

    const child = spawned
    let settled = false
    let killRequested = false
    let graceTimer: NodeJS.Timeout | undefined

    const exited = new Promise<ProcessExit>((resolve) => {
      const settle = (exit: ProcessExit): void => {
        if (!settled) {
          settled = true
          clearTimeout(graceTimer)
          resolve(exit)
        }
      }

      child.on('close', (code, signal) => settle({ code, signal, error: undefined }))
      child.on('error', (error) => settle({ code: null, signal: null, error }))
    })

    const kill = (): void => {
      if (killRequested || settled) {
        return
      }

      killRequested = true
      graceTimer = setTimeout(() => {
        if (!settled && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
        }
      }, graceMilliseconds)

      try {
        const docker = spawn('docker', ['kill', name], { stdio: 'ignore' })

        docker.on('error', () => undefined)
        docker.unref()
      } catch {
        // The grace timer ends the client, since the container can't be told to stop.
      }
    }

    return { toBrowser: child.stdin, fromBrowser: child.stdout, output: child.stderr, exited, kill }
  }
}

/**
 * Spawns the `docker run` client, or returns the error when `spawn` throws at once, such as for an argument with a NUL
 * byte.
 */
function spawnClient(args: string[]): ChildProcessByStdio<Writable, Readable, Readable> | Error {
  try {
    return spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}
