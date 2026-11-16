import type { DetectedProject, DetectedStorybook } from './detect-project.js'

/**
 * Builds a Storybook `init` found, with the config folder `.storybook` and version `10.6.7` unless given.
 */
export function storybookOf(overrides: Partial<DetectedStorybook> = {}): DetectedStorybook {
  return {
    configDir: '.storybook',
    packageDir: '/project',
    defaultName: 'project',
    startScript: undefined,
    version: '10.6.7',
    ...overrides,
  }
}

/**
 * Builds a project `init` detected that has nothing wrong with it: one Storybook, no Deno file, a readable manifest.
 */
export function projectOf(overrides: Partial<DetectedProject> = {}): DetectedProject {
  return {
    root: '/project',
    manifest: {},
    manifestPath: '/project/package.json',
    manifestProblem: undefined,
    packageManager: 'pnpm',
    denoFile: undefined,
    storybooks: [storybookOf()],
    ...overrides,
  }
}
