import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuestionHeader } from './question-header.js'
import { cleanupSettled, plainFrameOf, renderSettled, renderSettledAt } from './terminal.fixture.js'
import { ThemeContext } from './theme.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(cleanupSettled)

describe('QuestionHeader', () => {
  it('draws the question mark in the accent colour and the question bold', async () => {
    const { lastFrame } = await renderSettled(<QuestionHeader message="Package manager" />)

    expect(lastFrame()).toBe('\u001b[36m?\u001b[39m \u001b[1mPackage manager\u001b[22m')
  })

  it('draws the hint dim under the question, indented to match it', async () => {
    const { lastFrame } = await renderSettled(
      <QuestionHeader hint="It installs visual-check." message="Package manager" />,
    )

    expect(lastFrame()).toBe(
      '\u001b[36m?\u001b[39m \u001b[1mPackage manager\u001b[22m\n  \u001b[2mIt installs visual-check.\u001b[22m',
    )
  })

  it('wraps a long hint to a narrow terminal, each line indented, without a leading space', async () => {
    const { lastFrame } = await renderSettledAt(
      <QuestionHeader hint="Where visual-check opens this Storybook, locally and in CI." message="URL of web" />,
      40,
    )

    expect(plainFrameOf(lastFrame())).toBe(
      '? URL of web\n  Where visual-check opens this\n  Storybook, locally and in CI.',
    )
  })

  it('draws no colour when the theme has colour off', async () => {
    const { lastFrame } = await renderSettled(
      <ThemeContext value={{ colour: false }}>
        <QuestionHeader message="Package manager" />
      </ThemeContext>,
    )

    expect(lastFrame()).toBe('? \u001b[1mPackage manager\u001b[22m')
  })
})
