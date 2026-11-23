import { mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigError } from './config-error.js'
import { readConfig } from './load-config.js'
import { readConfigAfresh } from './read-config-afresh.js'

/**
 * The temporary folder of the current test, removed after it.
 */
let folder: string

/**
 * The start of a config's default export, up to its other keys.
 */
const storybooks = "storybooks: { web: { url: 'http://127.0.0.1:6006' } }"

/**
 * Writes a file of the folder, the config unless a name is given.
 */
function write(content: string, name = 'visual-check.config.ts'): void {
  writeFileSync(join(folder, name), content)
}

/**
 * Reads the config afresh.
 */
async function readAfresh(signal?: AbortSignal, name = 'visual-check.config.ts') {
  return await readConfigAfresh(join(folder, name), folder, signal)
}

/**
 * The statements of a config that appends to a file once, then again each time `append` is called.
 */
function appending(): string {
  return (
    "import { appendFileSync } from 'node:fs'\n\n" +
    `const append = () => appendFileSync(${JSON.stringify(join(folder, 'appended'))}, 'x')\n\nappend()\n`
  )
}

/**
 * The size of the file a config appends to, `0` while there is none.
 */
function appendedSize(): number {
  return statSync(join(folder, 'appended'), { throwIfNoEntry: false })?.size ?? 0
}

/**
 * Expects the file a config appends to to stop growing.
 */
async function expectNoMoreAppended(): Promise<void> {
  await delay(100)

  const size = appendedSize()

  await delay(200)
  expect(appendedSize()).toBe(size)
}

