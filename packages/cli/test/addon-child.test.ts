import { type ChildProcess, fork, spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { AddonMessage } from '../src/addon-child/protocol.js'

const entryPath = fileURLToPath(new URL('../dist/addon-child.js', import.meta.url))
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * How long a test may take, in milliseconds. Each waits for what it expects, so it takes this long only when that never
 * comes.
 */
const testTimeout = 30_000

/**
 * A config of one Storybook, whose config folder is the project's `.storybook`.
 */
const config = "export default { storybooks: { web: { url: 'http://127.0.0.1:6006' } } }\n"

/**
 * A config that never finishes loading, so a check waits for it until it's cancelled.
 */
const endlessConfig = `setInterval(() => undefined, 60_000)\nawait new Promise(() => undefined)\n${config}`

/**
 * The projects the tests made, removed after each test.
 */
const projects: string[] = []

/**
 * The processes the tests started, killed after each test when they haven't exited.
 */
const processes: ChildProcess[] = []

/**
 * Makes a temporary project, and returns its real path. A `.git` folder ends the config search there. It holds the
 * given config, or none.
 */
function createProject(configSource?: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-addon-child-')))

  projects.push(root)
  mkdirSync(join(root, '.git'))
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  mkdirSync(join(root, '.storybook'))
  mkdirSync(join(root, 'empty'))

  if (configSource !== undefined) {
    writeFileSync(join(root, 'visual-check.config.mjs'), configSource)
  }

  return root
}

/**
 * Gives the environment of a process: the inherited one without `CI`, and with a folder that holds nothing as `PATH`, so
 * none runs the real `docker`.
 */
function environmentOf(project: string): NodeJS.ProcessEnv {
  const { CI: _ci, ...environment } = process.env

  return { ...environment, PATH: join(project, 'empty') }
}

/**
 * Gives a request for a check in the project, with the click's ID.
 */
function checkRequestOf(project: string, id: string): { kind: string; id: string } & Record<string, string> {
  return { kind: 'check', id, storyId: 'a', configDir: join(project, '.storybook'), url: 'http://127.0.0.1:6006' }
}

/**
 * A forked child.
 */
interface ForkedChild {
  /**
   * The process.
   */
  process: ChildProcess
  /**
   * Resolves with the first message of the kind about `id`, or about nothing for `ready`, once it's there.
   */
  message: (kind: AddonMessage['kind'], id?: string) => Promise<AddonMessage>
  /**
   * Every message so far, in order.
   */
  messages: AddonMessage[]
  /**
   * Resolves with the exit code and the signal once the process has exited.
   */
  exit: Promise<unknown[]>
}

/**
 * Forks the built entry in the project, as the addon does.
 */
function forkIn(project: string): ForkedChild {
  const child = fork(entryPath, [], {
    execArgv: [],
    serialization: 'json',
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    windowsHide: true,
    cwd: project,
    env: environmentOf(project),
  })
  const messages: AddonMessage[] = []
  const checks: (() => void)[] = []

  processes.push(child)
  child.on('message', (message) => {
    messages.push(message as AddonMessage)

    for (const check of checks) {
      check()
    }
  })

  return {
    process: child,
    messages,
    message: (kind, id) =>
      new Promise((resolve) => {
        const check = (): void => {
          const found = messages.find((message) => message.kind === kind && ('id' in message ? message.id : id) === id)

          if (found !== undefined) {
            resolve(found)
          }
        }

        checks.push(check)
        check()
      }),
    exit: once(child, 'exit'),
  }
}

afterEach(async () => {
  for (const child of processes.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit')

      child.kill('SIGKILL')
      await exit
    }
  }

  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true })
  }
})

