import { afterEach, describe, expect, it } from 'vitest'
import { makeFolder, removeRepos, writeFiles } from './git-repo.fixture.js'
import { packageFolderFinder } from './package-folder.js'

afterEach(removeRepos)

describe('packageFolderFinder', () => {
  /**
   * Makes a monorepo with a root package and `packages/ui`, and gives its package finder.
   */
  function monorepo(): (file: string) => Promise<string> {
    const root = makeFolder()

    writeFiles(root, { 'package.json': '{}', 'packages/ui/package.json': '{}', 'packages/ui/src/a.ts': '' })

    return packageFolderFinder(root)
  }

  it('gives the nearest folder with a package.json', async () => {
    const packageFolderOf = monorepo()

    expect(await packageFolderOf('packages/ui/src/assets/bg.png')).toBe('packages/ui')
    expect(await packageFolderOf('packages/ui/tsconfig.json')).toBe('packages/ui')
  })

  it('gives the root for a file in no package but the root', async () => {
    const packageFolderOf = monorepo()

    expect(await packageFolderOf('docs/logo.png')).toBe('.')
    expect(await packageFolderOf('.env')).toBe('.')
  })

  it('gives the own folder of a package.json, even a deleted one', async () => {
    const packageFolderOf = monorepo()

    expect(await packageFolderOf('packages/ui/package.json')).toBe('packages/ui')
    expect(await packageFolderOf('packages/gone/package.json')).toBe('packages/gone')
    expect(await packageFolderOf('package.json')).toBe('.')
  })

  it('gives the root when no folder holds a package.json', async () => {
    const packageFolderOf = packageFolderFinder(makeFolder())

    expect(await packageFolderOf('a/b/c.png')).toBe('.')
  })
})
