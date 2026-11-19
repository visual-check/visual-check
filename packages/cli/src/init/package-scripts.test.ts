import { describe, expect, it } from 'vitest'
import { packageScriptsOf } from './package-scripts.js'

/**
 * What `packageScriptsOf` needs for a pnpm workspace at `/acme` whose list names `apps/a` and `apps/b`, with
 * `overrides` in place.
 */
function inputOf(
  overrides: Partial<Parameters<typeof packageScriptsOf>[0]> = {},
): Parameters<typeof packageScriptsOf>[0] {
  return {
    root: '/acme',
    storybooks: [
      { name: 'a', dir: '/acme/apps/a' },
      { name: 'b', dir: '/acme/apps/b' },
    ],
    scriptNames: { test: 'visual:check', update: 'visual:update' },
    packageManager: 'pnpm',
    yarnBerry: false,
    listedPackageDirs: ['apps/a', 'apps/b'],
    ...overrides,
  }
}

describe('packageScriptsOf', () => {
  it("gives each Storybook's package the root's script names, narrowed to its Storybook", () => {
    expect(packageScriptsOf(inputOf())).toEqual([
      {
        dir: '/acme/apps/a',
        scripts: {
          'visual:check': 'visual-check test --storybook a',
          'visual:update': 'visual-check update --storybook a',
        },
      },
      {
        dir: '/acme/apps/b',
        scripts: {
          'visual:check': 'visual-check test --storybook b',
          'visual:update': 'visual-check update --storybook b',
        },
      },
    ])
  })

  it('runs the root binary with yarn run -T under Yarn 2 or later', () => {
    const [first] = packageScriptsOf(inputOf({ packageManager: 'yarn', yarnBerry: true }))

    expect(first?.scripts).toEqual({
      'visual:check': 'yarn run -T visual-check test --storybook a',
      'visual:update': 'yarn run -T visual-check update --storybook a',
    })
  })

  it('takes the names the root scripts have', () => {
    const [first] = packageScriptsOf(inputOf({ scriptNames: { test: 'vc', update: 'vc:update' } }))

    expect(Object.keys(first?.scripts ?? {})).toEqual(['vc', 'vc:update'])
  })

  it('gives each of several Storybooks in one package a pair of its own, named with a suffix', () => {
    const storybooks = [
      { name: 'ui', dir: '/acme/apps/a' },
      { name: 'ui-docs', dir: '/acme/apps/a' },
    ]

    expect(packageScriptsOf(inputOf({ storybooks }))).toEqual([
      {
        dir: '/acme/apps/a',
        scripts: {
          'visual:check:ui': 'visual-check test --storybook ui',
          'visual:update:ui': 'visual-check update --storybook ui',
          'visual:check:ui-docs': 'visual-check test --storybook ui-docs',
          'visual:update:ui-docs': 'visual-check update --storybook ui-docs',
        },
      },
    ])
  })

  it('gives none to a Storybook at the root, whose scripts are the root ones', () => {
    const storybooks = [
      { name: 'acme', dir: '/acme' },
      { name: 'a', dir: '/acme/apps/a' },
    ]

    expect(packageScriptsOf(inputOf({ storybooks })).map(({ dir }) => dir)).toEqual(['/acme/apps/a'])
  })

  it("gives none to a package the package manager's list doesn't name, such as one only Nx or Rush lists", () => {
    expect(packageScriptsOf(inputOf({ listedPackageDirs: ['apps/b'] })).map(({ dir }) => dir)).toEqual(['/acme/apps/b'])
    expect(packageScriptsOf(inputOf({ listedPackageDirs: undefined }))).toEqual([])
  })
})
