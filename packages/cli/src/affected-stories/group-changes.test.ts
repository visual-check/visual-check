import { describe, expect, it } from 'vitest'
import type { ChangedFileRule } from './changed-file-rules.js'
import { changedPackagesOf, groupChanges } from './group-changes.js'

/**
 * The rule of each file the tests change.
 */
const rules: Record<string, ChangedFileRule> = {
  'README.md': { kind: 'ignored' },
  'pnpm-lock.yaml': { kind: 'every-story' },
  'src/button.tsx': { kind: 'graph' },
  'packages/ui/package.json': { kind: 'package' },
  'packages/ui/src/star.svg': { kind: 'asset' },
  'baselines/button--primary.png': { kind: 'baseline', folder: '/project/baselines', stem: 'button--primary' },
}

/**
 * Groups the changed files with the rules of `rules`, each file in the package that is its folder's first segment, or
 * the root, and records each file it looked up the package of.
 */
async function grouped(files: string[]) {
  const lookedUp: string[] = []
  const groups = await groupChanges(
    files,
    (file) => rules[file] ?? { kind: 'graph' },
    async (file) => {
      lookedUp.push(file)

      return file.startsWith('packages/ui/') ? 'packages/ui' : '.'
    },
  )

  return { groups, lookedUp }
}

describe('groupChanges', () => {
  it('gives ignored when every file is ignored, or when no file changed', async () => {
    expect((await grouped(['README.md'])).groups).toBe('ignored')
    expect((await grouped([])).groups).toBe('ignored')
  })

  it('gives every-story when a file that is not ignored selects every story, looking up no package', async () => {
    expect(await grouped(['README.md', 'packages/ui/package.json', 'pnpm-lock.yaml'])).toEqual({
      groups: 'every-story',
      lookedUp: [],
    })
  })

  it('leaves out the ignored files', async () => {
    expect((await grouped(['README.md', 'src/button.tsx'])).groups).toEqual({
      graphFiles: ['src/button.tsx'],
      baselines: [],
      packageScoped: [],
    })
  })

  it('keeps the baselines out of the graph files, and scopes package configs and assets to their package', async () => {
    expect(
      await grouped([
        'baselines/button--primary.png',
        'packages/ui/package.json',
        'packages/ui/src/star.svg',
        'src/button.tsx',
      ]),
    ).toEqual({
      groups: {
        graphFiles: ['packages/ui/package.json', 'packages/ui/src/star.svg', 'src/button.tsx'],
        baselines: [{ folder: '/project/baselines', stem: 'button--primary' }],
        packageScoped: [
          { file: 'packages/ui/package.json', packageFolder: 'packages/ui', asset: false },
          { file: 'packages/ui/src/star.svg', packageFolder: 'packages/ui', asset: true },
        ],
      },
      lookedUp: ['packages/ui/package.json', 'packages/ui/src/star.svg'],
    })
  })
})

/**
 * A changed package.json in `packages/ui`, and an image in `packages/icons`.
 */
const packageScoped = [
  { file: 'packages/ui/package.json', packageFolder: 'packages/ui', asset: false },
  { file: 'packages/icons/star.svg', packageFolder: 'packages/icons', asset: true },
]

describe('changedPackagesOf', () => {
  it('counts no asset before the graph answers', () => {
    expect(changedPackagesOf(packageScoped, undefined)).toEqual(new Set(['packages/ui']))
  })

  it("counts an asset's package when the graph doesn't hold it", () => {
    expect(changedPackagesOf(packageScoped, new Set(['packages/ui/package.json']))).toEqual(
      new Set(['packages/ui', 'packages/icons']),
    )
  })

  it("leaves out an asset's package when the graph holds it, but never a package config's", () => {
    expect(changedPackagesOf(packageScoped, new Set(['packages/ui/package.json', 'packages/icons/star.svg']))).toEqual(
      new Set(['packages/ui']),
    )
  })
})
