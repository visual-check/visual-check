import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectQuestion } from './select-question.js'
import { cleanupSettled, keys, plainFrameOf, press, renderSettled } from './terminal.fixture.js'
import { ThemeContext } from './theme.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(cleanupSettled)

/**
 * A package manager the test question offers.
 */
type Manager = 'npm' | 'pnpm' | 'yarn'

/**
 * The choices the test question offers.
 */
const managers = [
  { value: 'npm', label: 'npm' },
  { value: 'pnpm', label: 'pnpm', hint: 'pnpm-lock.yaml' },
  { value: 'yarn', label: 'Yarn' },
] as const

/**
 * Renders a select question with recording callbacks.
 */
async function renderQuestion(defaultValue: Manager, hint?: string) {
  const onSubmit = vi.fn<(value: Manager) => void>()
  const onCancel = vi.fn<() => void>()
  const instance = await renderSettled(
    <SelectQuestion
      choices={managers}
      defaultValue={defaultValue}
      hint={hint}
      message="Package manager"
      onCancel={onCancel}
      onSubmit={onSubmit}
    />,
  )

  return { ...instance, onSubmit, onCancel }
}

describe('SelectQuestion', () => {
  it('draws the question, the hint and the choices, with the default highlighted', async () => {
    const { lastFrame } = await renderQuestion('pnpm', 'It installs visual-check.')

    expect(plainFrameOf(lastFrame())).toBe(
      '? Package manager\n  It installs visual-check.\n  npm\n❯ pnpm · pnpm-lock.yaml\n  Yarn',
    )
  })

  it('draws the highlighted choice in the accent colour and the hints dim', async () => {
    const { lastFrame } = await renderQuestion('pnpm')

    expect(lastFrame()).toBe(
      '\u001b[36m?\u001b[39m \u001b[1mPackage manager\u001b[22m\n' +
        '  npm\n' +
        '\u001b[36m❯ pnpm\u001b[39m\u001b[2m · pnpm-lock.yaml\u001b[22m\n' +
        '  Yarn',
    )
  })

  it('draws no colour when the theme has colour off', async () => {
    const { lastFrame } = await renderSettled(
      <ThemeContext value={{ colour: false }}>
        <SelectQuestion
          choices={managers}
          defaultValue="npm"
          message="Package manager"
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
        />
      </ThemeContext>,
    )

    expect(lastFrame()).toBe(
      '? \u001b[1mPackage manager\u001b[22m\n❯ npm\n  pnpm\u001b[2m · pnpm-lock.yaml\u001b[22m\n  Yarn',
    )
  })

  it('starts on the first choice when the default is not one of them', async () => {
    const { lastFrame } = await renderQuestion('bun' as Manager)

    expect(plainFrameOf(lastFrame())).toBe('? Package manager\n❯ npm\n  pnpm · pnpm-lock.yaml\n  Yarn')
  })

  it('submits the default on Enter', async () => {
    const { stdin, onSubmit } = await renderQuestion('pnpm')

    await press(stdin, keys.enter)

    expect(onSubmit).toHaveBeenCalledWith('pnpm')
  })

  it.each([
    ['↓', keys.down],
    ['j', 'j'],
  ])('moves down on %s', async (_name, key) => {
    const { lastFrame, stdin, onSubmit } = await renderQuestion('npm')

    await press(stdin, key)

    expect(plainFrameOf(lastFrame())).toBe('? Package manager\n  npm\n❯ pnpm · pnpm-lock.yaml\n  Yarn')

    await press(stdin, keys.enter)

    expect(onSubmit).toHaveBeenCalledWith('pnpm')
  })

  it.each([
    ['↑', keys.up],
    ['k', 'k'],
  ])('moves up on %s', async (_name, key) => {
    const { stdin, onSubmit } = await renderQuestion('yarn')

    await press(stdin, key, keys.enter)

    expect(onSubmit).toHaveBeenCalledWith('pnpm')
  })

  it('wraps round from the last choice to the first', async () => {
    const { stdin, onSubmit } = await renderQuestion('yarn')

    await press(stdin, keys.down, keys.enter)

    expect(onSubmit).toHaveBeenCalledWith('npm')
  })

  it('wraps round from the first choice to the last', async () => {
    const { stdin, onSubmit } = await renderQuestion('npm')

    await press(stdin, keys.up, keys.enter)

    expect(onSubmit).toHaveBeenCalledWith('yarn')
  })

  it('submits the choice a move before Enter highlighted when both arrive in one chunk', async () => {
    const { stdin, onSubmit } = await renderQuestion('npm')

    await press(stdin, keys.down + keys.enter)

    expect(onSubmit).toHaveBeenCalledWith('pnpm')
  })

  it('ignores letters typed with Ctrl, such as Ctrl+K', async () => {
    const { lastFrame, stdin, onSubmit } = await renderQuestion('pnpm')

    await press(stdin, keys.ctrlK, keys.enter)

    expect(plainFrameOf(lastFrame())).toBe('? Package manager\n  npm\n❯ pnpm · pnpm-lock.yaml\n  Yarn')
    expect(onSubmit).toHaveBeenCalledWith('pnpm')
  })

  it('ignores letters typed with Meta, such as Meta+J', async () => {
    const { lastFrame, stdin, onSubmit } = await renderQuestion('pnpm')

    await press(stdin, keys.metaJ, keys.enter)

    expect(plainFrameOf(lastFrame())).toBe('? Package manager\n  npm\n❯ pnpm · pnpm-lock.yaml\n  Yarn')
    expect(onSubmit).toHaveBeenCalledWith('pnpm')
  })

  it('cancels on Ctrl+C', async () => {
    const { stdin, onCancel, onSubmit } = await renderQuestion('npm')

    await press(stdin, keys.ctrlC)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('cancels on Ctrl+D', async () => {
    const { stdin, onCancel } = await renderQuestion('npm')

    await press(stdin, keys.ctrlD)

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
