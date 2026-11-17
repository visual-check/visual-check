import { describe, expect, it } from 'vitest'
import { projectOf, storybookOf } from './detected-project.fixture.js'
import { type PromptRecord, scriptedPrompter } from './prompter.fixture.js'
import { defaultsPrompter } from './prompter.js'
import { askQuestions } from './questions.js'

/**
 * Asks the questions with scripted answers, and gives the answers, the warnings and what the prompter recorded.
 */
async function ask(
  scripted: (string | boolean)[],
  options: {
    project?: Parameters<typeof projectOf>[0]
    existingConfig?: { names: Record<string, string> }
  } = {},
) {
  const prompter = scriptedPrompter(scripted)
  const result = await askQuestions({
    project: projectOf(options.project),
    prompter,
    existingConfig: options.existingConfig,
  })

  expect(prompter.unused()).toEqual([])

  return { ...result, records: prompter.records }
}

/**
 * Lists the messages of the records of one kind.
 */
function messagesOf(records: PromptRecord[], kind: PromptRecord['kind']): string[] {
  return records.filter((record) => record.kind === kind).map(({ message }) => message)
}

describe('askQuestions', () => {
  it('asks the questions with their defaults for a project without a start script', async () => {
    const { answers, warnings, records } = await ask(['', '', '', '', '', true], {
      project: { manifest: { devDependencies: {} } },
    })

    expect(records).toEqual([
      { kind: 'text', message: 'Name of the Storybook in .storybook', defaultValue: 'project' },
      { kind: 'text', message: 'URL of project', defaultValue: 'http://127.0.0.1:6006' },
      { kind: 'text', message: 'Command that starts project', defaultValue: 'pnpm exec storybook dev -p 6006' },
      { kind: 'text', message: 'Name of the script that runs visual-check test', defaultValue: 'visual:check' },
      { kind: 'text', message: 'Name of the script that runs visual-check update', defaultValue: 'visual:update' },
      { kind: 'confirm', message: 'Add the Storybook addon to project?', defaultValue: true },
    ])
    expect(answers).toEqual({
      packageManager: 'pnpm',
      storybooks: [
        {
          configDir: '.storybook',
          name: 'project',
          url: 'http://127.0.0.1:6006',
          startCommand: 'pnpm exec storybook dev -p 6006',
        },
      ],
      scripts: { test: { name: 'visual:check', add: true }, update: { name: 'visual:update', add: true } },
      addons: [{ configDir: '.storybook', name: 'project' }],
    })
    expect(warnings).toEqual([])
  })

  it('takes a custom name, URL and start command', async () => {
    const { answers } = await ask(['web', 'https://sb.test:7000', 'make sb', 'vt', 'vu', false])

    expect(answers.storybooks).toEqual([
      { configDir: '.storybook', name: 'web', url: 'https://sb.test:7000', startCommand: 'make sb' },
    ])
    expect(answers.scripts).toEqual({ test: { name: 'vt', add: true }, update: { name: 'vu', add: true } })
    expect(answers.addons).toEqual([])
  })

  it('asks again after a name that is not valid', async () => {
    const { answers, records } = await ask(['Web App', 'web', '', '', '', '', false])

    expect(messagesOf(records, 'invalid')).toEqual(['A Storybook name takes lowercase letters, digits and -.'])
    expect(answers.storybooks[0]?.name).toBe('web')
  })

  it('asks again after a name that another Storybook has', async () => {
    const { answers, records } = await ask(['a', '', '', 'a', 'b', '', '', '', '', false, false], {
      project: {
        storybooks: [
          storybookOf({ defaultName: 'a' }),
          storybookOf({ configDir: 'docs/.storybook', defaultName: 'b' }),
        ],
      },
    })

    expect(messagesOf(records, 'invalid')).toEqual(['Another Storybook is already called a.'])
    expect(answers.storybooks.map(({ name }) => name)).toEqual(['a', 'b'])
  })

  it("never puts a URL's login in the message", async () => {
    const { answers, records } = await ask(['', 'http://admin:hunter2@127.0.0.1:6006', '', '', '', '', false])
    const [message] = messagesOf(records, 'invalid')

    expect(message).toBe(
      "A Storybook URL can't hold a user name or password. visual-check sends no login: serve Storybook where visual-check runs (storybook dev, or its static build served in the same CI job) and point the URL at that.",
    )
    expect(message).not.toContain('hunter2')
    expect(answers.storybooks[0]?.url).toBe('http://127.0.0.1:6006')
  })

  it('asks again after a URL that is not http', async () => {
    const { records } = await ask(['', 'ftp://host', '', '', '', '', false])

    expect(messagesOf(records, 'invalid')).toEqual(['Give an http: or https: URL, such as http://127.0.0.1:6006.'])
  })

  it('names a config folder in the default start command', async () => {
    const { records } = await ask(['', '', '', '', '', false], {
      project: { storybooks: [storybookOf({ configDir: 'docs/.storybook' })] },
    })

    expect(records.find(({ message }) => message.startsWith('Command'))?.defaultValue).toBe(
      'pnpm exec storybook dev -p 6006 -c docs/.storybook',
    )
  })

  it('takes the default start command for a blank answer', async () => {
    const { answers, records } = await ask(['', '', ' ', '', '', false])

    expect(answers.storybooks[0]?.startCommand).toBe('pnpm exec storybook dev -p 6006')
    expect(messagesOf(records, 'invalid')).toEqual([])
  })

  it('uses the port of the URL in the default start command', async () => {
    const { records } = await ask(['', 'http://localhost:7007', '', '', '', false])

    expect(records.find(({ message }) => message.startsWith('Command'))?.defaultValue).toBe(
      'pnpm exec storybook dev -p 7007',
    )
  })

  it('runs the start script without asking, and defaults to its port', async () => {
    const startScript = { script: 'storybook', subcommand: 'dev' as const, configDir: undefined, port: 6100 }
    const { answers, records, warnings } = await ask(['', '', '', '', false], {
      project: { storybooks: [storybookOf({ startScript })] },
    })

    expect(records.map(({ message }) => message)).not.toContain('Command that starts project')
    expect(records[1]).toEqual({ kind: 'text', message: 'URL of project', defaultValue: 'http://127.0.0.1:6100' })
    expect(answers.storybooks[0]?.startCommand).toBe('pnpm run storybook')
    expect(warnings).toEqual([])
  })

  it('hints at a start script that sets no port', async () => {
    const startScript = { script: 'sb', subcommand: 'dev' as const, configDir: undefined, port: undefined }
    const { records, warnings } = await ask(['', '', '', '', false], {
      project: { storybooks: [storybookOf({ startScript })] },
    })

    expect(messagesOf(records, 'note')).toEqual([
      "hint: The sb script sets no port. Add -p 6006 to it, so Storybook always starts on the port in project's URL.",
    ])
    expect(records[2]).toEqual({ kind: 'text', message: 'URL of project', defaultValue: 'http://127.0.0.1:6006' })
    expect(warnings).toEqual([])
  })

  it('warns when the URL port differs from the start script port', async () => {
    const startScript = { script: 'storybook', subcommand: 'dev' as const, configDir: undefined, port: 6100 }
    const { warnings } = await ask(['', 'http://127.0.0.1:6006', '', '', false], {
      project: { storybooks: [storybookOf({ startScript })] },
    })

    expect(warnings).toEqual([
      "Warning: project's URL, http://127.0.0.1:6006, has port 6006, and its start command, pnpm run storybook, starts Storybook on port 6100.",
    ])
  })

  it('warns when the URL port differs from the port of a start command the person types', async () => {
    const { warnings } = await ask(['', '', 'pnpm exec storybook dev -p 7000', '', '', false])

    expect(warnings).toEqual([
      "Warning: project's URL, http://127.0.0.1:6006, has port 6006, and its start command, pnpm exec storybook dev -p 7000, starts Storybook on port 7000.",
    ])
  })

  it('does not warn when a typed start command starts Storybook on the port of the URL', async () => {
    const { warnings } = await ask(['', '', 'pnpm exec storybook dev -p 6006', '', '', false])

    expect(warnings).toEqual([])
  })

  it('does not warn about a typed start command that runs no storybook dev', async () => {
    const { warnings } = await ask(['', '', 'make sb -p 7000', '', '', false])

    expect(warnings).toEqual([])
  })

  it('counts the port of an https URL without one as 443', async () => {
    const startScript = { script: 'storybook', subcommand: 'dev' as const, configDir: undefined, port: 6006 }
    const { warnings } = await ask(['', 'https://sb.test', '', '', false], {
      project: { storybooks: [storybookOf({ startScript })] },
    })

    expect(warnings).toEqual([
      "Warning: project's URL, https://sb.test, has port 443, and its start command, pnpm run storybook, starts Storybook on port 6006.",
    ])
  })

  it('asks for the package manager only when nothing shows one, and the commands follow it', async () => {
    const { answers, records } = await ask(['', '', '', '', '', '', false], {
      project: { packageManager: undefined },
    })

    expect(records[0]).toEqual({
      kind: 'text',
      message: 'Package manager (npm, pnpm, yarn or bun)',
      defaultValue: 'npm',
    })
    expect(answers.packageManager).toBe('npm')
    expect(answers.storybooks[0]?.startCommand).toBe('npx storybook dev -p 6006')
  })

  it('asks again after a package manager it does not know', async () => {
    const { answers, records } = await ask(['pip', 'yarn', '', '', '', '', '', false], {
      project: { packageManager: undefined },
    })

    expect(messagesOf(records, 'invalid')).toEqual(['Pick npm, pnpm, yarn or bun.'])
    expect(answers.packageManager).toBe('yarn')
  })

  it('runs the start script with the package manager answered', async () => {
    const startScript = { script: 'storybook', subcommand: 'dev' as const, configDir: undefined, port: 6006 }
    const { answers } = await ask(['', '', '', '', '', false], {
      project: { packageManager: undefined, storybooks: [storybookOf({ startScript })] },
    })

    expect(answers.storybooks[0]?.startCommand).toBe('npm run storybook')
  })

  it('uses an existing script that runs visual-check, without a question', async () => {
    const manifest = { scripts: { vt: 'visual-check test --ci', other: 'visual-check update' } }
    const { answers, records } = await ask(['', '', '', false], { project: { manifest } })

    expect(answers.scripts).toEqual({ test: { name: 'vt', add: false }, update: { name: 'other', add: false } })
    expect(messagesOf(records, 'text').filter((message) => message.startsWith('Name of the script'))).toEqual([])
  })

  it('ignores a script that is not a text', async () => {
    const { answers } = await ask(['', '', '', '', '', false], {
      project: { manifest: { scripts: { a: 1, b: null } } },
    })

    expect(answers.scripts.test).toEqual({ name: 'visual:check', add: true })
  })

  it('takes a name another script has, so that script is replaced', async () => {
    const manifest = { scripts: { 'visual:check': 'vitest', 'visual:update': 'vitest -u' } }
    const { answers, records, warnings } = await ask(['', '', '', '', '', false], { project: { manifest } })

    expect(answers.scripts).toEqual({
      test: { name: 'visual:check', add: true },
      update: { name: 'visual:update', add: true },
    })
    expect(messagesOf(records, 'invalid')).toEqual([])
    expect(warnings).toEqual([])
  })

  it('asks again after a script name that starts Storybook or has a space', async () => {
    const startScript = { script: 'storybook', subcommand: 'dev' as const, configDir: undefined, port: 6006 }
    const { answers, records } = await ask(['', '', 'storybook', 'a b', 'vt', '', false], {
      project: { storybooks: [storybookOf({ startScript })] },
    })

    expect(messagesOf(records, 'invalid')).toEqual([
      'The storybook script starts Storybook. Pick another name.',
      "A script name can't hold spaces.",
    ])
    expect(answers.scripts.test).toEqual({ name: 'vt', add: true })
  })

  it('asks again when the update script has the name of the test script', async () => {
    const { answers, records } = await ask(['', '', '', 'same', 'same', 'other', false])

    expect(messagesOf(records, 'invalid')).toEqual(['The test and update scripts need different names.'])
    expect(answers.scripts.update).toEqual({ name: 'other', add: true })
  })

  it.each([
    ['9.1.0', 0],
    ['10.0.0', 1],
    ['11.0.0', 0],
    [undefined, 0],
  ])('asks about the addon for Storybook %s: %s question', async (version, questions) => {
    const { records } = await ask(questions === 1 ? ['', '', '', '', '', true] : ['', '', '', '', ''], {
      project: { storybooks: [storybookOf({ version })] },
    })

    expect(records.filter(({ kind }) => kind === 'confirm')).toHaveLength(questions)
  })

  it.each(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'])(
    'skips the addon question when %s lists it',
    async (field) => {
      const manifest = { [field]: { '@visual-check/storybook-addon': '^1.0.0' } }
      const { answers, records } = await ask(['', '', '', '', ''], { project: { manifest } })

      expect(records.filter(({ kind }) => kind === 'confirm')).toEqual([])
      expect(answers.addons).toEqual([])
    },
  )

  it('asks only about the Storybooks with the addon missing, and keeps the yes answers', async () => {
    const { answers, records } = await ask(['', '', '', 'b', '', '', '', '', true, false], {
      project: {
        storybooks: [
          storybookOf({ defaultName: 'a' }),
          storybookOf({ configDir: 'docs/.storybook', defaultName: 'b' }),
        ],
      },
    })

    expect(messagesOf(records, 'confirm')).toEqual(['Add the Storybook addon to a?', 'Add the Storybook addon to b?'])
    expect(answers.addons).toEqual([{ configDir: '.storybook', name: 'a' }])
  })

  it('asks no Storybook question with an existing config, and names the addon question after the config', async () => {
    const { answers, records } = await ask(['', '', true], { existingConfig: { names: { '.storybook': 'web' } } })

    expect(answers.storybooks).toEqual([])
    expect(records.map(({ message }) => message)).toEqual([
      'Name of the script that runs visual-check test',
      'Name of the script that runs visual-check update',
      'Add the Storybook addon to web?',
    ])
    expect(answers.addons).toEqual([{ configDir: '.storybook', name: 'web' }])
  })

  it('asks the addon question only for the Storybooks of an existing config', async () => {
    const { answers, records } = await ask(['', '', true], {
      existingConfig: { names: { 'docs/.storybook': 'docs' } },
      project: { storybooks: [storybookOf(), storybookOf({ configDir: 'docs/.storybook', defaultName: 'docs-x' })] },
    })

    expect(messagesOf(records, 'confirm')).toEqual(['Add the Storybook addon to docs?'])
    expect(answers.addons).toEqual([{ configDir: 'docs/.storybook', name: 'docs' }])
  })

  it('does not warn about an explicit default port that matches the start script', async () => {
    const startScript = { script: 'storybook', subcommand: 'dev' as const, configDir: undefined, port: 80 }
    const { warnings } = await ask(['', 'http://127.0.0.1:80', '', '', false], {
      project: { storybooks: [storybookOf({ startScript })] },
    })

    expect(warnings).toEqual([])
  })

  it.each(['my-visual-check test', 'visual-check test-x', 'visual-check testing'])(
    'does not take "%s" for a script that runs visual-check test',
    async (command) => {
      const { answers } = await ask(['', '', '', '', '', false], { project: { manifest: { scripts: { a: command } } } })

      expect(answers.scripts.test).toEqual({ name: 'visual:check', add: true })
    },
  )

  it.each([
    'npx visual-check test',
    'cd x && visual-check test',
    './node_modules/.bin/visual-check test',
    'visual-check test',
  ])('takes "%s" for a script that runs visual-check test', async (command) => {
    const { answers } = await ask(['', '', '', '', false], { project: { manifest: { scripts: { a: command } } } })

    expect(answers.scripts.test).toEqual({ name: 'a', add: false })
  })

  it('gives the defaults with the defaults prompter', async () => {
    const prompter = defaultsPrompter()
    const startScript = { script: 'sb', subcommand: 'dev' as const, configDir: undefined, port: undefined }
    const { answers, warnings } = await askQuestions({
      project: projectOf({ storybooks: [storybookOf({ startScript })] }),
      prompter,
    })

    expect(answers).toEqual({
      packageManager: 'pnpm',
      storybooks: [
        { configDir: '.storybook', name: 'project', url: 'http://127.0.0.1:6006', startCommand: 'pnpm run sb' },
      ],
      scripts: { test: { name: 'visual:check', add: true }, update: { name: 'visual:update', add: true } },
      addons: [{ configDir: '.storybook', name: 'project' }],
    })
    expect(warnings).toEqual([])
    expect(prompter.notes).toEqual([
      "hint: The sb script sets no port. Add -p 6006 to it, so Storybook always starts on the port in project's URL.",
    ])
  })
})
