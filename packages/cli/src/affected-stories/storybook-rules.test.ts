import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type AffectedStorybook,
  type AffectedStorybookInput,
  affectedStorybooksOf,
  type ChangeReach,
  type RequiredStorybookInput,
  requiredStorybooksOf,
} from './storybook-rules.js'

/**
 * The project root the rules tests use. Never read from disk.
 */
const root = '/project'

/**
 * The baselines folder and story IDs of a Storybook whose baselines no test changes.
 */
const noBaselines = { baselines: join(root, '.visual-check/baselines'), storyIds: [] }

/**
 * The rules input of a change that touches no package and no baseline.
 */
const noPackages = { changedPackages: new Set<string>(), reachedFromPackages: new Set<string>(), changedBaselines: [] }

/**
 * A Storybook at the project root, with its config in `.storybook/`.
 */
const rootStorybook: AffectedStorybookInput = {
  dir: root,
  configDir: join(root, '.storybook'),
  storiesFiles: ['./src/button.stories.tsx', './src/card.stories.tsx', 'src/badge.stories.tsx'],
  ...noBaselines,
}

/**
 * Gives the stories files the rules select in the root Storybook, given the reached and the changed files.
 */
function affectedIn(reached: readonly string[], changedFiles: readonly string[] = reached): AffectedStorybook[] {
  return affectedStorybooksOf(
    {
      root,
      reached: new Set(reached),
      changedFiles,
      ...noPackages,
    },
    [rootStorybook],
  )
}

/**
 * Gives the result that selects these stories files.
 */
function some(...storiesFiles: string[]): AffectedStorybook {
  return { all: false, storiesFiles: new Set(storiesFiles), storyIds: new Set() }
}

