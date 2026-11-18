import { describe, expect, it } from 'vitest'
import { scriptedPrompter } from './prompter.fixture.js'

/**
 * The choices the test checklists offer.
 */
const choices = [
  { value: 'web', label: 'web' },
  { value: 'docs', label: 'docs' },
  { value: 'ui', label: 'ui' },
] as const

describe('scriptedPrompter checklist', () => {
  it('answers with the values scripted, in the order of the choices, and records the question', async () => {
    const prompter = scriptedPrompter([['ui', 'web']])

    await expect(
      prompter.checklist('Storybooks', { choices, defaultValues: ['docs'], hint: 'A hint.' }),
    ).resolves.toEqual(['web', 'ui'])
    expect(prompter.records).toEqual([
      { kind: 'checklist', message: 'Storybooks', defaultValue: ['docs'], hint: 'A hint.' },
    ])
    expect(prompter.unused()).toEqual([])
  })

  it('takes the defaults, in the order of the choices, for an empty string', async () => {
    const prompter = scriptedPrompter([''])

    await expect(prompter.checklist('Storybooks', { choices, defaultValues: ['ui', 'web'] })).resolves.toEqual([
      'web',
      'ui',
    ])
  })

  it('records a validation message and takes the next answer', async () => {
    const prompter = scriptedPrompter([[], ['docs']])
    const validate = (values: string[]) => (values.length === 0 ? 'Pick one.' : undefined)

    await expect(prompter.checklist('Storybooks', { choices, defaultValues: [], validate })).resolves.toEqual(['docs'])
    expect(prompter.records.map(({ kind, message }) => [kind, message])).toEqual([
      ['checklist', 'Storybooks'],
      ['invalid', 'Pick one.'],
    ])
  })

  it('throws for a value no choice has', () => {
    const prompter = scriptedPrompter([['gone']])

    expect(() => prompter.checklist('Storybooks', { choices, defaultValues: [] })).toThrow(
      '"Storybooks" offers no choice "gone".',
    )
  })

  it.each([[true], ['web']])('throws for an answer that is not an array, such as %s', (answer) => {
    const prompter = scriptedPrompter([answer])

    expect(() => prompter.checklist('Storybooks', { choices, defaultValues: [] })).toThrow(
      `"Storybooks" is a checklist, and the answer is "${answer}".`,
    )
  })

  it('throws when it runs out of answers', () => {
    expect(() => scriptedPrompter([]).checklist('Storybooks', { choices, defaultValues: [] })).toThrow(
      'The scripted prompter ran out of answers at "Storybooks".',
    )
  })
})
