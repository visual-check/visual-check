import { describe, expect, it } from 'vitest'
import { recordingProgress } from './init-tools.fixture.js'
import { addAddons, addonTitleOf, dependenciesToAddOf, installDependencies } from './install.js'
import type { RunCommand } from './run-command.js'
import { plainSetupProgress } from './setup-progress.js'

/**
 * A command the fake `RunCommand` was asked to run.
 */
interface RecordedCommand {
  /**
   * The program.
   */
  command: string
  /**
   * The arguments.
   */
  args: readonly string[]
  /**
   * The folder it ran in.
   */
  cwd: string
}

/**
 * Makes a `RunCommand` that records each call and gives the scripted exit codes in order, 0 once they run out. A
 * scripted `'throw'` makes the call reject.
 */
function fakeRunCommand(script: readonly (number | 'throw')[] = []): {
  runCommand: RunCommand
  calls: RecordedCommand[]
} {
  const calls: RecordedCommand[] = []
  const runCommand: RunCommand = (command, args, cwd) => {
    const next = script[calls.length] ?? 0

    calls.push({ command, args, cwd })

    return next === 'throw' ? Promise.reject(new Error('boom')) : Promise.resolve(next)
  }

  return { calls, runCommand }
}

describe('dependenciesToAddOf', () => {
  const base = { root: '/p', rootManifest: {}, cliVersion: '0.0.0', browserRange: '^157.0.0' }

  it('adds all three to the root when nothing is listed', () => {
    const storybooks = [{ packageDir: '/p', manifest: {} }]

    expect(dependenciesToAddOf({ ...base, storybooks })).toEqual([
      {
        dir: '/p',
        specs: ['@visual-check/cli@0.0.0', '@visual-check/chromium@^157.0.0', '@visual-check/storybook@0.0.0'],
      },
    ])
  })

  it('skips a name that is already listed', () => {
    const manifest = { dependencies: { '@visual-check/cli': '^0.0.0' } }
    const storybooks = [{ packageDir: '/p', manifest }]

    expect(dependenciesToAddOf({ ...base, rootManifest: manifest, storybooks })).toEqual([
      { dir: '/p', specs: ['@visual-check/chromium@^157.0.0', '@visual-check/storybook@0.0.0'] },
    ])
  })

  it('gives nothing when all are listed', () => {
    const manifest = {
      devDependencies: { '@visual-check/cli': '1', '@visual-check/chromium': '1' },
      peerDependencies: { '@visual-check/storybook': '1' },
    }

    expect(
      dependenciesToAddOf({ ...base, rootManifest: manifest, storybooks: [{ packageDir: '/p', manifest }] }),
    ).toEqual([])
  })

  it('lists the Storybook package once for two Storybooks in one folder', () => {
    const storybooks = [
      { packageDir: '/p', manifest: {} },
      { packageDir: '/p', manifest: {} },
    ]

    expect(dependenciesToAddOf({ ...base, storybooks })).toEqual([
      {
        dir: '/p',
        specs: ['@visual-check/cli@0.0.0', '@visual-check/chromium@^157.0.0', '@visual-check/storybook@0.0.0'],
      },
    ])
  })

  it('keeps a Storybook in another folder apart', () => {
    const storybooks = [{ packageDir: '/p/app', manifest: {} }]

    expect(dependenciesToAddOf({ ...base, storybooks })).toEqual([
      { dir: '/p', specs: ['@visual-check/cli@0.0.0', '@visual-check/chromium@^157.0.0'] },
      { dir: '/p/app', specs: ['@visual-check/storybook@0.0.0'] },
    ])
  })
})

/**
 * A `SetupProgress` that writes nothing, for a test that reads no progress.
 */
const silentProgress = plainSetupProgress(() => undefined)

describe('addonTitleOf', () => {
  it('names the Storybook', () => {
    expect(addonTitleOf('docs')).toBe('Add the Storybook addon to docs')
  })
})

