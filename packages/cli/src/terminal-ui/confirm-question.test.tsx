import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmQuestion } from './confirm-question.js'
import { cleanupSettled, keys, plainFrameOf, press, renderSettled } from './terminal.fixture.js'
import { ThemeContext } from './theme.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(cleanupSettled)

/**
 * Renders a yes or no question with recording callbacks.
 */
async function renderQuestion(defaultValue: boolean, hint?: string) {
  const onSubmit = vi.fn<(value: boolean) => void>()
  const onCancel = vi.fn<() => void>()
  const instance = await renderSettled(
    <ConfirmQuestion
      defaultValue={defaultValue}
      hint={hint}
      message="Add the scripts?"
      onCancel={onCancel}
      onSubmit={onSubmit}
    />,
  )

  return { ...instance, onSubmit, onCancel }
}

describe('ConfirmQuestion', () => {
  it('draws the question, the hint and both sides', async () => {
    const { lastFrame } = await renderQuestion(true, 'They run visual-check.')

    expect(plainFrameOf(lastFrame())).toBe('? Add the scripts?\n  They run visual-check.\n› ● Yes  ○ No')
  })

  it('draws the chosen side bold in the accent colour and the other dim', async () => {
    const { lastFrame } = await renderQuestion(true)

    expect(lastFrame()).toBe(
      '\u001b[36m?\u001b[39m \u001b[1mAdd the scripts?\u001b[22m\n' +
        '\u001b[36m›\u001b[39m \u001b[1m\u001b[36m● Yes\u001b[39m\u001b[22m  \u001b[2m○ No\u001b[22m',
    )
  })

  it('starts on No when that is the default', async () => {
    const { lastFrame } = await renderQuestion(false)

    expect(lastFrame()).toBe(
      '\u001b[36m?\u001b[39m \u001b[1mAdd the scripts?\u001b[22m\n' +
        '\u001b[36m›\u001b[39m \u001b[2m○ Yes\u001b[22m  \u001b[1m\u001b[36m● No\u001b[39m\u001b[22m',
    )
  })

  it('draws no colour when the theme has colour off', async () => {
    const { lastFrame } = await renderSettled(
      <ThemeContext value={{ colour: false }}>
        <ConfirmQuestion defaultValue={true} message="Add the scripts?" onCancel={vi.fn()} onSubmit={vi.fn()} />
      </ThemeContext>,
    )

    expect(lastFrame()).toBe(
      '? \u001b[1mAdd the scripts?\u001b[22m\n› \u001b[1m● Yes\u001b[22m  \u001b[2m○ No\u001b[22m',
    )
  })

  it('marks the chosen side with a glyph, so the choice shows without styles', async () => {
    const { lastFrame, stdin } = await renderSettled(
      <ThemeContext value={{ colour: false }}>
        <ConfirmQuestion defaultValue={true} message="Add the scripts?" onCancel={vi.fn()} onSubmit={vi.fn()} />
      </ThemeContext>,
    )

    await press(stdin, keys.right)

    expect(plainFrameOf(lastFrame())).toBe('? Add the scripts?\n› ○ Yes  ● No')
  })

  it('submits the default on Enter', async () => {
    const { stdin, onSubmit } = await renderQuestion(true)

    await press(stdin, keys.enter)

    expect(onSubmit).toHaveBeenCalledWith(true)
  })

  it.each([
    ['→', keys.right],
    ['←', keys.left],
    ['l', 'l'],
    ['h', 'h'],
    ['Tab', keys.tab],
  ])('switches sides on %s', async (_name, key) => {
    const { lastFrame, stdin, onSubmit } = await renderQuestion(true)

    await press(stdin, key)

    expect(lastFrame()).toBe(
      '\u001b[36m?\u001b[39m \u001b[1mAdd the scripts?\u001b[22m\n' +
        '\u001b[36m›\u001b[39m \u001b[2m○ Yes\u001b[22m  \u001b[1m\u001b[36m● No\u001b[39m\u001b[22m',
    )

    await press(stdin, keys.enter)

    expect(onSubmit).toHaveBeenCalledWith(false)
  })

  it('submits the side a switch before Enter chose when both arrive in one chunk', async () => {
    const { stdin, onSubmit } = await renderQuestion(true)

    await press(stdin, keys.right + keys.enter)

    expect(onSubmit).toHaveBeenCalledWith(false)
  })

  it('switches back on a second press', async () => {
    const { stdin, onSubmit } = await renderQuestion(true)

    await press(stdin, keys.right, keys.left, keys.enter)

    expect(onSubmit).toHaveBeenCalledWith(true)
  })

  it.each([
    ['y', true],
    ['Y', true],
    ['n', false],
    ['N', false],
  ])('answers straight away on %s', async (key, answer) => {
    const { stdin, onSubmit } = await renderQuestion(!answer)

    await press(stdin, key)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(answer)
  })

  it('ignores other keys', async () => {
    const { lastFrame, stdin, onSubmit } = await renderQuestion(true)

    await press(stdin, 'x', keys.up)

    expect(plainFrameOf(lastFrame())).toBe('? Add the scripts?\n› ● Yes  ○ No')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('ignores letters typed with Ctrl, such as Ctrl+Y', async () => {
    const { lastFrame, stdin, onSubmit } = await renderQuestion(false)

    await press(stdin, keys.ctrlY)

    expect(plainFrameOf(lastFrame())).toBe('? Add the scripts?\n› ○ Yes  ● No')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('ignores letters typed with Meta, such as Meta+Y', async () => {
    const { lastFrame, stdin, onSubmit } = await renderQuestion(false)

    await press(stdin, keys.metaY)

    expect(plainFrameOf(lastFrame())).toBe('? Add the scripts?\n› ○ Yes  ● No')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('cancels on Ctrl+C', async () => {
    const { stdin, onCancel, onSubmit } = await renderQuestion(true)

    await press(stdin, keys.ctrlC)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('cancels on Ctrl+D', async () => {
    const { stdin, onCancel } = await renderQuestion(true)

    await press(stdin, keys.ctrlD)

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
