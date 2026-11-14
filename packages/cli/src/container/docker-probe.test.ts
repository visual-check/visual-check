import { afterEach, describe, expect, it } from 'vitest'
import { ContainerError } from './container-error.js'
import { probeDocker } from './docker-probe.js'
import { type FakeDocker, installFakeDocker, removeDockerFromPath } from './fake-docker.fixture.js'

/**
 * Runs the probe and gives the error it fails with.
 */
async function failureOf(timeoutMs?: number): Promise<ContainerError> {
  const error = await probeDocker(timeoutMs).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )

  expect(error).toBeInstanceOf(ContainerError)

  return error as ContainerError
}

describe('probeDocker', () => {
  let fake: FakeDocker | undefined
  let restorePath: (() => void) | undefined

  afterEach(() => {
    fake?.remove()
    restorePath?.()
    fake = undefined
    restorePath = undefined
  })

  it("asks `docker info` once and gives the engine's CPUs and memory", async () => {
    fake = installFakeDocker({ info: { cpus: 8, memoryBytes: 2 ** 33 } })

    expect(await probeDocker()).toEqual({ cpus: 8, memoryBytes: 2 ** 33 })
    expect(fake.calls()).toEqual([['info', '--format', '{{json .}}']])
  })

  it('fails with the install fix when there is no docker command', async () => {
    restorePath = removeDockerFromPath()

    const error = await failureOf()

    expect(error.message).toBe("visual-check runs the browser in Docker, and there's no docker command on PATH.")
    expect(error.fix).toBe('docker')
  })

  it("names the daemon and the first line docker wrote when it can't be reached", async () => {
    fake = installFakeDocker({
      info: { exitCode: 1, stderr: '\nfailed to connect to the docker API at unix:///x.sock: no such file.\nmore\n' },
    })

    const error = await failureOf()

    expect(error.message).toBe(
      "Docker's daemon isn't running, or visual-check can't reach its socket: " +
        'failed to connect to the docker API at unix:///x.sock: no such file.',
    )
    expect(error.fix).toBe('docker')
  })

  it("names docker's exit code when it fails without a word", async () => {
    fake = installFakeDocker({ info: { exitCode: 3 } })

    expect((await failureOf()).message).toBe(
      "Docker's daemon isn't running, or visual-check can't reach its socket: 'docker info' exited with code 3.",
    )
  })

  it('says docker reported no CPUs when it succeeds with a CPU count of zero', async () => {
    fake = installFakeDocker({ info: { cpus: 0 } })

    const error = await failureOf()

    expect(error.message).toBe("docker info didn't report the engine's CPUs and memory.")
    expect(error.fix).toBe('docker')
  })

  it('asks to switch to Linux containers when Docker runs Windows containers', async () => {
    fake = installFakeDocker({ info: { osType: 'windows' } })

    const error = await failureOf()

    expect(error.message).toBe(
      "Docker runs Windows containers, and visual-check's browser needs Linux containers. " +
        'Switch Docker to Linux containers, then run visual-check again.',
    )
    expect(error.fix).toBe('linux-containers')
  })

  it("fails when docker's answer isn't JSON", async () => {
    fake = installFakeDocker({ info: { stdout: 'not json\n' } })

    const error = await failureOf()

    expect(error.message).toBe("docker info gave an answer visual-check can't read.")
    expect(error.fix).toBe('docker')
  })

  it("fails when docker's answer is JSON but not an object", async () => {
    fake = installFakeDocker({ info: { stdout: 'null\n' } })

    expect((await failureOf()).message).toBe("docker info gave an answer visual-check can't read.")
  })

  it('names the daemon when docker fails with nothing readable on stdout', async () => {
    fake = installFakeDocker({ info: { exitCode: 1, stdout: '', stderr: 'context not found\n' } })

    expect((await failureOf()).message).toBe(
      "Docker's daemon isn't running, or visual-check can't reach its socket: context not found.",
    )
  })

  it('says docker reported no memory when it succeeds with a memory of zero', async () => {
    fake = installFakeDocker({ info: { memoryBytes: 0 } })

    const error = await failureOf()

    expect(error.message).toBe("docker info didn't report the engine's CPUs and memory.")
    expect(error.fix).toBe('docker')
  })

  it('keeps the question mark of an older docker CLI and adds no full stop', async () => {
    fake = installFakeDocker({
      info: {
        exitCode: 1,
        stderr: 'Cannot connect to the Docker daemon at unix:///x.sock. Is the docker daemon running?\n',
      },
    })

    expect((await failureOf()).message).toBe(
      "Docker's daemon isn't running, or visual-check can't reach its socket: " +
        'Cannot connect to the Docker daemon at unix:///x.sock. Is the docker daemon running?',
    )
  })

  it('adds a full stop to a reason that has none', async () => {
    fake = installFakeDocker({ info: { exitCode: 1, stderr: 'permission denied\n' } })

    expect((await failureOf()).message).toBe(
      "Docker's daemon isn't running, or visual-check can't reach its socket: permission denied.",
    )
  })

  it("prefers the JSON's first server error, which an older docker CLI reports with exit 0 and no stderr", async () => {
    fake = installFakeDocker({
      info: { cpus: 0, memoryBytes: 0, serverErrors: ['Cannot connect to the daemon.', 'x'] },
    })

    expect((await failureOf()).message).toBe(
      "Docker's daemon isn't running, or visual-check can't reach its socket: Cannot connect to the daemon.",
    )
  })

  it('skips stderr warnings when naming why', async () => {
    fake = installFakeDocker({ info: { exitCode: 1, stderr: 'WARNING: a warning\nsocket is gone\n' } })

    expect((await failureOf()).message).toBe(
      "Docker's daemon isn't running, or visual-check can't reach its socket: socket is gone.",
    )
  })

  it("fails and kills docker when it doesn't answer in time", async () => {
    fake = installFakeDocker({ info: { delayMs: 5_000 } })

    const error = await failureOf(100)

    expect(error.message).toBe("docker info didn't answer within 0.1 s.")
    expect(error.fix).toBe('docker')
  })
})
