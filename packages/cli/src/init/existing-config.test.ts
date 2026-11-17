import { existsSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { projectOf, storybookOf } from './detected-project.fixture.js'
import { type ExistingConfig, existingConfigOf, existingStorybooksOf } from './existing-config.js'
import {
  commandsIn,
  gitignore,
  modesFile,
  pnpmAdd,
  pnpmAddon,
  pnpmClosingMessage,
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

  it('names the Storybooks by their config folder, written like a detected one, and keeps their URLs', async () => {
    const config =
      'export default { storybooks: { ' +
      "web: { configDir: './.storybook/', url: 'http://127.0.0.1:7000' }, " +
      "docs: { dir: 'docs', url: 'http://127.0.0.1:6008' } } }\n"
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
        { name: 'web', dir: root, configDir: join(root, '.storybook'), url: 'http://127.0.0.1:7000' },
        {
          name: 'docs',
          dir: join(root, 'docs'),
          configDir: join(root, 'docs', '.storybook'),
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
      storybooks: [{ name: 'web-app', dir: root, configDir: join(root, '.storybook'), url: undefined }],
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
    const startScript = { script: 'storybook', subcommand: 'dev' as const, configDir: undefined, port: 6006 }
    const project = projectOf({ storybooks: [storybookOf({ startScript })] })
    const existing = configOf([
      { name: 'web', dir: '/project', configDir: '/project/.storybook', url: 'http://127.0.0.1:7000' },
    ])

    expect(existingStorybooksOf(project, existing, 'npm')).toEqual([
      { name: 'web', dir: '/project', configDir: '/project/.storybook', startCommand: 'npm run storybook' },
    ])
  })

  it.each([
    ['http://127.0.0.1:7000', 'pnpm exec storybook dev -p 7000'],
    ['https://storybook.example.com', 'pnpm exec storybook dev -p 6006'],
    [undefined, 'pnpm exec storybook dev -p 6006'],
  ])('starts a Storybook without a start script on the port of %s', (url, startCommand) => {
    const existing = configOf([{ name: 'web', dir: '/project', configDir: '/project/.storybook', url }])

    expect(existingStorybooksOf(projectOf(), existing, 'pnpm')[0]?.startCommand).toBe(startCommand)
  })

  it('passes a config folder that is not .storybook to storybook dev', () => {
    const existing = configOf([
      { name: 'docs', dir: '/project', configDir: '/project/docs/.storybook', url: 'http://127.0.0.1:6008' },
    ])

    expect(existingStorybooksOf(projectOf(), existing, 'yarn')[0]?.startCommand).toBe(
      'yarn storybook dev -p 6008 -c docs/.storybook',
    )
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
      stdout:
        'Wrote .storybook/visual-check.ts\n' +
        'Added the scripts visual:test and visual:update to package.json.\n' +
        `\n${pnpmClosingMessage}`,
      stderr: '',
    })
    expect(readText(root, 'visual-check.config.ts')).toBe(config)
    expect(readText(root, '.storybook/visual-check.ts')).toBe(modesFile)
    expect(record.commands).toEqual(commandsIn(root, pnpmAdd, pnpmAddon))
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
    expect(result.stdout).toContain('Wrote docs/.storybook/visual-check.ts\n')
    expect(result.stdout).toContain('  1. Start Storybook with pnpm run storybook:docs.\n')
    expect(existsSync(join(root, '.storybook/visual-check.ts'))).toBe(false)
    expect(readText(root, 'visual-check.config.ts')).toBe(config)
    expect(record.commands).toEqual(
      commandsIn(root, pnpmAdd, {
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
    expect(result.stdout).toContain('Wrote .storybook/visual-check.ts\n')
    expect(record.commands).toEqual(commandsIn(root, pnpmAdd, pnpmAddon))
  })

  it("warns of a config it can't load, leaves it alone and sets up the detected Storybooks", async () => {
    const config = "throw new Error('broken config')\n"
    const root = pnpmProject({ files: { 'visual-check.config.ts': config } })
    const { tools, record } = toolsOf()
    const result = await runInit(root, tools)

    expect(result).toEqual({
      exitCode: 0,
      stdout:
        'Wrote .storybook/visual-check.ts\n' +
        'Wrote .visual-check/.gitignore\n' +
        'Added the scripts visual:test and visual:update to package.json.\n' +
        `\n${pnpmClosingMessage}`,
      stderr:
        "Warning: visual-check init left visual-check.config.ts alone: Couldn't load visual-check.config.ts: broken config\n",
    })
    expect(readText(root, 'visual-check.config.ts')).toBe(config)
    expect(record.commands).toEqual(commandsIn(root, pnpmAdd, pnpmAddon))
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
    expect(result.stdout).toContain(`  1. Start Storybook with ${command}.\n`)
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
    expect(result.stdout).toBe(
      'Wrote .storybook/visual-check.ts\n' +
        'Wrote .visual-check/.gitignore\n' +
        'Added the scripts visual:test and visual:update to package.json.\n' +
        `\n${pnpmClosingMessage}`,
    )
    expect(existsSync(join(root, 'old'))).toBe(false)
    expect(existsSync(join(root, outside))).toBe(false)
    expect(record.commands).toEqual(commandsIn(root, pnpmAdd, pnpmAddon))
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
    expect(result.stdout).toContain('Wrote .storybook/visual-check.ts\n')
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

    expect(await runInit(root, tools)).toEqual({
      exitCode: 0,
      stdout: `Wrote .visual-check/.gitignore
Added the scripts visual:test and visual:update to package.json.

visual-check is set up. Next:
  1. Add your Storybook to visual-check.config.ts, as the hints say, then start it.
  2. Run pnpm run visual:update to write baselines. The first run downloads the browser image.
  3. Run pnpm run visual:test. It should pass. If a story fails, see https://visual-check.vercel.app/docs/broken-stories.
  4. Commit visual-check.config.ts and .visual-check/.

To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.
`,
      stderr:
        `hint: visual-check.config.ts lists the Storybook shared in ${outside}, outside this project, so init left it alone.\n` +
        "hint: visual-check.config.ts lists no Storybook in .storybook. To add it, put this under storybooks: 'web-app': { url: 'http://127.0.0.1:6006' },\n",
    })
    expect(existsSync(join(root, outside))).toBe(false)
    expect(existsSync(join(root, '.storybook/visual-check.ts'))).toBe(false)
    expect(record.commands).toEqual(commandsIn(root, pnpmAdd))
  })

  it('asks no Storybook question when a config is there', async () => {
    const root = pnpmProject({
      files: {
        'visual-check.config.ts': "export default { storybooks: { web: { url: 'http://127.0.0.1:6006' } } }\n",
      },
    })
    const prompter = scriptedPrompter(['', '', true])
    const result = await runInit(root, toolsOf({ yes: false, interactive: true, prompter }).tools)

    expect(result.exitCode).toBe(0)
    expect(prompter.records).toEqual([
      { kind: 'text', message: 'Name of the script that runs visual-check test', defaultValue: 'visual:test' },
      { kind: 'text', message: 'Name of the script that runs visual-check update', defaultValue: 'visual:update' },
      { kind: 'confirm', message: 'Add the Storybook addon to web?', defaultValue: true },
    ])
    expect(prompter.unused()).toEqual([])
  })
})
