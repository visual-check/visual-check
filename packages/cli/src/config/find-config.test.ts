import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findConfig } from './find-config.js'

/**
 * The temporary folders the tests made, removed after each test.
 */
const temporaryFolders: string[] = []

/**
 * Content for a config file. `findConfig` never reads it.
 */
const content = 'export default {}\n'

/**
 * The content of `.git/HEAD`. A `.git` folder ends the search at the folder holding it, and each test makes one, so the
 * search never sees files above the temporary folder.
 */
const gitHead = 'ref: refs/heads/main\n'

/**
 * Makes a temporary folder holding `files`, each a path relative to the folder mapped to its content, and returns the
 * folder's real path.
 */
function createFolder(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-config-')))
  temporaryFolders.push(root)
  for (const [path, fileContent] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), fileContent)
  }
  return root
}

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

describe('findConfig', () => {
  it('finds the config in the start folder', () => {
    const root = createFolder({ '.git/HEAD': gitHead, 'visual-check.config.ts': content })
    expect(findConfig(root)).toBe(join(root, 'visual-check.config.ts'))
  })

  it('finds the config in a parent folder', () => {
    const root = createFolder({ '.git/HEAD': gitHead, 'visual-check.config.ts': content, 'apps/web/src/.keep': '' })
    expect(findConfig(join(root, 'apps/web/src'))).toBe(join(root, 'visual-check.config.ts'))
  })

  it('takes the nearest config over a farther one', () => {
    const root = createFolder({
      '.git/HEAD': gitHead,
      'visual-check.config.ts': content,
      'apps/web/visual-check.config.mjs': content,
      'apps/web/src/.keep': '',
    })
    expect(findConfig(join(root, 'apps/web/src'))).toBe(join(root, 'apps/web/visual-check.config.mjs'))
  })

  it('takes .ts over .mjs in one folder', () => {
    const root = createFolder({
      '.git/HEAD': gitHead,
      'visual-check.config.mjs': content,
      'visual-check.config.ts': content,
    })
    expect(findConfig(root)).toBe(join(root, 'visual-check.config.ts'))
  })

  it('stops after the folder that holds a .git folder', () => {
    const root = createFolder({
      'visual-check.config.ts': content,
      'repo/.git/HEAD': gitHead,
      'repo/app/.keep': '',
    })
    expect(findConfig(join(root, 'repo/app'))).toBeUndefined()
  })

  it('stops after the folder that holds a .git file', () => {
    const root = createFolder({
      'visual-check.config.ts': content,
      'repo/.git': 'gitdir: ../.git/worktrees/repo\n',
      'repo/app/.keep': '',
    })
    expect(findConfig(join(root, 'repo/app'))).toBeUndefined()
  })

  it('finds a config in the folder that holds .git', () => {
    const root = createFolder({
      'visual-check.config.ts': content,
      'repo/.git/HEAD': gitHead,
      'repo/visual-check.config.js': content,
      'repo/app/.keep': '',
    })
    expect(findConfig(join(root, 'repo/app'))).toBe(join(root, 'repo/visual-check.config.js'))
  })

  it('returns undefined when there is no config', () => {
    const root = createFolder({ '.git/HEAD': gitHead, 'apps/web/.keep': '' })
    expect(findConfig(join(root, 'apps/web'))).toBeUndefined()
  })

  it('skips a link that loops', () => {
    const root = createFolder({ '.git/HEAD': gitHead, 'visual-check.config.js': content })
    symlinkSync('visual-check.config.ts', join(root, 'visual-check.config.ts'))
    expect(findConfig(root)).toBe(join(root, 'visual-check.config.js'))
  })

  it('skips a folder named like a config', () => {
    const root = createFolder({
      '.git/HEAD': gitHead,
      'visual-check.config.ts/.keep': '',
      'visual-check.config.js': content,
    })
    expect(findConfig(root)).toBe(join(root, 'visual-check.config.js'))
  })
})
