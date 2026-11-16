import { type ChildProcessByStdio, spawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import { ContainerError, DockerMissingError } from './container-error.js'

/**
 * What a missing `docker` command says.
 */
const noDockerMessage = "visual-check runs the browser in Docker, and there's no docker command on PATH."

/**
 * Runs `docker` with these arguments and resolves with its exit code. What it writes goes to `onStdout` and `onStderr`
 * as it arrives. With `timeoutMs`, a `docker` that is still running by then is killed.
 *
 * @throws {ContainerError} When `docker` can't be started (a `DockerMissingError` when it isn't on PATH), or doesn't
 * finish within `timeoutMs`.
 */
export function runDocker(
  args: readonly string[],
  onStdout: (text: string) => void,
  onStderr: (text: string) => void,
  timeoutMs?: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessByStdio<null, Readable, Readable>

    try {
      child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      reject(new ContainerError(`visual-check couldn't run docker: ${error instanceof Error ? error.message : error}.`))

      return
    }

    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            child.kill('SIGKILL')
            reject(new ContainerError(`docker ${args[0]} didn't answer within ${timeoutMs / 1000} s.`))
          }, timeoutMs)

    child.stdout.setEncoding('utf8').on('data', onStdout)
    child.stderr.setEncoding('utf8').on('data', onStderr)
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(
        error.code === 'ENOENT'
          ? new DockerMissingError(noDockerMessage)
          : new ContainerError(`visual-check couldn't run docker: ${error.message}.`),
      )
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code ?? 1)
    })
  })
}
