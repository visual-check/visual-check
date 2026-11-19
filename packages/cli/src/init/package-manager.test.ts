import { describe, expect, it } from 'vitest'
import {
  type AddOptions,
  addDevDependenciesCommandOf,
  commandInFolderOf,
  commandLineOf,
  listsDependency,
  lockfileNames,
  nodeLinkerOf,
  nonEmptyTextOf,
  nxCommandOf,
  type PackageManager,
  packageManagerOf,
  runScriptCommandOf,
  rushPackageManagerOf,
  scriptsOf,
  storybookCommandOf,
  yarnBerryOf,
  yarnPnpOf,
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
    expect(runScriptCommandOf(packageManager, 'visual:check')).toBe(`${packageManager} run visual:check`)
  })

  it('runs the storybook binary', () => {
    expect(storybookCommandOf('pnpm', ['dev'], false)).toEqual({ command: 'pnpm', args: ['exec', 'storybook', 'dev'] })
    expect(storybookCommandOf('npm', ['dev'], false)).toEqual({ command: 'npx', args: ['storybook', 'dev'] })
    expect(storybookCommandOf('bun', [], false)).toEqual({ command: 'bunx', args: ['storybook'] })
  })

  it("runs the storybook binary under Yarn so a script named storybook can't shadow it", () => {
    expect(storybookCommandOf('yarn', ['dev'], true)).toEqual({ command: 'yarn', args: ['exec', 'storybook', 'dev'] })
    expect(storybookCommandOf('yarn', ['dev'], false)).toEqual({
      command: 'npx',
      args: ['--no-install', 'storybook', 'dev'],
    })
  })

  it('runs a command in a folder, going into it from another', () => {
    expect(commandInFolderOf('/p', '/p', 'pnpm run sb')).toBe('pnpm run sb')
    expect(commandInFolderOf('/p', '/p/packages/ui', 'pnpm run sb')).toBe('cd packages/ui && pnpm run sb')
    expect(commandInFolderOf('/p/apps/web', '/p/packages/ui', 'pnpm run sb')).toBe(
      'cd ../../packages/ui && pnpm run sb',
    )
  })

  it('shows a command line with single spaces', () => {
    expect(commandLineOf({ command: 'pnpm', args: ['add', '--save-dev', 'a@1'] })).toBe('pnpm add --save-dev a@1')
    expect(commandLineOf({ command: 'pnpm', args: [] })).toBe('pnpm')
  })

  it.each<[PackageManager, string, string]>([
    ['npm', 'npm install --save-dev --save-exact a@1 b@2', 'npm install --save-dev a@1 b@2'],
    ['pnpm', 'pnpm add --save-dev --save-exact a@1 b@2', 'pnpm add --save-dev a@1 b@2'],
    ['yarn', 'yarn add --dev --exact a@1 b@2', 'yarn add --dev a@1 b@2'],
    ['bun', 'bun add --dev --exact a@1 b@2', 'bun add --dev a@1 b@2'],
  ])('adds dev dependencies under %s, exact or not', (packageManager, exact, ranged) => {
    expect(commandLineOf(addDevDependenciesCommandOf(packageManager, ['a@1', 'b@2'], { exact: true }))).toBe(exact)
    expect(commandLineOf(addDevDependenciesCommandOf(packageManager, ['a@1', 'b@2'], { exact: false }))).toBe(ranged)
  })

  it.each<[PackageManager, AddOptions, string]>([
    ['pnpm', { exact: true, workspaceRoot: true }, 'pnpm add --save-dev --save-exact -w a@1'],
    ['pnpm', { exact: false, workspaceRoot: true }, 'pnpm add --save-dev -w a@1'],
    ['yarn', { exact: true, workspaceRoot: true }, 'yarn add --dev --exact -W a@1'],
    ['yarn', { exact: false, workspaceRoot: true }, 'yarn add --dev -W a@1'],
    ['yarn', { exact: true, workspaceRoot: true, yarnBerry: true }, 'yarn add --dev --exact a@1'],
    ['npm', { exact: true, workspaceRoot: true }, 'npm install --save-dev --save-exact a@1'],
    ['bun', { exact: true, workspaceRoot: true }, 'bun add --dev --exact a@1'],
    [
      'npm',
      { exact: true, npmWorkspace: 'packages/ui' },
      'npm install --save-dev --save-exact --workspace packages/ui a@1',
    ],
    ['pnpm', { exact: true, npmWorkspace: 'packages/ui' }, 'pnpm add --save-dev --save-exact a@1'],
  ])('adds the flags %s takes for %j', (packageManager, options, command) => {
    expect(commandLineOf(addDevDependenciesCommandOf(packageManager, ['a@1'], options))).toBe(command)
  })
})

describe('nonEmptyTextOf', () => {
  it('gives text that is not empty, else undefined', () => {
    expect(nonEmptyTextOf('web')).toBe('web')
    expect(nonEmptyTextOf('')).toBeUndefined()
    expect(nonEmptyTextOf(7)).toBeUndefined()
    expect(nonEmptyTextOf(undefined)).toBeUndefined()
  })
})

