import { describe, expect, it, vi } from 'vitest'
import { scriptedPrompter } from './prompter.fixture.js'
import { countingPrompter, defaultsPrompter, InputEndedError } from './prompter.js'

describe('defaultsPrompter', () => {
  it('answers every question with its default, without validating, and ignores the hints', async () => {
    const prompter = defaultsPrompter()
    const choices = [
      { value: 'npm', label: 'npm' },
      { value: 'bun', label: 'bun', hint: 'works, but untested' },
    ] as const

    await expect(
      prompter.text('Name', { defaultValue: 'web', hint: 'A hint.', validate: () => 'Never.' }),
    ).resolves.toBe('web')
    await expect(prompter.confirm('Add it?', { defaultValue: true, hint: 'A hint.' })).resolves.toBe(true)
    await expect(prompter.confirm('Add it?', { defaultValue: false })).resolves.toBe(false)
    await expect(prompter.select('Package manager', { choices, defaultValue: 'bun', hint: 'A hint.' })).resolves.toBe(
      'bun',
    )
    await expect(
      prompter.checklist('Storybooks', {
        choices,
        defaultValues: ['bun', 'npm'],
        hint: 'A hint.',
        validate: () => 'No.',
      }),
    ).resolves.toEqual(['npm', 'bun'])
    await expect(prompter.checklist('Storybooks', { choices, defaultValues: [] })).resolves.toEqual([])
    expect(prompter.notes).toEqual([])
  })

  it('collects the notes', () => {
    const prompter = defaultsPrompter()

    prompter.note('one')
    prompter.note('two')

    expect(prompter.notes).toEqual(['one', 'two'])
  })
})

describe('countingPrompter', () => {
  it('tells the prompter how many questions are answered of the total before each one', async () => {
    const questionProgress = vi.fn()
    const prompter = countingPrompter({ ...scriptedPrompter(['web', true, 'npm', []]), questionProgress }, 4)
    const choices = [{ value: 'npm', label: 'npm' }] as const

    await prompter.text('Name', { defaultValue: 'docs' })
    await prompter.confirm('Add it?', { defaultValue: true })
    await prompter.select('Package manager', { choices, defaultValue: 'npm' })
    await prompter.checklist('Storybooks', { choices, defaultValues: [] })

    expect(questionProgress.mock.calls).toEqual([
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
    ])
  })

  it('counts a question asked again after a validation message once', async () => {
    const questionProgress = vi.fn()
    const prompter = countingPrompter({ ...scriptedPrompter(['Bad', 'good', '']), questionProgress }, 2)
    const validate = (value: string) => (value === value.toLowerCase() ? undefined : 'Lowercase.')

    await expect(prompter.text('Name', { defaultValue: 'web', validate })).resolves.toBe('good')
    await prompter.text('URL', { defaultValue: 'http://127.0.0.1:6006' })

    expect(questionProgress.mock.calls).toEqual([
      [0, 2],
      [1, 2],
    ])
  })

  it('tells the new total once it is planned again', async () => {
    const questionProgress = vi.fn()
    const prompter = countingPrompter({ ...scriptedPrompter(['', '']), questionProgress }, 5)

    await prompter.text('Name', { defaultValue: 'web' })
    prompter.replan(2)
    await prompter.text('URL', { defaultValue: 'http://127.0.0.1:6006' })

    expect(questionProgress.mock.calls).toEqual([
      [0, 5],
      [1, 2],
    ])
  })

  it('passes the answers and notes through, and asks a prompter without progress all the same', async () => {
    const scripted = scriptedPrompter(['web'])
    const prompter = countingPrompter(scripted, 1)

    prompter.note('hint: a')

    await expect(prompter.text('Name', { defaultValue: 'docs' })).resolves.toBe('web')
    expect(scripted.records).toEqual([
      { kind: 'note', message: 'hint: a' },
      { kind: 'text', message: 'Name', defaultValue: 'docs' },
    ])
  })
})

describe('InputEndedError', () => {
  it('says init stopped and wrote nothing', () => {
    const error = new InputEndedError()

    expect(error.name).toBe('InputEndedError')
    expect(error.message).toBe('visual-check init stopped before every answer was in. It wrote nothing.')
  })
})
