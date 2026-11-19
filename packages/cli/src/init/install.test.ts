import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { recordingProgress } from './init-tools.fixture.js'
import {
  addAddons,
  addonStepsOf,
  addonTitleOf,
  dependenciesToAddOf,
  installDependencies,
  installStepsOf,
  manualInstallTextOf,
  rushInstallOf,
} from './install.js'
import type { PackageManager } from './package-manager.js'
import { makeProject, removeProjects } from './project.fixture.js'
import type { RunCommand } from './run-command.js'
import type { PackageManagerLists } from './workspace.js'

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

afterEach(() => {
  removeProjects()
})

describe('dependenciesToAddOf', () => {
  const base = { root: '/p', rootManifest: {}, addons: [], cliVersion: '0.0.0', browserRange: '^157.0.0' }

  /**
   * The browser entry the root gets when it doesn't list the browser: the CLI's range, not exact.
   */
  const browserAdd = { dir: '/p', specs: ['@visual-check/chromium@^157.0.0'], exact: false }

  it('adds the CLI and the Storybook package exactly, then the browser at its range, when nothing is listed', () => {
    const storybooks = [{ manifestDir: '/p', manifest: {} }]

    expect(dependenciesToAddOf({ ...base, storybooks })).toEqual([
      { dir: '/p', specs: ['@visual-check/cli@0.0.0', '@visual-check/storybook@0.0.0'], exact: true },
      browserAdd,
    ])
  })

  it('skips a name that is already listed', () => {
    const manifest = { dependencies: { '@visual-check/cli': '^0.0.0' } }
    const storybooks = [{ manifestDir: '/p', manifest }]

    expect(dependenciesToAddOf({ ...base, rootManifest: manifest, storybooks })).toEqual([
      { dir: '/p', specs: ['@visual-check/storybook@0.0.0'], exact: true },
      browserAdd,
    ])
  })

  it('gives the browser alone when the root lists everything else', () => {
    const manifest = { devDependencies: { '@visual-check/cli': '1', '@visual-check/storybook': '1' } }

    expect(
      dependenciesToAddOf({ ...base, rootManifest: manifest, storybooks: [{ manifestDir: '/p', manifest }] }),
    ).toEqual([browserAdd])
  })

  it('gives nothing when all are listed', () => {
    const manifest = {
      devDependencies: { '@visual-check/cli': '1', '@visual-check/chromium': '1' },
      peerDependencies: { '@visual-check/storybook': '1' },
    }

    expect(
      dependenciesToAddOf({ ...base, rootManifest: manifest, storybooks: [{ manifestDir: '/p', manifest }] }),
    ).toEqual([])
  })

  it('lists the Storybook package once for two Storybooks in one folder', () => {
    const storybooks = [
      { manifestDir: '/p', manifest: {} },
      { manifestDir: '/p', manifest: {} },
    ]

    expect(dependenciesToAddOf({ ...base, storybooks })).toEqual([
      { dir: '/p', specs: ['@visual-check/cli@0.0.0', '@visual-check/storybook@0.0.0'], exact: true },
      browserAdd,
    ])
  })

  it('keeps a Storybook in another folder apart, after the browser', () => {
    const storybooks = [{ manifestDir: '/p/app', manifest: {} }]

    expect(dependenciesToAddOf({ ...base, storybooks })).toEqual([
      { dir: '/p', specs: ['@visual-check/cli@0.0.0'], exact: true },
      browserAdd,
      { dir: '/p/app', specs: ['@visual-check/storybook@0.0.0'], exact: true },
    ])
  })

  it("adds the addon to the add of the Storybook's package, once for two Storybooks there", () => {
    const storybooks = [{ manifestDir: '/p/app', manifest: {} }]
    const addons = [
      { manifestDir: '/p/app', manifest: {} },
      { manifestDir: '/p/app', manifest: {} },
    ]

    expect(dependenciesToAddOf({ ...base, storybooks, addons })).toEqual([
      { dir: '/p', specs: ['@visual-check/cli@0.0.0'], exact: true },
      browserAdd,
      {
        dir: '/p/app',
        specs: ['@visual-check/storybook@0.0.0', '@visual-check/storybook-addon@0.0.0'],
        exact: true,
      },
    ])
  })

  it('skips the addon for a package that lists it', () => {
    const manifest = { devDependencies: { '@visual-check/storybook-addon': '0.0.0' } }

    expect(
      dependenciesToAddOf({
        ...base,
        storybooks: [{ manifestDir: '/p/app', manifest }],
        addons: [{ manifestDir: '/p/app', manifest }],
      }),
    ).toEqual([
      { dir: '/p', specs: ['@visual-check/cli@0.0.0'], exact: true },
      browserAdd,
      { dir: '/p/app', specs: ['@visual-check/storybook@0.0.0'], exact: true },
    ])
  })
})

