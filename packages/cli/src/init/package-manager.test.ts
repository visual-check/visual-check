import { describe, expect, it } from 'vitest'
import {
  addDevDependenciesCommandOf,
  lockfileNames,
  packageManagerOf,
  runScriptCommandOf,
  storybookBinCommandOf,
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
    expect(storybookBinCommandOf('pnpm')).toEqual(['pnpm', 'exec', 'storybook'])
    expect(storybookBinCommandOf('npm')).toEqual(['npx', 'storybook'])
    expect(storybookBinCommandOf('yarn')).toEqual(['yarn', 'storybook'])
    expect(storybookBinCommandOf('bun')).toEqual(['bunx', 'storybook'])
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
