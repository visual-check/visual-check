import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultNameOf,
  isInsideRoot,
  listProjectFiles,
  mainFileOnDiskIn,
  relativePathOf,
  storybookConfigDirsOf,
  storybookFolderOf,
  takeUniqueName,
  workspaceFolderOf,
} from './find-storybooks.js'
import { storybookCallsOf } from './storybook-scripts.js'

/**
 * The temporary folders the tests made, removed after each test.
 */
const temporaryFolders: string[] = []

/**
 * Makes an empty temporary folder and returns its real path.
 */
function createFolder(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-init-')))

  temporaryFolders.push(folder)

  return folder
}

/**
 * Writes empty files at paths relative to `root`.
 */
function writeFiles(root: string, paths: readonly string[]): void {
  for (const path of paths) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), '')
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const folder of temporaryFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

/**
 * A `hasMainFile` that finds nothing on disk.
 */
const noMainFile = () => false

describe('storybookConfigDirsOf', () => {
  it('finds the root and nested .storybook folders', () => {
    expect(
      storybookConfigDirsOf(['.storybook/main.ts', 'apps/web/.storybook/main.js', 'a.ts'], [], noMainFile),
    ).toEqual(['.storybook', 'apps/web/.storybook'])
  })

  it.each(['ts', 'js', 'mjs', 'cjs', 'mts', 'cts'])('reads main.%s', (extension) => {
    expect(storybookConfigDirsOf([`.storybook/main.${extension}`], [], noMainFile)).toEqual(['.storybook'])
  })

  it('ignores other files in .storybook', () => {
    const files = ['.storybook/main.d.ts', '.storybook/preview.ts', '.storybook/main.json']

    expect(storybookConfigDirsOf(files, [], noMainFile)).toEqual([])
  })

  it('counts a -c folder with a main file on disk', () => {
    const calls = storybookCallsOf({ sb: 'storybook dev -c config/sb' })

    expect(storybookConfigDirsOf([], calls, (configDir) => configDir === 'config/sb')).toEqual(['config/sb'])
  })

  it('skips a -c folder without a main file on disk', () => {
    const calls = storybookCallsOf({ sb: 'storybook dev -c config/sb' })

    expect(storybookConfigDirsOf(['config/sb/main.js'], calls, noMainFile)).toEqual([])
  })

  it('skips folders outside the root', () => {
    const calls = storybookCallsOf({
      up: 'storybook dev -c ../shared/sb',
      parent: 'storybook dev -c ..',
      absolute: 'storybook dev -c /abs/sb',
      drive: 'storybook dev -c C:/sb',
    })

    expect(storybookConfigDirsOf([], calls, () => true)).toEqual([])
  })

  it('counts .storybook for a call without -c when it is on disk', () => {
    const calls = storybookCallsOf({ sb: 'storybook dev -p 6006' })

    expect(storybookConfigDirsOf([], calls, (configDir) => configDir === '.storybook')).toEqual(['.storybook'])
  })

  it('counts the project root for -c .', () => {
    const calls = storybookCallsOf({ sb: 'storybook dev -c .' })

    expect(storybookConfigDirsOf([], calls, (configDir) => configDir === '.')).toEqual(['.'])
  })

  it('counts a build call folder too', () => {
    const calls = storybookCallsOf({ build: 'storybook build -c ./sb/' })

    expect(storybookConfigDirsOf([], calls, (configDir) => configDir === 'sb')).toEqual(['sb'])
  })

  it('dedupes and puts .storybook first, then sorts by code point', () => {
    const calls = storybookCallsOf({ sb: 'storybook dev -c z/.storybook', docs: 'storybook dev -c a/.storybook' })
    const files = ['z/.storybook/main.ts', 'a/.storybook/main.ts', '.storybook/main.ts', 'B/.storybook/main.ts']

    expect(storybookConfigDirsOf(files, calls, () => true)).toEqual([
      '.storybook',
      'B/.storybook',
      'a/.storybook',
      'z/.storybook',
    ])
  })
})

