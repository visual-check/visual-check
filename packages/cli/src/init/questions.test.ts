import { describe, expect, it, vi } from 'vitest'
import { projectOf, scriptStartOf, storybookOf } from './detected-project.fixture.js'
import { type PromptRecord, type ScriptedAnswer, scriptedPrompter } from './prompter.fixture.js'
import { defaultsPrompter } from './prompter.js'
import { askQuestions } from './questions.js'

/**
 * Asks the questions with scripted answers, and gives the answers, the warnings and what the prompter recorded.
 */
async function ask(
  scripted: ScriptedAnswer[],
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
 * The hints of the questions, by what each asks about.
 */
const hints = {
  packageManager: 'No lockfile or packageManager field names one.',
  name: 'What the config and the report call this Storybook.',
  url: 'Where visual-check opens it, locally and in CI. Use 127.0.0.1, not localhost.',
  startCommand: 'No script starts this Storybook. The next steps show this command.',
  testScript: 'Compares each story with its baseline.',
  updateScript: 'Writes the baselines.',
  addon: 'Check and update the open story from inside Storybook.',
}

/**
 * Where the root Storybook of `projectOf` is: its package, which its dependencies go in too.
 */
const rootPlace = { packageDir: '/project', manifestDir: '/project', manifest: {} }

/**
 * Lists the messages of the records of one kind.
 */
function messagesOf(records: PromptRecord[], kind: PromptRecord['kind']): string[] {
  return records.filter((record) => record.kind === kind).map(({ message }) => message)
}

describe('askQuestions', () => {
  it('asks the questions with their defaults for a project without a start script', async () => {
    const { answers, warnings, records } = await ask(['', '', '', '', '', ''], {
      project: { manifest: { devDependencies: {} } },
    })

    expect(records).toEqual([
      { kind: 'text', message: 'Name of the Storybook in .storybook', defaultValue: 'project', hint: hints.name },
      { kind: 'text', message: 'URL of project', defaultValue: 'http://127.0.0.1:6006', hint: hints.url },
      {
        kind: 'text',
        message: 'Command that starts project',
        defaultValue: 'pnpm exec storybook dev -p 6006',
        hint: hints.startCommand,
      },
      {
        kind: 'text',
        message: 'Name of the script that runs visual-check test',
        defaultValue: 'visual:check',
        hint: hints.testScript,
      },
      {
        kind: 'text',
        message: 'Name of the script that runs visual-check update',
        defaultValue: 'visual:update',
        hint: hints.updateScript,
      },
      {
        kind: 'checklist',
        message: 'Add the Storybook addon to',
        defaultValue: ['.storybook'],
        hint: hints.addon,
      },
    ])
    expect(answers).toEqual({
      packageManager: 'pnpm',
      storybooks: [
        {
          configDir: '.storybook',
          name: 'project',
          url: 'http://127.0.0.1:6006',
          startCommand: 'pnpm exec storybook dev -p 6006',
          ...rootPlace,
        },
      ],
      scripts: { test: { name: 'visual:check', add: true }, update: { name: 'visual:update', add: true } },
      addons: [{ configDir: '.storybook', name: 'project', packageDir: '/project' }],
    })
    expect(warnings).toEqual([])
  })

  it('takes a custom name, URL and start command', async () => {
    const { answers } = await ask(['web', 'https://sb.test:7000', 'make sb', 'vt', 'vu', []])

    expect(answers.storybooks).toEqual([
      { configDir: '.storybook', name: 'web', url: 'https://sb.test:7000', startCommand: 'make sb', ...rootPlace },
    ])
    expect(answers.scripts).toEqual({ test: { name: 'vt', add: true }, update: { name: 'vu', add: true } })
    expect(answers.addons).toEqual([])
  })

  it('asks again after a name that is not valid', async () => {
    const { answers, records } = await ask(['Web App', 'web', '', '', '', '', []])

    expect(messagesOf(records, 'invalid')).toEqual(['A Storybook name takes lowercase letters, digits and -.'])
    expect(answers.storybooks[0]?.name).toBe('web')
  })

  it('asks again after a name that another Storybook has', async () => {
    const { answers, records } = await ask(['', 'a', '', '', 'a', 'b', '', '', '', '', []], {
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
    const { answers, records } = await ask(['', 'http://admin:hunter2@127.0.0.1:6006', '', '', '', '', []])
    const [message] = messagesOf(records, 'invalid')

    expect(message).toBe(
      "A Storybook URL can't hold a user name or password. visual-check sends no login: serve Storybook where visual-check runs (storybook dev, or its static build served in the same CI job) and point the URL at that.",
    )
    expect(message).not.toContain('hunter2')
    expect(answers.storybooks[0]?.url).toBe('http://127.0.0.1:6006')
  })

  it('asks again after a URL that is not http', async () => {
    const { records } = await ask(['', 'ftp://host', '', '', '', '', []])

    expect(messagesOf(records, 'invalid')).toEqual(['Give an http: or https: URL, such as http://127.0.0.1:6006.'])
  })

  it('names a config folder in the default start command', async () => {
    const { records } = await ask(['', '', '', '', '', []], {
      project: { storybooks: [storybookOf({ configDir: 'docs/.storybook' })] },
    })

    expect(records.find(({ message }) => message.startsWith('Command'))?.defaultValue).toBe(
      'pnpm exec storybook dev -p 6006 -c docs/.storybook',
    )
  })

  it('takes the default start command for a blank answer', async () => {
    const { answers, records } = await ask(['', '', ' ', '', '', []])

    expect(answers.storybooks[0]?.startCommand).toBe('pnpm exec storybook dev -p 6006')
    expect(messagesOf(records, 'invalid')).toEqual([])
  })

  it('uses the port of the URL in the default start command', async () => {
    const { records } = await ask(['', 'http://localhost:7007', '', '', '', []])

    expect(records.find(({ message }) => message.startsWith('Command'))?.defaultValue).toBe(
      'pnpm exec storybook dev -p 7007',
    )
  })

  it('runs the start script without asking, and defaults to its port', async () => {
    const start = scriptStartOf('storybook', 6100)
    const { answers, records, warnings } = await ask(['', '', '', '', []], {
      project: { storybooks: [storybookOf({ start })] },
    })

    expect(records.map(({ message }) => message)).not.toContain('Command that starts project')
    expect(records[1]).toEqual({
      kind: 'text',
      message: 'URL of project',
      defaultValue: 'http://127.0.0.1:6100',
      hint: hints.url,
    })
    expect(answers.storybooks[0]?.startCommand).toBe('pnpm run storybook')
    expect(warnings).toEqual([])
  })

  it('hints at an Nx target that sets no port, and suggests the default port', async () => {
    const start = { kind: 'nx' as const, project: 'ui', target: 'sb', port: undefined }
    const { answers, records } = await ask(['', '', '', '', []], {
      project: { storybooks: [storybookOf({ start })] },
    })

    expect(messagesOf(records, 'note')).toEqual([
      "hint: The ui:sb target sets no port. Set its port option to 6006, so Storybook always starts on the port in project's URL.",
    ])
    expect(answers.storybooks[0]).toMatchObject({
      url: 'http://127.0.0.1:6006',
      startCommand: 'pnpm exec nx run ui:sb',
    })
  })

  it('hints at a start script that sets no port', async () => {
    const start = scriptStartOf('sb', undefined)
    const { records, warnings } = await ask(['', '', '', '', []], {
      project: { storybooks: [storybookOf({ start })] },
    })

    expect(messagesOf(records, 'note')).toEqual([
      "hint: The sb script sets no port. Add -p 6006 to it, so Storybook always starts on the port in project's URL.",
    ])
    expect(records[2]).toEqual({
      kind: 'text',
      message: 'URL of project',
      defaultValue: 'http://127.0.0.1:6006',
      hint: hints.url,
    })
    expect(warnings).toEqual([])
  })

  it('warns when the URL port differs from the start script port', async () => {
    const start = scriptStartOf('storybook', 6100)
    const { warnings } = await ask(['', 'http://127.0.0.1:6006', '', '', []], {
      project: { storybooks: [storybookOf({ start })] },
    })

    expect(warnings).toEqual([
      "Warning: project's URL, http://127.0.0.1:6006, has port 6006, and its start command, pnpm run storybook, starts Storybook on port 6100.",
    ])
  })

  it('warns when the URL port differs from the port of a start command the person types', async () => {
    const { warnings } = await ask(['', '', 'pnpm exec storybook dev -p 7000', '', '', []])

    expect(warnings).toEqual([
      "Warning: project's URL, http://127.0.0.1:6006, has port 6006, and its start command, pnpm exec storybook dev -p 7000, starts Storybook on port 7000.",
    ])
  })

  it('does not warn when a typed start command starts Storybook on the port of the URL', async () => {
    const { warnings } = await ask(['', '', 'pnpm exec storybook dev -p 6006', '', '', []])

    expect(warnings).toEqual([])
  })

  it('does not warn about a typed start command that runs no storybook dev', async () => {
    const { warnings } = await ask(['', '', 'make sb -p 7000', '', '', []])

    expect(warnings).toEqual([])
  })

  it('counts the port of an https URL without one as 443', async () => {
    const start = scriptStartOf('storybook', 6006)
    const { warnings } = await ask(['', 'https://sb.test', '', '', []], {
      project: { storybooks: [storybookOf({ start })] },
    })

    expect(warnings).toEqual([
      "Warning: project's URL, https://sb.test, has port 443, and its start command, pnpm run storybook, starts Storybook on port 6006.",
    ])
  })

  it('asks for the package manager from a list only when nothing shows one, and the commands follow it', async () => {
    const choices = vi.fn()
    const prompter = scriptedPrompter(['', '', '', '', '', '', []])
    const { answers } = await askQuestions({
      project: projectOf({ packageManager: undefined }),
      prompter: {
        ...prompter,
        select(message, options) {
          choices(options.choices)

          return prompter.select(message, options)
        },
      },
    })

    expect(prompter.records[0]).toEqual({
      kind: 'select',
      message: 'Package manager',
      defaultValue: 'npm',
      hint: hints.packageManager,
    })
    expect(choices).toHaveBeenCalledWith([
      { value: 'npm', label: 'npm' },
      { value: 'pnpm', label: 'pnpm' },
      { value: 'yarn', label: 'yarn', hint: 'Yarn 1, or 2 and later' },
      { value: 'bun', label: 'bun', hint: 'works, but untested' },
    ])
    expect(answers.packageManager).toBe('npm')
    expect(answers.storybooks[0]?.startCommand).toBe('npx storybook dev -p 6006')
  })

  it('takes the package manager picked from the list', async () => {
    const { answers, records } = await ask(['yarn', '', '', '', '', '', []], {
      project: { packageManager: undefined },
    })

    expect(messagesOf(records, 'select')).toEqual(['Package manager'])
    expect(answers.packageManager).toBe('yarn')
    expect(answers.storybooks[0]?.startCommand).toBe('yarn storybook dev -p 6006')
  })

  it('runs the start script with the package manager answered', async () => {
    const start = scriptStartOf('storybook', 6006)
    const { answers } = await ask(['', '', '', '', '', []], {
      project: { packageManager: undefined, storybooks: [storybookOf({ start })] },
    })

    expect(answers.storybooks[0]?.startCommand).toBe('npm run storybook')
  })

  it('uses an existing script that runs visual-check, without a question', async () => {
    const manifest = { scripts: { vt: 'visual-check test --ci', other: 'visual-check update' } }
    const { answers, records } = await ask(['', '', '', []], { project: { manifest } })

    expect(answers.scripts).toEqual({ test: { name: 'vt', add: false }, update: { name: 'other', add: false } })
    expect(messagesOf(records, 'text').filter((message) => message.startsWith('Name of the script'))).toEqual([])
  })

  it('ignores a script that is not a text', async () => {
    const { answers } = await ask(['', '', '', '', '', []], {
      project: { manifest: { scripts: { a: 1, b: null } } },
    })

    expect(answers.scripts.test).toEqual({ name: 'visual:check', add: true })
  })

  it('takes a name another script has, so that script is replaced, and says so in the hint', async () => {
    const manifest = { scripts: { 'visual:check': 'vitest', 'visual:update': 'vitest -u' } }
    const { answers, records, warnings } = await ask(['', '', '', '', '', []], { project: { manifest } })

    expect(answers.scripts).toEqual({
      test: { name: 'visual:check', add: true },
      update: { name: 'visual:update', add: true },
    })
    expect(records.filter(({ message }) => message.startsWith('Name of the script')).map(({ hint }) => hint)).toEqual([
      `${hints.testScript} Replaces your current visual:check script.`,
      `${hints.updateScript} Replaces your current visual:update script.`,
    ])
    expect(messagesOf(records, 'invalid')).toEqual([])
    expect(warnings).toEqual([])
  })

  it('suggests visual:update-baselines for the update script when the test script has visual:update', async () => {
    const manifest = { scripts: { 'visual:update': 'visual-check test' } }
    const { answers, records } = await ask(['', '', '', '', []], { project: { manifest } })

    expect(records.find(({ message }) => message.endsWith('visual-check update'))).toEqual({
      kind: 'text',
      message: 'Name of the script that runs visual-check update',
      defaultValue: 'visual:update-baselines',
      hint: hints.updateScript,
    })
    expect(answers.scripts).toEqual({
      test: { name: 'visual:update', add: false },
      update: { name: 'visual:update-baselines', add: true },
    })
  })

  it('suggests visual:test for the test script when the update script is called visual:check', async () => {
    const manifest = { scripts: { 'visual:check': 'visual-check update' } }
    const { answers, records } = await ask(['', '', '', '', []], { project: { manifest } })

    expect(records.filter(({ message }) => message.startsWith('Name of the script'))).toEqual([
      {
        kind: 'text',
        message: 'Name of the script that runs visual-check test',
        defaultValue: 'visual:test',
        hint: hints.testScript,
      },
    ])
    expect(answers.scripts).toEqual({
      test: { name: 'visual:test', add: true },
      update: { name: 'visual:check', add: false },
    })
  })

  it('asks again when the test script has the name of the update script it reuses', async () => {
    const manifest = { scripts: { 'visual:check': 'visual-check update' } }
    const { answers, records } = await ask(['', '', '', 'visual:check', 'vt', []], { project: { manifest } })

    expect(messagesOf(records, 'invalid')).toEqual(['The test and update scripts need different names.'])
    expect(answers.scripts.test).toEqual({ name: 'vt', add: true })
  })

  it.each([
    [
      { 'visual:update': 'visual-check test' },
      { test: { name: 'visual:update', add: false }, update: { name: 'visual:update-baselines', add: true } },
    ],
    [
      { 'visual:check': 'visual-check update' },
      { test: { name: 'visual:test', add: true }, update: { name: 'visual:check', add: false } },
    ],
  ])('never gives one script the name of the other with the defaults prompter, for %j', async (scripts, expected) => {
    const { answers } = await askQuestions({
      project: projectOf({ manifest: { scripts } }),
      prompter: defaultsPrompter(),
    })

    expect(answers.scripts).toEqual(expected)
  })

  it('says a script with the suggested name is replaced, even another visual-check command', async () => {
    const { records } = await ask(['', '', '', '', '', []], {
      project: { manifest: { scripts: { 'visual:check': 'visual-check init --yes' } } },
    })

    expect(records.find(({ message }) => message.endsWith('visual-check test'))?.hint).toBe(
      `${hints.testScript} Replaces your current visual:check script.`,
    )
  })

  it('suggests visual:test when the script named visual:check starts Storybook, and says nothing of replacing it', async () => {
    const start = scriptStartOf('visual:check', 6006)
    const { answers, records } = await ask(['', '', '', '', []], {
      project: {
        manifest: { scripts: { 'visual:check': 'storybook dev -p 6006' } },
        storybooks: [storybookOf({ start })],
      },
    })
    const testQuestion = records.find(({ message }) => message.endsWith('visual-check test'))

    expect(testQuestion?.defaultValue).toBe('visual:test')
    expect(testQuestion?.hint).toBe(hints.testScript)
    expect(answers.scripts.test).toEqual({ name: 'visual:test', add: true })
  })

  it.each([
    ['visual:check', { test: { name: 'visual:test', add: true }, update: { name: 'visual:update', add: true } }],
    [
      'visual:update',
      { test: { name: 'visual:check', add: true }, update: { name: 'visual:update-baselines', add: true } },
    ],
  ])(
    'never takes the name of a script that starts Storybook with the defaults prompter: %s',
    async (script, expected) => {
      const start = scriptStartOf(script, 6006)
      const { answers } = await askQuestions({
        project: projectOf({
          manifest: { scripts: { [script]: 'storybook dev -p 6006' } },
          storybooks: [storybookOf({ start })],
        }),
        prompter: defaultsPrompter(),
      })

      expect(answers.scripts).toEqual(expected)
    },
  )

  it("keeps the default script names when only another package's script with that name starts Storybook", async () => {
    const start = scriptStartOf('visual:check', 6006, '/project/packages/ui')
    const { answers } = await askQuestions({
      project: projectOf({ storybooks: [storybookOf({ packageDir: '/project/packages/ui', start })] }),
      prompter: defaultsPrompter(),
    })

    expect(answers.scripts.test).toEqual({ name: 'visual:check', add: true })
  })

  it("starts a Storybook with Nx's target, and suggests the URL on its port", async () => {
    const { answers } = await askQuestions({
      project: projectOf({
        storybooks: [storybookOf({ start: { kind: 'nx', project: 'ui', target: 'storybook', port: 4400 } })],
      }),
      prompter: defaultsPrompter(),
    })

    expect(answers.storybooks).toEqual([
      {
        configDir: '.storybook',
        name: 'project',
        url: 'http://127.0.0.1:4400',
        startCommand: 'pnpm exec nx run ui:storybook',
        ...rootPlace,
      },
    ])
  })

  it('asks again after a script name that starts Storybook or has a space', async () => {
    const start = scriptStartOf('storybook', 6006)
    const { answers, records } = await ask(['', '', 'storybook', 'a b', 'vt', '', []], {
      project: { storybooks: [storybookOf({ start })] },
    })

    expect(messagesOf(records, 'invalid')).toEqual([
      'The storybook script starts Storybook. Pick another name.',
      "A script name can't hold spaces.",
    ])
    expect(answers.scripts.test).toEqual({ name: 'vt', add: true })
  })

  it("refuses the name of a root script that starts a package's Storybook", async () => {
    const start = scriptStartOf('sb:ui', 6006, '/project')
    const { answers, records } = await ask(['', '', 'sb:ui', 'vt', '', []], {
      project: {
        manifest: { scripts: { 'sb:ui': 'storybook dev -c packages/ui/.storybook -p 6006' } },
        storybooks: [storybookOf({ configDir: 'packages/ui/.storybook', packageDir: '/project/packages/ui', start })],
      },
    })

    expect(messagesOf(records, 'invalid')).toEqual(['The sb:ui script starts Storybook. Pick another name.'])
    expect(answers.scripts.test).toEqual({ name: 'vt', add: true })
  })

  it('asks again when the update script has the name of the test script', async () => {
    const { answers, records } = await ask(['', '', '', 'same', 'same', 'other', []])

    expect(messagesOf(records, 'invalid')).toEqual(['The test and update scripts need different names.'])
    expect(answers.scripts.update).toEqual({ name: 'other', add: true })
  })

  it('offers the addon to the Storybooks answered, and keeps the ones ticked', async () => {
    const { answers, records } = await ask(['', '', '', '', '', '', '', ['docs/.storybook']], {
      project: {
        storybooks: [
          storybookOf({ defaultName: 'a', start: scriptStartOf('sb', 6006) }),
          storybookOf({ configDir: 'docs/.storybook', defaultName: 'b', start: scriptStartOf('sb', 6007) }),
        ],
      },
    })

    expect(records.at(-1)).toEqual({
      kind: 'checklist',
      message: 'Add the Storybook addon to',
      defaultValue: ['.storybook', 'docs/.storybook'],
      hint: hints.addon,
    })
    expect(answers.addons).toEqual([{ configDir: 'docs/.storybook', name: 'b', packageDir: '/project' }])
  })

  it('asks no Storybook question with an existing config, and names the addon choice after the config', async () => {
    const { answers, records } = await ask(['', '', ''], { existingConfig: { names: { '.storybook': 'web' } } })

    expect(answers.storybooks).toEqual([])
    expect(records.map(({ message }) => message)).toEqual([
      'Name of the script that runs visual-check test',
      'Name of the script that runs visual-check update',
      'Add the Storybook addon to',
    ])
    expect(answers.addons).toEqual([{ configDir: '.storybook', name: 'web', packageDir: '/project' }])
  })

  it('does not warn about an explicit default port that matches the start script', async () => {
    const start = scriptStartOf('storybook', 80)
    const { warnings } = await ask(['', 'http://127.0.0.1:80', '', '', []], {
      project: { storybooks: [storybookOf({ start })] },
    })

    expect(warnings).toEqual([])
  })

  it.each(['my-visual-check test', 'visual-check test-x', 'visual-check testing'])(
    'does not take "%s" for a script that runs visual-check test',
    async (command) => {
      const { answers } = await ask(['', '', '', '', '', []], { project: { manifest: { scripts: { a: command } } } })

      expect(answers.scripts.test).toEqual({ name: 'visual:check', add: true })
    },
  )

  it.each([
    'npx visual-check test',
    'cd x && visual-check test',
    './node_modules/.bin/visual-check test',
    'visual-check test',
  ])('takes "%s" for a script that runs visual-check test', async (command) => {
    const { answers } = await ask(['', '', '', '', []], { project: { manifest: { scripts: { a: command } } } })

    expect(answers.scripts.test).toEqual({ name: 'a', add: false })
  })

  it('gives the defaults with the defaults prompter', async () => {
    const prompter = defaultsPrompter()
    const start = scriptStartOf('sb', undefined)
    const { answers, warnings } = await askQuestions({
      project: projectOf({ storybooks: [storybookOf({ start })] }),
      prompter,
    })

    expect(answers).toEqual({
      packageManager: 'pnpm',
      storybooks: [
        {
          configDir: '.storybook',
          name: 'project',
          url: 'http://127.0.0.1:6006',
          startCommand: 'pnpm run sb',
          ...rootPlace,
        },
      ],
      scripts: { test: { name: 'visual:check', add: true }, update: { name: 'visual:update', add: true } },
      addons: [{ configDir: '.storybook', name: 'project', packageDir: '/project' }],
    })
    expect(warnings).toEqual([])
    expect(prompter.notes).toEqual([
      "hint: The sb script sets no port. Add -p 6006 to it, so Storybook always starts on the port in project's URL.",
    ])
  })

  describe('with more than one Storybook', () => {
    /**
     * Two Storybooks in two packages of a pnpm workspace, each started by its package's `storybook` script.
     */
    const storybooks = [
      storybookOf({
        configDir: 'packages/ui/.storybook',
        packageDir: '/project/packages/ui',
        packageName: '@acme/ui',
        defaultName: 'ui',
        start: scriptStartOf('storybook', 6006, '/project/packages/ui', '@acme/ui'),
      }),
      storybookOf({
        configDir: 'packages/web/.storybook',
        packageDir: '/project/packages/web',
        defaultName: 'web',
        start: scriptStartOf('storybook', 6007, '/project/packages/web', undefined),
      }),
    ]
    const project = {
      workspace: {
        kind: 'pnpm' as const,
        packageDirs: ['.', 'packages/ui', 'packages/web'],
        packageManagerLists: { pnpm: true, workspaces: false },
      },
    }

    it('asks which to set up first, from a checklist with all ticked', async () => {
      const choices = vi.fn()
      const prompter = scriptedPrompter(['', '', '', '', '', '', '', []])

      await askQuestions({
        project: projectOf({ ...project, storybooks }),
        prompter: {
          ...prompter,
          checklist(message, options) {
            choices(options.choices)

            return prompter.checklist(message, options)
          },
        },
      })

      expect(prompter.records[0]).toEqual({
        kind: 'checklist',
        message: 'Storybooks to set up',
        defaultValue: ['packages/ui/.storybook', 'packages/web/.storybook'],
        hint: 'The ones ticked go in the config.',
      })
      expect(choices).toHaveBeenNthCalledWith(1, [
        { value: 'packages/ui/.storybook', label: 'packages/ui/.storybook', hint: '@acme/ui' },
        { value: 'packages/web/.storybook', label: 'packages/web/.storybook', hint: 'web' },
      ])
      expect(prompter.unused()).toEqual([])
    })

    it('asks again when none is ticked, then asks only about the ones ticked', async () => {
      const { answers, records } = await ask([[], ['packages/web/.storybook'], '', '', '', '', ''], {
        project: { ...project, storybooks },
      })

      expect(messagesOf(records, 'invalid')).toEqual(['Tick at least one Storybook.'])
      expect(answers.storybooks).toEqual([
        {
          configDir: 'packages/web/.storybook',
          name: 'web',
          url: 'http://127.0.0.1:6007',
          startCommand: 'pnpm --filter ./packages/web run storybook',
          packageDir: '/project/packages/web',
          manifestDir: '/project/packages/web',
          manifest: {},
        },
      ])
      expect(records.filter(({ kind }) => kind === 'checklist').map(({ defaultValue }) => defaultValue)).toEqual([
        ['packages/ui/.storybook', 'packages/web/.storybook'],
        ['packages/web/.storybook'],
      ])
      expect(answers.addons).toEqual([
        { configDir: 'packages/web/.storybook', name: 'web', packageDir: '/project/packages/web' },
      ])
    })

    it("goes into a package's folder to start it when the package manager's own list doesn't name the packages", async () => {
      const { answers } = await askQuestions({
        project: projectOf({
          workspace: {
            kind: 'nx',
            packageDirs: ['.', 'packages/ui'],
            packageManagerLists: { pnpm: false, workspaces: true },
          },
          storybooks,
        }),
        prompter: defaultsPrompter(),
      })

      expect(answers.storybooks.map(({ startCommand }) => startCommand)).toEqual([
        'cd packages/ui && pnpm run storybook',
        'cd packages/web && pnpm run storybook',
      ])
    })

    it('starts a package of an Nx workspace through the package manager when its own list names the packages', async () => {
      const { answers } = await askQuestions({
        project: projectOf({
          packageManager: 'npm',
          workspace: {
            kind: 'nx',
            packageDirs: ['.', 'packages/ui'],
            packageManagerLists: { pnpm: false, workspaces: true },
          },
          storybooks,
        }),
        prompter: defaultsPrompter(),
      })

      expect(answers.storybooks.map(({ startCommand }) => startCommand)).toEqual([
        'npm run storybook --workspace packages/ui',
        'npm run storybook --workspace packages/web',
      ])
    })

    it('sets up every Storybook with the defaults prompter, each started from the root', async () => {
      const { answers, warnings } = await askQuestions({
        project: projectOf({ ...project, storybooks }),
        prompter: defaultsPrompter(),
      })

      expect(answers.storybooks.map(({ name, startCommand }) => [name, startCommand])).toEqual([
        ['ui', 'pnpm --filter @acme/ui run storybook'],
        ['web', 'pnpm --filter ./packages/web run storybook'],
      ])
      expect(warnings).toEqual([])
    })

    it('asks no checklist with an existing config', async () => {
      const { records } = await ask(['', '', []], {
        project: { ...project, storybooks },
        existingConfig: { names: { 'packages/ui/.storybook': 'ui' } },
      })

      expect(messagesOf(records, 'checklist')).toEqual(['Add the Storybook addon to'])
    })

    it('warns once when two Storybooks share a port', async () => {
      const { warnings } = await ask(['', '', '', '', 'http://127.0.0.1:6006', '', '', []], {
        project: { ...project, storybooks },
      })

      expect(warnings).toEqual([
        "Warning: web's URL, http://127.0.0.1:6006, has port 6006, and its start command, pnpm --filter ./packages/web run storybook, starts Storybook on port 6007.",
        "Warning: ui and web both use port 6006, so they can't run at the same time. Give each Storybook its own port.",
      ])
    })

    it('warns once per port that three Storybooks or more share, and not across hosts', async () => {
      const storybooks = [
        storybookOf({ configDir: 'a/.storybook', defaultName: 'a' }),
        storybookOf({ configDir: 'b/.storybook', defaultName: 'b' }),
        storybookOf({ configDir: 'c/.storybook', defaultName: 'c' }),
        storybookOf({ configDir: 'd/.storybook', defaultName: 'd' }),
        storybookOf({ configDir: 'e/.storybook', defaultName: 'e' }),
      ]
      const { warnings } = await ask(
        [
          ...['', '', '', ''],
          ...['', '', ''],
          ...['', '', ''],
          ...['', 'http://sb.test:6006', ''],
          ...['', 'https://127.0.0.1', ''],
          ...['', '', []],
        ],
        { project: { storybooks } },
      )

      expect(warnings).toEqual([
        "Warning: a, b and c all use port 6006, so they can't run at the same time. Give each Storybook its own port.",
      ])
    })

    it.each(['http://localhost:6006', 'http://[::1]:6006', 'http://0.0.0.0:6006', 'http://127.0.0.2:6006'])(
      'counts %s and 127.0.0.1 as one host',
      async (url) => {
        const { warnings } = await ask(['', '', '', '', url, '', '', []], { project: { ...project, storybooks } })

        expect(warnings.at(-1)).toBe(
          "Warning: ui and web both use port 6006, so they can't run at the same time. Give each Storybook its own port.",
        )
      },
    )
  })
})