describe('affectedStorybooksOf', () => {
  it("selects only the importers' stories files of a component imported directly", () => {
    expect(affectedIn(['src/button.tsx', 'src/button.stories.tsx'], ['src/button.tsx'])).toEqual([
      some('./src/button.stories.tsx'),
    ])
  })

  it("selects only the importers' stories files of a component imported through another file", () => {
    const reached = ['src/icon.tsx', 'src/button.tsx', 'src/button.stories.tsx', 'src/card.stories.tsx']

    expect(affectedIn(reached, ['src/icon.tsx'])).toEqual([some('./src/button.stories.tsx', './src/card.stories.tsx')])
  })

  it('selects a changed stories file itself', () => {
    expect(affectedIn(['src/card.stories.tsx'])).toEqual([some('./src/card.stories.tsx')])
  })

  it('matches an import path with and without a leading ./', () => {
    expect(affectedIn(['src/badge.stories.tsx', 'src/button.stories.tsx'])).toEqual([
      some('./src/button.stories.tsx', 'src/badge.stories.tsx'),
    ])
  })

  it('ignores a reached file that is no stories file', () => {
    expect(affectedIn(['src/button.tsx', 'src/unused.tsx'])).toEqual([some()])
  })

  it('selects nothing for a changed file not in the graph', () => {
    expect(affectedIn([], ['README.md'])).toEqual([some()])
  })

  it('selects every story when preview.tsx changes', () => {
    expect(affectedIn(['.storybook/preview.tsx'])).toEqual([{ all: true }])
  })

  it('selects every story when main.ts changes', () => {
    expect(affectedIn(['.storybook/main.ts'])).toEqual([{ all: true }])
  })

  it('selects every story when preview-head.html changes, though it is not in the graph', () => {
    expect(affectedIn([], ['.storybook/preview-head.html'])).toEqual([{ all: true }])
  })

  it('selects every story when preview-body.html changes', () => {
    expect(affectedIn([], ['.storybook/preview-body.html'])).toEqual([{ all: true }])
  })

  it('selects every story when the walk reaches main.ts', () => {
    expect(affectedIn(['src/addon.ts', '.storybook/main.ts'], ['src/addon.ts'])).toEqual([{ all: true }])
  })

  it('selects every story when the walk reaches preview.ts', () => {
    expect(affectedIn(['src/theme.ts', '.storybook/preview.ts'], ['src/theme.ts'])).toEqual([{ all: true }])
  })

  it('selects what the graph says when another config file is reached', () => {
    const reached = ['src/viewports.ts', '.storybook/visual-check.ts', 'src/card.stories.tsx']

    expect(affectedIn(reached, ['src/viewports.ts'])).toEqual([some('./src/card.stories.tsx')])
  })

  it('does not count a preview file in a subfolder of the config folder', () => {
    expect(affectedIn(['.storybook/sub/preview.ts', '.storybook/sub/main.ts'])).toEqual([some()])
  })

  it('does not count a preview file outside the config folder', () => {
    expect(affectedIn(['src/preview.ts', 'main.ts'])).toEqual([some()])
  })

  it('counts config file names whatever their case', () => {
    expect(affectedIn(['.storybook/Preview.tsx'])).toEqual([{ all: true }])
    expect(affectedIn(['.storybook/Main.ts'])).toEqual([{ all: true }])
  })

  it('counts any file whose name starts with preview or main, such as previewer.ts or maintenance.ts', () => {
    expect(affectedIn(['.storybook/previewer.ts'])).toEqual([{ all: true }])
    expect(affectedIn(['.storybook/maintenance.ts'])).toEqual([{ all: true }])
  })

  it('selects every story when preview.ts is deleted, though the graph no longer has it', () => {
    expect(affectedIn([], ['.storybook/preview.ts'])).toEqual([{ all: true }])
  })

  it('selects every story of only the Storybook whose folder is outside the root', () => {
    const outside: AffectedStorybookInput = {
      dir: '/elsewhere',
      configDir: join(root, '.storybook'),
      storiesFiles: ['./src/button.stories.tsx'],
      ...noBaselines,
    }

    expect(
      affectedStorybooksOf(
        {
          root,
          reached: new Set(['src/card.stories.tsx']),
          changedFiles: ['src/card.stories.tsx'],
          ...noPackages,
        },
        [outside, rootStorybook],
      ),
    ).toEqual([{ all: true }, some('./src/card.stories.tsx')])
  })

  it('selects every story of only the Storybook whose config folder is outside the root', () => {
    const outside: AffectedStorybookInput = {
      dir: root,
      configDir: '/elsewhere/.storybook',
      storiesFiles: ['./src/button.stories.tsx'],
      ...noBaselines,
    }

    expect(
      affectedStorybooksOf(
        {
          root,
          reached: new Set(['src/card.stories.tsx']),
          changedFiles: ['src/card.stories.tsx'],
          ...noPackages,
        },
        [outside, rootStorybook],
      ),
    ).toEqual([{ all: true }, some('./src/card.stories.tsx')])
  })

  it('selects every story when the config folder is the Storybook folder itself', () => {
    const storybook: AffectedStorybookInput = {
      dir: root,
      configDir: root,
      storiesFiles: ['./a.stories.tsx'],
      ...noBaselines,
    }

    expect(
      affectedStorybooksOf(
        {
          root,
          reached: new Set(['preview.ts']),
          changedFiles: [],
          ...noPackages,
        },
        [storybook],
      ),
    ).toEqual([{ all: true }])
  })

  describe('in a monorepo with two Storybooks', () => {
    /**
     * A Storybook in `packages/web`.
     */
    const web: AffectedStorybookInput = {
      dir: join(root, 'packages/web'),
      configDir: join(root, 'packages/web/.storybook'),
      storiesFiles: ['./src/page.stories.tsx'],
      ...noBaselines,
    }

    /**
     * A Storybook in `packages/ui`, with its config in a folder of its own name.
     */
    const ui: AffectedStorybookInput = {
      dir: join(root, 'packages/ui'),
      configDir: join(root, 'packages/ui/storybook-config'),
      storiesFiles: ['./src/button.stories.tsx', './src/card.stories.tsx'],
      ...noBaselines,
    }

    /**
     * Gives the stories files the rules select in both Storybooks.
     */
    function affectedInBoth(reached: readonly string[], changedFiles: readonly string[] = reached) {
      return affectedStorybooksOf(
        {
          root,
          reached: new Set(reached),
          changedFiles,
          ...noPackages,
        },
        [web, ui],
      )
    }

    it('selects the stories files of each Storybook from the root-relative paths', () => {
      const reached = [
        'packages/ui/src/button.tsx',
        'packages/ui/src/button.stories.tsx',
        'packages/web/src/page.stories.tsx',
      ]

      expect(affectedInBoth(reached, ['packages/ui/src/button.tsx'])).toEqual([
        some('./src/page.stories.tsx'),
        some('./src/button.stories.tsx'),
      ])
    })

    it('selects every story of only the Storybook whose preview changed', () => {
      expect(affectedInBoth(['packages/ui/storybook-config/preview.tsx'])).toEqual([some(), { all: true }])
    })

    it('matches an import path without a leading ./ against the Storybook folder', () => {
      const docs: AffectedStorybookInput = {
        dir: join(root, 'packages/docs'),
        configDir: join(root, 'packages/docs/.storybook'),
        storiesFiles: ['src/intro.stories.tsx', 'src/other.stories.tsx'],
        ...noBaselines,
      }

      expect(
        affectedStorybooksOf(
          {
            root,
            reached: new Set(['packages/docs/src/intro.stories.tsx', 'src/other.stories.tsx']),
            changedFiles: ['packages/docs/src/intro.stories.tsx'],
            ...noPackages,
          },
          [docs],
        ),
      ).toEqual([some('src/intro.stories.tsx')])
    })

    /**
     * Gives the stories the rules select in both Storybooks when the packages changed reach `reachedFromPackages`.
     */
    function affectedByPackages(changedPackages: string[], reachedFromPackages: string[]) {
      return affectedStorybooksOf(
        {
          root,
          reached: new Set(),
          changedFiles: [],
          ...noPackages,
          changedPackages: new Set(changedPackages),
          reachedFromPackages: new Set(reachedFromPackages),
        },
        [web, ui],
      )
    }

    it('selects every story of a Storybook inside a changed package', () => {
      expect(affectedByPackages(['packages/ui'], [])).toEqual([some(), { all: true }])
      expect(affectedByPackages(['packages'], [])).toEqual([{ all: true }, { all: true }])
    })

    it('does not take a package for the folder of another whose name it starts', () => {
      expect(affectedByPackages(['packages/w'], [])).toEqual([some(), some()])
    })

    it('selects every story of every Storybook when the root package changed', () => {
      expect(affectedByPackages(['.'], [])).toEqual([{ all: true }, { all: true }])
    })

    it('selects every story of a Storybook when a changed package reaches one of its stories files', () => {
      expect(affectedByPackages(['lib'], ['lib/a.ts', 'packages/web/src/page.stories.tsx'])).toEqual([
        { all: true },
        some(),
      ])
    })

    it('selects every story of a Storybook when a changed package reaches its preview or main', () => {
      expect(affectedByPackages(['lib'], ['lib/a.ts', 'packages/ui/storybook-config/main.ts'])).toEqual([
        some(),
        { all: true },
      ])
    })

    it('reads nothing from reachedFromPackages when no package changed', () => {
      expect(affectedByPackages([], ['packages/web/src/page.stories.tsx'])).toEqual([some(), some()])
    })

    it('selects the stories a changed baseline names in the Storybook that keeps it', () => {
      const withIds = [
        { ...web, baselines: join(root, 'packages/web/baselines'), storyIds: ['page--a', 'page--b'] },
        { ...ui, baselines: join(root, 'packages/ui/baselines'), storyIds: ['page--a'] },
      ]

      expect(
        affectedStorybooksOf(
          {
            root,
            reached: new Set(),
            changedFiles: [],
            ...noPackages,
            changedBaselines: [{ folder: join(root, 'packages/web/baselines'), stem: 'page--a.dark' }],
          },
          withIds,
        ),
      ).toEqual([{ all: false, storiesFiles: new Set(), storyIds: new Set(['page--a']) }, some()])
    })

    it("does not count another Storybook's config folder", () => {
      expect(affectedInBoth(['packages/ui/.storybook/preview.tsx'])).toEqual([some(), some()])
    })
  })
})

