import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { skillSourcePaths, skillVersionOf } from '../agent-skill/skill-markdown.js'
import { ContainerError, DockerMissingError } from '../container/container-error.js'
import { closingMessageTextOf } from './closing-message.js'
import {
  browserVersion,
  cliVersion,
  commandsIn,
  gitignore,
  modesFile,
  type ProgressCall,
  pnpmAdd,
  pnpmAddBrowser,
  pnpmAddon,
  pnpmAddWithoutAddon,
  pnpmClosingMessage,
  pnpmNextSteps,
  toolsOf,
} from './init-tools.fixture.js'
import { makeProject, pnpmProject, readText, removeProjects, snapshotFiles } from './project.fixture.js'
import { scriptedPrompter } from './prompter.fixture.js'
import { defaultsPrompter, InputEndedError } from './prompter.js'
import { type InitResult, runInit } from './run-init.js'

/**
 * The config `init` writes for the one Storybook of the pnpm project.
 */
const webAppConfig = `import { defineConfig } from '@visual-check/cli'

export default defineConfig({
  storybooks: {
    'web-app': { url: 'http://127.0.0.1:6006' },
  },
})
`

/**
 * Where `init` installs the agent skill, relative to the project root.
 */
const skillDir = '.agents/skills/visual-check'

/**
 * Where `init` shows the agent skill to Claude Code, relative to the project root.
 */
const claudeSkillDir = '.claude/skills/visual-check'

/**
 * The CLI command the agent skill's `setup.json` holds for a pnpm project, run from the workspace root.
 */
const skillCli = { command: ['pnpm', 'exec', 'visual-check'], cwd: '../../..' }

/**
 * Reads the agent skill's `setup.json` in the project at `root`.
 */
function skillSetupIn(root: string): unknown {
  return JSON.parse(readText(root, `${skillDir}/setup.json`))
}

/**
 * The sentence a missing or stopped Docker gets after its message.
 */
const dockerFix = "Start or install Docker before you run visual-check update, or set platform: 'host' in the config."

/**
 * The title of the install step of the pnpm project.
 */
const installTitle = "Install visual-check's packages"

/**
 * The plan call of the pnpm project.
 */
const pnpmPlan: ProgressCall = [
  'plan',
  [
    'Write the files and scripts',
    installTitle,
    'Install the browser package',
    'Add the Storybook addon to web-app',
    'Check for unlisted dependencies',
  ],
]

/**
 * The calls to the progress of a run on the pnpm project that gets as far as the first install, whose outcome is
 * `install`. One that succeeds goes on to add the browser package.
 */
function installProgressOf(install: 'done' | 'failed'): ProgressCall[] {
  return [
    pnpmPlan,
    ['start', 'Write the files and scripts'],
    ['end', 'done'],
    ['start', installTitle, `${pnpmAdd.command} ${pnpmAdd.args.join(' ')}`],
    ['end', install],
    ...(install === 'done'
      ? ([
          ['start', 'Install the browser package', `${pnpmAddBrowser.command} ${pnpmAddBrowser.args.join(' ')}`],
          ['end', 'done'],
        ] as const)
      : []),
  ]
}

/**
 * The calls to the progress of a run on the pnpm project that gets to the end, where the addon and the Fallow check
 * end as given.
 */
function fullProgressOf(addon: 'done' | 'warned', check: 'done' | 'warned'): ProgressCall[] {
  return [
    ...installProgressOf('done'),
    ['start', 'Add the Storybook addon to web-app', `${pnpmAddon.command} ${pnpmAddon.args.join(' ')}`],
    ['end', addon],
    ['start', 'Check for unlisted dependencies'],
    ['end', check],
  ]
}

/**
 * The summary of a run that sets up the pnpm project from scratch.
 */
const pnpmSummary: InitResult['summary'] = { nextSteps: pnpmNextSteps }

/**
 * The stderr that holds `messages`: each, then a line break.
 */
function stderrOf(messages: readonly string[]): string {
  return messages.map((message) => `${message}\n`).join('')
}

afterEach(() => {
  removeProjects()
})

