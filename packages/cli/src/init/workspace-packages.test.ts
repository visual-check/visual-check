import { afterEach, describe, expect, it } from 'vitest'
import { makeProject, removeProjects } from './project.fixture.js'
import {
  nestedWorkspaceOf,
  packageOf,
  packageRelativeOf,
  packagesOf,
  rootRelativeCallOf,
  type WorkspacePackage,
} from './workspace-packages.js'

afterEach(removeProjects)

/**
 * Builds a package in `dir` with no Storybook calls, holding a readable `package.json` unless `hasManifest` is false.
 */
function packageIn(dir: string, hasManifest = true): WorkspacePackage {
  return { dir, hasManifest, manifest: {}, manifestProblem: undefined, calls: [] }
}

describe('packagesOf', () => {
  it('reads each package, the root first, with its calls relative to it', () => {
    const root = makeProject({
      manifest: { name: 'acme' },
      files: {
        'packages/ui/package.json': '\uFEFF{"name":"ui","scripts":{"sb":"storybook dev -c .sb -p 6100"}}',
        'libs/nx/project.json': '{}',
      },
    })

    const { rootPackage, packages } = packagesOf(root, ['packages/ui', 'libs/nx'])

    expect(rootPackage).toEqual({
      dir: '.',
      hasManifest: true,
      manifest: { name: 'acme' },
      manifestProblem: undefined,
      calls: [],
    })
    expect(packages).toEqual([
      rootPackage,
      {
        dir: 'packages/ui',
        hasManifest: true,
        manifest: { name: 'ui', scripts: { sb: 'storybook dev -c .sb -p 6100' } },
        manifestProblem: undefined,
        calls: [{ script: 'sb', subcommand: 'dev', configDir: '.sb', port: 6100 }],
      },
      { dir: 'libs/nx', hasManifest: false, manifest: {}, manifestProblem: undefined, calls: [] },
    ])
  })

  it.each([
    ['not JSON', '{ nope', expect.any(String)],
    ['not an object', '[1]', 'the file must hold a JSON object'],
    ['scripts that are not an object', '{"scripts":"x"}', '"scripts" must be an object'],
  ])("reports a package's package.json that is %s", (_, content, problem) => {
    const root = makeProject({ manifest: {}, files: { 'packages/ui/package.json': content } })

    const [, ui] = packagesOf(root, ['packages/ui']).packages

    expect(ui).toMatchObject({ hasManifest: true, manifest: {}, manifestProblem: problem })
  })

  it('makes the root a package without a package.json', () => {
    const root = makeProject({ files: { 'rush.json': '{}' } })

    expect(packagesOf(root, []).rootPackage).toMatchObject({ dir: '.', hasManifest: false, manifestProblem: undefined })
  })
})

describe('packageOf', () => {
  const rootPackage = packageIn('.')
  const packages = [rootPackage, packageIn('packages/ui'), packageIn('packages/ui/nested', false), packageIn('ui')]

  it('gives the deepest package holding a folder', () => {
    expect(packageOf(packages, rootPackage, 'packages/ui/nested/.storybook').dir).toBe('packages/ui/nested')
    expect(packageOf(packages, rootPackage, 'packages/ui/.storybook').dir).toBe('packages/ui')
    expect(packageOf(packages, rootPackage, 'packages/ui').dir).toBe('packages/ui')
  })

  it('gives the root for a folder outside every package, or one only sharing a prefix', () => {
    expect(packageOf(packages, rootPackage, 'docs/.storybook')).toBe(rootPackage)
    expect(packageOf(packages, rootPackage, 'packages/ui-kit/.storybook')).toBe(rootPackage)
  })

  it('skips the packages it is told to', () => {
    const withManifest = (workspacePackage: WorkspacePackage) => workspacePackage.hasManifest

    expect(packageOf(packages, rootPackage, 'packages/ui/nested/.storybook', withManifest).dir).toBe('packages/ui')
    expect(packageOf([packageIn('.', false)], rootPackage, '.storybook', withManifest)).toBe(rootPackage)
  })
})

describe('packageRelativeOf', () => {
  it('gives a folder relative to the package, . for the package itself', () => {
    expect(packageRelativeOf('packages/ui', 'packages/ui/.storybook')).toBe('.storybook')
    expect(packageRelativeOf('packages/ui', 'packages/ui')).toBe('.')
    expect(packageRelativeOf('.', 'docs/.storybook')).toBe('docs/.storybook')
  })
})

describe('rootRelativeCallOf', () => {
  /**
   * A `storybook dev` call of the script `sb` with the config folder `configDir`.
   */
  function callOf(configDir: string | undefined) {
    return { script: 'sb', subcommand: 'dev' as const, configDir, port: undefined }
  }

  it.each([
    [undefined, 'packages/ui/.storybook'],
    ['.sb', 'packages/ui/.sb'],
    ['.', 'packages/ui'],
    ['../shared/.storybook', 'packages/shared/.storybook'],
    ['/abs/.storybook', '/abs/.storybook'],
    ['C:/sb', 'C:/sb'],
  ])('makes -c %s of packages/ui relative to the root', (configDir, rootRelative) => {
    expect(rootRelativeCallOf('packages/ui', callOf(configDir))).toEqual(callOf(rootRelative))
  })
})

describe('nestedWorkspaceOf', () => {
  it('finds the outermost folder below the root with a lockfile', () => {
    const root = makeProject({
      files: { 'examples/yarn.lock': '', 'examples/demo/package-lock.json': '', 'package-lock.json': '' },
    })

    expect(nestedWorkspaceOf(root, 'examples/demo/.storybook', [])).toBe('examples')
    expect(nestedWorkspaceOf(root, '.storybook', [])).toBeUndefined()
    expect(nestedWorkspaceOf(root, 'docs/.storybook', [])).toBeUndefined()
  })

  it('takes no package of the workspace as a nested one', () => {
    const root = makeProject({ files: { 'packages/ui/pnpm-lock.yaml': '' } })

    expect(nestedWorkspaceOf(root, 'packages/ui/.storybook', ['.', 'packages/ui'])).toBeUndefined()
  })
})