describe('mainFileOnDiskIn', () => {
  it('finds a main file in a folder on disk', () => {
    const root = createFolder()

    writeFiles(root, ['docs/sb/main.js', 'other/preview.js'])

    const hasMainFile = mainFileOnDiskIn(root)

    expect(hasMainFile('docs/sb')).toBe(true)
    expect(hasMainFile('other')).toBe(false)
    expect(hasMainFile('missing')).toBe(false)
  })
})

describe('defaultNameOf', () => {
  /**
   * Returns the default name of `configDir` in the package in `packageDir`, the root's unless `rootPackage` is false.
   */
  function nameOf(configDir: string, packageName: string | undefined, packageDir: string, rootPackage = true): string {
    return defaultNameOf({ configDir, packageName, packageDir, rootPackage })
  }

  it("names a package's .storybook after the package, without its scope", () => {
    expect(nameOf('.storybook', '@acme/web', '/work/app')).toBe('web')
  })

  it("names the package's own folder like its .storybook", () => {
    expect(nameOf('.', '@acme/web', '/work/app')).toBe('web')
    expect(nameOf('.', undefined, '/work/app')).toBe('app')
  })

  it('falls back to the package folder name', () => {
    expect(nameOf('.storybook', undefined, '/work/My App')).toBe('my-app')
  })

  it('names another config folder after the folder holding it', () => {
    expect(nameOf('docs/.storybook', 'pkg', '/r')).toBe('docs')
    expect(nameOf('apps/web/.storybook', 'pkg', '/r')).toBe('web')
  })

  it('names a differently called config folder after itself', () => {
    expect(nameOf('.storybook-mobile', 'pkg', '/r')).toBe('storybook-mobile')
    expect(nameOf('config/sb', 'pkg', '/r')).toBe('sb')
  })

  it('replaces invalid characters and trims dashes', () => {
    expect(nameOf('.storybook', 'My_Pkg!! v2', '/r')).toBe('my-pkg-v2')
  })

  it('falls back to storybook for an empty name', () => {
    expect(nameOf('.storybook', '@acme/---', '/r')).toBe('storybook')
  })

  it("names any config folder directly in a package other than the root's after the package", () => {
    expect(nameOf('.sb', '@acme/web', '/r/packages/web', false)).toBe('web')
    expect(nameOf('storybook-config', undefined, '/r/libs/ui', false)).toBe('ui')
    expect(nameOf('.storybook-mobile', 'pkg', '/r', true)).toBe('storybook-mobile')
  })

  it("names a nested config folder in a package other than the root's after the folder holding it", () => {
    expect(nameOf('docs/.storybook', '@acme/web', '/r/packages/web', false)).toBe('docs')
    expect(nameOf('config/sb', '@acme/web', '/r/packages/web', false)).toBe('sb')
  })
})

describe('relativePathOf', () => {
  it('writes a path inside the folder with / and no ./', () => {
    expect(relativePathOf('/project', join('/project', 'docs', '.storybook'))).toBe('docs/.storybook')
  })

  it('drops a trailing separator and gives . for the folder itself', () => {
    expect(relativePathOf('/project', '/project/.storybook/')).toBe('.storybook')
    expect(relativePathOf('/project', '/project')).toBe('.')
  })

  it('climbs out of the folder with ..', () => {
    expect(relativePathOf('/project/src', '/project/visual-check.config.ts')).toBe('../visual-check.config.ts')
  })
})

