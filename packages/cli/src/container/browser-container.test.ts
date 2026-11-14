import { afterEach, describe, expect, it, vi } from 'vitest'
import { containerRunArguments, startBrowserInContainer } from './browser-container.js'
import { type FakeDocker, installFakeDocker, removeDockerFromPath } from './fake-docker.fixture.js'

const image = 'ghcr.io/visual-check/chromium@sha256:abc'
const executable = '/opt/chrome-headless-shell/chrome-headless-shell'
const script = 'exec "$0" "$@" 3<&0 4>&1 1>&2'

/**
 * Reads a stream to its end.
 */
async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  let text = ''

  for await (const chunk of stream) {
    text += String(chunk)
  }

  return text
}

describe('containerRunArguments', () => {
  it.each([
    ['linux/amd64', 'host'],
    ['linux/arm64', `container:${'a'.repeat(64)}`],
  ] as const)('builds the exact docker run arguments for %s on the %s network', (platform, network) => {
    expect(
      containerRunArguments({ name: 'visual-check-0123456789ab', image, platform, executable, network }, [
        '--a',
        '--b=1',
      ]),
    ).toEqual([
      'run',
      '-i',
      '--rm',
      '--pull=never',
      '--name',
      'visual-check-0123456789ab',
      '--platform',
      platform,
      '--user',
      'ubuntu',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--network',
      network,
      image,
      'sh',
      '-c',
      script,
      executable,
      '--a',
      '--b=1',
    ])
  })
})

describe('startBrowserInContainer', () => {
  let fake: FakeDocker | undefined
  let restorePath: (() => void) | undefined

  afterEach(() => {
    fake?.remove()
    restorePath?.()
    fake = undefined
    restorePath = undefined
  })

  it('runs the browser with a fresh visual-check name each start', () => {
    fake = installFakeDocker()

    const start = startBrowserInContainer({ image, platform: 'linux/amd64', executable, network: 'host' })
    const first = start(['--x'])
    const second = start(['--x'])

    first.toBrowser.end()
    second.toBrowser.end()

    return Promise.all([first.exited, second.exited]).then(() => {
      const names = fake?.calls().map((call) => call[call.indexOf('--name') + 1]) ?? []

      expect(names).toHaveLength(2)
      expect(names[0]).toMatch(/^visual-check-[0-9a-f]{12}$/)
      expect(names[1]).toMatch(/^visual-check-[0-9a-f]{12}$/)
      expect(names[0]).not.toBe(names[1])
      expect(fake?.calls()[0]?.slice(-2)).toEqual([executable, '--x'])
    })
  })

  it('carries bytes both ways, passes stderr as output, and settles exited with the code when stdin ends', async () => {
    fake = installFakeDocker()

    const browser = startBrowserInContainer({ image, platform: 'linux/arm64', executable, network: 'host' })(['--x'])
    const received = readAll(browser.fromBrowser)
    const output = readAll(browser.output)

    browser.toBrowser.write('{"id":1}\0')
    browser.toBrowser.end('{"id":2}\0')

    expect(await received).toBe('{"id":1}\0{"id":2}\0')
    expect(await output).toBe('browser started\n')
    expect(await browser.exited).toEqual({ code: 0, signal: null, error: undefined })
  })

  it('settles exited with the error when docker is missing, without throwing', async () => {
    restorePath = removeDockerFromPath()

    const browser = startBrowserInContainer({ image, platform: 'linux/amd64', executable, network: 'host' })([])
    const exit = await browser.exited

    expect(exit.code).toBeNull()
    expect(exit.signal).toBeNull()
    expect((exit.error as NodeJS.ErrnoException).code).toBe('ENOENT')
    expect(() => browser.kill()).not.toThrow()
  })

  it('settles exited with the error when spawn throws, such as for a NUL byte in the image', async () => {
    fake = installFakeDocker()

    const browser = startBrowserInContainer({
      image: 'bad\0image',
      platform: 'linux/amd64',
      executable,
      network: 'host',
    })([])

    expect((await browser.exited).error).toBeInstanceOf(Error)
    expect(() => browser.kill()).not.toThrow()
  })

  it('kills the container by its name with docker kill, which ends the run', async () => {
    fake = installFakeDocker({ kill: 'stop' })

    const browser = startBrowserInContainer({ image, platform: 'linux/amd64', executable, network: 'host' })([])

    await readFirstOutput(browser.output)
    browser.kill()

    const exit = await browser.exited

    const calls = fake.calls()
    const run = calls.find((call) => call[0] === 'run')
    const kill = calls.find((call) => call[0] === 'kill')

    expect(kill).toEqual(['kill', run?.[run.indexOf('--name') + 1]])
    expect(exit).toEqual({ code: 137, signal: null, error: undefined })
  })

  it.each(['fail', 'ignore'] as const)('SIGKILLs the docker client when docker kill %ss', async (kill) => {
    fake = installFakeDocker({ kill })

    const browser = startBrowserInContainer({
      image,
      platform: 'linux/amd64',
      executable,
      network: 'host',
      killGraceMilliseconds: 300,
    })([])

    await readFirstOutput(browser.output)
    browser.kill()

    expect(await browser.exited).toEqual({ code: null, signal: 'SIGKILL', error: undefined })
    // The `docker kill` client starts on its own, so on a loaded machine it may log its call after the grace ran out.
    await vi.waitFor(() => expect(fake?.calls().some((call) => call[0] === 'kill')).toBe(true), { timeout: 3000 })
  })
})

/**
 * Waits for the fake browser's first line of output, which says it is running and has written its pid file.
 */
async function readFirstOutput(output: NodeJS.ReadableStream): Promise<void> {
  await new Promise<void>((resolve) => {
    output.once('data', () => resolve())
  })
}