describe('installStepsOf', () => {
  const rootSpecs = ['@visual-check/cli@1.0.0']
  const browserSpecs = ['@visual-check/chromium@^157.0.0']
  const packageSpecs = ['@visual-check/storybook@1.0.0']

  /**
   * The lists of a workspace at `/p` whose package manager lists name `packages/ui` only, under pnpm's own list or
   * `package.json#workspaces`.
   */
  const workspaceLists = {
    pnpm: { pnpm: ['packages/ui'], workspaces: undefined },
    workspaces: { pnpm: undefined, workspaces: ['packages/ui'] },
  } satisfies Record<string, PackageManagerLists>

  /**
   * The lists of a root that holds none.
   */
  const noLists: PackageManagerLists = { pnpm: undefined, workspaces: undefined }

  /**
   * Returns the lists of the workspace whose list `packageManager` reads names `packages/ui`.
   */
  function listsFor(packageManager: PackageManager): PackageManagerLists {
    return packageManager === 'pnpm' ? workspaceLists.pnpm : workspaceLists.workspaces
  }

  /**
   * Plans the add of `specs` in `dir` under `packageManager`, and gives each command as shown, with its folder.
   */
  function planned(
    packageManager: PackageManager,
    install: { dir: string; specs: string[]; exact: boolean },
    packageManagerLists: PackageManagerLists,
    yarnBerry = false,
  ): [string, string][] {
    return installStepsOf({
      installs: [install],
      packageManager,
      yarnBerry,
      root: '/p',
      packageManagerLists,
    }).map(({ dir: runDir, commandLine }) => [runDir, [commandLine.command, ...commandLine.args].join(' ')])
  }

  it.each<[string, PackageManager, boolean, string, string]>([
    ['npm', 'npm', false, 'npm install --save-dev --save-exact', 'npm install --save-dev'],
    ['pnpm', 'pnpm', false, 'pnpm add --save-dev --save-exact', 'pnpm add --save-dev'],
    ['Yarn 1', 'yarn', false, 'yarn add --dev --exact', 'yarn add --dev'],
    ['Yarn 4', 'yarn', true, 'yarn add --dev --exact', 'yarn add --dev'],
    ['bun', 'bun', false, 'bun add --dev --exact', 'bun add --dev'],
  ])(
    'adds at a lone root under %s: exact, then the browser at its range',
    (_, packageManager, yarnBerry, exact, ranged) => {
      expect(planned(packageManager, { dir: '/p', specs: rootSpecs, exact: true }, noLists, yarnBerry)).toEqual([
        ['/p', `${exact} ${rootSpecs.join(' ')}`],
      ])
      expect(planned(packageManager, { dir: '/p', specs: browserSpecs, exact: false }, noLists, yarnBerry)).toEqual([
        ['/p', `${ranged} ${browserSpecs.join(' ')}`],
      ])
    },
  )

  it.each<[string, PackageManager, boolean, string, string]>([
    ['npm', 'npm', false, 'npm install --save-dev --save-exact', 'npm install --save-dev'],
    ['pnpm', 'pnpm', false, 'pnpm add --save-dev --save-exact -w', 'pnpm add --save-dev -w'],
    ['Yarn 1', 'yarn', false, 'yarn add --dev --exact -W', 'yarn add --dev -W'],
    ['Yarn 4', 'yarn', true, 'yarn add --dev --exact', 'yarn add --dev'],
    ['bun', 'bun', false, 'bun add --dev --exact', 'bun add --dev'],
  ])(
    "adds to a workspace root its package manager's list names packages in under %s",
    (_, packageManager, yarnBerry, exact, ranged) => {
      const lists = listsFor(packageManager)

      expect(planned(packageManager, { dir: '/p', specs: rootSpecs, exact: true }, lists, yarnBerry)).toEqual([
        ['/p', `${exact} ${rootSpecs.join(' ')}`],
      ])
      expect(planned(packageManager, { dir: '/p', specs: browserSpecs, exact: false }, lists, yarnBerry)).toEqual([
        ['/p', `${ranged} ${browserSpecs.join(' ')}`],
      ])
    },
  )

  it('adds -w at a pnpm root whose pnpm-workspace.yaml lists no packages', () => {
    const lists = { pnpm: [], workspaces: undefined }

    expect(planned('pnpm', { dir: '/p', specs: rootSpecs, exact: true }, lists)).toEqual([
      ['/p', `pnpm add --save-dev --save-exact -w ${rootSpecs.join(' ')}`],
    ])
  })

  it.each<[PackageManager, PackageManagerLists, string]>([
    ['pnpm', workspaceLists.workspaces, 'pnpm add --save-dev --save-exact'],
    ['yarn', workspaceLists.pnpm, 'yarn add --dev --exact'],
  ])(
    'takes no root flag under %s when only another package manager lists packages',
    (packageManager, lists, command) => {
      expect(planned(packageManager, { dir: '/p', specs: rootSpecs, exact: true }, lists)).toEqual([
        ['/p', `${command} ${rootSpecs.join(' ')}`],
      ])
    },
  )

  it.each<[string, PackageManager, boolean, string, string]>([
    ['npm', 'npm', false, '/p', 'npm install --save-dev --save-exact --workspace packages/ui'],
    ['pnpm', 'pnpm', false, '/p/packages/ui', 'pnpm add --save-dev --save-exact'],
    ['Yarn 1', 'yarn', false, '/p/packages/ui', 'yarn add --dev --exact'],
    ['Yarn 4', 'yarn', true, '/p/packages/ui', 'yarn add --dev --exact'],
    ['bun', 'bun', false, '/p/packages/ui', 'bun add --dev --exact'],
  ])('adds to a package its list names under %s', (_, packageManager, yarnBerry, runDir, command) => {
    const install = { dir: '/p/packages/ui', specs: packageSpecs, exact: true }

    expect(planned(packageManager, install, listsFor(packageManager), yarnBerry)).toEqual([
      [runDir, `${command} ${packageSpecs.join(' ')}`],
    ])
  })

  it.each<[string, PackageManager, boolean, string]>([
    ['npm', 'npm', false, 'npm install --save-dev --save-exact'],
    ['pnpm', 'pnpm', false, 'pnpm add --save-dev --save-exact'],
    ['Yarn 1', 'yarn', false, 'yarn add --dev --exact'],
    ['Yarn 4', 'yarn', true, 'yarn add --dev --exact'],
    ['bun', 'bun', false, 'bun add --dev --exact'],
  ])("adds in the folder of a package its list doesn't name under %s", (_, packageManager, yarnBerry, command) => {
    const install = { dir: '/p/libs/ui', specs: packageSpecs, exact: true }

    expect(planned(packageManager, install, listsFor(packageManager), yarnBerry)).toEqual([
      ['/p/libs/ui', `${command} ${packageSpecs.join(' ')}`],
    ])
  })

  it('keeps the order of the entries, each titled after what it installs and where', () => {
    const steps = installStepsOf({
      installs: [
        { dir: '/p', specs: rootSpecs, exact: true },
        { dir: '/p', specs: browserSpecs, exact: false },
        { dir: '/p/packages/ui', specs: packageSpecs, exact: true },
      ],
      packageManager: 'npm',
      yarnBerry: false,
      root: '/p',
      packageManagerLists: workspaceLists.workspaces,
    })

    expect(steps).toEqual([
      {
        title: "Install visual-check's packages",
        dir: '/p',
        commandLine: { command: 'npm', args: ['install', '--save-dev', '--save-exact', ...rootSpecs] },
      },
      {
        title: 'Install the browser package',
        dir: '/p',
        commandLine: { command: 'npm', args: ['install', '--save-dev', ...browserSpecs] },
      },
      {
        title: "Install visual-check's packages in packages/ui",
        dir: '/p',
        commandLine: {
          command: 'npm',
          args: ['install', '--save-dev', '--save-exact', '--workspace', 'packages/ui', ...packageSpecs],
        },
      },
    ])
  })
})