describe('requiredStorybooksOf', () => {
  /**
   * A Storybook at the project root, whose globs read `./src/*.stories.tsx`.
   */
  const atRoot: RequiredStorybookInput = {
    dir: root,
    configDir: join(root, '.storybook'),
    baselines: join(root, '.visual-check/baselines'),
    storiesMatchers: [/^\.\/src\/[^/]+\.stories\.tsx$/],
  }

  /**
   * A Storybook in `apps/web`, whose globs read its own `./src/*.stories.tsx` and `packages/ui`'s.
   */
  const web: RequiredStorybookInput = {
    dir: join(root, 'apps/web'),
    configDir: join(root, 'apps/web/.storybook'),
    baselines: join(root, 'apps/web/.visual-check/baselines'),
    storiesMatchers: [/^\.\/src\/[^/]+\.stories\.tsx$/, /^\.\.\/\.\.\/packages\/ui\/src\/[^/]+\.stories\.tsx$/],
  }

  /**
   * Tells which of the root and `apps/web` Storybooks the change requires.
   */
  function requiredBy(change: Partial<ChangeReach>, storybooks = [atRoot, web]): boolean[] {
    return requiredStorybooksOf({ root, reached: new Set(), changedFiles: [], ...noPackages, ...change }, storybooks)
  }

  it('requires the Storybook whose globs match a reached file', () => {
    expect(
      requiredBy({ reached: new Set(['apps/web/src/page.stories.tsx']), changedFiles: ['apps/web/src/page.tsx'] }),
    ).toEqual([false, true])
  })

  it('requires the Storybook whose globs match a reached file in another package, by a ../ import path', () => {
    expect(
      requiredBy({
        reached: new Set(['packages/ui/src/button.stories.tsx']),
        changedFiles: ['packages/ui/src/button.tsx'],
      }),
    ).toEqual([false, true])
  })

  it('requires the Storybook whose globs match a changed file the graph does not hold: deleted, or .mdx', () => {
    const withMdx: RequiredStorybookInput = { ...atRoot, storiesMatchers: [/^\.\/src\/[^/]+\.mdx$/] }

    expect(requiredBy({ changedFiles: ['apps/web/src/old.stories.tsx'] })).toEqual([false, true])
    expect(requiredBy({ changedFiles: ['src/intro.mdx'] }, [withMdx, web])).toEqual([true, false])
  })

  it("requires the Storybook whose globs can't be read, whatever changed", () => {
    expect(requiredBy({ changedFiles: ['README.md'] }, [{ ...atRoot, storiesMatchers: undefined }, web])).toEqual([
      true,
      false,
    ])
  })

  it('requires the Storybook whose baselines folder holds a changed baseline, and not another', () => {
    expect(requiredBy({ changedBaselines: [{ folder: web.baselines, stem: 'page--default' }] })).toEqual([false, true])
  })

  it.each([
    ['changed', { changedFiles: ['apps/web/.storybook/preview.ts'] }],
    ['reached', { reached: new Set(['apps/web/.storybook/preview.ts']), changedFiles: ['apps/web/src/theme.ts'] }],
  ])('requires the Storybook whose preview.ts is %s', (_name, change) => {
    expect(requiredBy(change)).toEqual([false, true])
  })

  it('requires the Storybook a changed package reaches through a file its globs match', () => {
    const change = {
      changedPackages: new Set(['packages/ui']),
      reachedFromPackages: new Set(['packages/ui/src/index.ts', 'packages/ui/src/button.stories.tsx']),
    }

    expect(requiredBy(change)).toEqual([false, true])
  })

  it('requires the Storybook inside a changed package, and every Storybook when the root package changed', () => {
    expect(requiredBy({ changedPackages: new Set(['apps/web']) })).toEqual([false, true])
    expect(requiredBy({ changedPackages: new Set(['.']) })).toEqual([true, true])
  })

  it('requires the Storybook whose folder is outside the root', () => {
    expect(requiredBy({ changedFiles: ['README.md'] }, [{ ...atRoot, dir: '/elsewhere' }, web])).toEqual([true, false])
  })

  it('does not require a Storybook for a reached file no glob matches, nor for an unrelated changed file', () => {
    expect(requiredBy({ reached: new Set(['src/button.tsx', 'apps/web/src/page.tsx']) })).toEqual([false, false])
    expect(requiredBy({ changedFiles: ['README.md'] })).toEqual([false, false])
  })
})
