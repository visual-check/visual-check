// The fixtures the Setup check sets up, in `fixtures/<name>`, and what the check expects of each: where its Storybooks
// are, the workspace's packages, the config and warnings `init` gives, and whether the check starts a Storybook.

/**
 * The fixtures the check knows, as `--fixture` names them: the folders under `fixtures/`.
 */
export const fixtureNames = ['single', 'monorepo'] as const

/**
 * A fixture the check knows.
 */
export type FixtureName = (typeof fixtureNames)[number]

/**
 * A fixture, and what the check expects of it.
 */
export interface Fixture {
  /**
   * Its name, its folder under `fixtures/`.
   */
  name: FixtureName
  /**
   * The folders of its Storybook packages, relative to its root: `.` for a Storybook at the root.
   */
  storybookDirs: string[]
  /**
   * The name of the Storybook in each package that gets scripts of its own, which check only that Storybook, by the
   * package's folder. A Storybook at the root has only the root's scripts.
   */
  packageStorybooks: Record<string, string>
  /**
   * The config `init` writes at its root.
   */
  expectedConfig: string
  /**
   * The warnings `init` must print, each a whole line of its standard error, besides the one about Docker under
   * `--init-only`.
   */
  expectedWarnings: string[]
  /**
   * What those warnings say, for the init step's line, such as `that a and b share port 6106`.
   */
  warningsDescription: string[]
  /**
   * Whether the check goes on to start its Storybook, then runs `update`, `test` and `init` again. Storybooks that
   * share a port can't all start.
   */
  startsStorybook: boolean
  /**
   * The workspace's packages, as patterns, when it is a monorepo. The check writes them where the package manager
   * reads them.
   */
  workspaces?: string[]
}

/**
 * Every fixture the check knows, by name.
 */
export const fixtures: Record<FixtureName, Fixture> = {
  // One Storybook at the root, on port 6106.
  single: {
    name: 'single',
    storybookDirs: ['.'],
    packageStorybooks: {},
    expectedConfig: `import { defineConfig } from '@visual-check/cli'

export default defineConfig({
  storybooks: {
    'setup-fixture': { url: 'http://127.0.0.1:6106' },
  },
})
`,
    expectedWarnings: [],
    warningsDescription: [],
    startsStorybook: true,
  },
  // Two Storybooks, `@setup-monorepo/a` and `@setup-monorepo/b`, both on port 6106.
  monorepo: {
    name: 'monorepo',
    storybookDirs: ['apps/a', 'apps/b'],
    packageStorybooks: { 'apps/a': 'a', 'apps/b': 'b' },
    expectedConfig: `import { defineConfig } from '@visual-check/cli'

export default defineConfig({
  storybooks: {
    a: { dir: 'apps/a', url: 'http://127.0.0.1:6106' },
    b: { dir: 'apps/b', url: 'http://127.0.0.1:6106' },
  },
})
`,
    expectedWarnings: [
      "Warning: a and b both use port 6106, so they can't run at the same time. Give each Storybook its own port.",
    ],
    warningsDescription: ['that a and b share port 6106'],
    startsStorybook: false,
    workspaces: ['apps/*'],
  },
}
