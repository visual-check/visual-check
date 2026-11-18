import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectProject } from './detect-project.js'
import { listProjectFiles } from './find-storybooks.js'
import { portOfStart } from './storybook-start.js'

/**
 * The temporary folders the tests made, removed after each test.
 */
const temporaryFolders: string[] = []

/**
 * Makes a temporary git repo holding `files`, each a path relative to the folder mapped to its content, and returns
 * the folder's real path.
 */
function createProject(files: Record<string, string>, git = true): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-detect-')))

  temporaryFolders.push(root)

  if (git) {
    execFileSync('git', ['init', '-q'], { cwd: root })
  } else {
    vi.stubEnv('GIT_CEILING_DIRECTORIES', dirname(root))
  }

  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }

  return root
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const folder of temporaryFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

describe('detectProject', () => {
  it('finds the root from a subfolder', async () => {
    const root = createProject({ 'package.json': '{"name":"app"}', 'src/deep/a.ts': '' })

    const project = await detectProject(join(root, 'src/deep'), listProjectFiles)

    expect(project?.root).toBe(root)
    expect(project?.manifestPath).toBe(join(root, 'package.json'))
    expect(project?.manifest.name).toBe('app')
  })

  it('returns undefined without a package.json up to the repo root', async () => {
    const root = createProject({ 'src/a.ts': '' })

    expect(await detectProject(join(root, 'src'), listProjectFiles)).toBeUndefined()
  })

  it('does not look above the repo root', async () => {
    const outer = createProject({ 'package.json': '{}' })
    const inner = join(outer, 'inner')

    mkdirSync(inner)
    execFileSync('git', ['init', '-q'], { cwd: inner })

    expect(await detectProject(inner, listProjectFiles)).toBeUndefined()
  })

  it('ignores a package.json folder and goes on up', async () => {
    const root = createProject({ 'package.json': '{}', 'sub/package.json/keep': '' })

    expect((await detectProject(join(root, 'sub'), listProjectFiles))?.root).toBe(root)
  })

  it('stops at a .git file', async () => {
    const root = createProject({ 'package.json': '{}', 'inner/.git': 'gitdir: ../elsewhere', 'inner/src/a.ts': '' })

    expect(await detectProject(join(root, 'inner/src'), async () => [])).toBeUndefined()
  })

  it('reports a package.json that is not JSON', async () => {
    const root = createProject({ 'package.json': '{ nope' })

    const project = await detectProject(root, listProjectFiles)

    expect(project?.manifest).toEqual({})
    expect(project?.manifestProblem).toEqual(expect.any(String))
  })

  it('reports a package.json that is not an object', async () => {
    const root = createProject({ 'package.json': '[1]' })

    const project = await detectProject(root, listProjectFiles)

    expect(project?.manifest).toEqual({})
    expect(project?.manifestProblem).toBe('the file must hold a JSON object')
  })

  it.each(['"nope"', '[]', 'null', '7'])('reports scripts that are not an object: %s', async (scripts) => {
    const root = createProject({ 'package.json': `{"scripts":${scripts}}` })

    const project = await detectProject(root, listProjectFiles)

    expect(project?.manifest).toEqual({})
    expect(project?.manifestProblem).toBe('"scripts" must be an object')
  })

  it('reports no problem for a good package.json', async () => {
    const root = createProject({ 'package.json': '{}' })

    expect((await detectProject(root, listProjectFiles))?.manifestProblem).toBeUndefined()
  })

  it('ignores scripts that are not text', async () => {
    const root = createProject({
      'package.json': JSON.stringify({ scripts: { storybook: 7, sb: 'storybook dev -p 6006' } }),
      '.storybook/main.ts': '',
    })

    const [storybook] = (await detectProject(root, listProjectFiles))?.storybooks ?? []

    expect(storybook?.start).toMatchObject({ kind: 'script', call: { script: 'sb' } })
  })

  it('finds a Storybook without git when a script runs it', async () => {
    const root = createProject(
      { 'package.json': JSON.stringify({ scripts: { storybook: 'storybook dev -p 6006' } }), '.storybook/main.ts': '' },
      false,
    )

    const project = await detectProject(root, listProjectFiles)

    expect(project?.storybooks.map((storybook) => storybook.configDir)).toEqual(['.storybook'])
    expect(portOfStart(project?.storybooks[0]?.start)).toBe(6006)
  })

  it('finds a -c folder on disk without git', async () => {
    const root = createProject(
      { 'package.json': JSON.stringify({ scripts: { sb: 'storybook dev -c docs/sb' } }), 'docs/sb/main.js': '' },
      false,
    )

    const project = await detectProject(root, listProjectFiles)

    expect(project?.storybooks.map((storybook) => [storybook.configDir, storybook.defaultName])).toEqual([
      ['docs/sb', 'sb'],
    ])
  })

  it('finds the project root as a config folder for -c .', async () => {
    const root = createProject({
      'package.json': JSON.stringify({ name: '@acme/web', scripts: { sb: 'storybook dev -c . -p 7000' } }),
      'main.ts': '',
    })

    const [storybook] = (await detectProject(root, listProjectFiles))?.storybooks ?? []

    expect(storybook).toMatchObject({ configDir: '.', defaultName: 'web' })
    expect(portOfStart(storybook?.start)).toBe(7000)
  })

  it('detects a Deno file', async () => {
    const root = createProject({ 'package.json': '{}', 'deno.jsonc': '{}' })

    expect((await detectProject(root, listProjectFiles))?.denoFile).toBe('deno.jsonc')
  })

  it('has no Deno file without one', async () => {
    const root = createProject({ 'package.json': '{}' })

    expect((await detectProject(root, listProjectFiles))?.denoFile).toBeUndefined()
  })

  it('reads the package manager from a lockfile', async () => {
    const root = createProject({ 'package.json': '{}', 'yarn.lock': '' })

    expect((await detectProject(root, listProjectFiles))?.packageManager).toBe('yarn')
  })

  it('has no package manager when nothing shows one', async () => {
    const root = createProject({ 'package.json': '{}' })

    expect((await detectProject(root, listProjectFiles))?.packageManager).toBeUndefined()
  })

  it('detects a Storybook with its start script, port and version', async () => {
    const root = createProject({
      'package.json': JSON.stringify({
        name: '@acme/web',
        scripts: { storybook: 'storybook dev -p 6007', test: 'vitest' },
      }),
      '.storybook/main.ts': '',
      'node_modules/storybook/package.json': '{"version":"10.1.2"}',
    })

    const project = await detectProject(root, listProjectFiles)

    expect(project?.storybooks).toEqual([
      {
        configDir: '.storybook',
        packageDir: root,
        manifestDir: root,
        manifest: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')),
        manifestProblem: undefined,
        packageName: '@acme/web',
        defaultName: 'web',
        start: {
          kind: 'script',
          call: { script: 'storybook', subcommand: 'dev', configDir: undefined, port: 6007 },
          packageDir: root,
        },
        version: '10.1.2',
      },
    ])
  })

  it('leaves the start script and version undefined when there are none', async () => {
    const root = createProject({ 'package.json': '{"name":"web"}', 'docs/.storybook/main.js': '' })

    const [storybook] = (await detectProject(root, listProjectFiles))?.storybooks ?? []

    expect(storybook).toMatchObject({ configDir: 'docs/.storybook', defaultName: 'docs', start: undefined })
    expect(storybook?.version).toBeUndefined()
  })

  it('finds no Storybook without a config', async () => {
    const root = createProject({ 'package.json': '{}' })

    expect((await detectProject(root, listProjectFiles))?.storybooks).toEqual([])
  })

  it('takes the file lister it is given', async () => {
    const root = createProject({ 'package.json': '{}' })

    const project = await detectProject(root, async () => ['x/.storybook/main.ts'])

    expect(project?.storybooks.map((storybook) => storybook.configDir)).toEqual(['x/.storybook'])
  })
})

