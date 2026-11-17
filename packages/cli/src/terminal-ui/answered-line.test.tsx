import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnsweredLine } from './answered-line.js'
import { cleanupSettled, plainFrameOf, renderSettled } from './terminal.fixture.js'
import { ThemeContext } from './theme.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(cleanupSettled)

describe('AnsweredLine', () => {
  it('draws a check, the question and the answer', async () => {
    const { lastFrame } = await renderSettled(<AnsweredLine message="Package manager" answer="pnpm" />)

    expect(plainFrameOf(lastFrame())).toBe('✓ Package manager pnpm')
  })

  it('draws the check and the answer in the accent colour and the question dim', async () => {
    const { lastFrame } = await renderSettled(<AnsweredLine message="Package manager" answer="pnpm" />)

    expect(lastFrame()).toBe('\u001b[36m✓\u001b[39m \u001b[2mPackage manager\u001b[22m \u001b[36mpnpm\u001b[39m')
  })

  it('draws no colour when the theme has colour off', async () => {
    const { lastFrame } = await renderSettled(
      <ThemeContext value={{ colour: false }}>
        <AnsweredLine message="Package manager" answer="pnpm" />
      </ThemeContext>,
    )

    expect(lastFrame()).toBe('✓ \u001b[2mPackage manager\u001b[22m pnpm')
  })
})