describe('addonTitleOf', () => {
  it('names the Storybook', () => {
    expect(addonTitleOf('docs')).toBe('Add the Storybook addon to docs')
  })
})

describe('installDependencies', () => {
  const steps = [
    {
      title: "Install visual-check's packages",
      dir: '/p',
      commandLine: { command: 'pnpm', args: ['add', '--save-dev', '--save-exact', '@visual-check/cli@0.0.0'] },
    },
    {
      title: "Install visual-check's packages in app",
      dir: '/p/app',
      commandLine: { command: 'pnpm', args: ['add', '--save-dev', '--save-exact', '@visual-check/storybook@0.0.0'] },
    },
  ]

  it('reports progress under each title, runs each command in its folder and returns nothing', async () => {
    const { runCommand, calls } = fakeRunCommand()
    const { progress, calls: progressCalls } = recordingProgress()
    const problem = await installDependencies({ steps, cwd: '/p', runCommand, progress })

    expect(problem).toBeUndefined()
    expect(progressCalls).toEqual([
      ['start', "Install visual-check's packages", 'pnpm add --save-dev --save-exact @visual-check/cli@0.0.0'],
      ['end', 'done'],
      [
        'start',
        "Install visual-check's packages in app",
        'pnpm add --save-dev --save-exact @visual-check/storybook@0.0.0',
      ],
      ['end', 'done'],
    ])
    expect(calls).toEqual(steps.map(({ dir, commandLine }) => ({ ...commandLine, cwd: dir })))
  })

  it('returns the problem and stops at a failure', async () => {
    const { runCommand, calls } = fakeRunCommand([2])
    const { progress, calls: progressCalls } = recordingProgress()
    const problem = await installDependencies({ steps, cwd: '/p', runCommand, progress })

    expect(problem).toBe(
      'pnpm add --save-dev --save-exact @visual-check/cli@0.0.0 failed with exit code 2. Run it yourself, then run visual-check init again.',
    )
    expect(calls).toHaveLength(1)
    expect(progressCalls).toEqual([
      ['start', "Install visual-check's packages", 'pnpm add --save-dev --save-exact @visual-check/cli@0.0.0'],
      ['end', 'failed'],
    ])
  })

  it('names the folder to run a failed command in, relative to where init runs', async () => {
    const fromRoot = await installDependencies({
      steps,
      cwd: '/p',
      ...fakeRunCommand([0, 1]),
      progress: recordingProgress().progress,
    })
    const fromPackage = await installDependencies({
      steps,
      cwd: '/p/app/src',
      ...fakeRunCommand([1]),
      progress: recordingProgress().progress,
    })

    expect(fromRoot).toBe(
      'pnpm add --save-dev --save-exact @visual-check/storybook@0.0.0 failed with exit code 1. Run it yourself in app, then run visual-check init again.',
    )
    expect(fromPackage).toBe(
      'pnpm add --save-dev --save-exact @visual-check/cli@0.0.0 failed with exit code 1. Run it yourself in ../.., then run visual-check init again.',
    )
  })

  it('quotes a spec holding ^ in the problem, as a person copies it', async () => {
    const { progress, calls: progressCalls } = recordingProgress()
    const problem = await installDependencies({
      steps: [
        {
          title: "Install visual-check's packages",
          dir: '/p',
          commandLine: { command: 'pnpm', args: ['add', '--save-dev', '@visual-check/chromium@^157.0.0'] },
        },
      ],
      cwd: '/p',
      ...fakeRunCommand([1]),
      progress,
    })

    expect(problem).toBe(
      'pnpm add --save-dev "@visual-check/chromium@^157.0.0" failed with exit code 1. Run it yourself, then run visual-check init again.',
    )
    expect(progressCalls[0]).toEqual([
      'start',
      "Install visual-check's packages",
      'pnpm add --save-dev @visual-check/chromium@^157.0.0',
    ])
  })
})

