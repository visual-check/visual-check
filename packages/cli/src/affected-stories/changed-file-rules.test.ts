import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { baselineStemOf } from '../baselines/baseline-files.js'
import { baselineNamesStory, type ChangedFileContext, changedFileRuleOf } from './changed-file-rules.js'

/**
 * The project root the tests use. Never read from disk.
 */
const root = '/project'

/**
 * A monorepo whose config file sits at the root, with a Storybook's baselines in `apps/web/.visual-check/baselines`.
 */
const context: ChangedFileContext = {
  root,
  configPath: join(root, 'visual-check.config.ts'),
  selectAll: [],
  ignore: [],
  baselinesFolders: [join(root, 'apps/web/.visual-check/baselines')],
}

/**
 * Gives the kind of rule a changed file falls under, with the context's settings overridden by `overrides`.
 */
function kindOf(file: string, overrides: Partial<ChangedFileContext> = {}): string {
  return changedFileRuleOf(file, { ...context, ...overrides }).kind
}

describe('changedFileRuleOf', () => {
  it('selects every story for the config file', () => {
    expect(kindOf('visual-check.config.ts')).toBe('every-story')
  })

  it('selects every story for the config file in a subfolder, but not for another file of that name', () => {
    const inApp = { configPath: join(root, 'apps/web/visual-check.config.ts') }

    expect(kindOf('apps/web/visual-check.config.ts', inApp)).toBe('every-story')
    expect(kindOf('visual-check.config.ts', inApp)).toBe('graph')
  })

  it.each(['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock', 'bun.lockb'])(
    'selects every story for the lockfile %s, at the root or in a package',
    (name) => {
      expect(kindOf(name)).toBe('every-story')
      expect(kindOf(`apps/web/${name}`)).toBe('every-story')
    },
  )

  it('selects every story for pnpm-workspace.yaml', () => {
    expect(kindOf('pnpm-workspace.yaml')).toBe('every-story')
  })

  it('selects every story for a match for affected.selectAll', () => {
    expect(kindOf('packages/ui/src/docs/intro.md', { selectAll: ['packages/ui/src/docs/**'] })).toBe('every-story')
    expect(kindOf('packages/ui/src/other.md', { selectAll: ['packages/ui/src/docs/**'] })).toBe('graph')
  })

  it('reads the globs relative to the config file folder', () => {
    const inApp = { configPath: join(root, 'apps/web/visual-check.config.ts') }

    expect(kindOf('apps/web/fixtures/a.txt', { ...inApp, selectAll: ['fixtures/**'] })).toBe('every-story')
    expect(kindOf('packages/ui/a.txt', { ...inApp, selectAll: ['../../packages/ui/*.txt'] })).toBe('every-story')
    expect(kindOf('fixtures/a.txt', { ...inApp, selectAll: ['fixtures/**'] })).toBe('graph')
  })

  it('matches dotfiles only with a glob that names the dot', () => {
    expect(kindOf('.env.local', { ignore: ['.env*'] })).toBe('ignored')
    expect(kindOf('apps/web/.env', { ignore: ['**/.env*'] })).toBe('ignored')
    expect(kindOf('.env.local', { ignore: ['*'] })).toBe('package')
    expect(kindOf('docs/.vitepress/config.ts', { ignore: ['docs/**'] })).toBe('graph')
  })

  it('ignores a match for affected.ignore, whatever else selects it', () => {
    expect(kindOf('visual-check.config.ts', { ignore: ['*.config.ts'] })).toBe('ignored')
    expect(kindOf('pnpm-lock.yaml', { ignore: ['pnpm-lock.yaml'] })).toBe('ignored')
    expect(kindOf('docs/a.md', { ignore: ['docs/**'], selectAll: ['docs/**'] })).toBe('ignored')
    expect(kindOf('apps/web/.visual-check/baselines/a.png', { ignore: ['apps/web/.visual-check/**'] })).toBe('ignored')
    expect(kindOf('packages/ui/src/button.tsx', { ignore: ['packages/ui/**'] })).toBe('ignored')
  })

  it.each([
    'package.json',
    'packages/ui/package.json',
    'tsconfig.json',
    'packages/ui/tsconfig.build.json',
    'jsconfig.json',
    'vite.config.ts',
    'postcss.config.cjs',
    '.postcssrc.json',
    'tailwind.config.js',
    'next.config.mjs',
    '.env',
    'apps/web/.env.production.local',
    'packages/ui/Package.JSON',
  ])('scopes %s to its package', (file) => {
    expect(kindOf(file)).toBe('package')
  })

  it.each([
    'packages/ui/src/star.svg',
    'packages/ui/src/photo.JPG',
    'packages/ui/src/favicon.ico',
    'packages/ui/fonts/inter.woff2',
    'packages/ui/fonts/inter.ttf',
    'packages/ui/src/data.json',
    'public/logo.png',
  ])('takes %s for an asset', (file) => {
    expect(kindOf(file)).toBe('asset')
  })

  it.each([
    '.vscode/settings.json',
    'packages/ui/.eslintrc.json',
    'apps/web/.storybook/addons.json',
    'biome.json',
    'packages/ui/biome.jsonc',
    'turbo.json',
    'renovate.json',
    'lerna.json',
    'nx.json',
  ])('leaves the config JSON %s to the graph', (file) => {
    expect(kindOf(file)).toBe('graph')
  })

  it.each(['README.md', 'packages/ui/src/button.tsx', 'packages/ui/src/notes.txt'])(
    'leaves %s to the graph',
    (file) => {
      expect(kindOf(file)).toBe('graph')
    },
  )

  it('takes a .png directly in a baselines folder for a baseline, with its NFC stem', () => {
    expect(changedFileRuleOf('apps/web/.visual-check/baselines/button--primary.dark.png', context)).toEqual({
      kind: 'baseline',
      folder: join(root, 'apps/web/.visual-check/baselines'),
      stem: 'button--primary.dark',
    })
    expect(changedFileRuleOf('apps/web/.visual-check/baselines/café--a.png', context)).toMatchObject({
      stem: 'café--a',
    })
  })

  it('takes a .png outside the baselines folders, or in a subfolder of one, for an asset', () => {
    expect(kindOf('apps/docs/.visual-check/baselines/a.png')).toBe('asset')
    expect(kindOf('apps/web/.visual-check/baselines/sub/a.png')).toBe('asset')
  })
})