describe('installDependencies', () => {
  const installs = [
    { dir: '/p', specs: ['@visual-check/cli@0.0.0', '@visual-check/chromium@^157.0.0'] },
    { dir: '/p/app', specs: ['@visual-check/storybook@0.0.0'] },
  ]

  it('reports progress, runs each command in its folder and returns nothing', async () => {
    const { runCommand, calls } = fakeRunCommand()
    const { progress, calls: progressCalls } = recordingProgress()
    const problem = await installDependencies({ installs, packageManager: 'pnpm', runCommand, progress })

    expect(problem).toBeUndefined()
    expect(progressCalls).toEqual([
      [
        'start',
        "Install visual-check's packages",
        'pnpm add --save-dev @visual-check/cli@0.0.0 @visual-check/chromium@^157.0.0',
      ],
      ['end', 'done'],
      ['start', "Install visual-check's packages", 'pnpm add --save-dev @visual-check/storybook@0.0.0'],
      ['end', 'done'],
    ])
    expect(calls).toEqual([
      {
        command: 'pnpm',
        args: ['add', '--save-dev', '@visual-check/cli@0.0.0', '@visual-check/chromium@^157.0.0'],
        cwd: '/p',
      },
      { command: 'pnpm', args: ['add', '--save-dev', '@visual-check/storybook@0.0.0'], cwd: '/p/app' },
    ])
  })

  it('returns the problem and stops at a failure', async () => {
    const { runCommand, calls } = fakeRunCommand([2])
    const { progress, calls: progressCalls } = recordingProgress()
    const problem = await installDependencies({ installs, packageManager: 'npm', runCommand, progress })

    expect(problem).toBe(
      'npm install --save-dev @visual-check/cli@0.0.0 @visual-check/chromium@^157.0.0 failed with exit code 2. Run it yourself, then run visual-check init again.',
    )
    expect(calls).toHaveLength(1)
    expect(progressCalls).toEqual([
      [
        'start',
        "Install visual-check's packages",
        'npm install --save-dev @visual-check/cli@0.0.0 @visual-check/chromium@^157.0.0',
      ],
      ['end', 'failed'],
    ])
  })

  it('uses the yarn and bun forms', async () => {
    const storybookInstall = { dir: '/p/app', specs: ['@visual-check/storybook@0.0.0'] }
    const yarn = fakeRunCommand()
    const bun = fakeRunCommand()

    await installDependencies({
      installs: [storybookInstall],
      packageManager: 'yarn',
      runCommand: yarn.runCommand,
      progress: silentProgress,
    })
    await installDependencies({
      installs: [storybookInstall],
      packageManager: 'bun',
      runCommand: bun.runCommand,
      progress: silentProgress,
    })

    expect(yarn.calls[0]).toMatchObject({ command: 'yarn', args: ['add', '--dev', '@visual-check/storybook@0.0.0'] })
    expect(bun.calls[0]).toMatchObject({ command: 'bun', args: ['add', '--dev', '@visual-check/storybook@0.0.0'] })
  })
})

describe('addAddons', () => {
  const base = { packageManager: 'pnpm' as const, cliVersion: '0.0.0', root: '/p' }

  it('runs storybook add in the root', async () => {
    const { runCommand, calls } = fakeRunCommand()
    const { progress, calls: progressCalls } = recordingProgress()
    const warnings = await addAddons({
      ...base,
      addons: [{ configDir: '.storybook', name: 'app', packageDir: '/p' }],
      runCommand,
      progress,
    })

    expect(warnings).toEqual([])
    expect(calls).toEqual([
      {
        command: 'pnpm',
        args: ['exec', 'storybook', 'add', '@visual-check/storybook-addon@0.0.0', '--yes'],
        cwd: '/p',
      },
    ])
    expect(progressCalls).toEqual([
      ['start', 'Add the Storybook addon to app', 'pnpm exec storybook add @visual-check/storybook-addon@0.0.0 --yes'],
      ['end', 'done'],
    ])
  })

  it('passes a config folder with -c', async () => {
    const { runCommand, calls } = fakeRunCommand()

    await addAddons({
      ...base,
      addons: [
        { configDir: 'docs/.storybook', name: 'docs', packageDir: '/p' },
        { configDir: '.', name: 'root', packageDir: '/p' },
      ],
      runCommand,
      progress: silentProgress,
    })

    expect(calls.map(({ args }) => args.slice(3))).toEqual([
      ['@visual-check/storybook-addon@0.0.0', '--yes', '-c', 'docs/.storybook'],
      ['@visual-check/storybook-addon@0.0.0', '--yes', '-c', '.'],
    ])
  })

  it('warns about a failure and still runs the next addon', async () => {
    const { runCommand, calls } = fakeRunCommand([1])
    const { progress, calls: progressCalls } = recordingProgress()
    const warnings = await addAddons({
      ...base,
      addons: [
        { configDir: 'docs/.storybook', name: 'docs', packageDir: '/p' },
        { configDir: '.storybook', name: 'app', packageDir: '/p' },
      ],
      runCommand,
      progress,
    })

    expect(warnings).toEqual([
      'Warning: pnpm exec storybook add @visual-check/storybook-addon@0.0.0 --yes -c docs/.storybook failed, so docs has no addon. Run it yourself to add it.',
    ])
    expect(calls).toHaveLength(2)
    expect(progressCalls).toEqual([
      [
        'start',
        'Add the Storybook addon to docs',
        'pnpm exec storybook add @visual-check/storybook-addon@0.0.0 --yes -c docs/.storybook',
      ],
      ['end', 'warned'],
      ['start', 'Add the Storybook addon to app', 'pnpm exec storybook add @visual-check/storybook-addon@0.0.0 --yes'],
      ['end', 'done'],
    ])
  })

  it('warns when the command throws', async () => {
    const { runCommand } = fakeRunCommand(['throw'])
    const { progress, calls: progressCalls } = recordingProgress()
    const warnings = await addAddons({
      ...base,
      packageManager: 'npm',
      addons: [{ configDir: '.storybook', name: 'app', packageDir: '/p' }],
      runCommand,
      progress,
    })

    expect(warnings).toEqual([
      'Warning: npx storybook add @visual-check/storybook-addon@0.0.0 --yes failed, so app has no addon. Run it yourself to add it.',
    ])
    expect(progressCalls).toEqual([
      ['start', 'Add the Storybook addon to app', 'npx storybook add @visual-check/storybook-addon@0.0.0 --yes'],
      ['end', 'warned'],
    ])
  })
})