describe("the addon's child process", { timeout: testTimeout }, () => {
  it('says first that it is ready, with the package version', async () => {
    const child = forkIn(createProject())

    await child.message('ready')

    expect(child.messages).toEqual([{ kind: 'ready', protocol: 1, version }])
  })

  it('stops a check with no config, and takes the next one', async () => {
    const project = createProject()
    const child = forkIn(project)

    for (const id of ['click-1', 'click-2']) {
      child.process.send(checkRequestOf(project, id))

      expect(await child.message('progress', id)).toEqual({ kind: 'progress', id, progress: { step: 'preparing' } })
      expect(await child.message('finished', id)).toEqual({
        kind: 'finished',
        id,
        outcome: { result: 'stopped', cause: 'config', message: expect.stringContaining('init'), notices: [] },
      })
    }
  })

  it('stops a check with both fixes when there is no docker command, and takes the next one', async () => {
    const project = createProject(config)
    const child = forkIn(project)

    for (const id of ['click-1', 'click-2']) {
      child.process.send(checkRequestOf(project, id))

      expect(await child.message('finished', id)).toMatchObject({
        outcome: {
          result: 'stopped',
          cause: 'run',
          message: expect.stringContaining(
            "visual-check runs the browser in Docker, and there's no docker command on PATH.\n" +
              "Start or install Docker, or set platform: 'host' in the config.",
          ),
        },
      })
    }
  })

  it('cancels a check', async () => {
    const project = createProject(endlessConfig)
    const child = forkIn(project)

    child.process.send(checkRequestOf(project, 'click-1'))
    await child.message('progress', 'click-1')
    child.process.send({ kind: 'cancel', id: 'click-1' })

    expect(await child.message('finished', 'click-1')).toMatchObject({ outcome: { result: 'cancelled' } })
  })

  it('exits 0 once the channel closes', async () => {
    const child = forkIn(createProject())

    await child.message('ready')
    child.process.disconnect()

    expect(await child.exit).toEqual([0, null])
  })

  it('exits 0 once the channel closes during a check', async () => {
    const project = createProject(endlessConfig)
    const child = forkIn(project)

    child.process.send(checkRequestOf(project, 'click-1'))
    await child.message('progress', 'click-1')
    child.process.disconnect()

    expect(await child.exit).toEqual([0, null])
  })

  it('exits 0 when the channel closes while it starts, with a check asked for', async () => {
    const project = createProject(endlessConfig)
    const child = forkIn(project)

    await new Promise((resolve) => child.process.send(checkRequestOf(project, 'click-1'), resolve))
    child.process.disconnect()

    expect(await child.exit).toEqual([0, null])
  })

  it.each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)('exits 0 on %s', async (signal) => {
    const child = forkIn(createProject())

    await child.message('ready')
    child.process.kill(signal)

    expect(await child.exit).toEqual([0, null])
  })

  it('exits when the process that forked it is killed', async () => {
    const project = createProject()
    // The child inherits the parent's standard error, so that pipe ends once both have exited.
    const source = `
      const child = require('node:child_process').fork(${JSON.stringify(entryPath)}, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })

      child.once('message', () => process.stdout.write(child.pid + '\\n'))
    `
    const parent = spawn(process.execPath, ['-e', source], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: project,
      env: environmentOf(project),
    })

    processes.push(parent)

    const exited = text(parent.stderr)
    const [chunk] = await once(parent.stdout, 'data')
    const pid = Number(String(chunk))
    let timer: NodeJS.Timeout | undefined

    expect(pid).toBeGreaterThan(0)
    parent.kill('SIGKILL')

    const result = await Promise.race([
      exited,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 5_000, 'still running')
      }),
    ])

    clearTimeout(timer)

    if (result === 'still running') {
      process.kill(pid, 'SIGKILL')
    }

    expect(result).toBe('')
  })

  it('exits 2 without a channel', () => {
    const { NODE_CHANNEL_FD: _channel, ...environment } = process.env
    const result = spawnSync(process.execPath, [entryPath], { encoding: 'utf8', env: environment })

    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe("This is visual-check's internal entry, which its Storybook addon starts.\n")
  })
})
