import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChecklistQuestion } from './checklist-question.js'
import { cleanupSettled, keys, plainFrameOf, press, renderSettled } from './terminal.fixture.js'
import { ThemeContext } from './theme.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(cleanupSettled)

/**
 * The choices the test question offers.
 */
const storybooks = [
  { value: 'web', label: 'web' },
  { value: 'docs', label: 'docs', hint: 'apps/docs' },
  { value: 'ui', label: 'ui' },
] as const

/**
 * Renders a checklist question with recording callbacks.
 */
async function renderQuestion(
  defaultValue: string[],
  options: { hint?: string; validate?: (values: string[]) => string | undefined } = {},
) {
  const onSubmit = vi.fn<(values: string[]) => void>()
  const onCancel = vi.fn<() => void>()
  const instance = await renderSettled(
    <ChecklistQuestion
      choices={storybooks}
      defaultValue={defaultValue}
      hint={options.hint}
      message="Storybooks"
      onCancel={onCancel}
      onSubmit={onSubmit}
      validate={options.validate}
    />,
  )

  return { ...instance, onSubmit, onCancel }
}

describe('ChecklistQuestion', () => {
  it('draws the question, the hint and the choices, with the defaults ticked and the first highlighted', async () => {
    const { lastFrame } = await renderQuestion(['docs', 'ui'], { hint: 'Pick some.' })

    expect(plainFrameOf(lastFrame())).toBe(
      "? Storybooks\n  Pick some.\n❯ ◯ web\n  ◉ docs · apps/docs\n  ◉ ui\n  <space> to tick, 'a' for all, <enter> to confirm",
    )
  })

  it('draws the highlighted choice in the accent colour and the hints dim', async () => {
    const { lastFrame } = await renderQuestion(['docs'])

    expect(lastFrame()).toBe(
      '\u001b[36m?\u001b[39m \u001b[1mStorybooks\u001b[22m\n' +
        '\u001b[36m❯ ◯ web\u001b[39m\n' +
        '  ◉ docs\u001b[2m · apps/docs\u001b[22m\n' +
        '  ◯ ui\n' +
        "\u001b[2m  <space> to tick, 'a' for all, <enter> to confirm\u001b[22m",
    )
  })

  it('draws no colour when the theme has colour off', async () => {
    const { lastFrame } = await renderSettled(
      <ThemeContext value={{ colour: false }}>
        <ChecklistQuestion
          choices={storybooks}
          defaultValue={['web']}
          message="Storybooks"
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
        />
      </ThemeContext>,
    )

    expect(lastFrame()).toBe(
      "? \u001b[1mStorybooks\u001b[22m\n❯ ◉ web\n  ◯ docs\u001b[2m · apps/docs\u001b[22m\n  ◯ ui\n\u001b[2m  <space> to tick, 'a' for all, <enter> to confirm\u001b[22m",
    )
  })

  it('submits the defaults, in the order of the choices, on Enter', async () => {
    const { stdin, onSubmit } = await renderQuestion(['ui', 'web'])

    await press(stdin, keys.enter)

    expect(onSubmit).toHaveBeenCalledWith(['web', 'ui'])
  })

  it('ignores default values that no choice has', async () => {
    const { stdin, onSubmit } = await renderQuestion(['gone', 'docs'])

    await press(stdin, keys.enter)

    expect(onSubmit).toHaveBeenCalledWith(['docs'])
  })

  it.each([
    ['↓', keys.down],
    ['j', 'j'],
  ])('moves the pointer down on %s', async (_name, key) => {
    const { lastFrame, stdin } = await renderQuestion([])

    await press(stdin, key)

    expect(plainFrameOf(lastFrame())).toBe(
      "? Storybooks\n  ◯ web\n❯ ◯ docs · apps/docs\n  ◯ ui\n  <space> to tick, 'a' for all, <enter> to confirm",
    )
  })

  it.each([
    ['↑', keys.up],
    ['k', 'k'],
  ])('moves the pointer up on %s, wrapping round from the first choice', async (_name, key) => {
    const { lastFrame, stdin } = await renderQuestion([])

    await press(stdin, key)

    expect(plainFrameOf(lastFrame())).toBe(
      "? Storybooks\n  ◯ web\n  ◯ docs · apps/docs\n❯ ◯ ui\n  <space> to tick, 'a' for all, <enter> to confirm",
    )
  })

  it('wraps round from the last choice to the first', async () => {
    const { lastFrame, stdin } = await renderQuestion([])

    await press(stdin, keys.down, keys.down, keys.down)

    expect(plainFrameOf(lastFrame())).toBe(
      "? Storybooks\n❯ ◯ web\n  ◯ docs · apps/docs\n  ◯ ui\n  <space> to tick, 'a' for all, <enter> to confirm",
    )
  })

  it('ticks and unticks the choice the pointer is on with Space', async () => {
    const { lastFrame, stdin, onSubmit } = await renderQuestion(['web'])

    await press(stdin, ' ', keys.down, ' ')

    expect(plainFrameOf(lastFrame())).toBe(
      "? Storybooks\n  ◯ web\n❯ ◉ docs · apps/docs\n  ◯ ui\n  <space> to tick, 'a' for all, <enter> to confirm",
    )

    await press(stdin, keys.enter)

    expect(onSubmit).toHaveBeenCalledWith(['docs'])
  })

  it('ticks all with a, and unticks all with a when all are ticked', async () => {
    const { lastFrame, stdin } = await renderQuestion(['web'])

    await press(stdin, 'a')

    expect(plainFrameOf(lastFrame())).toBe(
      "? Storybooks\n❯ ◉ web\n  ◉ docs · apps/docs\n  ◉ ui\n  <space> to tick, 'a' for all, <enter> to confirm",
    )

    await press(stdin, 'a')

    expect(plainFrameOf(lastFrame())).toBe(
      "? Storybooks\n❯ ◯ web\n  ◯ docs · apps/docs\n  ◯ ui\n  <space> to tick, 'a' for all, <enter> to confirm",
    )
  })

  it('submits no values when none are ticked and there is no validation', async () => {
    const { stdin, onSubmit } = await renderQuestion([])

    await press(stdin, keys.enter)

    expect(onSubmit).toHaveBeenCalledWith([])
  })

  it('submits the values ticked by keys that arrive in one chunk with Enter', async () => {
    const { stdin, onSubmit } = await renderQuestion([])

    await press(stdin, ` ${keys.down} ${keys.enter}`)

    expect(onSubmit).toHaveBeenCalledWith(['web', 'docs'])
  })

  it('shows the message validate gives and stays open', async () => {
    const validate = (values: string[]) => (values.length === 0 ? 'Pick at least one.' : undefined)
    const { lastFrame, stdin, onSubmit } = await renderQuestion([], { validate })

    await press(stdin, keys.enter)

    expect(plainFrameOf(lastFrame())).toBe(
      "? Storybooks\n❯ ◯ web\n  ◯ docs · apps/docs\n  ◯ ui\n  <space> to tick, 'a' for all, <enter> to confirm\n✕ Pick at least one.",
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('draws the validation message in the danger colour', async () => {
    const { lastFrame, stdin } = await renderQuestion([], { validate: () => 'Nope.' })

    await press(stdin, keys.enter)

    expect(lastFrame()?.endsWith('\u001b[31m✕ Nope.\u001b[39m')).toBe(true)
  })

  it('keeps the message while the pointer moves', async () => {
    const { lastFrame, stdin } = await renderQuestion([], { validate: () => 'Nope.' })

    await press(stdin, keys.enter, keys.down)

    expect(plainFrameOf(lastFrame())).toBe(
      "? Storybooks\n  ◯ web\n❯ ◯ docs · apps/docs\n  ◯ ui\n  <space> to tick, 'a' for all, <enter> to confirm\n✕ Nope.",
    )
  })

  it('clears the message on the next tick, and submits once validate is satisfied', async () => {
    const validate = (values: string[]) => (values.length === 0 ? 'Pick at least one.' : undefined)
    const { lastFrame, stdin, onSubmit } = await renderQuestion([], { validate })

    await press(stdin, keys.enter, ' ')

    expect(plainFrameOf(lastFrame())).toBe(
      "? Storybooks\n❯ ◉ web\n  ◯ docs · apps/docs\n  ◯ ui\n  <space> to tick, 'a' for all, <enter> to confirm",
    )

    await press(stdin, keys.enter)

    expect(onSubmit).toHaveBeenCalledWith(['web'])
  })

  it('hands validate the values in the order of the choices', async () => {
    const validate = vi.fn<(values: string[]) => string | undefined>()
    const { stdin } = await renderQuestion(['ui', 'web'], { validate })

    await press(stdin, keys.enter)

    expect(validate).toHaveBeenCalledWith(['web', 'ui'])
  })

  it('ticks all with A, in capitals, too', async () => {
    const { stdin, onSubmit } = await renderQuestion([])

    await press(stdin, 'A', keys.enter)

    expect(onSubmit).toHaveBeenCalledWith(['web', 'docs', 'ui'])
  })

  it('draws a dim legend of the keys under the choices', async () => {
    const { lastFrame } = await renderQuestion([])

    expect(lastFrame()?.split('\n').at(-1)).toBe(
      "\u001b[2m  <space> to tick, 'a' for all, <enter> to confirm\u001b[22m",
    )
  })

  it('ignores letters typed with Ctrl, such as Ctrl+K', async () => {
    const { lastFrame, stdin } = await renderQuestion([])

    await press(stdin, keys.ctrlK)

    expect(plainFrameOf(lastFrame())).toBe(
      "? Storybooks\n❯ ◯ web\n  ◯ docs · apps/docs\n  ◯ ui\n  <space> to tick, 'a' for all, <enter> to confirm",
    )
  })

  it('ignores letters typed with Meta, such as Meta+J', async () => {
    const { lastFrame, stdin } = await renderQuestion([])

    await press(stdin, keys.metaJ)

    expect(plainFrameOf(lastFrame())).toBe(
      "? Storybooks\n❯ ◯ web\n  ◯ docs · apps/docs\n  ◯ ui\n  <space> to tick, 'a' for all, <enter> to confirm",
    )
  })

  it('cancels on Ctrl+C', async () => {
    const { stdin, onCancel, onSubmit } = await renderQuestion([])

    await press(stdin, keys.ctrlC)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('cancels on Ctrl+D', async () => {
    const { stdin, onCancel } = await renderQuestion([])

    await press(stdin, keys.ctrlD)

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
