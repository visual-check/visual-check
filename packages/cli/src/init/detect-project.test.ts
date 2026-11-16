import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectProject } from './detect-project.js'
import { listProjectFiles } from './find-storybooks.js'

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

    expect(storybook?.startScript?.script).toBe('sb')
  })

  it('finds a Storybook without git when a script runs it', async () => {
    const root = createProject(
      { 'package.json': JSON.stringify({ scripts: { storybook: 'storybook dev -p 6006' } }), '.storybook/main.ts': '' },
      false,
    )

    const project = await detectProject(root, listProjectFiles)

    expect(project?.storybooks.map((storybook) => storybook.configDir)).toEqual(['.storybook'])
    expect(project?.storybooks[0]?.startScript?.port).toBe(6006)
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
    expect(storybook?.startScript?.port).toBe(7000)
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
        defaultName: 'web',
        startScript: { script: 'storybook', subcommand: 'dev', configDir: undefined, port: 6007 },
        version: '10.1.2',
      },
    ])
  })

  it('leaves the start script and version undefined when there are none', async () => {
    const root = createProject({ 'package.json': '{"name":"web"}', 'docs/.storybook/main.js': '' })

    const [storybook] = (await detectProject(root, listProjectFiles))?.storybooks ?? []

    expect(storybook).toMatchObject({ configDir: 'docs/.storybook', defaultName: 'docs', startScript: undefined })
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
