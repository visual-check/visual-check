import { describe, expect, it } from 'vitest'
import { askAddons } from './addon-question.js'
import type { DetectedStorybook } from './detect-project.js'
import { projectOf, storybookOf } from './detected-project.fixture.js'
import { type PromptRecord, type ScriptedAnswer, scriptedPrompter } from './prompter.fixture.js'

/**
 * The hint of the addon question.
 */
const hint = 'Check and update the open story from inside Storybook.'

/**
 * Asks the addon question about `storybooks`, each answered with its default name unless a config already exists, and
 * gives the answers and what the prompter recorded.
 */
async function ask(
  scripted: ScriptedAnswer[],
  storybooks: DetectedStorybook[],
  existingConfig?: { names: Record<string, string> },
) {
  const prompter = scriptedPrompter(scripted)
  const answered = storybooks.map(({ configDir, defaultName }) => ({ configDir, name: defaultName }))
  const addons = await askAddons({
    project: projectOf({ storybooks }),
    answered: existingConfig === undefined ? answered : [],
    existingConfig,
    prompter,
  })

  expect(prompter.unused()).toEqual([])

  return { addons, records: prompter.records }
}

/**
 * Lists the messages of the records of one kind.
 */
function messagesOf(records: PromptRecord[], kind: PromptRecord['kind']): string[] {
  return records.filter((record) => record.kind === kind).map(({ message }) => message)
}

describe('askAddons', () => {
  it.each([
    ['9.1.0', 0, ['hint: project runs Storybook 9, and the addon is for Storybook 10, so init skips it.']],
    ['10.0.0', 1, []],
    ['11.0.0', 0, ['hint: project runs Storybook 11, and the addon is for Storybook 10, so init skips it.']],
    ['12.0.0', 0, ['hint: project runs Storybook 12, and the addon is for Storybook 10, so init skips it.']],
    [undefined, 0, []],
  ])('asks about the addon for Storybook %s: %s question', async (version, questions, notes) => {
    const { records } = await ask(questions === 1 ? [''] : [], [storybookOf({ version })])

    expect(messagesOf(records, 'checklist')).toHaveLength(questions)
    expect(messagesOf(records, 'note')).toEqual(notes)
  })

  it.each(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'])(
    "skips the addon question when the Storybook package's %s lists it",
    async (field) => {
      const manifest = { [field]: { '@visual-check/storybook-addon': '^1.0.0' } }
      const { addons, records } = await ask([], [storybookOf({ manifest })])

      expect(records).toEqual([])
      expect(addons).toEqual([])
    },
  )

  it('lists only the Storybooks 10 with the addon missing, after a note on each other version, all ticked', async () => {
    const listing = { devDependencies: { '@visual-check/storybook-addon': '^1.0.0' } }
    const { addons, records } = await ask(
      [''],
      [
        storybookOf({ configDir: 'a/.storybook', packageDir: '/project/a', defaultName: 'a' }),
        storybookOf({ configDir: 'b/.storybook', defaultName: 'b', version: '9.1.0' }),
        storybookOf({ configDir: 'c/.storybook', defaultName: 'c', manifest: listing }),
        storybookOf({ configDir: 'd/.storybook', defaultName: 'd', version: '11.2.0' }),
        storybookOf({ configDir: 'e/.storybook', defaultName: 'e' }),
      ],
    )

    expect(records).toEqual([
      { kind: 'note', message: 'hint: b runs Storybook 9, and the addon is for Storybook 10, so init skips it.' },
      { kind: 'note', message: 'hint: d runs Storybook 11, and the addon is for Storybook 10, so init skips it.' },
      {
        kind: 'checklist',
        message: 'Add the Storybook addon to',
        defaultValue: ['a/.storybook', 'e/.storybook'],
        hint,
      },
    ])
    expect(addons).toEqual([
      { configDir: 'a/.storybook', name: 'a', packageDir: '/project/a', manifestDir: '/project/a', manifest: {} },
      { configDir: 'e/.storybook', name: 'e', packageDir: '/project', manifestDir: '/project', manifest: {} },
    ])
  })

  it('asks a one-item checklist for one Storybook', async () => {
    const { addons, records } = await ask([''], [storybookOf()])

    expect(records).toEqual([
      { kind: 'checklist', message: 'Add the Storybook addon to', defaultValue: ['.storybook'], hint },
    ])
    expect(addons).toEqual([
      { configDir: '.storybook', name: 'project', packageDir: '/project', manifestDir: '/project', manifest: {} },
    ])
  })

  it('keeps the Storybooks ticked, and takes none', async () => {
    const storybooks = [
      storybookOf({ defaultName: 'a' }),
      storybookOf({ configDir: 'docs/.storybook', defaultName: 'b' }),
    ]
    const some = await ask([['docs/.storybook']], storybooks)
    const none = await ask([[]], storybooks)

    expect(some.addons).toEqual([
      { configDir: 'docs/.storybook', name: 'b', packageDir: '/project', manifestDir: '/project', manifest: {} },
    ])
    expect(none.addons).toEqual([])
  })

  it('leaves out a Storybook not answered', async () => {
    const prompter = scriptedPrompter([''])
    const addons = await askAddons({
      project: projectOf({
        storybooks: [storybookOf(), storybookOf({ configDir: 'docs/.storybook', defaultName: 'docs' })],
      }),
      answered: [{ configDir: 'docs/.storybook', name: 'docs' }],
      existingConfig: undefined,
      prompter,
    })

    expect(addons).toEqual([
      { configDir: 'docs/.storybook', name: 'docs', packageDir: '/project', manifestDir: '/project', manifest: {} },
    ])
  })

  it('offers the addon only to the Storybooks of an existing config, named as the config names them', async () => {
    const { addons, records } = await ask(
      [''],
      [storybookOf(), storybookOf({ configDir: 'docs/.storybook', defaultName: 'docs-x' })],
      { names: { 'docs/.storybook': 'docs' } },
    )

    expect(records).toEqual([
      { kind: 'checklist', message: 'Add the Storybook addon to', defaultValue: ['docs/.storybook'], hint },
    ])
    expect(addons).toEqual([
      { configDir: 'docs/.storybook', name: 'docs', packageDir: '/project', manifestDir: '/project', manifest: {} },
    ])
  })
})