beforeEach(() => {
  folder = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-afresh-')))
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

describe('readConfigAfresh and edits', () => {
  it.each(['visual-check.config.ts', 'visual-check.config.mjs'])('reads %s afresh', async (name) => {
    write(`export default { ${storybooks}, retries: 1 }\n`, name)
    expect((await readAfresh(undefined, name)).retries).toBe(1)
    write(`export default { ${storybooks}, retries: 2 }\n`, name)
    expect((await readAfresh(undefined, name)).retries).toBe(2)
  })

  it.each(['retries.ts', 'retries.mjs'])('reads %s, which the config imports, afresh', async (name) => {
    write(`import { retries } from './${name}'\n\nexport default { ${storybooks}, retries }\n`)
    write('export const retries = 1\n', name)
    expect((await readAfresh()).retries).toBe(1)
    write('export const retries = 2\n', name)
    expect((await readAfresh()).retries).toBe(2)
  })

  it('reads a .js file of a "type": "module" package, which the config imports, afresh', async () => {
    write('{ "type": "module" }\n', 'package.json')
    write(`import { retries } from './retries.js'\n\nexport default { ${storybooks}, retries }\n`)
    write('export const retries = 1\n', 'retries.js')
    expect((await readAfresh()).retries).toBe(1)
    write('export const retries = 2\n', 'retries.js')
    expect((await readAfresh()).retries).toBe(2)
  })

  it('reads an .mjs file, whose namespace the config holds, afresh', async () => {
    write(`import * as viewport from './viewport.mjs'\n\nexport default { ${storybooks}, viewport }\n`)
    write('export const width = 800\n', 'viewport.mjs')
    expect((await readAfresh()).viewport).toStrictEqual({ width: 800 })
    write('export const width = 900\n', 'viewport.mjs')
    expect((await readAfresh()).viewport).toStrictEqual({ width: 900 })
  })

  it('reads an .mjs file afresh after a config that held a function', async () => {
    write('export const retries = 1\n', 'retries.mjs')
    write(`import { retries } from './retries.mjs'\n\nexport default { ${storybooks}, retries, image: () => 1 }\n`)
    await expect(readAfresh()).rejects.toThrow('image: must be')
    write('export const retries = () => 7\n', 'retries.mjs')
    write(`import { retries } from './retries.mjs'\n\nexport default { ${storybooks}, retries }\n`)
    await expect(readAfresh()).rejects.toThrow('retries: must be')
  })
})

describe('readConfigAfresh and the config', () => {
  it('gives what readConfig gives', async () => {
    write(
      `export default { ${storybooks}, retries: 2, image: undefined, silenceHosts: ['a.test'], ` +
        "affected: { ignore: ['**/*.md'] }, viewport: new Proxy({ width: 800 }, {}) }\n",
    )
    expect(await readAfresh()).toStrictEqual(await readConfig(join(folder, 'visual-check.config.ts'), folder))
  })

  it('keeps what the config does to the process in its thread', async () => {
    write(`process.env.VISUAL_CHECK_AFRESH = 'set'\n\nexport default { ${storybooks}, image: () => 1 }\n`)
    await expect(readAfresh()).rejects.toThrow(ConfigError)
    expect(process.env).not.toHaveProperty('VISUAL_CHECK_AFRESH')
  })

  it('takes nothing the config posts to its parent for the answer', async () => {
    write(
      "import { parentPort } from 'node:worker_threads'\n\n" +
        `parentPort.postMessage({ config: {} })\n\nexport default { ${storybooks}, retries: 2 }\n`,
    )
    expect((await readAfresh()).retries).toBe(2)
  })

  it('stops the thread once it has the config, whatever the config left running', async () => {
    write(`${appending()}setInterval(append, 5)\n\nexport default { ${storybooks} }\n`)
    await readAfresh()
    expect(appendedSize()).toBeGreaterThan(0)
    await expectNoMoreAppended()
  })

  it('stops the thread of a config that fails, whatever it left running', async () => {
    write(`${appending()}setInterval(append, 5)\n\nexport default {}\n`)
    await expect(readAfresh()).rejects.toThrow(ConfigError)
    await expectNoMoreAppended()
  })
})

describe('readConfigAfresh failures', () => {
  it.each([
    ['throws', "throw new Error('No Storybook here')\n"],
    ['throws a string', "throw 'boom'\n"],
    ['can’t be parsed', 'export default {\n'],
    ['imports a missing file', "import './missing.ts'\n\nexport default {}\n"],
    ['rejects', "export default Promise.reject(new Error('boom'))\n"],
    ['exports nothing', 'export const config = {}\n'],
    ['holds a function', `export default { ${storybooks}, image: () => 1 }\n`],
    ['holds a symbol', `export default { ${storybooks}, image: Symbol('chromium') }\n`],
    ['holds a class instance', `class Size {}\n\nexport default { ${storybooks}, viewport: new Size() }\n`],
    ['is a class instance', `class Config {\n  ${storybooks.replace(':', ' =')}\n}\n\nexport default new Config()\n`],
    ['holds itself', `const config = { ${storybooks} }\n\nconfig.viewport = config\n\nexport default config\n`],
    ['is invalid', `export default { ${storybooks}, colour: 'red' }\n`],
  ])('fails with readConfig’s message on a config that %s', async (_, content) => {
    write(content)

    const inProcess = await readConfig(join(folder, 'visual-check.config.ts'), folder).catch((error: unknown) => error)
    const error = await readAfresh().catch((rejection: unknown) => rejection)

    expect(inProcess).toBeInstanceOf(ConfigError)
    expect(error).toBeInstanceOf(ConfigError)
    expect((error as ConfigError).message).toBe((inProcess as ConfigError).message)
  })

  it('fails with an error that is no ConfigError where readConfig does', async () => {
    write(`export default { ${storybooks}, get image() { throw new Error('boom') } }\n`)
    await expect(readAfresh()).rejects.toStrictEqual(new Error('boom'))
  })

  it.each([
    ['exits', 'process.exit(3)\n', 'its thread stopped with exit code 3 before it gave a config.'],
    ['exits with code 0', 'process.exit(0)\n', 'its thread stopped with exit code 0 before it gave a config.'],
    [
      'exports what never settles',
      'export default new Promise(() => {})\n',
      'it waits for a promise that never settles.',
    ],
    [
      'waits for what never settles',
      'await new Promise(() => {})\n\nexport default {}\n',
      'it waits for a promise that never settles.',
    ],
    [
      'throws in a timer',
      "setTimeout(() => {\n  throw new Error('boom')\n}, 0)\n\nexport default new Promise(() => {})\n",
      'boom',
    ],
  ])('fails on a config that %s', async (_, content, reason) => {
    write(content)
    await expect(readAfresh()).rejects.toThrow(new ConfigError(`Couldn't load visual-check.config.ts: ${reason}`))
  })
})

describe('readConfigAfresh and its signal', () => {
  it('stops the thread of a config that spins, rejecting with the signal’s reason', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled')

    write(
      `${appending()}while (true) {\n  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)\n  append()\n}\n`,
    )

    const rejection = readAfresh(controller.signal).catch((error: unknown) => error)

    await vi.waitUntil(() => appendedSize() > 2, { timeout: 5000 })
    controller.abort(reason)
    expect(await rejection).toBe(reason)
    await expectNoMoreAppended()
  })

  it('rejects with the reason of a signal that has aborted, without running the config', async () => {
    const reason = new Error('cancelled')

    write(`${appending()}export default { ${storybooks} }\n`)
    await expect(readAfresh(AbortSignal.abort(reason))).rejects.toBe(reason)
    await expectNoMoreAppended()
    expect(appendedSize()).toBe(0)
  })

  it('leaves no listener on the signal', async () => {
    const { signal } = new AbortController()
    const add = vi.spyOn(signal, 'addEventListener')
    const remove = vi.spyOn(signal, 'removeEventListener')

    write(`export default { ${storybooks} }\n`)
    await readAfresh(signal)
    expect(remove).toHaveBeenCalledTimes(add.mock.calls.length)
  })
})
