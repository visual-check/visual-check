import { describe, expect, it } from 'vitest'
import { projectOf, scriptStartOf, storybookOf } from './detected-project.fixture.js'
import type { PackageManager } from './package-manager.js'
import { type SkillStorybook, skillSetupOf } from './skill-setup.js'

/**
 * A Storybook in `apps/web`, with its config in `.storybook` there, on `http://127.0.0.1:6100`, unless given.
 */
function webOf(overrides: Partial<SkillStorybook> = {}): SkillStorybook {
  return {
    name: 'web',
    dir: '/project/apps/web',
    configDir: '/project/apps/web/.storybook',
    url: 'http://127.0.0.1:6100',
    ...overrides,
  }
}

/**
 * The setup of a project whose one Storybook `init` found no start for, the given one, under `packageManager`.
 */
function noStartSetupOf(storybook: SkillStorybook, packageManager: PackageManager = 'pnpm') {
  const project = projectOf({ storybooks: [storybookOf({ configDir: 'apps/web/.storybook', start: undefined })] })

  return skillSetupOf({ project, packageManager, storybooks: [storybook] })
}

describe('skillSetupOf', () => {
  it('runs the CLI from the root and a root start script with the package manager', () => {
    const project = projectOf({ storybooks: [storybookOf({ start: scriptStartOf('storybook', 6006) })] })
    const storybooks = [
      { name: 'web', dir: '/project', configDir: '/project/.storybook', url: 'http://localhost:6006' },
    ]

    expect(skillSetupOf({ project, packageManager: 'pnpm', storybooks })).toEqual({
      cli: { command: ['pnpm', 'exec', 'visual-check'], cwd: '/project' },
      storybooks: { web: { command: ['pnpm', 'run', 'storybook'], cwd: '/project' } },
    })
  })

  it("runs a workspace package's start script in that package's folder", () => {
    const start = scriptStartOf('storybook', 6006, '/project/apps/web', 'web')
    const project = projectOf({
      packageManager: 'npm',
      storybooks: [storybookOf({ configDir: 'apps/web/.storybook', start })],
    })
    const setup = skillSetupOf({ project, packageManager: 'npm', storybooks: [webOf()] })

    expect(setup.cli.command).toEqual(['npx', '--no-install', 'visual-check'])
    expect(setup.storybooks.web).toEqual({ command: ['npm', 'run', 'storybook'], cwd: '/project/apps/web' })
  })

  it.each([
    [true, ['yarn', 'exec', 'visual-check']],
    [false, ['npx', '--no-install', 'visual-check']],
  ])('runs the CLI under Yarn, Yarn 2 or later: %s, never downloading', (yarnBerry, command) => {
    const project = projectOf({ packageManager: 'yarn', yarnBerry })

    expect(skillSetupOf({ project, packageManager: 'yarn', storybooks: [] }).cli.command).toEqual(command)
  })

  it('runs an Nx target from the root', () => {
    const start = { kind: 'nx', project: 'web', target: 'storybook', port: 4400 } as const
    const project = projectOf({ storybooks: [storybookOf({ configDir: 'apps/web/.storybook', start })] })
    const setup = skillSetupOf({ project, packageManager: 'pnpm', storybooks: [webOf()] })

    expect(setup.storybooks.web).toEqual({ command: ['pnpm', 'exec', 'nx', 'run', 'web:storybook'], cwd: '/project' })
  })

  it("starts a Storybook with no start found on its URL's port in its folder", () => {
    expect(noStartSetupOf(webOf()).storybooks.web).toEqual({
      command: ['pnpm', 'exec', 'storybook', 'dev', '-p', '6100'],
      cwd: '/project/apps/web',
    })
  })

  it("names a config folder that isn't .storybook", () => {
    const setup = noStartSetupOf(webOf({ configDir: '/project/apps/web/config/storybook' }))

    expect(setup.storybooks.web?.command).toEqual([
      'pnpm',
      'exec',
      'storybook',
      'dev',
      '-p',
      '6100',
      '-c',
      'config/storybook',
    ])
  })

  it('starts on the default port when the URL is unknown', () => {
    expect(noStartSetupOf(webOf({ url: undefined })).storybooks.web?.command).toEqual([
      'pnpm',
      'exec',
      'storybook',
      'dev',
      '-p',
      '6006',
    ])
  })

  it('starts Storybook under npm without downloading', () => {
    expect(noStartSetupOf(webOf(), 'npm').storybooks.web?.command).toEqual([
      'npx',
      '--no-install',
      'storybook',
      'dev',
      '-p',
      '6100',
    ])
  })

  it('keeps the Storybooks in the order given, except that integer-like names come first', () => {
    const names = ['zeta', 'alpha', '2', 'mid', '1']
    const storybooks = names.map((name) => webOf({ name }))
    const setup = skillSetupOf({ project: projectOf({ storybooks: [] }), packageManager: 'pnpm', storybooks })

    expect(Object.keys(setup.storybooks)).toEqual(['1', '2', 'zeta', 'alpha', 'mid'])
  })
})
