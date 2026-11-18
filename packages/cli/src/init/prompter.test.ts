import { describe, expect, it } from 'vitest'
import { defaultsPrompter, InputEndedError } from './prompter.js'

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

describe('InputEndedError', () => {
  it('says init stopped and wrote nothing', () => {
    const error = new InputEndedError()

    expect(error.name).toBe('InputEndedError')
    expect(error.message).toBe('visual-check init stopped before every answer was in. It wrote nothing.')
  })
})
