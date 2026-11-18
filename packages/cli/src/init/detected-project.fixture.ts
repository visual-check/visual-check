import type { DetectedProject, DetectedStorybook } from './detect-project.js'
import type { StorybookStart } from './storybook-start.js'

/**
 * Builds a Storybook `init` found, with the config folder `.storybook` in the root package and version `10.6.7`
 * unless given. Its dependencies go in its package unless `manifestDir` says otherwise.
 */
export function storybookOf(overrides: Partial<DetectedStorybook> = {}): DetectedStorybook {
  const packageDir = overrides.packageDir ?? '/project'

  return {
    configDir: '.storybook',
    packageDir,
    manifestDir: packageDir,
    manifest: {},
    manifestProblem: undefined,
    packageName: undefined,
    defaultName: 'project',
    start: undefined,
    version: '10.6.7',
    ...overrides,
  }
}

/**
 * Builds the start of a Storybook whose `script`, in the `package.json` in `packageDir` (the root package's unless
 * given) named `packageName` (none unless given), runs `storybook dev` on `port`, with no `-c`.
 */
export function scriptStartOf(
  script: string,
  port: number | undefined,
  packageDir = '/project',
  packageName: string | undefined = undefined,
): StorybookStart {
  return { kind: 'script', call: { script, subcommand: 'dev', configDir: undefined, port }, packageDir, packageName }
}

/**
 * Builds a project `init` detected that has nothing wrong with it: a lone package with one Storybook, no Deno file, a
 * readable manifest.
 */
export function projectOf(overrides: Partial<DetectedProject> = {}): DetectedProject {
  return {
    root: '/project',
    manifest: {},
    manifestPath: '/project/package.json',
    hasManifest: true,
    manifestProblem: undefined,
    packageManager: 'pnpm',
    yarnBerry: false,
    denoFile: undefined,
    workspace: { kind: 'single', packageDirs: ['.'], packageManagerLists: { pnpm: false, workspaces: false } },
    storybooks: [storybookOf()],
    notes: [],
    ...overrides,
  }
}