describe('addonStepsOf', () => {
  const base = { packageManager: 'pnpm' as const, yarnBerry: false, cliVersion: '0.0.0', root: '/p' }

  /**
   * An addon answer for the Storybook in `configDir`, relative to the root, of the package in `packageDir`.
   */
  function addonOf(configDir: string, name: string, packageDir: string) {
    return { configDir, name, packageDir, manifestDir: packageDir, manifest: {} }
  }

  it("runs storybook add with --skip-install in the Storybook's package folder, and pins in its package.json", () => {
    expect(addonStepsOf({ ...base, addons: [addonOf('packages/ui/.storybook', 'ui', '/p/packages/ui')] })).toEqual([
      {
        name: 'ui',
        dir: '/p/packages/ui',
        commandLine: {
          command: 'pnpm',
          args: ['exec', 'storybook', 'add', '@visual-check/storybook-addon@0.0.0', '--yes', '--skip-install'],
        },
        manifestDir: '/p/packages/ui',
        version: '0.0.0',
      },
    ])
  })

  it("pins in the package.json of the Storybook's dependencies when its package has none", () => {
    const [step] = addonStepsOf({
      ...base,
      addons: [{ ...addonOf('libs/ui/.storybook', 'ui', '/p/libs/ui'), manifestDir: '/p' }],
    })

    expect(step).toMatchObject({ dir: '/p/libs/ui', manifestDir: '/p' })
  })

  it('passes a config folder other than .storybook with -c, relative to the package folder', () => {
    const steps = addonStepsOf({
      ...base,
      addons: [
        addonOf('packages/ui/docs/.storybook', 'docs', '/p/packages/ui'),
        addonOf('docs/.storybook', 'root-docs', '/p'),
        addonOf('.', 'root', '/p'),
      ],
    })

    expect(steps.map(({ dir, commandLine }) => [dir, commandLine.args.slice(5)])).toEqual([
      ['/p/packages/ui', ['--skip-install', '-c', 'docs/.storybook']],
      ['/p', ['--skip-install', '-c', 'docs/.storybook']],
      ['/p', ['--skip-install', '-c', '.']],
    ])
  })

  it.each<[PackageManager, boolean, string]>([
    ['npm', false, 'npx storybook'],
    ['yarn', false, 'npx --no-install storybook'],
    ['yarn', true, 'yarn exec storybook'],
    ['bun', false, 'bunx storybook'],
  ])("uses %s's runner, Yarn 2 or later: %s", (packageManager, yarnBerry, runner) => {
    const [step] = addonStepsOf({ ...base, packageManager, yarnBerry, addons: [addonOf('.storybook', 'app', '/p')] })

    expect([step?.commandLine.command, ...(step?.commandLine.args ?? [])].join(' ')).toBe(
      `${runner} add @visual-check/storybook-addon@0.0.0 --yes --skip-install`,
    )
  })
})

