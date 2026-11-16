import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createTerminalPrompter, defaultsPrompter } from './prompter.js'

/**
 * Builds a terminal prompter on streams that tests feed and read.
 */
function terminal(): {
  input: PassThrough
  written: () => string
  prompter: ReturnType<typeof createTerminalPrompter>
} {
  const input = new PassThrough()
  const output = new PassThrough()
  let text = ''

  output.on('data', (chunk: Buffer) => {
    text += chunk.toString()
  })

  return { input, written: () => text, prompter: createTerminalPrompter(input, output) }
}

describe('createTerminalPrompter', () => {
  it('takes the default for an empty answer', async () => {
    const { input, written, prompter } = terminal()

    input.write('\n')

    await expect(prompter.text('Name', { defaultValue: 'web' })).resolves.toBe('web')
    expect(written()).toBe('? Name (web) ')
    prompter.close()
  })

  it('trims an answer', async () => {
    const { input, prompter } = terminal()

    input.write('  docs  \n')

    await expect(prompter.text('Name', { defaultValue: 'web' })).resolves.toBe('docs')
    prompter.close()
  })

  it('shows the validation message and asks again', async () => {
    const { input, written, prompter } = terminal()

    input.write('Bad\ngood\n')

    const answer = await prompter.text('Name', {
      defaultValue: 'web',
      validate: (value) => (value === 'good' ? undefined : 'Not good.'),
    })

    expect(answer).toBe('good')
    expect(written()).toBe('? Name (web)   Not good.\n? Name (web) ')
    prompter.close()
  })

  it('reads an answer that arrives after the question', async () => {
    const { input, prompter } = terminal()
    const answer = prompter.text('Name', { defaultValue: 'web' })

    input.write('late\n')

    await expect(answer).resolves.toBe('late')
    prompter.close()
  })

  it.each([
    [true, '(Y/n)', '', true],
    [false, '(y/N)', '', false],
    [false, '(y/N)', 'yes', true],
    [true, '(Y/n)', 'NO', false],
    [false, '(y/N)', 'Y', true],
  ])('asks a yes or no question with default %s as %s and answer "%s"', async (defaultValue, hint, line, expected) => {
    const { input, written, prompter } = terminal()

    input.write(`${line}\n`)

    await expect(prompter.confirm('Add it?', defaultValue)).resolves.toBe(expected)
    expect(written()).toBe(`? Add it? ${hint} `)
    prompter.close()
  })

  it('asks again after an answer that is neither yes nor no', async () => {
    const { input, written, prompter } = terminal()

    input.write('maybe\nn\n')

    await expect(prompter.confirm('Add it?', true)).resolves.toBe(false)
    expect(written()).toBe('? Add it? (Y/n)   Answer y or n.\n? Add it? (Y/n) ')
    prompter.close()
  })

  it('reads lines that end in a carriage return and a line feed', async () => {
    const { input, prompter } = terminal()

    input.write('docs\r\n')

    await expect(prompter.text('Name', { defaultValue: 'web' })).resolves.toBe('docs')
    prompter.close()
  })

  it('writes a note as a line', () => {
    const { written, prompter } = terminal()

    prompter.note('hint: look here')

    expect(written()).toBe('hint: look here\n')
    prompter.close()
  })

  it('rejects when the input ends while it waits', async () => {
    const { input, written, prompter } = terminal()
    const answer = prompter.text('Name', { defaultValue: 'web' })

    input.end()

    await expect(answer).rejects.toThrow(new Error('visual-check init needs an answer, and the input ended.'))
    expect(written()).toBe('? Name (web) \n')
  })

  it('rejects a question asked after the input ended', async () => {
    const { input, prompter } = terminal()

    input.write('first\n')
    input.end()

    await expect(prompter.text('Name', { defaultValue: 'web' })).resolves.toBe('first')
    await expect(prompter.confirm('Add it?', true)).rejects.toThrow(
      'visual-check init needs an answer, and the input ended.',
    )
  })
})

describe('defaultsPrompter', () => {
  it('answers every question with its default, without validating', async () => {
    const prompter = defaultsPrompter()

    await expect(prompter.text('Name', { defaultValue: 'web', validate: () => 'Never.' })).resolves.toBe('web')
    await expect(prompter.confirm('Add it?', true)).resolves.toBe(true)
    await expect(prompter.confirm('Add it?', false)).resolves.toBe(false)
  })

  it('collects the notes', () => {
    const prompter = defaultsPrompter()

    prompter.note('one')
    prompter.note('two')
    prompter.close()

    expect(prompter.notes).toEqual(['one', 'two'])
  })
})
