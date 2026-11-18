import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listProjectFiles } from './find-storybooks.js'
import { makeProject, removeProjects } from './project.fixture.js'
import { findWorkspace, workspaceLayoutOf } from './workspace.js'

afterEach(removeProjects)

/**
 * Turns files, each a path relative to the root mapped to its content, into what `workspaceLayoutOf` takes: the listed
 * paths and a reader that gives a file's content, or `undefined` for none.
 */
function inMemory(files: Record<string, string>): [string[], (path: string) => string | undefined] {
  return [Object.keys(files), (path) => files[path]]
}

/**
 * A `package.json` with `fields`, written as JSON.
 */
function manifest(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ name: 'x', ...fields })
}

describe('workspaceLayoutOf', () => {
  it('reads a block list in pnpm-workspace.yaml', () => {
    expect(
      workspaceLayoutOf(
        ...inMemory({
          'package.json': manifest(),
          'pnpm-workspace.yaml': '# the packages\npackages:\n  - \'apps/*\'\n  - "libs/*" # shared\n  - tools/cli\n',
          'apps/web/package.json': manifest(),
          'apps/docs/package.json': manifest(),
          'libs/ui/package.json': manifest(),
          'tools/cli/package.json': manifest(),
          'tools/other/package.json': manifest(),
          'apps/web/src/a.ts': '',
        }),
      ),
    ).toEqual({ kind: 'pnpm', packageDirs: ['.', 'apps/docs', 'apps/web', 'libs/ui', 'tools/cli'] })
  })

  it.each([
    ['a block list at the key’s indent', 'packages:\n- apps/*\n- libs/*\nonlyBuilt: []\n'],
    ['a flow list with a comment', "packages: [apps/*, 'libs/*'] # not 'tools/*', ]\n"],
    ['a flow list over several lines', 'packages: [\n  "apps/*",\n  libs/*,\n]\n'],
  ])('reads %s in pnpm-workspace.yaml', (_, yaml) => {
    const files = {
      'pnpm-workspace.yaml': yaml,
      'apps/web/package.json': manifest(),
      'libs/ui/package.json': manifest(),
      'tools/cli/package.json': manifest(),
    }

    expect(workspaceLayoutOf(...inMemory(files))).toEqual({ kind: 'pnpm', packageDirs: ['apps/web', 'libs/ui'] })
  })

  it.each([
    ['a scalar', 'packages: apps/*\n'],
    ['an unclosed flow list', 'packages: [apps/*\n'],
  ])('makes a pnpm workspace whose packages is %s one package, the root', (_, yaml) => {
    const files = { 'package.json': manifest(), 'pnpm-workspace.yaml': yaml, 'apps/web/package.json': manifest() }

    expect(workspaceLayoutOf(...inMemory(files))).toEqual({ kind: 'pnpm', packageDirs: ['.'] })
  })

  it('matches the base folder of a ** glob, and its exclude', () => {
    const files = {
      'apps/package.json': manifest(),
      'apps/web/package.json': manifest(),
      'libs/package.json': manifest(),
      'libs/ui/package.json': manifest(),
    }

    expect(
      workspaceLayoutOf(...inMemory({ ...files, 'pnpm-workspace.yaml': 'packages: [apps/**, libs/**, "!libs/**"]' })),
    ).toEqual({ kind: 'pnpm', packageDirs: ['apps', 'apps/web'] })
  })

  it('reads \\ in globs as /', () => {
    const files = {
      'package.json': manifest({ workspaces: ['apps\\*', '!apps\\legacy'] }),
      'apps/web/package.json': manifest(),
      'apps/legacy/package.json': manifest(),
    }

    expect(workspaceLayoutOf(...inMemory(files))?.packageDirs).toEqual(['.', 'apps/web'])
  })

  it('leaves out the folders a ! glob excludes', () => {
    expect(
      workspaceLayoutOf(
        ...inMemory({
          'pnpm-workspace.yaml': "packages:\n  - 'packages/**'\n  - '!packages/**/test/**'\n",
          'packages/a/package.json': manifest(),
          'packages/a/test/fixture/package.json': manifest(),
          'packages/group/b/package.json': manifest(),
        }),
      )?.packageDirs,
    ).toEqual(['packages/a', 'packages/group/b'])
  })

  it('makes a pnpm workspace without packages one package, the root', () => {
    expect(
      workspaceLayoutOf(
        ...inMemory({
          'package.json': manifest(),
          'pnpm-workspace.yaml': 'onlyBuiltDependencies:\n  - esbuild\n',
          'apps/web/package.json': manifest(),
        }),
      ),
    ).toEqual({ kind: 'pnpm', packageDirs: ['.'] })
  })

  it.each([
    ['npm and Yarn', ['packages/*']],
    ['Yarn 1', { packages: ['packages/*'], nohoist: ['**/react'] }],
  ])('reads the %s form of package.json#workspaces', (_, workspaces) => {
    expect(
      workspaceLayoutOf(
        ...inMemory({
          'package.json': manifest({ workspaces }),
          'packages/a/package.json': manifest(),
          'packages/b/package.json': manifest(),
          'docs/package.json': manifest(),
        }),
      ),
    ).toEqual({ kind: 'workspaces', packageDirs: ['.', 'packages/a', 'packages/b'] })
  })

  it('reads a Bun workspace, which is package.json#workspaces', () => {
    expect(
      workspaceLayoutOf(
        ...inMemory({
          'package.json': manifest({ workspaces: ['apps/*', '!apps/legacy'] }),
          'bun.lock': '',
          'apps/web/package.json': manifest(),
          'apps/legacy/package.json': manifest(),
        }),
      ),
    ).toEqual({ kind: 'workspaces', packageDirs: ['.', 'apps/web'] })
  })

  it('ignores a workspaces field of the wrong type and a package.json that is not JSON', () => {
    expect(
      workspaceLayoutOf(...inMemory({ 'package.json': manifest({ workspaces: 'packages/*' }) }))?.kind,
    ).toBeUndefined()
    expect(
      workspaceLayoutOf(...inMemory({ 'package.json': manifest({ workspaces: { packages: 'x' } }) }))?.kind,
    ).toBeUndefined()
    expect(workspaceLayoutOf(...inMemory({ 'package.json': '{' }))?.kind).toBeUndefined()
    expect(workspaceLayoutOf(...inMemory({}))?.kind).toBeUndefined()
  })

  it('reads lerna.json#packages', () => {
    expect(
      workspaceLayoutOf(
        ...inMemory({
          'package.json': manifest({ workspaces: ['packages/*'] }),
          'lerna.json': JSON.stringify({ packages: ['modules/*'] }),
          'modules/a/package.json': manifest(),
          'packages/b/package.json': manifest(),
        }),
      ),
    ).toEqual({ kind: 'lerna', packageDirs: ['.', 'modules/a'] })
  })

  it('takes the package manager’s workspaces for a lerna.json without packages', () => {
    expect(
      workspaceLayoutOf(
        ...inMemory({
          'package.json': manifest({ workspaces: ['modules/*'] }),
          'lerna.json': JSON.stringify({ version: 'independent' }),
          'modules/a/package.json': manifest(),
          'packages/b/package.json': manifest(),
        }),
      )?.packageDirs,
    ).toEqual(['.', 'modules/a'])
    expect(
      workspaceLayoutOf(
        ...inMemory({
          'lerna.json': '{}',
          'pnpm-workspace.yaml': 'packages:\n  - modules/*\n',
          'modules/a/package.json': manifest(),
          'packages/b/package.json': manifest(),
        }),
      )?.packageDirs,
    ).toEqual(['modules/a'])
  })

  it('takes the package manager’s workspaces for a lerna.json that is not JSON', () => {
    const files = {
      'package.json': manifest({ workspaces: ['modules/*'] }),
      'lerna.json': '{ "packages": [',
      'modules/a/package.json': manifest(),
      'packages/b/package.json': manifest(),
    }

    expect(workspaceLayoutOf(...inMemory(files))).toEqual({ kind: 'lerna', packageDirs: ['.', 'modules/a'] })
  })

  it('takes package.json#workspaces for lerna when pnpm-workspace.yaml has no packages', () => {
    expect(
      workspaceLayoutOf(
        ...inMemory({
          'package.json': manifest({ workspaces: ['modules/*'] }),
          'lerna.json': '{}',
          'pnpm-workspace.yaml': 'onlyBuiltDependencies:\n  - esbuild\n',
          'modules/a/package.json': manifest(),
          'packages/b/package.json': manifest(),
        }),
      )?.packageDirs,
    ).toEqual(['.', 'modules/a'])
  })

  it('takes packages/* for a lerna.json without packages nor workspaces', () => {
    expect(
      workspaceLayoutOf(
        ...inMemory({
          'package.json': manifest(),
          'lerna.json': '{}',
          'modules/a/package.json': manifest(),
          'packages/b/package.json': manifest(),
        }),
      ),
    ).toEqual({ kind: 'lerna', packageDirs: ['.', 'packages/b'] })
  })

  it('reads every Nx project.json and the package manager’s workspaces', () => {
    expect(
      workspaceLayoutOf(
        ...inMemory({
          'package.json': manifest({ workspaces: ['packages/*'] }),
          'nx.json': '{}',
          'apps/web/project.json': '{}',
          'libs/deep/ui/project.json': '{}',
          'packages/a/package.json': manifest(),
          'tools/package.json': manifest(),
        }),
      ),
    ).toEqual({ kind: 'nx', packageDirs: ['.', 'apps/web', 'libs/deep/ui', 'packages/a'] })
  })

  it('adds lerna.json’s packages beside nx.json to the project.json folders and workspaces', () => {
    expect(
      workspaceLayoutOf(
        ...inMemory({
          'package.json': manifest({ workspaces: ['packages/*'] }),
          'nx.json': '{}',
          'lerna.json': JSON.stringify({ packages: ['modules/*'] }),
          'apps/web/project.json': '{}',
          'packages/a/package.json': manifest(),
          'modules/b/package.json': manifest(),
          'tools/package.json': manifest(),
        }),
      ),
    ).toEqual({ kind: 'nx', packageDirs: ['.', 'apps/web', 'modules/b', 'packages/a'] })
  })

  it('takes Lerna’s packages/* beside nx.json only without lerna packages nor workspaces', () => {
    const files = {
      'nx.json': '{}',
      'lerna.json': '{}',
      'apps/web/project.json': '{}',
      'packages/a/package.json': manifest(),
      'modules/b/package.json': manifest(),
    }

    expect(workspaceLayoutOf(...inMemory(files))?.packageDirs).toEqual(['apps/web', 'packages/a'])
    expect(
      workspaceLayoutOf(...inMemory({ ...files, 'package.json': manifest({ workspaces: ['modules/*'] }) }))
        ?.packageDirs,
    ).toEqual(['.', 'apps/web', 'modules/b'])
  })

  it('reads rush.json with comments and trailing commas', () => {
    const rush = `{
      // The Rush version, "// not a comment"
      "rushVersion": "5.120.0",
      "pnpmVersion": "9.12.3", /* the package manager */
      "projects": [
        { "packageName": "web // \\"x\\", ]", "projectFolder": "apps/web", },
        { "packageName": "ui", "projectFolder": "./libs/ui/" },
        { "packageName": "broken" },
        { "packageName": "root", "projectFolder": "." },
        { "packageName": "empty", "projectFolder": "" },
        { "packageName": "outside", "projectFolder": "../other" },
        { "packageName": "absolute", "projectFolder": "/srv/app" },
      ],
    }`

    expect(workspaceLayoutOf(...inMemory({ 'rush.json': rush, 'common/config/rush/pnpm-config.json': '{}' }))).toEqual({
      kind: 'rush',
      packageDirs: ['apps/web', 'libs/ui'],
    })
  })

  it('ignores a rush.json that is not JSON', () => {
    expect(workspaceLayoutOf(...inMemory({ 'rush.json': '{ "projects": [' }))).toEqual({
      kind: 'rush',
      packageDirs: [],
    })
  })

  it('reads a Turbo repo as the package manager’s workspaces', () => {
    const files = {
      'package.json': manifest({ workspaces: ['apps/*'] }),
      'apps/web/package.json': manifest(),
    }

    expect(workspaceLayoutOf(...inMemory({ ...files, 'turbo.json': '{}' }))).toEqual(
      workspaceLayoutOf(...inMemory(files)),
    )
    expect(workspaceLayoutOf(...inMemory({ 'package.json': manifest(), 'turbo.json': '{}' }))?.kind).toBeUndefined()
  })

  it.each([
    [['rush.json', 'nx.json', 'lerna.json', 'pnpm-workspace.yaml', 'package.json'], 'rush'],
    [['nx.json', 'lerna.json', 'pnpm-workspace.yaml', 'package.json'], 'nx'],
    [['lerna.json', 'pnpm-workspace.yaml', 'package.json'], 'lerna'],
    [['pnpm-workspace.yaml', 'package.json'], 'pnpm'],
    [['package.json'], 'workspaces'],
  ])('reads %j as %s', (markers, kind) => {
    const files = Object.fromEntries(
      markers.map((name) => [name, name === 'package.json' ? manifest({ workspaces: [] }) : '{}']),
    )

    expect(workspaceLayoutOf(...inMemory(files))?.kind).toBe(kind)
  })

  it('skips folders in node_modules and reads ./ and trailing / in globs', () => {
    const files = {
      'package.json': manifest({ workspaces: ['./packages/**/'] }),
      'packages/a/package.json': manifest(),
      'packages/a/node_modules/dep/package.json': manifest(),
    }

    expect(workspaceLayoutOf(...inMemory(files))?.packageDirs).toEqual(['.', 'packages/a'])
  })
})