describe('baselineNamesStory', () => {
  it("names the story of a default capture's baseline", () => {
    expect(baselineNamesStory('button--primary', 'button--primary')).toBe(true)
  })

  it("names the story of a mode's baseline", () => {
    expect(baselineNamesStory('button--primary.dark', 'button--primary')).toBe(true)
  })

  it('names no other story, even one whose ID starts the same', () => {
    expect(baselineNamesStory('button--primary', 'button--primary-large')).toBe(false)
    expect(baselineNamesStory('button--primary-large', 'button--primary')).toBe(false)
    expect(baselineNamesStory('card--primary', 'button--primary')).toBe(false)
  })

  it('names a story whose ID is in another Unicode form', () => {
    expect(baselineNamesStory('café--a', 'café--a')).toBe(true)
  })

  it('names the story of a shortened stem, and of its shortened mode stem', () => {
    const id = `long--${'a'.repeat(250)}`

    expect(baselineNamesStory(baselineStemOf(id), id)).toBe(true)
    expect(baselineNamesStory(baselineStemOf(`${id}.dark`), id)).toBe(true)
    expect(baselineNamesStory(baselineStemOf(id), 'long--b')).toBe(false)
  })

  it("names a shorter story whose mode's key was shortened", () => {
    const id = `long--${'a'.repeat(200)}`
    const mode = 'm'.repeat(60)

    expect(baselineNamesStory(baselineStemOf(`${id}.${mode}`), id)).toBe(true)
  })

  it('may name a story that shares the kept start of a shortened stem', () => {
    const start = `long--${'a'.repeat(250)}`

    expect(baselineNamesStory(baselineStemOf(`${start}-one`), `${start}-two`)).toBe(true)
  })

  it('takes a short stem that ends like a hash for a plain one', () => {
    expect(baselineNamesStory('button--a-0123456789abcdef', 'button--active')).toBe(false)
  })
})
