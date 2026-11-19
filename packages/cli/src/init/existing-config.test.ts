import { existsSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { projectOf, scriptStartOf, storybookOf } from './detected-project.fixture.js'
import { type ExistingConfig, existingConfigOf, existingStorybooksOf } from './existing-config.js'
import {
  commandsIn,
  gitignore,
  modesFile,
  pnpmAdd,
  pnpmAddBrowser,
  pnpmAddon,
  pnpmClosingMessage,
  pnpmNextSteps,
  toolsOf,
} from './init-tools.fixture.js'
import { makeProject, pnpmProject, readText, removeProjects } from './project.fixture.js'
import { scriptedPrompter } from './prompter.fixture.js'
import { runInit } from './run-init.js'

afterEach(() => {
  removeProjects()
})

describe('existingConfigOf', () => {
  it('gives undefined when there is no config', async () => {
    const root = makeProject({ manifest: {}, files: { '.storybook/main.ts': '' } })

    expect(await existingConfigOf(root, projectOf({ root, storybooks: [storybookOf({ packageDir: root })] }))).toBe(
      undefined,
    )
  })

  it('names the Storybooks by their config folder, written like a detected one, and keeps their URLs and baselines', async () => {
    const config =
      'export default { storybooks: { ' +
      "web: { configDir: './.storybook/', url: 'http://127.0.0.1:7000' }, " +
      "docs: { dir: 'docs', baselines: 'shots', url: 'http://127.0.0.1:6008' } } }\n"
    const root = makeProject({
      manifest: {},
      files: { '.storybook/main.ts': '', 'docs/.storybook/main.ts': '', 'visual-check.config.ts': config },
    })
    const project = projectOf({
      root,
      storybooks: [
        storybookOf({ packageDir: root }),
        storybookOf({ configDir: 'docs/.storybook', packageDir: root, defaultName: 'docs' }),
      ],
    })

    expect(await existingConfigOf(root, project)).toEqual({
      path: join(root, 'visual-check.config.ts'),
      names: { '.storybook': 'web', 'docs/.storybook': 'docs' },
      storybooks: [
        {
          name: 'web',
          dir: root,
          configDir: join(root, '.storybook'),
          baselines: join(root, '.visual-check', 'baselines'),
          url: 'http://127.0.0.1:7000',
        },
        {
          name: 'docs',
          dir: join(root, 'docs'),
          configDir: join(root, 'docs', '.storybook'),
          baselines: join(root, 'docs', 'shots'),
          url: 'http://127.0.0.1:6008',
        },
      ],
      notes: [],
    })
  })

  it("stands the detected Storybooks in for a config it can't load, with their default names", async () => {
    const root = makeProject({
      manifest: {},
      files: { '.storybook/main.ts': '', 'visual-check.config.ts': "throw new Error('broken config')\n" },
    })
    const project = projectOf({ root, storybooks: [storybookOf({ packageDir: root, defaultName: 'web-app' })] })

    expect(await existingConfigOf(join(root, 'src'), project)).toEqual({
      path: join(root, 'visual-check.config.ts'),
      names: { '.storybook': 'web-app' },
      storybooks: [
        {
          name: 'web-app',
          dir: root,
          configDir: join(root, '.storybook'),
          baselines: join(root, '.visual-check', 'baselines'),
          url: undefined,
        },
      ],
      notes: [
        "Warning: visual-check init left ../visual-check.config.ts alone: Couldn't load ../visual-check.config.ts: broken config",
      ],
    })
  })
})

describe('existingStorybooksOf', () => {
  /**
   * Builds a config at `/project` that holds `storybooks`.
   */
  function configOf(storybooks: ExistingConfig['storybooks']): ExistingConfig {
    return { path: '/project/visual-check.config.ts', names: {}, storybooks, notes: [] }
  }

  it('starts a Storybook with its start script', () => {
    const start = scriptStartOf('storybook', 6006)
    const project = projectOf({ storybooks: [storybookOf({ start })] })
    const existing = configOf([
      {
        name: 'web',
        dir: '/project',
        configDir: '/project/.storybook',
        baselines: '/project/shots',
        url: 'http://127.0.0.1:7000',
      },
    ])

    expect(existingStorybooksOf(project, existing, 'npm')).toEqual([
      {
        name: 'web',
        dir: '/project',
        configDir: '/project/.storybook',
        baselines: '/project/shots',
        startCommand: 'npm run storybook',
      },
    ])
  })

  it.each([
    ['http://127.0.0.1:7000', 'pnpm exec storybook dev -p 7000'],
    ['https://storybook.example.com', 'pnpm exec storybook dev -p 6006'],
    [undefined, 'pnpm exec storybook dev -p 6006'],
  ])('starts a Storybook without a start script on the port of %s', (url, startCommand) => {
    const existing = configOf([
      {
        name: 'web',
        dir: '/project',
        configDir: '/project/.storybook',
        baselines: '/project/.visual-check/baselines',
        url,
      },
    ])

    expect(existingStorybooksOf(projectOf(), existing, 'pnpm')[0]?.startCommand).toBe(startCommand)
  })

  it('passes a config folder that is not .storybook to storybook dev', () => {
    const existing = configOf([
      {
        name: 'docs',
        dir: '/project',
        configDir: '/project/docs/.storybook',
        baselines: '/project/.visual-check/baselines',
        url: 'http://127.0.0.1:6008',
      },
    ])

    expect(existingStorybooksOf(projectOf(), existing, 'yarn')[0]?.startCommand).toBe(
      'npx --no-install storybook dev -p 6008 -c docs/.storybook',
    )
    expect(existingStorybooksOf(projectOf({ yarnBerry: true }), existing, 'yarn')[0]?.startCommand).toBe(
      'yarn exec storybook dev -p 6008 -c docs/.storybook',
    )
  })
})

describe('existingStorybooksOf with an Nx start', () => {
  it("starts a Storybook with Nx's storybook target through the package manager", () => {
    const project = projectOf({
      storybooks: [
        storybookOf({
          configDir: 'libs/ui/.storybook',
          start: { kind: 'nx', project: 'ui', target: 'storybook', port: 4400 },
        }),
      ],
    })
    const existing: ExistingConfig = {
      path: '/project/visual-check.config.ts',
      names: {},
      storybooks: [
        {
          name: 'ui',
          dir: '/project/libs/ui',
          configDir: '/project/libs/ui/.storybook',
          baselines: '/project/libs/ui/.visual-check/baselines',
          url: 'http://127.0.0.1:4400',
        },
      ],
      notes: [],
    }

    expect(existingStorybooksOf(project, existing, 'pnpm')[0]?.startCommand).toBe('pnpm exec nx run ui:storybook')
  })
})

describe('existingConfigOf in a workspace', () => {
  it("hints at a package's Storybook the config leaves out, with the package folder and its start's port", async () => {
    const root = makeProject({
      manifest: { name: 'acme' },
      files: {
        'visual-check.config.ts': "export default { storybooks: { web: { url: 'http://127.0.0.1:6006' } } }\n",
        '.storybook/main.ts': '',
        'packages/ui/.storybook/main.ts': '',
      },
    })
    const project = projectOf({
      root,
      storybooks: [
        storybookOf({
          configDir: 'packages/ui/.storybook',
          packageDir: join(root, 'packages/ui'),
          defaultName: 'ui',
          start: scriptStartOf('storybook', 6100),
        }),
      ],
    })

    expect((await existingConfigOf(join(root, 'packages/ui'), project))?.notes).toEqual([
      "hint: ../../visual-check.config.ts lists no Storybook in packages/ui/.storybook. To add it, put this under storybooks: ui: { dir: 'packages/ui', url: 'http://127.0.0.1:6100' },",
    ])
  })
})

describe('init run again with a config there', () => {
  it("adds a Storybook's missing visual-check.ts and leaves the config alone", async () => {
    const config = "export default { storybooks: { web: { url: 'http://127.0.0.1:6006' } } }\n"
    const root = pnpmProject({
      files: { 'visual-check.config.ts': config, '.visual-check/.gitignore': gitignore },
    })
    const { tools, record } = toolsOf()
    const result = await runInit(root, tools)

    expect(result).toEqual({
      exitCode: 0,
      stdout: pnpmClosingMessage,
      stderr: '',
      messages: [],
      summary: { nextSteps: pnpmNextSteps },
    })
    expect(readText(root, 'visual-check.config.ts')).toBe(config)
    expect(readText(root, '.storybook/visual-check.ts')).toBe(modesFile)
    expect(record.commands).toEqual(commandsIn(root, pnpmAdd, pnpmAddBrowser, pnpmAddon))
  })

  it('hints at each detected Storybook the config leaves out, and sets up only the ones it holds', async () => {
    const config =
      "export default { storybooks: { docs: { configDir: 'docs/.storybook', url: 'http://127.0.0.1:6008' } } }\n"
    const root = pnpmProject({
      manifest: {
        scripts: { storybook: 'storybook dev -p 6007', 'storybook:docs': 'storybook dev -p 6008 -c docs/.storybook' },
      },
      files: { 'docs/.storybook/main.ts': '', 'visual-check.config.ts': config },
    })
    const { tools, record } = toolsOf()
    const result = await runInit(root, tools)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe(
      "hint: visual-check.config.ts lists no Storybook in .storybook. To add it, put this under storybooks: 'web-app': { url: 'http://127.0.0.1:6007' },\n",
    )
    expect(readText(root, 'docs/.storybook/visual-check.ts')).toBe(modesFile)
    expect(readText(root, '.visual-check/.gitignore')).toBe(gitignore)
    expect(result.stdout).toContain('  1. pnpm run storybook:docs   Start Storybook, and keep it running\n')
    expect(result.stdout).toContain('To set options for every story, see docs/.storybook/visual-check.ts.\n')
    expect(existsSync(join(root, '.storybook/visual-check.ts'))).toBe(false)
    expect(readText(root, 'visual-check.config.ts')).toBe(config)
    expect(record.commands).toEqual(
      commandsIn(root, pnpmAdd, pnpmAddBrowser, {
        command: 'pnpm',
        args: [...pnpmAddon.args, '-c', 'docs/.storybook'],
      }),
    )
  })

  it("matches the config's Storybooks by their config folder, however it is written", async () => {
    const config =
      "export default { storybooks: { web: { configDir: './.storybook/', url: 'http://127.0.0.1:6006' } } }\n"
    const root = pnpmProject({ files: { 'visual-check.config.ts': config } })
    const { tools, record } = toolsOf()
    const result = await runInit(root, tools)

    expect(result.stderr).toBe('')
    expect(readText(root, '.storybook/visual-check.ts')).toBe(modesFile)
    expect(readText(root, '.visual-check/.gitignore')).toBe(gitignore)
    expect(record.commands).toEqual(commandsIn(root, pnpmAdd, pnpmAddBrowser, pnpmAddon))
  })

  describe('reads the baselines folder the config names, to tell whether to write the first baselines', () => {
    /**
     * The config of the pnpm project's one Storybook, which keeps its baselines in `shots/`.
     */
    const config = "export default { storybooks: { web: { baselines: 'shots', url: 'http://127.0.0.1:6006' } } }\n"

    it('leaves the step out when that folder has a baseline', async () => {
      const root = pnpmProject({ files: { 'visual-check.config.ts': config, 'shots/button--primary.png': 'png' } })
      const result = await runInit(root, toolsOf().tools)

      expect(result.stdout).toBe(`visual-check is set up. Next:
  1. pnpm run storybook      Start Storybook, and keep it running
  2. pnpm run visual:check   Check the stories against the baselines
  3. Commit the changes, baselines included

To set options for every story, see .storybook/visual-check.ts.
To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.
`)
    })

    it('keeps the step when only the default folder has a baseline', async () => {
      const root = pnpmProject({
        files: { 'visual-check.config.ts': config, '.visual-check/baselines/button--primary.png': 'png' },
      })

      expect((await runInit(root, toolsOf().tools)).stdout).toBe(pnpmClosingMessage)
    })
  })

  it("warns of a config it can't load, leaves it alone and sets up the detected Storybooks", async () => {
    const config = "throw new Error('broken config')\n"
    const root = pnpmProject({ files: { 'visual-check.config.ts': config } })
    const { tools, record } = toolsOf()
    const result = await runInit(root, tools)

    const warning =
      "Warning: visual-check init left visual-check.config.ts alone: Couldn't load visual-check.config.ts: broken config"

    expect(result).toEqual({
      exitCode: 0,
      stdout: pnpmClosingMessage,
      stderr: `${warning}\n`,
      messages: [warning],
      summary: { nextSteps: pnpmNextSteps },
    })
    expect(readText(root, 'visual-check.config.ts')).toBe(config)
    expect(readText(root, '.storybook/visual-check.ts')).toBe(modesFile)
    expect(readText(root, '.visual-check/.gitignore')).toBe(gitignore)
    expect(record.commands).toEqual(commandsIn(root, pnpmAdd, pnpmAddBrowser, pnpmAddon))
  })

  it.each([
    ['http://127.0.0.1:7000', 'pnpm exec storybook dev -p 7000'],
    ['https://storybook.example.com', 'pnpm exec storybook dev -p 6006'],
  ])("starts a Storybook without a start script on its config URL's port: %s", async (url, command) => {
    const root = pnpmProject({
      manifest: { scripts: {} },
      files: { 'visual-check.config.ts': `export default { storybooks: { web: { url: '${url}' } } }\n` },
    })
    const result = await runInit(root, toolsOf().tools)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`  1. ${command}   Start Storybook, and keep it running\n`)
  })

  it('gives a left-out Storybook a name no Storybook in the config has', async () => {
    const config =
      "export default { storybooks: { 'web-app': { configDir: 'docs/.storybook', url: 'http://127.0.0.1:6008' } } }\n"
    const root = pnpmProject({
      files: { 'docs/.storybook/main.ts': '', 'visual-check.config.ts': config },
    })
    const result = await runInit(root, toolsOf().tools)

    expect(result.stderr).toBe(
      "hint: visual-check.config.ts lists no Storybook in .storybook. To add it, put this under storybooks: 'web-app-2': { url: 'http://127.0.0.1:6006' },\n",
    )
  })

  it('leaves alone a Storybook of the config outside the project or without a main file, and writes nothing for it', async () => {
    const root = pnpmProject()
    const outside = `../${basename(root)}-elsewhere`
    const config =
      'export default { storybooks: { ' +
      "web: { url: 'http://127.0.0.1:6006' }, " +
      "old: { dir: 'old', url: 'http://127.0.0.1:6007' }, " +
      `shared: { dir: '${outside}', url: 'http://127.0.0.1:6008' } } }\n`

    writeFileSync(join(root, 'visual-check.config.ts'), config)

    const { tools, record } = toolsOf()
    const result = await runInit(root, tools)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe(
      'hint: visual-check.config.ts lists the Storybook old in old/.storybook, which has no main file, so init left it alone.\n' +
        `hint: visual-check.config.ts lists the Storybook shared in ${outside}, outside this project, so init left it alone.\n`,
    )
    expect(result.stdout).toBe(pnpmClosingMessage)
    expect(readText(root, '.storybook/visual-check.ts')).toBe(modesFile)
    expect(readText(root, '.visual-check/.gitignore')).toBe(gitignore)
    expect(existsSync(join(root, 'old'))).toBe(false)
    expect(existsSync(join(root, outside))).toBe(false)
    expect(record.commands).toEqual(commandsIn(root, pnpmAdd, pnpmAddBrowser, pnpmAddon))
  })

  it('leaves alone a Storybook whose config folder is outside the project, even with its folder inside', async () => {
    const root = pnpmProject()
    const outside = `${basename(root)}-elsewhere`
    const config =
      'export default { storybooks: { ' +
      "web: { url: 'http://127.0.0.1:6006' }, " +
      `docs: { dir: 'docs', configDir: '../../${outside}/.storybook', url: 'http://127.0.0.1:6007' } } }\n`

    writeFileSync(join(root, 'visual-check.config.ts'), config)

    const result = await runInit(root, toolsOf().tools)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe(
      `hint: visual-check.config.ts lists the Storybook docs in ../${outside}/.storybook, outside this project, so init left it alone.\n`,
    )
    expect(readText(root, '.storybook/visual-check.ts')).toBe(modesFile)
    expect(existsSync(join(root, 'docs'))).toBe(false)
    expect(existsSync(join(root, '..', outside))).toBe(false)
  })

  it('tells to add the Storybook when the config holds none in the project', async () => {
    const root = pnpmProject()
    const outside = `../${basename(root)}-elsewhere`

    writeFileSync(
      join(root, 'visual-check.config.ts'),
      `export default { storybooks: { shared: { dir: '${outside}', url: 'http://127.0.0.1:6008' } } }\n`,
    )

    const { tools, record } = toolsOf()

    const hints = [
      `hint: visual-check.config.ts lists the Storybook shared in ${outside}, outside this project, so init left it alone.`,
      "hint: visual-check.config.ts lists no Storybook in .storybook. To add it, put this under storybooks: 'web-app': { url: 'http://127.0.0.1:6006' },",
    ]

    expect(await runInit(root, tools)).toEqual({
      exitCode: 0,
      stdout: `visual-check is set up. Next:
  1. Add your Storybook to visual-check.config.ts, as the hints say, then start it
  2. pnpm run visual:update   Write the first baselines
  3. pnpm run visual:check    Check the stories against the baselines
  4. Commit the changes, baselines included

To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.
`,
      stderr: hints.map((hint) => `${hint}\n`).join(''),
      messages: hints,
      summary: {
        nextSteps: {
          steps: [
            [
              {
                text: [
                  'Add your Storybook to ',
                  { code: 'visual-check.config.ts' },
                  ', as the hints say, then start it',
                ],
              },
            ],
            [{ command: 'pnpm run visual:update', text: ['Write the first baselines'] }],
            [{ command: 'pnpm run visual:check', text: ['Check the stories against the baselines'] }],
            [{ text: ['Commit the changes, baselines included'] }],
          ],
          modesFiles: [],
          ciUrl: 'https://visual-check.vercel.app/docs/ci',
        },
      },
    })
    expect(readText(root, '.visual-check/.gitignore')).toBe(gitignore)
    expect(existsSync(join(root, outside))).toBe(false)
    expect(existsSync(join(root, '.storybook/visual-check.ts'))).toBe(false)
    // Only the config's Storybooks get the Storybook package, and this config holds none in the project.
    expect(record.commands).toEqual(
      commandsIn(
        root,
        { command: 'pnpm', args: pnpmAdd.args.filter((arg) => !/^@visual-check\/storybook(-addon)?@/.test(arg)) },
        pnpmAddBrowser,
      ),
    )
  })

  it('asks no Storybook question when a config is there', async () => {
    const root = pnpmProject({
      files: {
        'visual-check.config.ts': "export default { storybooks: { web: { url: 'http://127.0.0.1:6006' } } }\n",
      },
    })
    const prompter = scriptedPrompter(['', '', ''])
    const result = await runInit(root, toolsOf({ yes: false, interactive: true, prompter }).tools)

    expect(result.exitCode).toBe(0)
    expect(prompter.records.map(({ kind, message, defaultValue }) => ({ kind, message, defaultValue }))).toEqual([
      { kind: 'text', message: 'Name of the script that runs visual-check test', defaultValue: 'visual:check' },
      { kind: 'text', message: 'Name of the script that runs visual-check update', defaultValue: 'visual:update' },
      { kind: 'confirm', message: 'Add the Storybook addon to web?', defaultValue: true },
    ])
    expect(prompter.unused()).toEqual([])
  })
})