describe('runInit', () => {
  it('sets up a pnpm project with --yes', async () => {
    const root = pnpmProject()
    const { tools, record } = toolsOf()
    const result = await runInit(root, tools)

    expect(result).toEqual({
      exitCode: 0,
      stdout: pnpmClosingMessage,
      stderr: '',
      messages: [],
      summary: pnpmSummary,
    })
    expect(readText(root, 'visual-check.config.ts')).toBe(webAppConfig)
    expect(readText(root, '.storybook/visual-check.ts')).toBe(modesFile)
    expect(readText(root, '.visual-check/.gitignore')).toBe(gitignore)
    expect(JSON.parse(readText(root, 'package.json')).scripts).toEqual({
      storybook: 'storybook dev -p 6006',
      'visual:check': 'visual-check test',
      'visual:update': 'visual-check update',
    })
    expect(record.commands).toEqual(commandsIn(root, pnpmAdd, pnpmAddBrowser, pnpmAddon))
    expect(record.progress).toEqual(fullProgressOf('done', 'done'))
    expect(record.probes).toBe(1)
    expect(record.fallowRoots).toEqual([root])
  })

  it('says to run the next steps from the project root when it runs in a subfolder, with the paths relative to it', async () => {
    const root = pnpmProject({ files: { 'src/a.ts': '' } })
    const result = await runInit(join(root, 'src'), toolsOf().tools)

    expect(result.stdout).toContain(`visual-check is set up. Next, from ${basename(root)}:\n`)
    expect(result.stdout).toContain('To set options for every story, see .storybook/visual-check.ts.\n')
  })

  describe('each check that stops it writes nothing and runs nothing', () => {
    it.each([
      {
        name: 'Node below 22',
        project: () => pnpmProject(),
        tools: { nodeVersion: '20.18.0' },
        messages: [
          'visual-check needs Node 22 or later, and this is Node 20.18.0. Upgrade Node, then run visual-check init again.',
        ],
      },
      {
        name: 'a package.json that is not an object',
        project: () => makeProject({ manifest: '[]\n', files: { '.storybook/main.ts': '' } }),
        tools: {},
        messages: [
          "visual-check init can't read package.json: the file must hold a JSON object. Fix it, then run visual-check init again.",
        ],
      },
      {
        name: 'Deno',
        project: () => pnpmProject({ files: { 'deno.json': '{}\n' } }),
        tools: {},
        messages: [
          "visual-check doesn't support Deno, and this project has deno.json. Run visual-check init in a Node project.",
        ],
      },
      {
        name: 'no terminal without --yes',
        project: () => pnpmProject(),
        tools: { yes: false, interactive: false },
        messages: [
          "visual-check init asks questions, and there's no terminal to ask them in. Run it in a terminal, or pass --yes to take every default.",
        ],
      },
      {
        name: 'no Storybook',
        project: () => makeProject({ manifest: { name: 'web-app' }, storybookVersion: '10.6.7' }),
        tools: {},
        messages: [
          'visual-check init found no Storybook: git lists no .storybook/main file (.ts, .js, .mjs, .cjs, .mts or .cts), and no script in package.json passes -c to storybook. Add Storybook, then run visual-check init again.',
        ],
      },
      {
        name: 'storybook 9.0.0',
        project: () => pnpmProject({ storybookVersion: '9.0.0' }),
        tools: {},
        messages: (root: string) => [
          `The Storybook in ${basename(root)} runs storybook 9.0.0, and visual-check needs 9.1 or later. Upgrade storybook, then run visual-check init again.`,
        ],
      },
      {
        name: 'no package.json',
        project: () => makeProject({ files: { '.storybook/main.ts': '' } }),
        tools: {},
        messages: [
          "visual-check init found no package.json in the current folder or its parents. Run it in your project's folder.",
        ],
      },
      {
        name: 'no package.json with Node below 22',
        project: () => makeProject({ files: { '.storybook/main.ts': '' } }),
        tools: { nodeVersion: '20.18.0' },
        messages: [
          'visual-check needs Node 22 or later, and this is Node 20.18.0. Upgrade Node, then run visual-check init again.',
          "visual-check init found no package.json in the current folder or its parents. Run it in your project's folder.",
        ],
      },
    ])('$name', async ({ project, tools: overrides, messages: expectedMessages }) => {
      const root = project()
      const messages = typeof expectedMessages === 'function' ? expectedMessages(root) : expectedMessages
      const before = snapshotFiles(root)
      const prompter = scriptedPrompter([])
      const { tools, record } = toolsOf({ ...overrides, prompter })

      expect(await runInit(root, tools)).toEqual({ exitCode: 2, stdout: '', stderr: stderrOf(messages), messages })
      expect(snapshotFiles(root)).toEqual(before)
      expect(record).toEqual({ commands: [], progress: [], probes: 0, fallowRoots: [] })
      expect(prompter.records).toEqual([])
    })

    it('lists every problem at once', async () => {
      const root = pnpmProject({ storybookVersion: '9.0.0', files: { 'deno.lock': '' } })
      const result = await runInit(root, toolsOf({ nodeVersion: '20.18.0', yes: false }).tools)

      expect(result.exitCode).toBe(2)
      expect(result.stderr.split('\n')).toEqual([
        'visual-check needs Node 22 or later, and this is Node 20.18.0. Upgrade Node, then run visual-check init again.',
        "visual-check doesn't support Deno, and this project has deno.lock. Run visual-check init in a Node project.",
        "visual-check init asks questions, and there's no terminal to ask them in. Run it in a terminal, or pass --yes to take every default.",
        `The Storybook in ${basename(root)} runs storybook 9.0.0, and visual-check needs 9.1 or later. Upgrade storybook, then run visual-check init again.`,
        '',
      ])
    })
  })

  describe('each warning still writes', () => {
    /**
     * Expects the run to have written the three files of the pnpm project and printed the closing message.
     */
    function expectWritten(root: string, stdout: string): void {
      expect(readText(root, 'visual-check.config.ts')).toContain("import { defineConfig } from '@visual-check/cli'")
      expect(readText(root, '.storybook/visual-check.ts')).toBe(modesFile)
      expect(readText(root, '.visual-check/.gitignore')).toBe(gitignore)
      expect(stdout.endsWith(pnpmClosingMessage)).toBe(true)
    }

    it('warns of storybook 12.0.0 before the questions and asks nothing about the addon', async () => {
      const root = pnpmProject({ storybookVersion: '12.0.0' })
      const prompter = scriptedPrompter(['', '', '', '', ''])
      const { tools, record } = toolsOf({ yes: false, interactive: true, prompter })
      const result = await runInit(root, tools)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(prompter.records[0]).toEqual({
        kind: 'note',
        message: `Warning: ${basename(root)} runs storybook 12.0.0, newer than the versions visual-check is tested on (9.1 to 11).`,
      })
      expectWritten(root, result.stdout)
      expect(prompter.records.filter(({ kind }) => kind === 'checklist')).toEqual([])
      expect(prompter.unused()).toEqual([])
      expect(record.commands).toEqual(commandsIn(root, pnpmAddWithoutAddon, pnpmAddBrowser))
    })

    it.each([
      {
        name: 'Docker missing on Linux',
        error: new DockerMissingError(
          "visual-check runs the browser in Docker, and there's no docker command on PATH.",
        ),
        os: 'linux' as const,
        warning: `Warning: visual-check runs the browser in Docker, and there's no docker command on PATH. ${dockerFix}`,
      },
      {
        name: 'Docker missing on Windows',
        error: new DockerMissingError(
          "visual-check runs the browser in Docker, and there's no docker command on PATH.",
        ),
        os: 'win32' as const,
        warning: `Warning: visual-check runs the browser in Docker, and there's no docker command on PATH. ${dockerFix} If Docker runs inside WSL, run visual-check from inside WSL too.`,
      },
      {
        name: "Docker's daemon down",
        error: new ContainerError("Docker's daemon isn't running, or visual-check can't reach its socket: refused."),
        os: 'linux' as const,
        warning: `Warning: Docker's daemon isn't running, or visual-check can't reach its socket: refused. ${dockerFix}`,
      },
      {
        name: 'Docker on Windows containers',
        error: new ContainerError('Docker runs Windows containers. Switch it to Linux containers.', 'linux-containers'),
        os: 'win32' as const,
        warning: 'Warning: Docker runs Windows containers. Switch it to Linux containers.',
      },
    ])('warns of $name', async ({ error, os, warning }) => {
      const root = pnpmProject()
      const { tools, record } = toolsOf({ os }, { dockerError: error })
      const result = await runInit(root, tools)

      expect(result).toEqual({
        exitCode: 0,
        stdout: pnpmClosingMessage,
        stderr: `${warning}\n`,
        messages: [warning],
        summary: pnpmSummary,
      })
      expect(record.probes).toBe(1)
      expectWritten(root, result.stdout)
    })

    it("warns when the URL's port isn't the start command's", async () => {
      const root = pnpmProject()
      const prompter = scriptedPrompter(['', 'http://127.0.0.1:7000', '', '', '', ''])
      const result = await runInit(root, toolsOf({ yes: false, interactive: true, prompter }).tools)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe(
        "Warning: web-app's URL, http://127.0.0.1:7000, has port 7000, and its start command, pnpm run storybook, starts Storybook on port 6006.\n",
      )
      expectWritten(root, result.stdout)
      expect(readText(root, 'visual-check.config.ts')).toContain("'web-app': { url: 'http://127.0.0.1:7000' },")
      expect(prompter.unused()).toEqual([])
    })

    it('warns when Fallow finds an unlisted dependency', async () => {
      const root = pnpmProject()
      const fallow = [{ name: 'leftpad-zz', paths: ['src/a.js'] }]
      const { tools, record } = toolsOf({}, { fallow })
      const result = await runInit(root, tools)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe(
        "Warning: package.json doesn't list leftpad-zz, imported in src/a.js. visual-check can't tell which stories it affects.\n",
      )
      expectWritten(root, result.stdout)
      expect(record.progress).toEqual(fullProgressOf('done', 'warned'))
    })

    it('warns when storybook add fails, and carries on', async () => {
      const root = pnpmProject()
      const { tools, record } = toolsOf({}, { exitCodes: [0, 0, 1] })
      const result = await runInit(root, tools)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe(
        `Warning: pnpm exec storybook add @visual-check/storybook-addon@${cliVersion} --yes --skip-install failed, so web-app has no addon. Run it yourself to add it, then set @visual-check/storybook-addon back to "${cliVersion}" in package.json.\n`,
      )
      expectWritten(root, result.stdout)
      expect(record.fallowRoots).toEqual([root])
      expect(record.progress).toEqual(fullProgressOf('warned', 'done'))
    })

    it('warns when Fallow throws', async () => {
      const root = pnpmProject()
      const { tools, record } = toolsOf({}, { fallow: new Error('Fallow broke.') })
      const result = await runInit(root, tools)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe("Warning: Fallow couldn't check the imports: Fallow broke.\n")
      expectWritten(root, result.stdout)
      expect(record.progress).toEqual(fullProgressOf('done', 'warned'))
    })

    it('keeps a warning that spans lines as one message', async () => {
      const root = pnpmProject()
      const warning = "Warning: Fallow couldn't check the imports: Fallow broke.\nIt could not read tsconfig.json."
      const result = await runInit(
        root,
        toolsOf({}, { fallow: new Error('Fallow broke.\nIt could not read tsconfig.json.') }).tools,
      )

      expect(result.messages).toEqual([warning])
      expect(result.stderr).toBe(`${warning}\n`)
    })

    it('hints at adding a port when the start script sets none, and uses 6006', async () => {
      const root = pnpmProject({ manifest: { scripts: { storybook: 'storybook dev' } } })
      const result = await runInit(root, toolsOf().tools)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe(
        "hint: The storybook script sets no port. Add -p 6006 to it, so Storybook always starts on the port in web-app's URL.\n",
      )
      expect(readText(root, 'visual-check.config.ts')).toBe(webAppConfig)
    })

    it('prints the hints and warnings in the order they arose', async () => {
      const root = pnpmProject({ manifest: { scripts: { storybook: 'storybook dev' } } })
      const error = new ContainerError("Docker's daemon isn't running.")
      const result = await runInit(root, toolsOf({}, { dockerError: error, exitCodes: [0, 0, 1] }).tools)

      expect(result.stderr.split('\n')).toEqual([
        `Warning: Docker's daemon isn't running. ${dockerFix}`,
        "hint: The storybook script sets no port. Add -p 6006 to it, so Storybook always starts on the port in web-app's URL.",
        `Warning: pnpm exec storybook add @visual-check/storybook-addon@${cliVersion} --yes --skip-install failed, so web-app has no addon. Run it yourself to add it, then set @visual-check/storybook-addon back to "${cliVersion}" in package.json.`,
        '',
      ])
    })
  })

  it('never touches preview, main, turbo.json, nx.json, .gitignore or the other scripts', async () => {
    const files = {
      '.storybook/main.ts': "export default { stories: ['../src/**/*.stories.ts'] }\n",
      '.storybook/preview.ts': 'export default { parameters: {} }\n',
      'turbo.json': '{ "tasks": {} }\n',
      'nx.json': '{}\n',
      '.gitignore': 'node_modules\n',
    }
    const manifest = {
      name: 'web-app',
      private: true,
      packageManager: 'pnpm@9.12.3',
      scripts: { build: 'storybook build', storybook: 'storybook dev -p 6006' },
      devDependencies: { storybook: '10.6.7' },
    }
    const root = makeProject({ manifest, files, storybookVersion: '10.6.7' })
    const before = snapshotFiles(root)

    expect((await runInit(root, toolsOf().tools)).exitCode).toBe(0)

    const after = snapshotFiles(root)

    for (const path of Object.keys(files)) {
      expect(after[path]).toBe(before[path])
    }

    expect(readText(root, 'package.json')).toBe(
      `${JSON.stringify(
        {
          ...manifest,
          scripts: { ...manifest.scripts, 'visual:check': 'visual-check test', 'visual:update': 'visual-check update' },
        },
        null,
        2,
      )}\n`,
    )
  })

  it('changes nothing when run a second time', async () => {
    const root = pnpmProject()
    const first = await runInit(root, toolsOf({}, { installs: true }).tools)
    const before = snapshotFiles(root)
    const { tools, record } = toolsOf({}, { installs: true })
    const second = await runInit(root, tools)

    expect(first.exitCode).toBe(0)
    expect(second).toEqual({
      exitCode: 0,
      stdout: pnpmClosingMessage,
      stderr: '',
      messages: [],
      summary: { nextSteps: pnpmNextSteps },
    })
    expect(snapshotFiles(root)).toEqual(before)
    expect(record.commands).toEqual([])
    expect(record.fallowRoots).toEqual([root])
  })

  describe('the agent skill', () => {
    it('installs the agent skill with --yes', async () => {
      const root = pnpmProject()
      const result = await runInit(root, toolsOf().tools)

      expect(skillSetupIn(root)).toEqual({
        cli: skillCli,
        storybooks: { 'web-app': { command: ['pnpm', 'run', 'storybook'], cwd: '../../..' } },
      })
      expect(skillVersionOf(readText(root, `${skillDir}/SKILL.md`))).toBe(cliVersion)
      expect(readText(root, `${skillDir}/scripts/run.mjs`)).toBe(readFileSync(skillSourcePaths.script, 'utf8'))
      expect(result.stdout).toBe(pnpmClosingMessage)
    })

    it.skipIf(process.platform === 'win32')('links the skill for Claude Code with --yes', async () => {
      const root = pnpmProject()

      await runInit(root, toolsOf().tools)

      expect(lstatSync(join(root, claudeSkillDir)).isSymbolicLink()).toBe(true)
      expect(readlinkSync(join(root, claudeSkillDir))).toBe('../../.agents/skills/visual-check')
    })

    it('copies the skill for Claude Code on Windows', async () => {
      const root = pnpmProject()

      await runInit(root, toolsOf({ os: 'win32' }).tools)

      const snapshot = snapshotFiles(root)
      const paths = ['SKILL.md', 'scripts/run.mjs', 'setup.json']

      expect(Object.keys(snapshot)).toEqual(expect.arrayContaining(paths.map((path) => `${claudeSkillDir}/${path}`)))

      for (const path of paths) {
        expect(snapshot[`${claudeSkillDir}/${path}`]).toBe(snapshot[`${skillDir}/${path}`])
      }
    })

    it('installs no agent skill when the answer is no', async () => {
      const root = pnpmProject()
      const prompter = scriptedPrompter(['', '', '', '', false, ''])
      const result = await runInit(root, toolsOf({ yes: false, interactive: true, prompter }).tools)

      expect(result.exitCode).toBe(0)
      expect(prompter.unused()).toEqual([])
      expect(existsSync(join(root, '.agents'))).toBe(false)
    })

    it('rewrites the skill files and refreshes setup.json from the config when run again', async () => {
      const root = pnpmProject()

      await runInit(root, toolsOf({}, { installs: true }).tools)

      const paths = ['SKILL.md', 'scripts/run.mjs', 'setup.json'].map((path) => `${skillDir}/${path}`)
      const written = paths.map((path) => readText(root, path))

      writeFileSync(join(root, skillDir, 'SKILL.md'), 'old\n')
      writeFileSync(join(root, skillDir, 'scripts/run.mjs'), '// old\n')
      writeFileSync(join(root, skillDir, 'setup.json'), '{}\n')
      await runInit(root, toolsOf({}, { installs: true }).tools)

      expect(paths.map((path) => readText(root, path))).toEqual(written)
    })

    it("names the config's Storybooks in setup.json when a config was already there", async () => {
      const root = pnpmProject()

      await runInit(root, toolsOf({}, { installs: true }).tools)
      writeFileSync(join(root, 'visual-check.config.ts'), webAppConfig.replace("'web-app':", 'docs:'))
      await runInit(root, toolsOf({}, { installs: true }).tools)

      expect(skillSetupIn(root)).toEqual({
        cli: skillCli,
        storybooks: { docs: { command: ['pnpm', 'run', 'storybook'], cwd: '../../..' } },
      })
    })
  })

  it('sets up a project that is no git repo, finding the Storybook through its start script', async () => {
    const root = makeProject({
      manifest: { name: 'web-app', packageManager: 'pnpm@9.12.3', scripts: { storybook: 'storybook dev -p 6006' } },
      files: { '.storybook/main.ts': 'export default {}\n' },
      storybookVersion: '10.6.7',
      git: false,
    })
    const { tools, record } = toolsOf()

    expect(await runInit(root, tools)).toEqual({
      exitCode: 0,
      stdout: pnpmClosingMessage,
      stderr: '',
      messages: [],
      summary: pnpmSummary,
    })
    expect(existsSync(join(root, '.git'))).toBe(false)
    expect(record.commands).toEqual(commandsIn(root, pnpmAdd, pnpmAddBrowser, pnpmAddon))
  })

  it('hints when storybook is not installed, asks nothing about the addon and still installs', async () => {
    const root = makeProject({
      manifest: { name: 'web-app', packageManager: 'pnpm@9.12.3', scripts: { storybook: 'storybook dev -p 6006' } },
      files: { '.storybook/main.ts': '' },
    })
    const hintTextIn = (folder: string) =>
      `hint: storybook isn't installed for ${basename(folder)}, so init skips its addon. Install dependencies, then run init again.`
    const hint = [
      "hint: storybook isn't installed for ",
      { code: basename(root) },
      ', so init skips its addon. Install dependencies, then run init again.',
    ]
    const yes = toolsOf()
    const yesResult = await runInit(root, yes.tools)

    expect(yesResult).toEqual({
      exitCode: 0,
      stdout: pnpmClosingMessage,
      stderr: `${hintTextIn(root)}\n`,
      messages: [hint],
      summary: pnpmSummary,
    })
    expect(yes.record.commands).toEqual(commandsIn(root, pnpmAddWithoutAddon, pnpmAddBrowser))

    const asked = makeProject({
      manifest: { name: 'web-app', packageManager: 'pnpm@9.12.3', scripts: { storybook: 'storybook dev -p 6006' } },
      files: { '.storybook/main.ts': '' },
    })
    const prompter = scriptedPrompter(['', '', '', '', ''])

    await runInit(asked, toolsOf({ yes: false, interactive: true, prompter }).tools)

    expect(prompter.records[0]).toEqual({ kind: 'note', message: hintTextIn(asked) })
    expect(prompter.records.filter(({ kind }) => kind === 'checklist')).toEqual([])
    expect(prompter.unused()).toEqual([])
  })

  it('replaces a script that has the name with --yes, and names it before the closing message', async () => {
    const root = pnpmProject({
      manifest: { scripts: { storybook: 'storybook dev -p 6006', 'visual:check': 'vitest --project visual' } },
    })
    const result = await runInit(root, toolsOf().tools)
    const replacedLine = 'Replaced the script visual:check in package.json.'

    expect(result).toEqual({
      exitCode: 0,
      stdout: `${replacedLine}\n\n${pnpmClosingMessage}`,
      stderr: '',
      messages: [],
      summary: { replacedLine, nextSteps: pnpmNextSteps },
    })
    expect(JSON.parse(readText(root, 'package.json')).scripts['visual:check']).toBe('visual-check test')
  })

  it('names both scripts it replaced in one line', async () => {
    const root = pnpmProject({
      manifest: {
        scripts: { storybook: 'storybook dev -p 6006', 'visual:check': 'vitest', 'visual:update': 'vitest -u' },
      },
    })
    const result = await runInit(root, toolsOf().tools)

    expect(result.stdout).toBe(
      `Replaced the scripts visual:check and visual:update in package.json.\n\n${pnpmClosingMessage}`,
    )
  })

  describe('the step that writes the first baselines', () => {
    /**
     * Puts a file named `name` in the baselines folder of the Storybook in `folder` of the project at `root`.
     */
    function putInBaselines(root: string, folder: string, name: string): void {
      const baselines = join(root, folder, '.visual-check', 'baselines')

      mkdirSync(baselines, { recursive: true })
      writeFileSync(join(baselines, name), 'png')
    }

    it('is there when the baselines folder is there and empty', async () => {
      const root = pnpmProject()

      mkdirSync(join(root, '.visual-check', 'baselines'), { recursive: true })

      expect((await runInit(root, toolsOf().tools)).stdout).toBe(pnpmClosingMessage)
    })

    it('is there when the baselines folder holds no baseline', async () => {
      const root = pnpmProject()

      putInBaselines(root, '.', 'notes.txt')

      expect((await runInit(root, toolsOf().tools)).stdout).toBe(pnpmClosingMessage)
    })

    it('is left out when the Storybook has a baseline', async () => {
      const root = pnpmProject()

      putInBaselines(root, '.', 'button--primary.png')

      const result = await runInit(root, toolsOf().tools)

      expect(result.stdout).toBe(`visual-check is set up. Next:
  1. pnpm run storybook      Start Storybook, and keep it running
  2. pnpm run visual:check   Check the stories against the baselines
  3. Commit the changes, baselines included

To set options for every story, see .storybook/visual-check.ts.
To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.
`)
      expect(result.summary?.nextSteps?.steps).toEqual([
        [{ command: 'pnpm run storybook', text: ['Start Storybook, and keep it running'] }],
        [{ command: 'pnpm run visual:check', text: ['Check the stories against the baselines'] }],
        [{ text: ['Commit the changes, baselines included'] }],
      ])
    })

    it('counts a baselines folder it cannot list as holding no baseline', async () => {
      const root = pnpmProject()

      mkdirSync(join(root, '.visual-check'), { recursive: true })
      writeFileSync(join(root, '.visual-check', 'baselines'), 'not a folder')

      expect((await runInit(root, toolsOf().tools)).stdout).toBe(pnpmClosingMessage)
    })

    it('is there when one of two Storybooks has no baseline, and left out once both have one', async () => {
      const config =
        'export default { storybooks: { ' +
        "web: { url: 'http://127.0.0.1:6006' }, " +
        "docs: { dir: 'docs', url: 'http://127.0.0.1:6007' } } }\n"
      const root = pnpmProject({
        files: { 'docs/.storybook/main.ts': '', 'visual-check.config.ts': config },
      })
      const updateCommand = 'pnpm run visual:update'

      putInBaselines(root, '.', 'button--primary.png')

      const first = await runInit(root, toolsOf().tools)

      expect(first.stdout).toContain(updateCommand)

      putInBaselines(root, 'docs', 'page--home.png')

      expect((await runInit(root, toolsOf().tools)).stdout).not.toContain(updateCommand)
    })
  })

  it('exits 2 when a question is given up on, after the warnings so far, and writes nothing nor sums up', async () => {
    const root = pnpmProject()
    const before = snapshotFiles(root)
    const prompter = { ...defaultsPrompter(), text: () => Promise.reject(new InputEndedError()) }
    const error = new ContainerError("Docker's daemon isn't running.")
    const { tools, record } = toolsOf({ yes: false, interactive: true, prompter }, { dockerError: error })

    const messages = [
      `Warning: Docker's daemon isn't running. ${dockerFix}`,
      'visual-check init stopped before every answer was in. It wrote nothing.',
    ]

    expect(await runInit(root, tools)).toEqual({ exitCode: 2, stdout: '', stderr: stderrOf(messages), messages })
    expect(snapshotFiles(root)).toEqual(before)
    expect(record.commands).toEqual([])
    expect(record.fallowRoots).toEqual([])
  })

  it('exits 2 with only the message when a question is given up on under a prompter that showed its notes', async () => {
    const root = pnpmProject()
    const before = snapshotFiles(root)
    const scripted = scriptedPrompter([])
    const prompter = { ...scripted, text: () => Promise.reject(new InputEndedError()) }
    const error = new ContainerError("Docker's daemon isn't running.")
    const { tools, record } = toolsOf({ yes: false, interactive: true, prompter }, { dockerError: error })

    expect(await runInit(root, tools)).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: 'visual-check init stopped before every answer was in. It wrote nothing.\n',
      messages: ['visual-check init stopped before every answer was in. It wrote nothing.'],
    })
    expect(scripted.records).toEqual([
      { kind: 'note', message: `Warning: Docker's daemon isn't running. ${dockerFix}` },
    ])
    expect(snapshotFiles(root)).toEqual(before)
    expect(record.commands).toEqual([])
  })

  describe('the package manager', () => {
    it('takes npm with --yes when nothing shows one', async () => {
      const root = pnpmProject({ manifest: { packageManager: undefined } })
      const { tools, record } = toolsOf()
      const result = await runInit(root, tools)

      expect(record.commands).toEqual(
        commandsIn(
          root,
          { command: 'npm', args: ['install', ...pnpmAdd.args.slice(1)] },
          { command: 'npm', args: ['install', ...pnpmAddBrowser.args.slice(1)] },
          { command: 'npx', args: pnpmAddon.args.slice(1) },
        ),
      )
      expect(result.stdout).toContain('  1. npm run storybook       Start Storybook, and keep it running\n')
    })

    it('asks for one when nothing shows one', async () => {
      const root = pnpmProject({ manifest: { packageManager: undefined } })
      const prompter = scriptedPrompter(['yarn', '', '', '', '', '', ''])
      const { tools, record } = toolsOf({ yes: false, interactive: true, prompter })

      await runInit(root, tools)

      expect(prompter.records[0]).toEqual({
        kind: 'select',
        message: 'Package manager',
        defaultValue: 'npm',
        hint: 'No lockfile or packageManager field names one.',
      })
      expect(prompter.unused()).toEqual([])
      expect(record.commands).toEqual(
        commandsIn(
          root,
          { command: 'yarn', args: ['add', '--dev', '--exact', ...pnpmAdd.args.slice(3)] },
          { command: 'yarn', args: ['add', '--dev', '--exact', ...pnpmAddBrowser.args.slice(3)] },
          { command: 'npx', args: ['--no-install', ...pnpmAddon.args.slice(1)] },
        ),
      )
    })
  })

  it('exits 2 when the install fails, keeps the files and adds no addon, with no closing message', async () => {
    const root = pnpmProject()
    const { tools, record } = toolsOf({}, { exitCodes: [1] })

    const problem = `pnpm add --save-dev --save-exact @visual-check/cli@${cliVersion} @visual-check/storybook@${cliVersion} @visual-check/storybook-addon@${cliVersion} failed with exit code 1. Run it yourself, then run visual-check init again.`

    expect(await runInit(root, tools)).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: `${problem}\n`,
      messages: [problem],
      summary: {},
    })
    expect(record.commands).toEqual(commandsIn(root, pnpmAdd))
    expect(record.fallowRoots).toEqual([])
    expect(record.progress).toEqual(installProgressOf('failed'))
    expect(readText(root, 'visual-check.config.ts')).toBe(webAppConfig)
    expect(readText(root, '.storybook/visual-check.ts')).toBe(modesFile)
    expect(readText(root, '.visual-check/.gitignore')).toBe(gitignore)
  })

  it('names the scripts it replaced when the install fails, with no closing message', async () => {
    const root = pnpmProject({
      manifest: { scripts: { storybook: 'storybook dev -p 6006', 'visual:update': 'vitest -u' } },
    })
    const result = await runInit(root, toolsOf({}, { exitCodes: [1] }).tools)
    const replacedLine = 'Replaced the script visual:update in package.json.'

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe(`${replacedLine}\n`)
    expect(result.summary).toEqual({ replacedLine })
  })

  it('writes no file besides the agent skill, the config, the modes file, the .gitignore and package.json', async () => {
    const root = pnpmProject()

    await runInit(root, toolsOf().tools)
    rmSync(join(root, 'node_modules'), { recursive: true, force: true })

    // The `.claude` files are the link's: Node's recursive readdir walks into the linked folder.
    expect(Object.keys(snapshotFiles(root))).toEqual([
      '.agents/skills/visual-check/SKILL.md',
      '.agents/skills/visual-check/scripts/run.mjs',
      '.agents/skills/visual-check/setup.json',
      '.claude/skills/visual-check/SKILL.md',
      '.claude/skills/visual-check/scripts/run.mjs',
      '.claude/skills/visual-check/setup.json',
      '.storybook/main.ts',
      '.storybook/visual-check.ts',
      '.visual-check/.gitignore',
      'package.json',
      'visual-check.config.ts',
    ])
  })
})

