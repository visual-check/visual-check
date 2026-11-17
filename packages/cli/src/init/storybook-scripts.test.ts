import { describe, expect, it } from 'vitest'
import { startScriptOf, storybookCallsOf } from './storybook-scripts.js'

/**
 * Reads the one call of a single script.
 */
function callOf(command: string) {
  return storybookCallsOf({ sb: command })[0]
}

describe('storybookCallsOf', () => {
  it('reads -p', () => {
    expect(callOf('storybook dev -p 6006')).toEqual({
      script: 'sb',
      subcommand: 'dev',
      configDir: undefined,
      port: 6006,
    })
  })

  it('reads --port=', () => {
    expect(callOf('storybook dev --port=6007')?.port).toBe(6007)
  })

  it('reads --port with a space', () => {
    expect(callOf('storybook dev --port 6011')?.port).toBe(6011)
  })

  it('reads -p=', () => {
    expect(callOf('storybook dev -p=6008')?.port).toBe(6008)
  })

  it('reads SBCONFIG_PORT', () => {
    expect(callOf('SBCONFIG_PORT=6009 storybook dev')?.port).toBe(6009)
  })

  it('reads PORT after cross-env', () => {
    expect(callOf('cross-env PORT=6010 storybook dev')?.port).toBe(6010)
  })

  it('takes SBCONFIG_PORT over PORT', () => {
    expect(callOf('PORT=1 SBCONFIG_PORT=2 storybook dev')?.port).toBe(2)
  })

  it('takes -p over the environment', () => {
    expect(callOf('PORT=6010 storybook dev -p 6006')?.port).toBe(6006)
  })

  it('has no port without one', () => {
    expect(callOf('storybook dev')?.port).toBeUndefined()
  })

  it('ignores a port that is not a number', () => {
    expect(callOf('storybook dev -p abc')?.port).toBeUndefined()
    expect(callOf('storybook dev -p 6006x')?.port).toBeUndefined()
  })

  it('ignores a port out of range', () => {
    expect(callOf('storybook dev -p 0')?.port).toBeUndefined()
    expect(callOf('storybook dev -p 70000')?.port).toBeUndefined()
  })

  it('reads -c', () => {
    expect(callOf('storybook dev -c docs/.storybook')?.configDir).toBe('docs/.storybook')
  })

  it('normalizes --config-dir', () => {
    expect(callOf('storybook dev --config-dir ./docs/.storybook/')?.configDir).toBe('docs/.storybook')
  })

  it('reads --config-dir=', () => {
    expect(callOf('storybook dev --config-dir=x')?.configDir).toBe('x')
  })

  it('strips quotes', () => {
    expect(callOf('storybook dev -c "docs/.storybook" -p \'6006\'')).toMatchObject({
      configDir: 'docs/.storybook',
      port: 6006,
    })
  })

  it('keeps a quoted folder with a space in one word', () => {
    expect(callOf('storybook dev -c "my docs/.storybook"')?.configDir).toBe('my docs/.storybook')
  })

  it.each(['.', './', '""', '././'])('reads -c %s as the project root', (folder) => {
    expect(callOf(`storybook dev -c ${folder}`)?.configDir).toBe('.')
  })

  it('reads a call by a versioned or pathed binary', () => {
    expect(callOf('npx storybook@10 dev -p 1')).toMatchObject({ subcommand: 'dev', port: 1 })
    expect(callOf('./node_modules/.bin/storybook dev')?.subcommand).toBe('dev')
  })

  it('reads a build call', () => {
    expect(callOf('storybook build -c y')).toMatchObject({ subcommand: 'build', configDir: 'y' })
  })

  it('reads calls through a package runner', () => {
    expect(callOf('npx storybook dev')?.subcommand).toBe('dev')
    expect(callOf('pnpm exec storybook dev')?.subcommand).toBe('dev')
  })

  it('reads each command of a chain', () => {
    const calls = storybookCallsOf({ all: 'tsc && storybook dev -p 1 & storybook build -c y || true' })

    expect(calls.map((call) => [call.subcommand, call.port, call.configDir])).toEqual([
      ['dev', 1, undefined],
      ['build', undefined, 'y'],
    ])
  })

  it('splits on ; and |', () => {
    const calls = storybookCallsOf({
      all: 'echo a; storybook dev -p 3 | cat',
      other: 'storybook build ; storybook dev',
    })

    expect(calls.map((call) => [call.script, call.subcommand, call.port])).toEqual([
      ['all', 'dev', 3],
      ['other', 'build', undefined],
      ['other', 'dev', undefined],
    ])
  })

  it('does not take the flags of a later command', () => {
    expect(callOf('storybook dev && vite --port 5173')?.port).toBeUndefined()
  })

  it('skips scripts that do not call storybook dev or build', () => {
    expect(storybookCallsOf({ a: 'vite', b: 'storybook --help', c: 'storybook' })).toEqual([])
  })
})

describe('startScriptOf', () => {
  it('prefers the storybook script over an earlier script', () => {
    const calls = storybookCallsOf({ dev: 'storybook dev -p 1', storybook: 'storybook dev -p 2' })

    expect(startScriptOf(calls, '.storybook')?.script).toBe('storybook')
  })

  it('takes the first matching script without a storybook script', () => {
    const calls = storybookCallsOf({ a: 'storybook build', b: 'storybook dev -p 1', c: 'storybook dev -p 2' })

    expect(startScriptOf(calls, '.storybook')?.script).toBe('b')
  })

  it('does not take a storybook script for another config folder', () => {
    const calls = storybookCallsOf({ storybook: 'storybook dev -c docs/.storybook', other: 'storybook dev -p 1' })

    expect(startScriptOf(calls, '.storybook')?.script).toBe('other')
    expect(startScriptOf(calls, 'docs/.storybook')?.script).toBe('storybook')
  })

  it('does not start .storybook with a call for the project root', () => {
    const calls = storybookCallsOf({ storybook: 'storybook dev -c . -p 7000' })

    expect(startScriptOf(calls, '.storybook')).toBeUndefined()
    expect(startScriptOf(calls, '.')?.port).toBe(7000)
  })

  it('never starts with a build call', () => {
    expect(startScriptOf(storybookCallsOf({ storybook: 'storybook build' }), '.storybook')).toBeUndefined()
  })

  it('returns undefined without calls', () => {
    expect(startScriptOf([], '.storybook')).toBeUndefined()
  })
})
