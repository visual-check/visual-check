import { afterEach, describe, expect, it, vi } from 'vitest'
import { ColouredText } from './coloured-text.js'
import { cleanupSettled, renderSettled } from './terminal.fixture.js'
import { ThemeContext } from './theme.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(cleanupSettled)

describe('ColouredText', () => {
  it('draws a semantic colour as its ANSI name', async () => {
    const { lastFrame } = await renderSettled(<ColouredText colour="accent">selected</ColouredText>)

    expect(lastFrame()).toBe('\u001b[36mselected\u001b[39m')
  })

  it('draws a brand plate as its hex colour', async () => {
    const { lastFrame } = await renderSettled(<ColouredText colour="brandMagenta">✓</ColouredText>)

    expect(lastFrame()).toBe('\u001b[38;2;255;45;135m✓\u001b[39m')
  })

  it('keeps bold with the colour', async () => {
    const { lastFrame } = await renderSettled(
      <ColouredText bold colour="danger">
        wrong
      </ColouredText>,
    )

    expect(lastFrame()).toBe('\u001b[1m\u001b[31mwrong\u001b[39m\u001b[22m')
  })

  it('draws no colour but keeps bold when the theme has colour off', async () => {
    const { lastFrame } = await renderSettled(
      <ThemeContext value={{ colour: false }}>
        <ColouredText bold colour="danger">
          wrong
        </ColouredText>
      </ThemeContext>,
    )

    expect(lastFrame()).toBe('\u001b[1mwrong\u001b[22m')
  })
})
