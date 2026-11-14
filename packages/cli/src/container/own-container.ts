import { readFile } from 'node:fs/promises'
import { ContainerError } from './container-error.js'
import { runDocker } from './run-docker.js'

/**
 * The files Docker and Podman bind-mount into a container from a folder named for its ID.
 */
const containerFiles = new Set(['/etc/hostname', '/etc/hosts', '/etc/resolv.conf'])

/**
 * Matches the ID of a container in the folder a container file is mounted from.
 */
const containerIdPattern = /containers\/([0-9a-f]{64})\//

/**
 * Reads the ID of the container this process runs in from the text of /proc/self/mountinfo, or undefined.
 */
export function containerIdOf(mountinfo: string): string | undefined {
  for (const line of mountinfo.split('\n')) {
    const fields = line.split(' ')
    const root = fields[3]
    const mountPoint = fields[4]

    if (root !== undefined && mountPoint !== undefined && containerFiles.has(mountPoint)) {
      const id = containerIdPattern.exec(root)?.[1]

      if (id !== undefined) {
        return id
      }
    }
  }

  return undefined
}

/**
 * Whether the Docker daemon knows a container of this ID. A `docker` that can't be run counts as not knowing it.
 */
async function isKnownToDocker(id: string): Promise<boolean> {
  try {
    const exitCode = await runDocker(
      ['inspect', '--type', 'container', '--format', '{{.Id}}', id],
      () => undefined,
      () => undefined,
    )

    return exitCode === 0
  } catch (error) {
    if (error instanceof ContainerError) {
      return false
    }

    throw error
  }
}

/**
 * Gives the ID of the container the CLI runs in, read from the mountinfo file, when the Docker daemon knows it, else
 * `undefined`. A missing file and a mountinfo that names no container give `undefined` without running `docker`.
 *
 * @public
 */
export async function knownContainerIdOf(mountinfoPath = '/proc/self/mountinfo'): Promise<string | undefined> {
  let mountinfo: string

  try {
    mountinfo = await readFile(mountinfoPath, 'utf8')
  } catch {
    return undefined
  }

  const id = containerIdOf(mountinfo)

  return id !== undefined && (await isKnownToDocker(id)) ? id : undefined
}