describe('workspaceFolderOf', () => {
  it("names the root by its folder's name, as code", () => {
    expect(workspaceFolderOf('/work/acme-monorepo/packages/ui', '/work/acme-monorepo')).toEqual([
      { code: 'acme-monorepo' },
    ])
  })

  it('adds the path to the root as an aside when a folder below it has its name', () => {
    expect(workspaceFolderOf('/work/acme/apps/acme', '/work/acme')).toEqual([
      { code: 'acme' },
      ' ',
      { aside: '(../..)' },
    ])
    expect(workspaceFolderOf('/work/acme/acme/src', '/work/acme')).toEqual([
      { code: 'acme' },
      ' ',
      { aside: '(../..)' },
    ])
  })

  it('takes only whole folder names as the same name', () => {
    expect(workspaceFolderOf('/work/acme/apps/acme-web', '/work/acme')).toEqual([{ code: 'acme' }])
  })

  it('names a root with no name by its path', () => {
    expect(workspaceFolderOf(join('/', 'packages', 'ui'), '/')).toEqual([{ code: '../..' }])
  })
})

describe('storybookFolderOf', () => {
  it('names a .storybook folder by the folder holding it', () => {
    expect(storybookFolderOf('apps/my-app/.storybook', '/work/acme')).toBe('apps/my-app')
    expect(storybookFolderOf('ui/.storybook', '/work/acme')).toBe('ui')
  })

  it("names the root's own .storybook by the root folder's name", () => {
    expect(storybookFolderOf('.storybook', '/work/acme-monorepo')).toBe('acme-monorepo')
  })

  it('leaves any other config folder as it is', () => {
    expect(storybookFolderOf('apps/a/.storybook-mobile', '/work/acme')).toBe('apps/a/.storybook-mobile')
    expect(storybookFolderOf('config/storybook', '/work/acme')).toBe('config/storybook')
    expect(storybookFolderOf('.storybook-mobile', '/work/acme')).toBe('.storybook-mobile')
  })

  it("keeps .storybook for a root with no name, the file system's", () => {
    expect(storybookFolderOf('.storybook', '/')).toBe('.storybook')
  })
})

describe('isInsideRoot', () => {
  it.each(['.', '.storybook', 'docs/.storybook', '..storybook'])('takes %s as inside', (folder) => {
    expect(isInsideRoot(folder)).toBe(true)
  })

  it.each(['..', '../web', '/elsewhere', 'C:/elsewhere'])('takes %s as outside', (folder) => {
    expect(isInsideRoot(folder)).toBe(false)
  })
})

describe('takeUniqueName', () => {
  it('takes a free name as it is and marks it used', () => {
    const used = new Set(['docs'])

    expect(takeUniqueName('web', used)).toBe('web')
    expect([...used]).toEqual(['docs', 'web'])
  })

  it('suffixes a used name with the first free number from 2', () => {
    const used = new Set(['web', 'web-2'])

    expect(takeUniqueName('web', used)).toBe('web-3')
    expect(takeUniqueName('web', used)).toBe('web-4')
  })
})

describe('listProjectFiles', () => {
  it('lists an untracked file and skips an ignored one', async () => {
    const root = createFolder()

    execFileSync('git', ['init', '-q'], { cwd: root })
    writeFiles(root, ['src/a.ts', 'ignored/b.ts'])
    writeFileSync(join(root, '.gitignore'), 'ignored/\n')

    const files = await listProjectFiles(root)

    expect(files).toContain('src/a.ts')
    expect(files).not.toContain('ignored/b.ts')
  })

  it('lists a tracked file', async () => {
    const root = createFolder()

    execFileSync('git', ['init', '-q'], { cwd: root })
    writeFiles(root, ['tracked.ts'])
    execFileSync('git', ['add', 'tracked.ts'], { cwd: root })

    expect(await listProjectFiles(root)).toEqual(['tracked.ts'])
  })

  it('gives paths relative to a subfolder of the repo', async () => {
    const root = createFolder()

    execFileSync('git', ['init', '-q'], { cwd: root })
    writeFiles(root, ['top.ts', 'apps/web/a.ts'])

    expect(await listProjectFiles(join(root, 'apps/web'))).toEqual(['a.ts'])
  })

  it('gives an empty list outside a repo', async () => {
    const root = createFolder()

    writeFiles(root, ['a.ts'])
    vi.stubEnv('GIT_CEILING_DIRECTORIES', dirname(root))

    expect(await listProjectFiles(root)).toEqual([])
  })
})