describe('findWorkspace', () => {
  /**
   * A pnpm workspace with packages in `apps/*`, a root `package.json` and a folder outside its packages.
   */
  function pnpmWorkspace(): string {
    return makeProject({
      manifest: { name: 'root', private: true },
      files: {
        'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
        'apps/web/package.json': manifest(),
        'apps/web/src/deep/a.ts': '',
        'examples/demo/package.json': manifest(),
        'examples/demo/src/a.ts': '',
        'docs/guide.md': '',
      },
    })
  }

  it('finds the workspace from its root', async () => {
    const root = pnpmWorkspace()

    expect(await findWorkspace(root, listProjectFiles)).toEqual({
      root,
      kind: 'pnpm',
      packageDirs: ['.', 'apps/web'],
      files: expect.any(Array),
      packageManager: undefined,
      yarnBerry: false,
    })
  })

  it('gives the root’s listed files', async () => {
    const root = pnpmWorkspace()

    expect((await findWorkspace(join(root, 'apps/web'), listProjectFiles))?.files.toSorted()).toEqual([
      'apps/web/package.json',
      'apps/web/src/deep/a.ts',
      'docs/guide.md',
      'examples/demo/package.json',
      'examples/demo/src/a.ts',
      'package.json',
      'pnpm-workspace.yaml',
    ])
    expect((await findWorkspace(join(root, 'examples/demo'), listProjectFiles))?.files.toSorted()).toEqual([
      'package.json',
      'src/a.ts',
    ])
  })

  it.each([
    [{ '.yarnrc.yml': 'nodeLinker: node-modules\n' }, {}],
    [{}, { packageManager: 'yarn@4.1.0' }],
    [
      { 'pnpm-workspace.yaml': 'packages:\n  - apps/*\n' },
      { devEngines: { packageManager: { name: 'yarn', version: '4' } } },
    ],
  ])('reads Yarn 2 or later at the root from %j and %j', async (files, fields) => {
    const root = makeProject({
      manifest: { name: 'root', workspaces: ['apps/*'], ...fields },
      files: { ...files, 'apps/web/package.json': '{}' },
    })

    expect((await findWorkspace(join(root, 'apps/web'), listProjectFiles))?.yarnBerry).toBe(true)
  })

  it('finds the root from a folder inside a package', async () => {
    const root = pnpmWorkspace()

    expect((await findWorkspace(join(root, 'apps/web/src/deep'), listProjectFiles))?.root).toBe(root)
  })

  it('finds the root from a folder in no package', async () => {
    const root = pnpmWorkspace()

    expect((await findWorkspace(join(root, 'docs'), listProjectFiles))?.root).toBe(root)
  })

  it('takes the nearest package.json for a package outside the workspace’s packages', async () => {
    const root = pnpmWorkspace()

    expect(await findWorkspace(join(root, 'examples/demo/src'), listProjectFiles)).toEqual({
      root: join(root, 'examples/demo'),
      kind: 'single',
      packageDirs: ['.'],
      files: expect.any(Array),
      packageManager: undefined,
      yarnBerry: false,
    })
  })

  it('finds a Rush root, which has no package.json, from a project, with its package manager', async () => {
    const root = makeProject({
      files: {
        'rush.json': '{ "yarnVersion": "1.22.22", "projects": [{ "projectFolder": "apps/web" }], }',
        'apps/web/package.json': manifest(),
        'tools/a.ts': '',
      },
    })

    expect(await findWorkspace(join(root, 'apps/web'), listProjectFiles)).toEqual({
      root,
      kind: 'rush',
      packageDirs: ['apps/web'],
      files: expect.any(Array),
      packageManager: 'yarn',
      yarnBerry: false,
    })
    expect((await findWorkspace(join(root, 'tools'), listProjectFiles))?.root).toBe(root)
  })

  it('finds a single package from a subfolder', async () => {
    const root = makeProject({ manifest: { name: 'app' }, files: { 'src/deep/a.ts': '' } })

    expect(await findWorkspace(join(root, 'src/deep'), listProjectFiles)).toEqual({
      root,
      kind: 'single',
      packageDirs: ['.'],
      files: expect.any(Array),
      packageManager: undefined,
      yarnBerry: false,
    })
  })

  it('returns undefined without a package.json or a workspace up to the repo root', async () => {
    const root = makeProject({ files: { 'src/a.ts': '' } })

    expect(await findWorkspace(join(root, 'src'), listProjectFiles)).toBeUndefined()
  })

  it.each([
    ['folder', { 'inner/.git/HEAD': '' }],
    ['file of a worktree or a submodule', { 'inner/.git': 'gitdir: ../.git/worktrees/inner\n' }],
  ])('does not look above a .git %s', async (_, files) => {
    const outer = makeProject({ manifest: { workspaces: ['*'] }, git: false, files })

    expect(await findWorkspace(join(outer, 'inner'), listProjectFiles)).toBeUndefined()
  })

  it('goes on to an outer workspace when an inner one doesn’t list the package', async () => {
    const root = makeProject({
      manifest: { name: 'root' },
      files: {
        'pnpm-workspace.yaml': 'packages:\n  - apps/nested/tools/*\n',
        'apps/nested/package.json': manifest({ workspaces: ['libs/*'] }),
        'apps/nested/libs/ui/package.json': manifest(),
        'apps/nested/tools/cli/package.json': manifest(),
      },
    })

    expect((await findWorkspace(join(root, 'apps/nested/tools/cli'), listProjectFiles))?.root).toBe(root)
    expect((await findWorkspace(join(root, 'apps/nested/libs/ui'), listProjectFiles))?.root).toBe(
      join(root, 'apps/nested'),
    )
  })

  it('reads pnpm-workspace.yaml and package.json that start with a byte order mark', async () => {
    const root = makeProject({
      manifest: `\uFEFF${JSON.stringify({ name: 'root', packageManager: 'yarn@4.1.0' })}`,
      files: { 'pnpm-workspace.yaml': '\uFEFFpackages:\n  - apps/*\n', 'apps/web/package.json': manifest() },
    })

    expect(await findWorkspace(join(root, 'apps/web'), listProjectFiles)).toMatchObject({
      root,
      kind: 'pnpm',
      packageDirs: ['.', 'apps/web'],
      yarnBerry: true,
    })
  })
})
