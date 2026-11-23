import { ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { text } from 'node:stream/consumers'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The child of the engine process that a test runs. It writes to its standard error and answers no cancel.
 */
const childSource = `
  process.stderr.write('started')
  process.on('message', ({ kind, id }) => {
    if (kind === 'check') {
      process.send({ kind: 'progress', id, progress: { step: 'preparing' } })
    }
  })
  process.on('disconnect', () => process.exit(0))
`

/**
 * What stops and removes everything a test started and made.
 */
const cleanups: (() => void)[] = []

/**
 * Gives the URL of a built file of the package.
 */
function builtUrl(path: string): string {
  return new URL(`../dist/${path}`, import.meta.url).href
}

/**
 * Gives the source of a program that does nothing but ask an engine process, whose child is the script, for a check,
 * and cancel it once it goes on.
 */
function programSourceOf(entry: string): string {
  return `
    import { createEngineProcess } from ${JSON.stringify(builtUrl('engine-process/engine-process.js'))}

    const engine = createEngineProcess({
      version: '1.2.3',
      entry: () => ${JSON.stringify(entry)},
      cancelTimeoutMs: 600_000,
    })
    const server = setInterval(() => undefined, 60_000)

    engine.check(
      { id: 'click-1', storyId: 'a', configDir: '/project/.storybook', url: 'http://127.0.0.1:6006' },
      {
        progress: () => {
          engine.cancel('click-1')
          clearInterval(server)
        },
        finished: () => undefined,
      },
    )
  `
}

afterEach(() => {
  vi.restoreAllMocks()

  for (const cleanUp of cleanups.splice(0)) {
    cleanUp()
  }
})

describe('the package', () => {
  it('exports the manager, the preset and its manifest', () => {
    const { exports } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, string>
    }

    expect(Object.keys(exports)).toEqual(['./manager', './preset', './package.json'])
  })
})

describe('the built preset', () => {
  it('exports the two hooks alone', async () => {
    expect(Object.keys(await import(builtUrl('preset.js'))).sort()).toEqual([
      'experimental_devServer',
      'experimental_serverChannel',
    ])
  })

  it('starts no process before the first check, which starts the installed CLI', async () => {
    const started = vi
      .spyOn(ChildProcess.prototype as ChildProcess & { spawn: (options: { args: string[] }) => void }, 'spawn')
      .mockImplementation(() => {
        throw new Error('This test starts no process')
      })
    const { experimental_devServer, experimental_serverChannel } = await import(builtUrl('preset.js'))
    const listeners = new Map<string, (payload: unknown) => void>()
    const channel = {
      on: (event: string, listener: (payload: unknown) => void) => listeners.set(event, listener),
      emit: vi.fn(),
    }
    const app = { use: vi.fn().mockReturnThis() }
    const options = { configDir: '/project/.storybook', port: 6006 }

    expect(await experimental_serverChannel(channel, options)).toBe(channel)
    expect(await experimental_devServer(app, options)).toBe(app)
    expect(app.use).toHaveBeenCalledTimes(1)

    listeners.get('visual-check/get-state')?.(undefined)

    expect(channel.emit).toHaveBeenCalledWith('visual-check/state', { run: null, results: {} })
    expect(started).not.toHaveBeenCalled()

    listeners.get('visual-check/check')?.({ storyId: 'a' })

    const message = "visual-check's process couldn't start: This test starts no process"

    expect(started).toHaveBeenCalledTimes(1)
    expect(started.mock.calls[0]?.[0].args.at(-1)).toMatch(/cli[\\/]dist[\\/]addon-child\.js$/)
    expect(channel.emit.mock.lastCall?.[1]).toMatchObject({ run: null, results: { a: { outcome: { message } } } })
  })
})

describe('the built engine process', { timeout: 30_000 }, () => {
  it('never keeps the process that runs it alive', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'visual-check-engine-process-'))
    const entry = join(folder, 'child.mjs')

    cleanups.push(() => rmSync(folder, { recursive: true, force: true }))
    writeFileSync(entry, childSource)

    const program = spawn(process.execPath, ['--input-type=module', '-e', programSourceOf(entry)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })

    cleanups.push(() => program.kill('SIGKILL'))

    const [errors, [exitCode]] = await Promise.all([text(program.stderr), once(program, 'exit')])

    expect(errors).toBe('')
    expect(exitCode).toBe(0)
  })
})