describe('addAddons', () => {
  /**
   * The `storybook add` step of the Storybook `name` in `dir`, whose addon is in the `package.json` in `manifestDir`,
   * with `extraArgs` after `--skip-install`.
   */
  function stepOf(name: string, dir: string, manifestDir = dir, extraArgs: string[] = []) {
    return {
      name,
      dir,
      manifestDir,
      version: '0.0.0',
      commandLine: {
        command: 'pnpm',
        args: [
          'exec',
          'storybook',
          'add',
          '@visual-check/storybook-addon@0.0.0',
          '--yes',
          '--skip-install',
          ...extraArgs,
        ],
      },
    }
  }

  /**
   * The `package.json` `storybook add` leaves: the addon at the `^` range it saves, two-space indented, after a key it
   * keeps in front.
   */
  const rangedManifest = {
    name: 'app',
    devDependencies: { '@visual-check/storybook-addon': '^0.0.0', storybook: '10.6.7' },
  }

  it("runs storybook add in the Storybook's folder, then sets the addon back to its exact version", async () => {
    const root = makeProject({
      manifest: { name: 'app', devDependencies: { '@visual-check/storybook-addon': '0.0.0' } },
    })
    const { runCommand, calls } = fakeRunCommand()
    const { progress, calls: progressCalls } = recordingProgress()
    const step = stepOf('app', join(root, 'app'), root)
    const warnings = await addAddons({
      steps: [step],
      cwd: root,
      runCommand: async (...args) => {
        writeFileSync(join(root, 'package.json'), `${JSON.stringify(rangedManifest, null, 2)}\n`)

        return runCommand(...args)
      },
      progress,
    })

    expect(warnings).toEqual([])
    expect(calls).toEqual([{ ...step.commandLine, cwd: join(root, 'app') }])
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(
      `${JSON.stringify(
        {
          ...rangedManifest,
          devDependencies: { ...rangedManifest.devDependencies, '@visual-check/storybook-addon': '0.0.0' },
        },
        null,
        2,
      )}\n`,
    )
    expect(progressCalls).toEqual([
      [
        'start',
        'Add the Storybook addon to app',
        'pnpm exec storybook add @visual-check/storybook-addon@0.0.0 --yes --skip-install',
      ],
      ['end', 'done'],
    ])
  })

  it('leaves a package.json storybook add kept exact as it is', async () => {
    const text = '{ "devDependencies": { "@visual-check/storybook-addon": "0.0.0" } }'
    const root = makeProject({ manifest: text })

    expect(
      await addAddons({
        steps: [stepOf('app', root)],
        cwd: root,
        ...fakeRunCommand(),
        progress: recordingProgress().progress,
      }),
    ).toEqual([])
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(text)
  })

  it("warns when the addon's spec can't be set back, naming the package.json relative to where init runs", async () => {
    const root = makeProject({})
    const { progress, calls: progressCalls } = recordingProgress()
    const warnings = await addAddons({
      steps: [stepOf('app', join(root, 'packages/app'))],
      cwd: root,
      ...fakeRunCommand(),
      progress,
    })

    expect(warnings).toEqual([
      "Warning: storybook add saved @visual-check/storybook-addon at a range, and init couldn't set " +
        '@visual-check/storybook-addon back to "0.0.0" in packages/app/package.json. Set it yourself.',
    ])
    expect(progressCalls.at(-1)).toEqual(['end', 'warned'])
  })

  it('leaves package.json alone after a failed storybook add', async () => {
    const root = makeProject({ manifest: rangedManifest })
    const before = readFileSync(join(root, 'package.json'), 'utf8')

    await addAddons({
      steps: [stepOf('app', root)],
      cwd: root,
      ...fakeRunCommand([1]),
      progress: recordingProgress().progress,
    })

    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before)
  })

  it('warns about a failure and still runs the next addon', async () => {
    const root = makeProject({ manifest: rangedManifest })
    const { runCommand, calls } = fakeRunCommand([1])
    const { progress, calls: progressCalls } = recordingProgress()
    const warnings = await addAddons({
      steps: [stepOf('docs', root, root, ['-c', 'docs/.storybook']), stepOf('app', root)],
      cwd: root,
      runCommand,
      progress,
    })

    expect(warnings).toEqual([
      'Warning: pnpm exec storybook add @visual-check/storybook-addon@0.0.0 --yes --skip-install -c docs/.storybook ' +
        'failed, so docs has no addon. Run it yourself to add it, then set @visual-check/storybook-addon back to ' +
        '"0.0.0" in package.json.',
    ])
    expect(calls).toHaveLength(2)
    expect(progressCalls).toEqual([
      [
        'start',
        'Add the Storybook addon to docs',
        'pnpm exec storybook add @visual-check/storybook-addon@0.0.0 --yes --skip-install -c docs/.storybook',
      ],
      ['end', 'warned'],
      [
        'start',
        'Add the Storybook addon to app',
        'pnpm exec storybook add @visual-check/storybook-addon@0.0.0 --yes --skip-install',
      ],
      ['end', 'done'],
    ])
  })

  it('warns when the command throws, naming the folder to run it in and the package.json to fix', async () => {
    const { runCommand } = fakeRunCommand(['throw'])
    const { progress, calls: progressCalls } = recordingProgress()
    const warnings = await addAddons({
      steps: [stepOf('app', '/p/packages/app/sb', '/p/packages/app')],
      cwd: '/p',
      runCommand,
      progress,
    })

    expect(warnings).toEqual([
      'Warning: pnpm exec storybook add @visual-check/storybook-addon@0.0.0 --yes --skip-install failed, so app has ' +
        'no addon. Run it yourself in packages/app/sb to add it, then set @visual-check/storybook-addon back to ' +
        '"0.0.0" in packages/app/package.json.',
    ])
    expect(progressCalls.at(-1)).toEqual(['end', 'warned'])
  })
})