/**
 * Writes `fields` as JSON, the way a `package.json` or `project.json` holds them.
 */
function json(fields: Record<string, unknown>): string {
  return JSON.stringify(fields)
}

/**
 * The files of a pnpm workspace with two packages, `packages/ui` (`@acme/ui`, storybook 10.1.0 installed in the
 * package) and `packages/web`, each with a `.storybook` its `storybook` script starts on its own port.
 */
const pnpmWorkspaceFiles = {
  'package.json': json({ name: 'acme', private: true, packageManager: 'pnpm@9.12.3' }),
  'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
  'packages/ui/package.json': json({ name: '@acme/ui', scripts: { storybook: 'storybook dev -p 6006' } }),
  'packages/ui/.storybook/main.ts': '',
  'packages/ui/node_modules/storybook/package.json': '{"version":"10.1.0"}',
  'packages/web/package.json': json({ name: 'web', scripts: { storybook: 'storybook dev -p 6007' } }),
  'packages/web/.storybook/main.ts': '',
}

describe('detectProject in a workspace', () => {
  it('finds each Storybook of a pnpm workspace with its package, start script and version', async () => {
    const root = createProject(pnpmWorkspaceFiles)

    const project = await detectProject(root, listProjectFiles)

    expect(project).toMatchObject({
      root,
      hasManifest: true,
      packageManager: 'pnpm',
      yarnBerry: false,
      workspace: { kind: 'pnpm', packageDirs: ['.', 'packages/ui', 'packages/web'] },
      notes: [],
    })
    expect(project?.storybooks).toEqual([
      {
        configDir: 'packages/ui/.storybook',
        packageDir: join(root, 'packages/ui'),
        manifestDir: join(root, 'packages/ui'),
        manifest: JSON.parse(pnpmWorkspaceFiles['packages/ui/package.json']),
        manifestProblem: undefined,
        packageName: '@acme/ui',
        defaultName: 'ui',
        start: {
          kind: 'script',
          call: { script: 'storybook', subcommand: 'dev', configDir: undefined, port: 6006 },
          packageDir: join(root, 'packages/ui'),
        },
        version: '10.1.0',
      },
      {
        configDir: 'packages/web/.storybook',
        packageDir: join(root, 'packages/web'),
        manifestDir: join(root, 'packages/web'),
        manifest: JSON.parse(pnpmWorkspaceFiles['packages/web/package.json']),
        manifestProblem: undefined,
        packageName: 'web',
        defaultName: 'web',
        start: {
          kind: 'script',
          call: { script: 'storybook', subcommand: 'dev', configDir: undefined, port: 6007 },
          packageDir: join(root, 'packages/web'),
        },
        version: undefined,
      },
    ])
  })

  it('works at the workspace root from inside a package, and says so first', async () => {
    const root = createProject({
      ...pnpmWorkspaceFiles,
      'examples/package-lock.json': '',
      'examples/.storybook/main.ts': '',
    })

    const project = await detectProject(join(root, 'packages/web'), listProjectFiles)

    expect(project?.root).toBe(root)
    expect(project?.notes).toEqual([
      'hint: init sets up the workspace at ../.., where the config goes.',
      "hint: init skips the Storybook in examples/.storybook: examples has its own lockfile, so it's a workspace of " +
        'its own. Run visual-check init there to set it up.',
    ])
  })

  it('says nothing about the root when run in a subfolder of a lone package', async () => {
    const root = createProject({ 'package.json': '{"name":"app"}', 'src/a.ts': '' })

    expect((await detectProject(join(root, 'src'), listProjectFiles))?.notes).toEqual([])
  })

  it('reads -c in a package script relative to the package, under npm workspaces', async () => {
    const root = createProject({
      'package.json': json({ name: 'acme', workspaces: ['apps/*'] }),
      'package-lock.json': '{}',
      'apps/docs/package.json': json({ name: 'docs', scripts: { sb: 'storybook dev -c ./.sb -p 7000' } }),
      'apps/docs/.sb/main.ts': '',
    })

    const project = await detectProject(root, async () => ['package.json', 'apps/docs/package.json'])

    expect(project?.packageManager).toBe('npm')
    expect(project?.workspace.kind).toBe('workspaces')
    expect(project?.storybooks).toMatchObject([
      {
        configDir: 'apps/docs/.sb',
        packageDir: join(root, 'apps/docs'),
        defaultName: 'sb',
        start: {
          kind: 'script',
          call: { script: 'sb', configDir: '.sb', port: 7000 },
          packageDir: join(root, 'apps/docs'),
        },
      },
    ])
  })

  it("starts a Storybook with a script that names its config folder before Nx's target", async () => {
    const root = createProject({
      'package.json': json({ name: 'acme' }),
      'nx.json': '{}',
      'libs/ui/package.json': json({ name: 'ui', scripts: { sb: 'storybook dev -p 6100' } }),
      'libs/ui/project.json': json({ targets: { storybook: { options: { port: 4400 } } } }),
      'libs/ui/.storybook/main.ts': '',
    })

    const [storybook] = (await detectProject(root, listProjectFiles))?.storybooks ?? []

    expect(storybook?.start).toMatchObject({ kind: 'script', call: { script: 'sb' } })
  })

  it("starts a Storybook with Nx's storybook target when no script does", async () => {
    const root = createProject({
      'package.json': json({ name: 'acme' }),
      'nx.json': '{}',
      'libs/ui/project.json': json({
        name: 'ui-lib',
        targets: { storybook: { options: { port: 4400, configDir: 'libs/ui/.storybook' } } },
      }),
      'libs/ui/.storybook/main.ts': '',
    })

    const project = await detectProject(root, listProjectFiles)

    expect(project?.workspace).toEqual({ kind: 'nx', packageDirs: ['.', 'libs/ui'] })
    expect(project?.storybooks).toMatchObject([
      {
        configDir: 'libs/ui/.storybook',
        packageDir: join(root, 'libs/ui'),
        manifestDir: root,
        manifest: { name: 'acme' },
        packageName: undefined,
        defaultName: 'ui-lib',
        start: { kind: 'nx', project: 'ui-lib', target: 'storybook', port: 4400 },
      },
    ])
  })

  it("reads a Rush workspace's packages and package manager, with no root package.json", async () => {
    const root = createProject({
      'rush.json':
        '// Rush\n{ "pnpmVersion": "9.0.0", "projects": [{ "packageName": "ui", "projectFolder": "libs/ui" }] }',
      'libs/ui/package.json': json({ name: 'ui', scripts: { storybook: 'storybook dev -p 6006' } }),
      'libs/ui/.storybook/main.ts': '',
    })

    const project = await detectProject(join(root, 'libs/ui'), listProjectFiles)

    expect(project).toMatchObject({
      root,
      hasManifest: false,
      manifest: {},
      manifestProblem: undefined,
      packageManager: 'pnpm',
      workspace: { kind: 'rush', packageDirs: ['libs/ui'] },
    })
    expect(project?.storybooks.map(({ configDir, defaultName }) => [configDir, defaultName])).toEqual([
      ['libs/ui/.storybook', 'ui'],
    ])
  })

  it('skips a Storybook under a folder with its own lockfile, with a note', async () => {
    const root = createProject({
      'package.json': json({ name: 'app' }),
      '.storybook/main.ts': '',
      'examples/demo/package.json': json({ name: 'demo' }),
      'examples/demo/yarn.lock': '',
      'examples/demo/.storybook/main.ts': '',
    })

    const project = await detectProject(root, listProjectFiles)

    expect(project?.storybooks.map(({ configDir }) => configDir)).toEqual(['.storybook'])
    expect(project?.notes).toEqual([
      "hint: init skips the Storybook in examples/demo/.storybook: examples/demo has its own lockfile, so it's a " +
        'workspace of its own. Run visual-check init there to set it up.',
    ])
  })

  it('matches a Storybook to the deepest package holding it, else the root', async () => {
    const root = createProject({
      'package.json': json({ name: '@acme/root', workspaces: ['packages/*', 'packages/ui/nested'] }),
      '.storybook/main.ts': '',
      'docs/.storybook/main.ts': '',
      'packages/ui/package.json': json({ name: '@acme/ui' }),
      'packages/ui/nested/package.json': json({ name: '@acme/nested' }),
      'packages/ui/nested/.storybook/main.ts': '',
    })

    const project = await detectProject(root, listProjectFiles)

    expect(project?.storybooks.map(({ configDir, packageDir }) => [configDir, packageDir])).toEqual([
      ['.storybook', root],
      ['docs/.storybook', root],
      ['packages/ui/nested/.storybook', join(root, 'packages/ui/nested')],
    ])
  })

  it('names each Storybook after its package, unique across the workspace', async () => {
    const root = createProject({
      'package.json': json({ name: 'ui', workspaces: ['a/*', 'b/*'] }),
      '.storybook/main.ts': '',
      'a/ui/package.json': json({ name: '@a/ui' }),
      'a/ui/.storybook/main.ts': '',
      'b/ui/package.json': json({ name: '@b/ui' }),
      'b/ui/.storybook/main.ts': '',
      'b/ui/docs/.storybook/main.ts': '',
    })

    const project = await detectProject(root, listProjectFiles)

    expect(project?.storybooks.map(({ configDir, defaultName }) => [configDir, defaultName])).toEqual([
      ['.storybook', 'ui'],
      ['a/ui/.storybook', 'ui-2'],
      ['b/ui/.storybook', 'ui-3'],
      ['b/ui/docs/.storybook', 'docs'],
    ])
  })

  it("names an Nx project's Storybook after the project, never the root package", async () => {
    const root = createProject({
      'package.json': json({ name: 'acme' }),
      'nx.json': '{}',
      'libs/ui/project.json': '{}',
      'libs/ui/.storybook/main.ts': '',
      'libs/forms/project.json': json({ name: 'forms' }),
      'libs/forms/.storybook/main.ts': '',
      'libs/kit/project.json': json({ name: '@acme/design-kit' }),
      'libs/kit/.storybook/main.ts': '',
    })

    const project = await detectProject(root, listProjectFiles)

    expect(
      project?.storybooks.map(({ configDir, defaultName, packageName, manifestDir }) => [
        configDir,
        defaultName,
        packageName,
        manifestDir,
      ]),
    ).toEqual([
      ['libs/forms/.storybook', 'forms', undefined, root],
      ['libs/kit/.storybook', 'design-kit', undefined, root],
      ['libs/ui/.storybook', 'ui', undefined, root],
    ])
  })

  it("infers the start of a project's .storybook from Nx's Storybook plugin", async () => {
    const root = createProject({
      'package.json': json({ name: 'acme' }),
      'nx.json': json({ plugins: [{ plugin: '@nx/storybook/plugin', options: { serveStorybookTargetName: 'sb' } }] }),
      'libs/ui/project.json': json({ name: 'ui-lib' }),
      'libs/ui/.storybook/main.ts': '',
      'libs/web/package.json': json({ name: '@acme/web' }),
      'libs/web/project.json': '{ not json',
      'libs/web/.storybook/main.ts': '',
    })

    const project = await detectProject(root, listProjectFiles)

    expect(project?.storybooks.map(({ start }) => start)).toEqual([
      { kind: 'nx', project: 'ui-lib', target: 'sb', port: undefined },
      { kind: 'nx', project: '@acme/web', target: 'sb', port: undefined },
    ])
  })

  it('gives no Nx start for a project.json that is not JSON, without the plugin', async () => {
    const root = createProject({
      'package.json': json({ name: 'acme' }),
      'nx.json': '{}',
      'libs/ui/project.json': '{ "targets": { "storybook": {',
      'libs/ui/.storybook/main.ts': '',
    })

    const [storybook] = (await detectProject(root, listProjectFiles))?.storybooks ?? []

    expect(storybook).toMatchObject({ configDir: 'libs/ui/.storybook', start: undefined })
  })

  it("falls back to a root script that starts a package's Storybook with -c, before Nx", async () => {
    const root = createProject({
      'package.json': json({ name: 'acme', scripts: { 'sb:ui': 'storybook dev -c packages/ui/.storybook -p 6200' } }),
      'nx.json': '{}',
      'packages/ui/project.json': json({ targets: { storybook: { options: { port: 4400 } } } }),
      'packages/ui/package.json': json({ name: 'ui', scripts: { build: 'storybook build' } }),
      'packages/ui/.storybook/main.ts': '',
    })

    const [storybook] = (await detectProject(root, listProjectFiles))?.storybooks ?? []

    expect(storybook?.start).toEqual({
      kind: 'script',
      call: { script: 'sb:ui', subcommand: 'dev', configDir: 'packages/ui/.storybook', port: 6200 },
      packageDir: root,
    })
  })

  it("reports a Storybook package's package.json it can't read", async () => {
    const root = createProject({
      'package.json': json({ name: 'acme', workspaces: ['packages/*'] }),
      'packages/ui/package.json': '{ nope',
      'packages/ui/.storybook/main.ts': '',
    })

    const [storybook] = (await detectProject(root, listProjectFiles))?.storybooks ?? []

    expect(storybook).toMatchObject({
      packageDir: join(root, 'packages/ui'),
      manifestDir: join(root, 'packages/ui'),
      manifest: {},
      manifestProblem: expect.any(String),
      defaultName: 'ui',
    })
  })

  it("takes a package's own lockfile as no nested workspace", async () => {
    const root = createProject({
      ...pnpmWorkspaceFiles,
      'pnpm-lock.yaml': '',
      'packages/ui/pnpm-lock.yaml': '',
    })

    const project = await detectProject(root, listProjectFiles)

    expect(project?.storybooks.map(({ configDir }) => configDir)).toEqual([
      'packages/ui/.storybook',
      'packages/web/.storybook',
    ])
    expect(project?.notes).toEqual([])
  })

  it('reads Yarn Berry from the workspace root', async () => {
    const root = createProject({ 'package.json': json({ packageManager: 'yarn@4.1.0' }) })

    expect(await detectProject(root, listProjectFiles)).toMatchObject({ packageManager: 'yarn', yarnBerry: true })
  })
})
