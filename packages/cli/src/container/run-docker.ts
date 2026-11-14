import { type ChildProcessByStdio, spawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import { ContainerError } from './container-error.js'

/**
 * Runs `docker` with these arguments and resolves with its exit code. What it writes goes to `onStdout` and `onStderr` as it
 * arrives.
 *
 * @throws {ContainerError} When `docker` can't be started.
 */
export function runDocker(
  args: readonly string[],
  onStdout: (text: string) => void,
  onStderr: (text: string) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessByStdio<null, Readable, Readable>

    try {
      child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      reject(
        new ContainerError(`visual-check couldn't run \`docker\`: ${error instanceof Error ? error.message : error}`),
      )

      return
    }

    child.stdout.setEncoding('utf8').on('data', onStdout)
    child.stderr.setEncoding('utf8').on('data', onStderr)
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        new ContainerError(
          error.code === 'ENOENT'
            ? 'visual-check runs the browser in Docker, and there is no `docker` command on PATH. ' +
                'Install or start Docker.'
            : `visual-check couldn't run \`docker\`: ${error.message}`,
        ),
      )
    })
    child.on('close', (code) => resolve(code ?? 1))
  })
}
