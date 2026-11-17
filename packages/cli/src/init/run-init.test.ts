import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContainerError, DockerMissingError } from '../container/container-error.js'
import {
  browserRange,
  cliVersion,
  commandsIn,
  gitignore,
  modesFile,
  pnpmAdd,
  pnpmAddon,
  pnpmClosingMessage,
  pnpmWrittenLines,
  toolsOf,
} from './init-tools.fixture.js'
import { makeProject, pnpmProject, readText, removeProjects, snapshotFiles } from './project.fixture.js'
import { scriptedPrompter } from './prompter.fixture.js'
import { defaultsPrompter, InputEndedError } from './prompter.js'
import { runInit } from './run-init.js'

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
 * The sentence a missing or stopped Docker gets after its message.
 */
const dockerFix = "Start or install Docker before you run visual-check update, or set platform: 'host' in the config."

afterEach(() => {
  removeProjects()
})

describe('runInit', () => {
  it('sets up a pnpm project with --yes', async () => {
    const root = pnpmProject()
    const { tools, record } = toolsOf()
    const result = await runInit(root, tools)

    expect(result).toEqual({ exitCode: 0, stdout: `${pnpmWrittenLines}\n${pnpmClosingMessage}`, stderr: '' })
    expect(readText(root, 'visual-check.config.ts')).toBe(webAppConfig)
    expect(readText(root, '.storybook/visual-check.ts')).toBe(modesFile)
    expect(readText(root, '.visual-check/.gitignore')).toBe(gitignore)
    expect(JSON.parse(readText(root, 'package.json')).scripts).toEqual({
      storybook: 'storybook dev -p 6006',
      'visual:test': 'visual-check test',
      'visual:update': 'visual-check update',
    })
    expect(record.commands).toEqual(commandsIn(root, pnpmAdd, pnpmAddon))
    expect(record.progress).toEqual([
      `Running pnpm add --save-dev @visual-check/cli@${cliVersion} @visual-check/chromium@${browserRange} @visual-check/storybook@${cliVersion}\n`,
      `Running pnpm exec storybook add @visual-check/storybook-addon@${cliVersion} --yes\n`,
    ])
    expect(record.probes).toBe(1)
    expect(record.fallowRoots).toEqual([root])
  })

  it('closes the prompter', async () => {
    const prompter = defaultsPrompter()
    const close = vi.spyOn(prompter, 'close')

    await runInit(pnpmProject(), toolsOf({ prompter }).tools)

    expect(close).toHaveBeenCalledOnce()
  })

  it('shows the paths relative to a subfolder it runs in', async () => {
    const root = pnpmProject({ files: { 'src/a.ts': '' } })
    const result = await runInit(join(root, 'src'), toolsOf().tools)

    expect(result.stdout.startsWith('Wrote ../visual-check.config.ts\nWrote ../.storybook/visual-check.ts\n')).toBe(
      true,
    )
    expect(result.stdout).toContain(
      '  4. Commit ../visual-check.config.ts, ../.storybook/visual-check.ts and ../.visual-check/.\n',
    )
  })

  describe('each check that stops it writes nothing and runs nothing', () => {
    it.each([
      {
        name: 'Node below 22',
        project: () => pnpmProject(),
        tools: { nodeVersion: '20.18.0' },
        stderr:
          'visual-check needs Node 22 or later, and this is Node 20.18.0. Upgrade Node, then run visual-check init again.\n',
      },
      {
        name: 'a package.json that is not an object',
        project: () => makeProject({ manifest: '[]\n', files: { '.storybook/main.ts': '' } }),
        tools: {},
        stderr:
          "visual-check init can't read package.json: the file must hold a JSON object. Fix it, then run visual-check init again.\n",
      },
      {
        name: 'Deno',
        project: () => pnpmProject({ files: { 'deno.json': '{}\n' } }),
        tools: {},
        stderr:
          "visual-check doesn't support Deno, and this project has deno.json. Run visual-check init in a Node project.\n",
      },
      {
        name: 'no terminal without --yes',
        project: () => pnpmProject(),
        tools: { yes: false, interactive: false },
        stderr:
          "visual-check init asks questions, and there's no terminal to ask them in. Run it in a terminal, or pass --yes to take every default.\n",
      },
      {
        name: 'no Storybook',
        project: () => makeProject({ manifest: { name: 'web-app' }, storybookVersion: '10.6.7' }),
        tools: {},
        stderr:
          'visual-check init found no Storybook: git lists no .storybook/main file (.ts, .js, .mjs, .cjs, .mts or .cts), and no script in package.json passes -c to storybook. Add Storybook, then run visual-check init again.\n',
      },
      {
        name: 'storybook 9.0.0',
        project: () => pnpmProject({ storybookVersion: '9.0.0' }),
        tools: {},
        stderr:
          'The Storybook in .storybook runs storybook 9.0.0, and visual-check needs 9.1 or later. Upgrade storybook, then run visual-check init again.\n',
      },
      {
        name: 'no package.json',
        project: () => makeProject({ files: { '.storybook/main.ts': '' } }),
        tools: {},
        stderr:
          "visual-check init found no package.json in the current folder or its parents. Run it in your project's folder.\n",
      },
      {
        name: 'no package.json with Node below 22',
        project: () => makeProject({ files: { '.storybook/main.ts': '' } }),
        tools: { nodeVersion: '20.18.0' },
        stderr:
          'visual-check needs Node 22 or later, and this is Node 20.18.0. Upgrade Node, then run visual-check init again.\n' +
          "visual-check init found no package.json in the current folder or its parents. Run it in your project's folder.\n",
      },
    ])('$name', async ({ project, tools: overrides, stderr }) => {
      const root = project()
      const before = snapshotFiles(root)
      const prompter = scriptedPrompter([])
      const { tools, record } = toolsOf({ ...overrides, prompter })

      expect(await runInit(root, tools)).toEqual({ exitCode: 2, stdout: '', stderr })
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
        'The Storybook in .storybook runs storybook 9.0.0, and visual-check needs 9.1 or later. Upgrade storybook, then run visual-check init again.',
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
      const prompter = scriptedPrompter(['', '', '', ''])
      const { tools, record } = toolsOf({ yes: false, interactive: true, prompter })
      const result = await runInit(root, tools)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(prompter.records[0]).toEqual({
        kind: 'note',
        message:
          'Warning: The Storybook in .storybook runs storybook 12.0.0, and visual-check is tested on 9.1 to 11. visual-check init carries on.',
      })
      expectWritten(root, result.stdout)
      expect(prompter.records.filter(({ kind }) => kind === 'confirm')).toEqual([])
      expect(prompter.unused()).toEqual([])
      expect(record.commands).toEqual(commandsIn(root, pnpmAdd))
    })

    it.each([
      {
        name: 'Docker missing on Linux',
        error: new DockerMissingError(
          "visual-check runs the browser in Docker, and there's no docker command on PATH.",
        ),
        os: 'linux' as const,
        stderr: `Warning: visual-check runs the browser in Docker, and there's no docker command on PATH. ${dockerFix}\n`,
      },
      {
        name: 'Docker missing on Windows',
        error: new DockerMissingError(
          "visual-check runs the browser in Docker, and there's no docker command on PATH.",
        ),
        os: 'win32' as const,
        stderr: `Warning: visual-check runs the browser in Docker, and there's no docker command on PATH. ${dockerFix} If Docker runs inside WSL, run visual-check from inside WSL too.\n`,
      },
      {
        name: "Docker's daemon down",
        error: new ContainerError("Docker's daemon isn't running, or visual-check can't reach its socket: refused."),
        os: 'linux' as const,
        stderr: `Warning: Docker's daemon isn't running, or visual-check can't reach its socket: refused. ${dockerFix}\n`,
      },
      {
        name: 'Docker on Windows containers',
        error: new ContainerError('Docker runs Windows containers. Switch it to Linux containers.', 'linux-containers'),
        os: 'win32' as const,
        stderr: 'Warning: Docker runs Windows containers. Switch it to Linux containers.\n',
      },
    ])('warns of $name', async ({ error, os, stderr }) => {
      const root = pnpmProject()
      const { tools, record } = toolsOf({ os }, { dockerError: error })
      const result = await runInit(root, tools)

      expect(result).toEqual({ exitCode: 0, stdout: `${pnpmWrittenLines}\n${pnpmClosingMessage}`, stderr })
      expect(record.probes).toBe(1)
      expectWritten(root, result.stdout)
    })

    it("warns when the URL's port isn't the start command's", async () => {
      const root = pnpmProject()
      const prompter = scriptedPrompter(['', 'http://127.0.0.1:7000', '', '', true])
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
      const result = await runInit(root, toolsOf({}, { fallow }).tools)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe(
        "Warning: Fallow finds imports of packages package.json doesn't list: leftpad-zz (src/a.js). Affected stories follow imports through Fallow's graph, and an alias it can't see, such as one set in viteFinal, shows up this way. List the package, or teach Fallow the alias in its config.\n",
      )
      expectWritten(root, result.stdout)
    })

    it('warns when storybook add fails, and carries on', async () => {
      const root = pnpmProject()
      const { tools, record } = toolsOf({}, { exitCodes: [0, 1] })
      const result = await runInit(root, tools)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe(
        `Warning: pnpm exec storybook add @visual-check/storybook-addon@${cliVersion} --yes failed, so web-app has no addon. Run it yourself to add it.\n`,
      )
      expectWritten(root, result.stdout)
      expect(record.fallowRoots).toEqual([root])
    })

    it('warns when Fallow throws', async () => {
      const root = pnpmProject()
      const result = await runInit(root, toolsOf({}, { fallow: new Error('Fallow broke.') }).tools)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe("Warning: Fallow couldn't check this project's imports: Fallow broke.\n")
      expectWritten(root, result.stdout)
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
      const result = await runInit(root, toolsOf({}, { dockerError: error, exitCodes: [0, 1] }).tools)

      expect(result.stderr.split('\n')).toEqual([
        `Warning: Docker's daemon isn't running. ${dockerFix}`,
        "hint: The storybook script sets no port. Add -p 6006 to it, so Storybook always starts on the port in web-app's URL.",
        `Warning: pnpm exec storybook add @visual-check/storybook-addon@${cliVersion} --yes failed, so web-app has no addon. Run it yourself to add it.`,
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
          scripts: { ...manifest.scripts, 'visual:test': 'visual-check test', 'visual:update': 'visual-check update' },
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
    expect(second).toEqual({ exitCode: 0, stdout: pnpmClosingMessage, stderr: '' })
    expect(snapshotFiles(root)).toEqual(before)
    expect(record.commands).toEqual([])
    expect(record.fallowRoots).toEqual([root])
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
      stdout: `${pnpmWrittenLines}\n${pnpmClosingMessage}`,
      stderr: '',
    })
    expect(existsSync(join(root, '.git'))).toBe(false)
    expect(record.commands).toEqual(commandsIn(root, pnpmAdd, pnpmAddon))
  })

  it('hints when storybook is not installed, asks nothing about the addon and still installs', async () => {
    const root = makeProject({
      manifest: { name: 'web-app', packageManager: 'pnpm@9.12.3', scripts: { storybook: 'storybook dev -p 6006' } },
      files: { '.storybook/main.ts': '' },
    })
    const hint =
      "hint: storybook isn't installed for the Storybook in .storybook, so init can't tell its version and skips the addon. Install dependencies, then run visual-check init again to add it."
    const yes = toolsOf()
    const yesResult = await runInit(root, yes.tools)

    expect(yesResult).toEqual({
      exitCode: 0,
      stdout: `${pnpmWrittenLines}\n${pnpmClosingMessage}`,
      stderr: `${hint}\n`,
    })
    expect(yes.record.commands).toEqual(commandsIn(root, pnpmAdd))

    const asked = makeProject({
      manifest: { name: 'web-app', packageManager: 'pnpm@9.12.3', scripts: { storybook: 'storybook dev -p 6006' } },
      files: { '.storybook/main.ts': '' },
    })
    const prompter = scriptedPrompter(['', '', '', ''])

    await runInit(asked, toolsOf({ yes: false, interactive: true, prompter }).tools)

    expect(prompter.records[0]).toEqual({ kind: 'note', message: hint })
    expect(prompter.records.filter(({ kind }) => kind === 'confirm')).toEqual([])
    expect(prompter.unused()).toEqual([])
  })

  it('replaces a script that has the name with --yes, and says what it ran', async () => {
    const root = pnpmProject({
      manifest: { scripts: { storybook: 'storybook dev -p 6006', 'visual:test': 'vitest --project visual' } },
    })
    const result = await runInit(root, toolsOf().tools)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain(
      'Added the script visual:update to package.json.\n' +
        'Replaced the script visual:test in package.json. It ran: vitest --project visual\n',
    )
    expect(result.stdout).toContain(
      '  3. Run pnpm run visual:test. It should pass. If a story fails, see https://visual-check.vercel.app/docs/broken-stories.\n',
    )
    expect(JSON.parse(readText(root, 'package.json')).scripts['visual:test']).toBe('visual-check test')
  })

  it('exits 2 when the input ends before every answer is in, after the warnings so far, and writes nothing', async () => {
    const root = pnpmProject()
    const before = snapshotFiles(root)
    const prompter = { ...defaultsPrompter(), text: () => Promise.reject(new InputEndedError()) }
    const close = vi.spyOn(prompter, 'close')
    const error = new ContainerError("Docker's daemon isn't running.")
    const { tools, record } = toolsOf({ yes: false, interactive: true, prompter }, { dockerError: error })

    expect(await runInit(root, tools)).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        `Warning: Docker's daemon isn't running. ${dockerFix}\n` +
        'visual-check init needs an answer, and the input ended.\n',
    })
    expect(snapshotFiles(root)).toEqual(before)
    expect(record.commands).toEqual([])
    expect(record.fallowRoots).toEqual([])
    expect(close).toHaveBeenCalledOnce()
  })

  it('exits 2 with only the message when the input ends under a prompter that showed its notes as they came', async () => {
    const root = pnpmProject()
    const before = snapshotFiles(root)
    const scripted = scriptedPrompter([])
    const prompter = { ...scripted, text: () => Promise.reject(new InputEndedError()) }
    const error = new ContainerError("Docker's daemon isn't running.")
    const { tools, record } = toolsOf({ yes: false, interactive: true, prompter }, { dockerError: error })

    expect(await runInit(root, tools)).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: 'visual-check init needs an answer, and the input ended.\n',
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
          { command: 'npx', args: pnpmAddon.args.slice(1) },
        ),
      )
      expect(result.stdout).toContain('  1. Start Storybook with npm run storybook.\n')
    })

    it('asks for one when nothing shows one', async () => {
      const root = pnpmProject({ manifest: { packageManager: undefined } })
      const prompter = scriptedPrompter(['yarn', '', '', '', '', true])
      const { tools, record } = toolsOf({ yes: false, interactive: true, prompter })

      await runInit(root, tools)

      expect(prompter.records[0]).toEqual({
        kind: 'text',
        message: 'Package manager (npm, pnpm, yarn or bun)',
        defaultValue: 'npm',
      })
      expect(prompter.unused()).toEqual([])
      expect(record.commands).toEqual(
        commandsIn(
          root,
          { command: 'yarn', args: ['add', '--dev', ...pnpmAdd.args.slice(2)] },
          { command: 'yarn', args: pnpmAddon.args.slice(1) },
        ),
      )
    })
  })

  it('exits 2 when the install fails, keeps the files and adds no addon', async () => {
    const root = pnpmProject()
    const { tools, record } = toolsOf({}, { exitCodes: [1] })

    expect(await runInit(root, tools)).toEqual({
      exitCode: 2,
      stdout: pnpmWrittenLines,
      stderr: `pnpm add --save-dev @visual-check/cli@${cliVersion} @visual-check/chromium@${browserRange} @visual-check/storybook@${cliVersion} failed with exit code 1. Run it yourself, then run visual-check init again.\n`,
    })
    expect(record.commands).toEqual(commandsIn(root, pnpmAdd))
    expect(record.fallowRoots).toEqual([])
    expect(readText(root, 'visual-check.config.ts')).toBe(webAppConfig)
    expect(readText(root, '.storybook/visual-check.ts')).toBe(modesFile)
    expect(readText(root, '.visual-check/.gitignore')).toBe(gitignore)
  })

  it('writes no file besides the config, the modes file, the .gitignore and package.json', async () => {
    const root = pnpmProject()

    await runInit(root, toolsOf().tools)
    rmSync(join(root, 'node_modules'), { recursive: true, force: true })

    expect(Object.keys(snapshotFiles(root))).toEqual([
      '.storybook/main.ts',
      '.storybook/visual-check.ts',
      '.visual-check/.gitignore',
      'package.json',
      'visual-check.config.ts',
    ])
  })
})