describe('rushInstallOf', () => {
  const context = {
    packageManager: 'pnpm' as const,
    yarnBerry: false,
    root: '/p',
    cwd: '/p',
    packageManagerLists: { pnpm: undefined, workspaces: undefined },
  }
  const installs = [
    { dir: '/p', specs: ['@visual-check/cli@1.0.0'], exact: true },
    { dir: '/p', specs: ['@visual-check/chromium@^157.0.0'], exact: false },
    {
      dir: '/p/libs/ui',
      specs: ['@visual-check/storybook@1.0.0', '@visual-check/storybook-addon@1.0.0'],
      exact: true,
    },
  ]
  const addonSteps = addonStepsOf({
    addons: [
      {
        configDir: 'libs/ui/docs',
        name: 'ui',
        packageDir: '/p/libs/ui',
        manifestDir: '/p/libs/ui',
        manifest: {},
      },
    ],
    packageManager: 'pnpm',
    yarnBerry: false,
    cliVersion: '1.0.0',
    root: '/p',
  })

  it('runs storybook add first, then adds the root with its package manager and each project with rush add', () => {
    expect(rushInstallOf({ ...context, installs, addonSteps })).toEqual({
      heading: "Add the Storybook addon and install visual-check's packages yourself:",
      commands: [
        'cd libs/ui && pnpm exec storybook add @visual-check/storybook-addon@1.0.0 --yes --skip-install -c docs',
        'pnpm add --save-dev --save-exact @visual-check/cli@1.0.0',
        'pnpm add --save-dev "@visual-check/chromium@^157.0.0"',
        'cd libs/ui && rush add --dev --exact --skip-update -p @visual-check/storybook@1.0.0 -p @visual-check/storybook-addon@1.0.0',
        'rush update',
      ],
    })
  })

  it("uses Rush's package manager's own flags at the root, and quotes a spec holding ^", () => {
    const manualInstall = rushInstallOf({
      ...context,
      packageManager: 'yarn',
      installs: installs.slice(0, 2),
      addonSteps: [],
    })

    expect(manualInstall?.commands.slice(0, 2)).toEqual([
      'yarn add --dev --exact @visual-check/cli@1.0.0',
      'yarn add --dev "@visual-check/chromium@^157.0.0"',
    ])
  })

  it('quotes a spec holding ^ in rush add', () => {
    const manualInstall = rushInstallOf({
      ...context,
      installs: [{ dir: '/p/libs/ui', specs: ['a@^1.0.0'], exact: true }],
      addonSteps: [],
    })

    expect(manualInstall?.commands[0]).toBe('cd libs/ui && rush add --dev --exact --skip-update -p "a@^1.0.0"')
  })

  it('leaves the addon out of the heading when no Storybook gets it', () => {
    expect(rushInstallOf({ ...context, installs: installs.slice(0, 1), addonSteps: [] })).toEqual({
      heading: "Install visual-check's packages yourself:",
      commands: ['pnpm add --save-dev --save-exact @visual-check/cli@1.0.0', 'rush update'],
    })
  })

  it('names the root to run the commands from, which stay relative to it, when init runs in a project', () => {
    const manualInstall = rushInstallOf({ ...context, cwd: '/p/libs/ui', installs, addonSteps })

    expect(manualInstall?.heading).toBe(
      "Add the Storybook addon and install visual-check's packages yourself, from ../..:",
    )
    expect(manualInstall?.commands[0]).toBe(
      'cd libs/ui && pnpm exec storybook add @visual-check/storybook-addon@1.0.0 --yes --skip-install -c docs',
    )
    expect(
      rushInstallOf({ ...context, cwd: '/p/libs/ui', installs: installs.slice(0, 1), addonSteps: [] })?.heading,
    ).toBe("Install visual-check's packages yourself, from ../..:")
  })

  it('gives nothing when there is nothing to add', () => {
    expect(rushInstallOf({ ...context, installs: [], addonSteps: [] })).toBeUndefined()
  })
})

describe('manualInstallTextOf', () => {
  it('gives the heading, then each command indented on its own line', () => {
    expect(manualInstallTextOf({ heading: 'Install:', commands: ['rush add -p a', 'rush update'] })).toBe(
      'Install:\n  rush add -p a\n  rush update',
    )
  })
})
