import { ContainerError } from './container-error.js'
import { runDocker } from './run-docker.js'

/**
 * What Docker's engine has, read from `docker info`.
 *
 * @public
 */
export interface DockerHost {
  /**
   * How many CPUs the engine has.
   */
  cpus: number
  /**
   * How much memory the engine has, in bytes.
   */
  memoryBytes: number
  /**
   * Whether the engine is Docker Desktop's, which `docker info` reports as `OperatingSystem: Docker Desktop`.
   */
  desktop: boolean
}

/**
 * Asks Docker what its engine has, and resolves with it.
 *
 * @public
 * @throws {ContainerError} When Docker is missing, doesn't answer in time, its daemon can't be reached, it runs
 * Windows containers, or its answer can't be read.
 */
export type ProbeDocker = () => Promise<DockerHost>

/**
 * What `docker info` says that the probe reads. Any field may be missing, as when the daemon can't be reached.
 */
interface DockerInfo {
  /**
   * How many CPUs the engine has.
   */
  NCPU?: unknown
  /**
   * How much memory the engine has, in bytes.
   */
  MemTotal?: unknown
  /**
   * The engine's operating system, `windows` or `linux`.
   */
  OSType?: unknown
  /**
   * The name of the system the engine runs on, such as `Docker Desktop`, `OrbStack` or `Ubuntu 24.04.1 LTS`.
   */
  OperatingSystem?: unknown
  /**
   * The problems the daemon reported, such as one that can't be reached. Older Docker CLIs report them with exit
   * code 0.
   */
  ServerErrors?: unknown
}

/**
 * How long `docker info` may take, in milliseconds.
 */
const infoTimeoutMs = 30_000

/**
 * Whether the value is a number above zero.
 */
function isPositive(value: unknown): value is number {
  return typeof value === 'number' && value > 0
}

/**
 * Gives the first server error `docker info` reports, or `undefined` when it reports none.
 */
function serverErrorOf(info: DockerInfo | undefined): string | undefined {
  const first = Array.isArray(info?.ServerErrors) ? (info.ServerErrors as unknown[])[0] : undefined

  return typeof first === 'string' && first.trim() !== '' ? first.trim() : undefined
}

/**
 * Says why `docker info` failed: the first server error it reports, else the first line it wrote to stderr that isn't
 * a warning, else its exit code. The reason ends with a full stop unless it already ends a sentence.
 */
function whyOf(info: DockerInfo | undefined, stderr: string, exitCode: number): string {
  const serverError = serverErrorOf(info)
  const line = stderr
    .split('\n')
    .map((text) => text.trim())
    .find((text) => text !== '' && !text.startsWith('WARNING:'))
  const why = serverError ?? line ?? `'docker info' exited with code ${exitCode}`

  return /[.?!]$/.test(why) ? why : `${why}.`
}

/**
 * Builds the error for a daemon that isn't running or can't be reached.
 */
function daemonProblemOf(why: string): ContainerError {
  return new ContainerError(`Docker's daemon isn't running, or visual-check can't reach its socket: ${why}`)
}

/**
 * Parses what `docker info` printed, or gives `undefined` when it isn't a JSON object.
 */
function parseInfo(stdout: string): DockerInfo | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout)

    return typeof parsed === 'object' && parsed !== null ? (parsed as DockerInfo) : undefined
  } catch {
    return undefined
  }
}

/**
 * Runs `docker info` once, which tells whether Docker is there and running Linux containers, what its engine has, and
 * whether it is Docker Desktop's. It is killed when it doesn't finish within `timeoutMs`, 30 s by default.
 *
 * @public
 * @throws {ContainerError} When Docker is missing, doesn't answer in time, its daemon can't be reached, it runs
 * Windows containers, or its answer can't be read.
 */
export async function probeDocker(timeoutMs: number = infoTimeoutMs): Promise<DockerHost> {
  let stdout = ''
  let stderr = ''
  const exitCode = await runDocker(
    ['info', '--format', '{{json .}}'],
    (text) => {
      stdout += text
    },
    (text) => {
      stderr += text
    },
    timeoutMs,
  )
  const info = parseInfo(stdout)

  if (info === undefined) {
    throw exitCode === 0
      ? new ContainerError("docker info gave an answer visual-check can't read.")
      : daemonProblemOf(whyOf(info, stderr, exitCode))
  }

  if (exitCode !== 0 || serverErrorOf(info) !== undefined) {
    throw daemonProblemOf(whyOf(info, stderr, exitCode))
  }

  if (!isPositive(info.NCPU) || !isPositive(info.MemTotal)) {
    throw new ContainerError("docker info didn't report the engine's CPUs and memory.")
  }

  if (info.OSType === 'windows') {
    throw new ContainerError(
      "Docker runs Windows containers, and visual-check's browser needs Linux containers. " +
        'Switch Docker to Linux containers, then run visual-check again.',
      'linux-containers',
    )
  }

  return { cpus: info.NCPU, memoryBytes: info.MemTotal, desktop: info.OperatingSystem === 'Docker Desktop' }
}