describe('runInit in a workspace', () => {
  /**
   * Makes a pnpm workspace with two packages, `packages/ui` and `packages/web`, each with a `.storybook` its
   * `storybook` script starts. `packages/web` already lists `@visual-check/storybook`.
   */
  function pnpmWorkspace(): string {
    return makeProject({
      manifest: { name: 'acme', private: true, packageManager: 'pnpm@9.12.3' },
      files: {
        'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
        'packages/ui/package.json': JSON.stringify({
          name: '@acme/ui',
          scripts: { storybook: 'storybook dev -p 6006' },
        }),
        'packages/ui/.storybook/main.ts': '',
        'packages/web/package.json': JSON.stringify({
          name: 'web',
          scripts: { storybook: 'storybook dev -p 6007' },
          devDependencies: { '@visual-check/storybook': cliVersion },
        }),
        'packages/web/.storybook/main.ts': '',
      },
    })
  }

  it('sets up the workspace root from inside a package, and adds the Storybook package where it is missing', async () => {
    const root = pnpmWorkspace()
    const { tools, record } = toolsOf()
    const result = await runInit(join(root, 'packages/ui'), tools)

    expect(result.exitCode).toBe(0)
    expect(result.messages[0]).toEqual([
      'hint: init sets up the workspace in ',
      { code: basename(root) },
      ', where the config goes and the next steps run.',
    ])
    expect(result.stderr).toContain(
      `hint: init sets up the workspace in ${basename(root)}, where the config goes and the next steps run.\n`,
    )
    expect(existsSync(join(root, 'visual-check.config.ts'))).toBe(true)
    expect(existsSync(join(root, 'packages/ui/visual-check.config.ts'))).toBe(false)
    expect(readText(root, 'packages/ui/.storybook/visual-check.ts')).toBe(modesFile)
    expect(readText(root, 'packages/web/.visual-check/.gitignore')).toBe(gitignore)
    expect(record.commands).toEqual([
      {
        command: 'pnpm',
        args: ['add', '--save-dev', '--save-exact', '-w', `@visual-check/cli@${cliVersion}`],
        cwd: root,
      },
      {
        command: 'pnpm',
        args: ['add', '--save-dev', '--save-exact', '-w', `@visual-check/chromium@${browserVersion}`],
        cwd: root,
      },
      {
        command: 'pnpm',
        args: ['add', '--save-dev', '--save-exact', `@visual-check/storybook@${cliVersion}`],
        cwd: join(root, 'packages/ui'),
      },
    ])
    expect(result.stdout).toContain(`visual-check is set up. Next, from ${basename(root)}:\n`)
    expect(result.stdout).toContain('packages/ui/.storybook/visual-check.ts')
    expect(result.summary?.nextSteps?.runFrom).toEqual([{ code: basename(root) }])
  })

  /**
   * Reads the scripts of the `package.json` in `dir`, a folder relative to `root`.
   */
  function scriptsIn(root: string, dir: string): Record<string, string> {
    return JSON.parse(readText(root, join(dir, 'package.json'))).scripts
  }

  it("gives each Storybook's package the root's scripts, narrowed to its Storybook, and names those packages", async () => {
    const root = pnpmWorkspace()
    const result = await runInit(root, toolsOf().tools)
    const packagesLine = 'To check only one Storybook, run the scripts in its package: packages/ui and packages/web.'

    expect(result.exitCode).toBe(0)
    expect(scriptsIn(root, '.')).toEqual({
      'visual:check': 'visual-check test',
      'visual:update': 'visual-check update',
    })
    expect(scriptsIn(root, 'packages/ui')).toEqual({
      storybook: 'storybook dev -p 6006',
      'visual:check': 'visual-check test --storybook ui',
      'visual:update': 'visual-check update --storybook ui',
    })
    expect(scriptsIn(root, 'packages/web')).toEqual({
      storybook: 'storybook dev -p 6007',
      'visual:check': 'visual-check test --storybook web',
      'visual:update': 'visual-check update --storybook web',
    })
    expect(result.stdout).toContain(`\n${packagesLine}\n`)
    expect(result.summary?.nextSteps?.packageFolders).toEqual(['packages/ui', 'packages/web'])
  })

  it("replaces a package's script that has the name, and names it with its package.json", async () => {
    const root = pnpmWorkspace()

    writeFileSync(
      join(root, 'packages/ui/package.json'),
      JSON.stringify({ name: '@acme/ui', scripts: { storybook: 'storybook dev -p 6006', 'visual:check': 'vitest' } }),
    )

    const result = await runInit(root, toolsOf().tools)
    const replacedLine = 'Replaced the script visual:check in packages/ui/package.json.'

    expect(result.stdout.startsWith(`${replacedLine}\n\n`)).toBe(true)
    expect(result.summary?.replacedLine).toBe(replacedLine)
    expect(scriptsIn(root, 'packages/ui')['visual:check']).toBe('visual-check test --storybook ui')
  })

  it("changes no package's scripts when run a second time", async () => {
    const root = pnpmWorkspace()

    await runInit(root, toolsOf({}, { installs: true }).tools)

    const before = snapshotFiles(root)
    const second = await runInit(root, toolsOf({}, { installs: true }).tools)

    expect(second.exitCode).toBe(0)
    expect(second.summary?.replacedLine).toBe(undefined)
    expect(second.summary?.nextSteps?.packageFolders).toEqual(['packages/ui', 'packages/web'])
    expect(snapshotFiles(root)).toEqual(before)
  })

  it("installs the agent skill with each package's Storybook started in its folder", async () => {
    const root = pnpmWorkspace()

    await runInit(root, toolsOf().tools)

    expect(skillSetupIn(root)).toEqual({
      cli: skillCli,
      storybooks: {
        ui: { command: ['pnpm', 'run', 'storybook'], cwd: '../../../packages/ui' },
        web: { command: ['pnpm', 'run', 'storybook'], cwd: '../../../packages/web' },
      },
    })
  })

  it('runs the root binary with yarn run -T in a package under Yarn 2 or later', async () => {
    const root = makeProject({
      manifest: { name: 'acme', private: true, packageManager: 'yarn@4.18.1', workspaces: ['packages/*'] },
      files: {
        '.yarnrc.yml': 'nodeLinker: node-modules\n',
        'packages/ui/package.json': JSON.stringify({ name: 'ui', scripts: { storybook: 'storybook dev -p 6006' } }),
        'packages/ui/.storybook/main.ts': '',
      },
    })

    expect((await runInit(root, toolsOf().tools)).exitCode).toBe(0)
    expect(scriptsIn(root, 'packages/ui')).toMatchObject({
      'visual:check': 'yarn run -T visual-check test --storybook ui',
      'visual:update': 'yarn run -T visual-check update --storybook ui',
    })
  })

  it('gives each of two Storybooks in one package a pair of scripts named after it', async () => {
    const root = makeProject({
      manifest: { name: 'acme', private: true, packageManager: 'pnpm@9.12.3' },
      files: {
        'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
        'packages/ui/package.json': JSON.stringify({
          name: 'ui',
          scripts: { storybook: 'storybook dev -p 6006', 'storybook:docs': 'storybook dev -c docs -p 6007' },
        }),
        'packages/ui/.storybook/main.ts': '',
        'packages/ui/docs/main.ts': '',
      },
    })

    expect((await runInit(root, toolsOf().tools)).exitCode).toBe(0)
    expect(readText(root, 'visual-check.config.ts')).toContain("    'ui-2': { dir: 'packages/ui', configDir: 'docs',")
    expect(scriptsIn(root, 'packages/ui')).toEqual({
      storybook: 'storybook dev -p 6006',
      'storybook:docs': 'storybook dev -c docs -p 6007',
      'visual:check:ui': 'visual-check test --storybook ui',
      'visual:update:ui': 'visual-check update --storybook ui',
      'visual:check:ui-2': 'visual-check test --storybook ui-2',
      'visual:update:ui-2': 'visual-check update --storybook ui-2',
    })
  })

  /**
   * Makes a pnpm workspace with two packages, `packages/ui` and `packages/web`, whose Storybooks both start on port
   * 6006, with storybook 10 installed in the root. `packages/web`'s config folder is `.sb`.
   */
  function onePortWorkspace(): string {
    return makeProject({
      manifest: { name: 'acme', private: true, packageManager: 'pnpm@9.12.3' },
      files: {
        'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
        'packages/ui/package.json': JSON.stringify({
          name: '@acme/ui',
          scripts: { storybook: 'storybook dev -p 6006' },
        }),
        'packages/ui/.storybook/main.ts': '',
        'packages/web/package.json': JSON.stringify({
          name: 'web',
          scripts: { storybook: 'storybook dev -c .sb -p 6006' },
        }),
        'packages/web/.sb/main.ts': '',
      },
      storybookVersion: '10.6.7',
    })
  }

  it('lists every Storybook in one root config with --yes, and warns that they share a port', async () => {
    const root = onePortWorkspace()
    const { tools } = toolsOf()
    const result = await runInit(root, tools)
    const warning =
      "Warning: ui and web both use port 6006, so they can't run at the same time. Give each Storybook its own port."

    expect(result.exitCode).toBe(0)
    expect(result.messages).toEqual([warning])
    expect(result.stderr).toBe(`${warning}\n`)
    expect(readText(root, 'visual-check.config.ts')).toBe(`import { defineConfig } from '@visual-check/cli'

export default defineConfig({
  storybooks: {
    ui: { dir: 'packages/ui', url: 'http://127.0.0.1:6006' },
    web: { dir: 'packages/web', configDir: '.sb', url: 'http://127.0.0.1:6006' },
  },
})
`)
    expect(readText(root, 'packages/web/.sb/visual-check.ts')).toBe(modesFile)
    expect(result.summary?.nextSteps?.steps[0]).toEqual([
      { command: 'pnpm --filter @acme/ui run storybook', text: ['Start ui, and keep it running'] },
      { command: 'pnpm --filter web run storybook', text: ['Start web, and keep it running'] },
    ])
  })

  it("adds each package's dependencies and the addon in its folder, then runs storybook add there", async () => {
    const root = onePortWorkspace()
    const { tools, record } = toolsOf()
    const result = await runInit(root, tools)
    const storybookSpecs = [`@visual-check/storybook@${cliVersion}`, `@visual-check/storybook-addon@${cliVersion}`]
    const storybookAdd = ['exec', 'storybook', 'add', `@visual-check/storybook-addon@${cliVersion}`, '--yes']

    expect(result.exitCode).toBe(0)
    expect(record.commands).toEqual([
      {
        command: 'pnpm',
        args: ['add', '--save-dev', '--save-exact', '-w', `@visual-check/cli@${cliVersion}`],
        cwd: root,
      },
      {
        command: 'pnpm',
        args: ['add', '--save-dev', '--save-exact', '-w', `@visual-check/chromium@${browserVersion}`],
        cwd: root,
      },
      {
        command: 'pnpm',
        args: ['add', '--save-dev', '--save-exact', ...storybookSpecs],
        cwd: join(root, 'packages/ui'),
      },
      {
        command: 'pnpm',
        args: ['add', '--save-dev', '--save-exact', ...storybookSpecs],
        cwd: join(root, 'packages/web'),
      },
      { command: 'pnpm', args: [...storybookAdd, '--skip-install'], cwd: join(root, 'packages/ui') },
      { command: 'pnpm', args: [...storybookAdd, '--skip-install', '-c', '.sb'], cwd: join(root, 'packages/web') },
    ])
    expect(record.progress[0]).toEqual([
      'plan',
      [
        'Write the files and scripts',
        installTitle,
        'Install the browser package',
        `${installTitle} in packages/ui`,
        `${installTitle} in packages/web`,
        'Add the Storybook addon to ui',
        'Add the Storybook addon to web',
        'Check for unlisted dependencies',
      ],
    ])
  })

  it('adds through npm --workspace for a package its list names, and in the folder of one only Nx finds', async () => {
    const root = makeProject({
      manifest: { name: 'acme', private: true, packageManager: 'npm@10.9.0', workspaces: ['packages/*'] },
      files: {
        'nx.json': '{}',
        'packages/ui/package.json': JSON.stringify({
          name: '@acme/ui',
          scripts: { storybook: 'storybook dev -p 6006' },
        }),
        'packages/ui/.storybook/main.ts': '',
        'libs/docs/package.json': JSON.stringify({ name: 'docs', scripts: { storybook: 'storybook dev -p 6007' } }),
        'libs/docs/project.json': JSON.stringify({ name: 'docs' }),
        'libs/docs/.storybook/main.ts': '',
      },
      storybookVersion: '10.6.7',
    })
    const { tools, record } = toolsOf()
    const result = await runInit(root, tools)
    const storybookSpecs = [`@visual-check/storybook@${cliVersion}`, `@visual-check/storybook-addon@${cliVersion}`]
    const storybookAdd = ['storybook', 'add', `@visual-check/storybook-addon@${cliVersion}`, '--yes', '--skip-install']

    expect(result.exitCode).toBe(0)
    expect(record.commands).toEqual([
      { command: 'npm', args: ['install', '--save-dev', '--save-exact', `@visual-check/cli@${cliVersion}`], cwd: root },
      {
        command: 'npm',
        args: ['install', '--save-dev', '--save-exact', `@visual-check/chromium@${browserVersion}`],
        cwd: root,
      },
      {
        command: 'npm',
        args: ['install', '--save-dev', '--save-exact', ...storybookSpecs],
        cwd: join(root, 'libs/docs'),
      },
      {
        command: 'npm',
        args: ['install', '--save-dev', '--save-exact', '--workspace', 'packages/ui', ...storybookSpecs],
        cwd: root,
      },
      { command: 'npx', args: storybookAdd, cwd: join(root, 'libs/docs') },
      { command: 'npx', args: storybookAdd, cwd: join(root, 'packages/ui') },
    ])
    expect(result.summary?.nextSteps?.steps[0]).toEqual([
      { command: 'cd libs/docs && npm run storybook', text: ['Start docs, and keep it running'] },
      { command: 'npm run storybook --workspace packages/ui', text: ['Start ui, and keep it running'] },
    ])
    // npm's list doesn't name libs/docs, so its scripts wouldn't find the CLI the root installed.
    expect(scriptsIn(root, 'packages/ui')['visual:check']).toBe('visual-check test --storybook ui')
    expect(scriptsIn(root, 'libs/docs')).toEqual({ storybook: 'storybook dev -p 6007' })
    expect(result.summary?.nextSteps?.packageFolders).toEqual(['packages/ui'])
  })

  it('runs nothing under Rush, and prints the install steps before the closing message', async () => {
    const root = makeProject({
      manifest: { name: 'acme', private: true },
      files: {
        'rush.json': '{ "pnpmVersion": "9.0.0", "projects": [{ "packageName": "ui", "projectFolder": "libs/ui" }] }',
        'libs/ui/package.json': JSON.stringify({ name: 'ui', scripts: { storybook: 'storybook dev -p 6006' } }),
        'libs/ui/.storybook/main.ts': '',
      },
      storybookVersion: '10.6.7',
    })
    const { tools, record } = toolsOf()
    const result = await runInit(root, tools)
    const heading = "Add the Storybook addon and install visual-check's packages yourself:"
    const manualInstall = {
      heading: [heading],
      commands: [
        `cd libs/ui && pnpm exec storybook add @visual-check/storybook-addon@${cliVersion} --yes --skip-install`,
        `pnpm add --save-dev --save-exact @visual-check/cli@${cliVersion}`,
        `pnpm add --save-dev --save-exact @visual-check/chromium@${browserVersion}`,
        `cd libs/ui && rush add --dev --exact --skip-update -p @visual-check/storybook@${cliVersion} ` +
          `-p @visual-check/storybook-addon@${cliVersion}`,
        'rush update',
      ],
    }

    expect(result.exitCode).toBe(0)
    expect(record.commands).toEqual([])
    expect(record.progress[0]).toEqual(['plan', ['Write the files and scripts', 'Check for unlisted dependencies']])
    expect(result.summary?.manualInstall).toEqual(manualInstall)
    expect(result.stdout).toBe(
      `${heading}\n${manualInstall.commands.map((command) => `  ${command}\n`).join('')}\n` +
        closingMessageTextOf(result.summary?.nextSteps ?? pnpmNextSteps),
    )
    expect(readText(root, 'libs/ui/.storybook/visual-check.ts')).toBe(modesFile)
    // A Rush project's scripts see only its own dependencies, not the CLI the root installed.
    expect(scriptsIn(root, 'libs/ui')).toEqual({ storybook: 'storybook dev -p 6006' })
    expect(scriptsIn(root, '.')).toEqual({
      'visual:check': 'visual-check test',
      'visual:update': 'visual-check update',
    })
  })

  it('writes nothing, adds nothing and offers no addon for a Storybook left unticked', async () => {
    const root = onePortWorkspace()
    const prompter = scriptedPrompter([['packages/ui/.storybook'], '', '', '', '', '', ''])
    const { tools, record } = toolsOf({ yes: false, interactive: true, prompter })
    const result = await runInit(root, tools)

    expect(result.exitCode).toBe(0)
    expect(result.messages).toEqual([])
    expect(prompter.unused()).toEqual([])
    expect(prompter.records.filter(({ kind }) => kind === 'checklist').map(({ defaultValue }) => defaultValue)).toEqual(
      [['packages/ui/.storybook', 'packages/web/.sb']],
    )
    expect(prompter.records.filter(({ kind }) => kind === 'confirm').map(({ message }) => message)).toEqual([
      'Install the agent skill?',
      'Add the Storybook addon to ui?',
    ])
    expect(readText(root, 'visual-check.config.ts')).toContain(
      "  storybooks: {\n    ui: { dir: 'packages/ui', url: 'http://127.0.0.1:6006' },\n  },",
    )
    expect(existsSync(join(root, 'packages/web/.sb/visual-check.ts'))).toBe(false)
    expect(existsSync(join(root, 'packages/web/.visual-check'))).toBe(false)
    expect(record.commands.map(({ cwd }) => cwd)).not.toContain(join(root, 'packages/web'))
    expect(JSON.stringify(record.commands)).not.toContain('.sb')
  })

  it('adds the Storybook package to the root for an Nx project with only a project.json', async () => {
    const root = makeProject({
      manifest: { name: 'acme', private: true, packageManager: 'pnpm@9.12.3' },
      files: {
        'nx.json': '{}',
        'libs/ui/project.json': JSON.stringify({ name: 'ui', targets: { storybook: { options: { port: 4400 } } } }),
        'libs/ui/.storybook/main.ts': '',
      },
    })
    const { tools, record } = toolsOf()
    const result = await runInit(root, tools)

    expect(result.exitCode).toBe(0)
    expect(readText(root, 'libs/ui/.visual-check/.gitignore')).toBe(gitignore)
    expect(record.commands).toEqual(commandsIn(root, pnpmAddWithoutAddon, pnpmAddBrowser))
    expect(result.summary?.nextSteps?.steps[0]).toEqual([
      { command: 'pnpm exec nx run ui:storybook', text: ['Start Storybook, and keep it running'] },
    ])
  })

  it("stops on a Storybook package's package.json it can't read, writing nothing and running nothing", async () => {
    const root = makeProject({
      manifest: { name: 'acme', private: true, packageManager: 'pnpm@9.12.3' },
      files: {
        'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
        'packages/ui/package.json': '{"name":"ui","scripts":"storybook dev"}',
        'packages/ui/.storybook/main.ts': '',
      },
    })
    const before = snapshotFiles(root)
    const { tools, record } = toolsOf()
    const result = await runInit(root, tools)

    expect(result).toMatchObject({ exitCode: 2, stdout: '' })
    expect(result.messages).toEqual([
      'visual-check init can\'t read packages/ui/package.json: "scripts" must be an object. ' +
        'Fix it, then run visual-check init again.',
    ])
    expect(snapshotFiles(root)).toEqual(before)
    expect(record.commands).toEqual([])
  })

  it('stops a Rush workspace without a root package.json, writing nothing and running nothing', async () => {
    const root = makeProject({
      files: {
        'rush.json': '{ "pnpmVersion": "9.0.0", "projects": [{ "packageName": "ui", "projectFolder": "libs/ui" }] }',
        'libs/ui/package.json': JSON.stringify({ name: 'ui', scripts: { storybook: 'storybook dev -p 6006' } }),
        'libs/ui/.storybook/main.ts': '',
      },
    })
    const before = snapshotFiles(root)
    const { tools, record } = toolsOf()
    const result = await runInit(join(root, 'libs/ui'), tools)

    expect(result).toMatchObject({ exitCode: 2, stdout: '' })
    expect(result.messages).toEqual([
      [
        'hint: init sets up the workspace in ',
        { code: basename(root) },
        ', where the config goes and the next steps run.',
      ],
      'visual-check init needs a package.json at the root of this Rush workspace, for its scripts and the CLI. ' +
        'Add a private one, then run visual-check init again.',
    ])
    expect(snapshotFiles(root)).toEqual(before)
    expect(record.commands).toEqual([])
  })

  it('gives the note on a skipped Storybook before the problem that stops it', async () => {
    const root = makeProject({
      manifest: { name: 'app' },
      files: { 'examples/package-lock.json': '{}', 'examples/.storybook/main.ts': '' },
    })
    const result = await runInit(root, toolsOf().tools)

    expect(result.exitCode).toBe(2)
    expect(result.messages[0]).toEqual([
      'hint: init skips the Storybook in ',
      { code: 'examples' },
      ": examples has its own lockfile, so it's a workspace of its own. Run visual-check init there to set it up.",
    ])
    expect(result.messages[1]).toMatch(/^visual-check init found no Storybook/)
  })
})
