import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanupSettled, keys, plainFrameOf, press, renderSettled } from './terminal.fixture.js'
import { TextQuestion } from './text-question.js'
import { ThemeContext } from './theme.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(cleanupSettled)

/**
 * Renders a text question with recording callbacks.
 */
async function renderQuestion(options: { hint?: string; validate?: (value: string) => string | undefined } = {}) {
  const onSubmit = vi.fn<(value: string) => void>()
  const onCancel = vi.fn<() => void>()
  const instance = await renderSettled(
    <TextQuestion
      defaultValue="stories"
      hint={options.hint}
      message="Stories folder"
      onCancel={onCancel}
      onSubmit={onSubmit}
      validate={options.validate}
    />,
  )

  return { ...instance, onSubmit, onCancel }
}

describe('TextQuestion', () => {
  it('draws the question, the hint and the default', async () => {
    const { lastFrame } = await renderQuestion({ hint: 'Relative to the project root.' })

    expect(plainFrameOf(lastFrame())).toBe('? Stories folder\n  Relative to the project root.\n› stories (default)')
  })

  it('draws no hint line without a hint', async () => {
    const { lastFrame } = await renderQuestion()

    expect(plainFrameOf(lastFrame())).toBe('? Stories folder\n› stories (default)')
  })

  it('draws the question mark in the accent colour, the question bold, the hint and the default dim', async () => {
    const { lastFrame } = await renderQuestion({ hint: 'Relative.' })

    expect(lastFrame()).toBe(
      '\u001b[36m?\u001b[39m \u001b[1mStories folder\u001b[22m\n' +
        '  \u001b[2mRelative.\u001b[22m\n' +
        '\u001b[36m›\u001b[39m \u001b[2m\u001b[7ms\u001b[27mtories (default)\u001b[22m',
    )
  })

  it('draws no colour when the theme has colour off', async () => {
    const { lastFrame } = await renderSettled(
      <ThemeContext value={{ colour: false }}>
        <TextQuestion defaultValue="stories" message="Stories folder" onCancel={vi.fn()} onSubmit={vi.fn()} />
      </ThemeContext>,
    )

    expect(lastFrame()).toBe(
      '? \u001b[1mStories folder\u001b[22m\n› \u001b[2m\u001b[7ms\u001b[27mtories (default)\u001b[22m',
    )
  })

  it('draws only the cursor while the input is empty and there is no default', async () => {
    const { lastFrame } = await renderSettled(
      <TextQuestion defaultValue="" message="Name" onCancel={vi.fn()} onSubmit={vi.fn()} />,
    )

    expect(lastFrame()).toBe(
      '\u001b[36m?\u001b[39m \u001b[1mName\u001b[22m\n\u001b[36m›\u001b[39m \u001b[2m\u001b[7m \u001b[27m\u001b[22m',
    )
  })

  it('draws what was typed with the cursor after it', async () => {
    const { lastFrame, stdin } = await renderQuestion()

    await press(stdin, 'a', 'b')

    expect(lastFrame()).toBe(
      '\u001b[36m?\u001b[39m \u001b[1mStories folder\u001b[22m\n\u001b[36m›\u001b[39m ab\u001b[7m \u001b[27m',
    )
  })

  it('moves the cursor with the arrows and types at it', async () => {
    const { lastFrame, stdin } = await renderQuestion()

    await press(stdin, 'a', 'c', keys.left, 'b', keys.left, keys.left, keys.left, '_', keys.right)

    expect(lastFrame()).toBe(
      '\u001b[36m?\u001b[39m \u001b[1mStories folder\u001b[22m\n\u001b[36m›\u001b[39m _a\u001b[7mb\u001b[27mc',
    )
  })

  it('erases with Backspace and Delete', async () => {
    const { lastFrame, stdin, onSubmit } = await renderQuestion()

    await press(stdin, 'a', 'b', 'c', 'd', keys.backspace, keys.left, keys.left, keys.delete, keys.enter)

    expect(plainFrameOf(lastFrame())).toBe('? Stories folder\n› ac')
    expect(onSubmit).toHaveBeenCalledWith('ac')
  })

  it('takes pasted text, without its newlines', async () => {
    const { stdin, onSubmit } = await renderQuestion()

    await press(stdin, '\u001b[200~my\nstories\u001b[201~', keys.enter)

    expect(onSubmit).toHaveBeenCalledWith('mystories')
  })

  it('answers with the text that arrives in one chunk with the Enter after it', async () => {
    const { stdin, onSubmit } = await renderQuestion()

    await press(stdin, 'ab\r')

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('ab')
  })

  it('takes a line break in a chunk of text that is not a bracketed paste as Enter', async () => {
    const { stdin, onSubmit } = await renderQuestion()

    await press(stdin, 'my\nstories')

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('my')
  })

  it('clears on Ctrl+U, so the default shows again', async () => {
    const { lastFrame, stdin } = await renderQuestion()

    await press(stdin, 'a', 'b', keys.ctrlU)

    expect(plainFrameOf(lastFrame())).toBe('? Stories folder\n› stories (default)')
  })

  it('clears on Esc, so the default shows again', async () => {
    const { lastFrame, stdin } = await renderQuestion()

    await press(stdin, 'a', 'b', keys.escape)

    expect(plainFrameOf(lastFrame())).toBe('? Stories folder\n› stories (default)')
  })

  it('copies the default in to edit on Tab', async () => {
    const { stdin, onSubmit } = await renderQuestion()

    await press(stdin, keys.tab, keys.backspace, keys.enter)

    expect(onSubmit).toHaveBeenCalledWith('storie')
  })

  it('submits the input trimmed on Enter', async () => {
    const { stdin, onSubmit } = await renderQuestion()

    await press(stdin, ' ', 'a', ' ', keys.enter)

    expect(onSubmit).toHaveBeenCalledWith('a')
  })

  it('submits the default on Enter when the input is empty', async () => {
    const { stdin, onSubmit } = await renderQuestion()

    await press(stdin, keys.enter)

    expect(onSubmit).toHaveBeenCalledWith('stories')
  })

  it('shows what is wrong with an answer in the danger colour and stays', async () => {
    const { lastFrame, stdin, onSubmit } = await renderQuestion({
      validate: (value) => (value.includes(' ') ? 'Use no spaces.' : undefined),
    })

    await press(stdin, 'a', ' ', 'b', keys.enter)

    expect(onSubmit).not.toHaveBeenCalled()
    expect(lastFrame()).toBe(
      '\u001b[36m?\u001b[39m \u001b[1mStories folder\u001b[22m\n' +
        '\u001b[36m›\u001b[39m a b\u001b[7m \u001b[27m\n' +
        '\u001b[31m✕ Use no spaces.\u001b[39m',
    )
  })

  it('validates the default when the input is empty', async () => {
    const validate = vi.fn<(value: string) => string | undefined>(() => undefined)
    const { stdin, onSubmit } = await renderQuestion({ validate })

    await press(stdin, keys.enter)

    expect(validate).toHaveBeenCalledWith('stories')
    expect(onSubmit).toHaveBeenCalledWith('stories')
  })

  it('drops what is wrong on the next edit', async () => {
    const { lastFrame, stdin } = await renderQuestion({
      validate: (value) => (value.includes(' ') ? 'Use no spaces.' : undefined),
    })

    await press(stdin, 'a', ' ', 'b', keys.enter)

    expect(lastFrame()).toBe(
      '\u001b[36m?\u001b[39m \u001b[1mStories folder\u001b[22m\n' +
        '\u001b[36m›\u001b[39m a b\u001b[7m \u001b[27m\n' +
        '\u001b[31m✕ Use no spaces.\u001b[39m',
    )

    await press(stdin, keys.backspace)

    expect(lastFrame()).toBe(
      '\u001b[36m?\u001b[39m \u001b[1mStories folder\u001b[22m\n\u001b[36m›\u001b[39m a \u001b[7m \u001b[27m',
    )
  })

  it('submits once the answer is fixed', async () => {
    const { stdin, onSubmit } = await renderQuestion({
      validate: (value) => (value.includes(' ') ? 'Use no spaces.' : undefined),
    })

    await press(stdin, 'a', ' ', 'b', keys.enter, keys.left, keys.backspace, keys.enter)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('ab')
  })

  it('submits what the keys before Enter typed when they all arrive in one chunk', async () => {
    const { stdin, onSubmit } = await renderQuestion()

    await press(stdin, 'abc\u007f\r')

    expect(onSubmit).toHaveBeenCalledWith('ab')
  })

  it('cancels on Ctrl+C', async () => {
    const { stdin, onCancel, onSubmit } = await renderQuestion()

    await press(stdin, 'a', keys.ctrlC)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('cancels on Ctrl+D', async () => {
    const { stdin, onCancel } = await renderQuestion()

    await press(stdin, keys.ctrlD)

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