describe('nxCommandOf', () => {
  it.each([
    ['pnpm', false, 'pnpm exec nx run ui:storybook'],
    ['npm', false, 'npx nx run ui:storybook'],
    ['yarn', false, 'npx --no-install nx run ui:storybook'],
    ['yarn', true, 'yarn exec nx run ui:storybook'],
    ['bun', false, 'bunx nx run ui:storybook'],
  ] as const)('runs nx under %s, Yarn 2 or later: %s', (packageManager, yarnBerry, command) => {
    expect(commandLineOf(nxCommandOf(packageManager, ['run', 'ui:storybook'], yarnBerry))).toBe(command)
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

describe('listsDependency', () => {
  it('finds a name in each dependency field', () => {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      expect(listsDependency({ [field]: { left: '1.0.0' } }, 'left')).toBe(true)
    }
  })

  it('does not find a name that is not listed', () => {
    expect(listsDependency({ dependencies: { left: '1.0.0' } }, 'right')).toBe(false)
    expect(listsDependency({}, 'left')).toBe(false)
  })

  it('ignores a field that is not an object', () => {
    expect(listsDependency({ dependencies: ['left'], devDependencies: 'left' }, 'left')).toBe(false)
  })

  it('does not find an inherited property', () => {
    expect(listsDependency({ dependencies: {} }, 'toString')).toBe(false)
  })
})

describe('yarnBerryOf', () => {
  it('counts a .yarnrc.yml', () => {
    expect(yarnBerryOf({}, true)).toBe(true)
  })

  it.each([
    ['yarn@4.1.0', true],
    ['yarn@2.0.0+sha512.abc', true],
    ['yarn@1.22.22', false],
    ['yarn', false],
    ['pnpm@9.12.3', false],
  ])('reads packageManager %s', (packageManager, expected) => {
    expect(yarnBerryOf({ packageManager }, false)).toBe(expected)
  })

  it.each([
    [{ name: 'yarn', version: '^4.1.0' }, true],
    [
      [
        { name: 'pnpm', version: '9' },
        { name: 'yarn', version: '>=2' },
      ],
      true,
    ],
    [{ name: 'yarn', version: '1.x' }, false],
    [{ name: 'yarn' }, false],
    [{ name: 'npm', version: '10' }, false],
  ])('reads devEngines.packageManager %j', (packageManager, expected) => {
    expect(yarnBerryOf({ devEngines: { packageManager } }, false)).toBe(expected)
  })

  it('returns false when nothing shows Yarn 2 or later', () => {
    expect(yarnBerryOf({ packageManager: 7, devEngines: 'yarn@4' }, false)).toBe(false)
  })
})

describe('nodeLinkerOf', () => {
  it.each([
    ['nodeLinker: node-modules\n', 'node-modules'],
    ['yarnPath: .yarn/releases/yarn.cjs\nnodeLinker: "pnp" # the default\n', 'pnp'],
    ["nodeLinker: 'pnpm'", 'pnpm'],
  ])('reads %j', (yarnrc, expected) => {
    expect(nodeLinkerOf(yarnrc)).toBe(expected)
  })

  it.each(['', 'yarnPath: .yarn/releases/yarn.cjs\n', 'packageExtensions:\n  nodeLinker: pnp\n'])(
    'gives undefined without a top-level nodeLinker in %j',
    (yarnrc) => {
      expect(nodeLinkerOf(yarnrc)).toBeUndefined()
    },
  )
})

describe('yarnPnpOf', () => {
  const clues = { hasPnpFile: false, nodeLinker: undefined, yarnBerry: true, hasNodeModules: true }

  it('follows a nodeLinker that is set, whatever the files', () => {
    expect(yarnPnpOf({ ...clues, nodeLinker: 'pnp' })).toBe(true)
    expect(yarnPnpOf({ ...clues, nodeLinker: 'node-modules', hasPnpFile: true, hasNodeModules: false })).toBe(false)
    expect(yarnPnpOf({ ...clues, nodeLinker: 'pnpm', hasNodeModules: false })).toBe(false)
  })

  it("counts Plug'n'Play's loader file", () => {
    expect(yarnPnpOf({ ...clues, hasPnpFile: true })).toBe(true)
  })

  it("takes Yarn 2 or later's default, Plug'n'Play, when no node_modules folder shows otherwise", () => {
    expect(yarnPnpOf({ ...clues, hasNodeModules: false })).toBe(true)
    expect(yarnPnpOf(clues)).toBe(false)
  })

  it('never counts Yarn 1 without the loader file', () => {
    expect(yarnPnpOf({ ...clues, yarnBerry: false, hasNodeModules: false })).toBe(false)
  })
})

describe('rushPackageManagerOf', () => {
  it.each([
    [{ pnpmVersion: '9.12.3' }, 'pnpm'],
    [{ npmVersion: '10.0.0' }, 'npm'],
    [{ yarnVersion: '1.22.22' }, 'yarn'],
  ])('reads %j', (rush, expected) => {
    expect(rushPackageManagerOf(rush)).toBe(expected)
  })

  it.each([{}, { pnpmVersion: 9 }, null, []])('returns undefined for %j', (rush) => {
    expect(rushPackageManagerOf(rush)).toBeUndefined()
  })
})
