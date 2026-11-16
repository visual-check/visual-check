import { describe, expect, it } from 'vitest'
import {
  addDevDependenciesCommandOf,
  commandLineOf,
  isPackageManager,
  lockfileNames,
  packageManagerOf,
  runScriptCommandOf,
  scriptsOf,
  storybookCommandOf,
  visualCheckCommandOf,
} from './package-manager.js'

describe('packageManagerOf', () => {
  it('reads the packageManager field', () => {
    expect(packageManagerOf({ packageManager: 'pnpm@9.12.3' }, [])).toBe('pnpm')
  })

  it('cuts a checksum off the packageManager field', () => {
    expect(packageManagerOf({ packageManager: 'yarn@4.1.0+sha512.abc' }, [])).toBe('yarn')
  })

  it('reads a bare name in the packageManager field', () => {
    expect(packageManagerOf({ packageManager: 'bun' }, [])).toBe('bun')
  })

  it('reads a devEngines object', () => {
    expect(packageManagerOf({ devEngines: { packageManager: { name: 'pnpm', version: '9' } } }, [])).toBe('pnpm')
  })

  it('reads the first known name of a devEngines array', () => {
    const devEngines = { packageManager: [{ name: 'deno' }, { name: 'yarn' }, { name: 'npm' }] }

    expect(packageManagerOf({ devEngines }, [])).toBe('yarn')
  })

  it('takes packageManager over devEngines', () => {
    const manifest = { packageManager: 'npm@10.0.0', devEngines: { packageManager: { name: 'pnpm' } } }

    expect(packageManagerOf(manifest, [])).toBe('npm')
  })

  it.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['npm-shrinkwrap.json', 'npm'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
  ])('reads %s', (lockfile, expected) => {
    expect(packageManagerOf({}, [lockfile])).toBe(expected)
  })

  it('takes a field over a lockfile', () => {
    expect(packageManagerOf({ packageManager: 'yarn@4.0.0' }, ['pnpm-lock.yaml'])).toBe('yarn')
  })

  it('takes the first lockfile in the fixed order', () => {
    expect(packageManagerOf({}, ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'])).toBe('pnpm')
  })

  it('falls through unknown names to the lockfile', () => {
    const manifest = { packageManager: 'deno@2.0.0', devEngines: { packageManager: { name: 'deno' } } }

    expect(packageManagerOf(manifest, ['yarn.lock'])).toBe('yarn')
  })

  it('ignores fields of the wrong type', () => {
    expect(packageManagerOf({ packageManager: 7, devEngines: 'pnpm' }, [])).toBeUndefined()
  })

  it('returns undefined when nothing shows one', () => {
    expect(packageManagerOf({}, [])).toBeUndefined()
  })

  it('lists every lockfile it reads', () => {
    expect(lockfileNames).toEqual([
      'pnpm-lock.yaml',
      'yarn.lock',
      'package-lock.json',
      'npm-shrinkwrap.json',
      'bun.lock',
      'bun.lockb',
    ])
  })
})

describe('commands', () => {
  it.each(['npm', 'pnpm', 'yarn', 'bun'] as const)('runs a script with %s', (packageManager) => {
    expect(runScriptCommandOf(packageManager, 'visual:test')).toBe(`${packageManager} run visual:test`)
  })

  it('runs the storybook binary', () => {
    expect(storybookCommandOf('pnpm', ['dev'])).toEqual({ command: 'pnpm', args: ['exec', 'storybook', 'dev'] })
    expect(storybookCommandOf('npm', ['dev'])).toEqual({ command: 'npx', args: ['storybook', 'dev'] })
    expect(storybookCommandOf('yarn', ['dev'])).toEqual({ command: 'yarn', args: ['storybook', 'dev'] })
    expect(storybookCommandOf('bun', [])).toEqual({ command: 'bunx', args: ['storybook'] })
  })

  it('runs the visual-check binary', () => {
    expect(visualCheckCommandOf('pnpm', 'test')).toBe('pnpm exec visual-check test')
    expect(visualCheckCommandOf('npm', 'update')).toBe('npx visual-check update')
    expect(visualCheckCommandOf('yarn', 'test')).toBe('yarn visual-check test')
    expect(visualCheckCommandOf('bun', 'update')).toBe('bunx visual-check update')
  })

  it('shows a command line with single spaces', () => {
    expect(commandLineOf({ command: 'pnpm', args: ['add', '--save-dev', 'a@1'] })).toBe('pnpm add --save-dev a@1')
    expect(commandLineOf({ command: 'pnpm', args: [] })).toBe('pnpm')
  })

  it('adds dev dependencies', () => {
    const specs = ['a@1', 'b@2']

    expect(addDevDependenciesCommandOf('npm', specs)).toEqual({
      command: 'npm',
      args: ['install', '--save-dev', ...specs],
    })
    expect(addDevDependenciesCommandOf('pnpm', specs)).toEqual({
      command: 'pnpm',
      args: ['add', '--save-dev', ...specs],
    })
    expect(addDevDependenciesCommandOf('yarn', specs)).toEqual({ command: 'yarn', args: ['add', '--dev', ...specs] })
    expect(addDevDependenciesCommandOf('bun', specs)).toEqual({ command: 'bun', args: ['add', '--dev', ...specs] })
  })
})

describe('scriptsOf', () => {
  it('keeps the scripts that are text, in key order', () => {
    expect(Object.entries(scriptsOf({ scripts: { b: 'x', a: 1, c: null, d: 'y' } }))).toEqual([
      ['b', 'x'],
      ['d', 'y'],
    ])
  })

  it.each([undefined, null, 'x', ['a'], 3])('gives none for scripts that are %j', (scripts) => {
    expect(scriptsOf({ scripts })).toEqual({})
  })
})

describe('isPackageManager', () => {
  it.each(['npm', 'pnpm', 'yarn', 'bun'])('knows %s', (name) => {
    expect(isPackageManager(name)).toBe(true)
  })

  it.each(['pip', 'NPM', '', undefined, 3])('does not know %j', (value) => {
    expect(isPackageManager(value)).toBe(false)
  })
})
