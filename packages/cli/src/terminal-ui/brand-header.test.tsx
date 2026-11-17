import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrandHeader } from './brand-header.js'
import { cleanupSettled, plainFrameOf, renderSettled } from './terminal.fixture.js'
import { ThemeContext } from './theme.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(cleanupSettled)

describe('BrandHeader', () => {
  it('draws the mark, the name, the command and the version', async () => {
    const { lastFrame } = await renderSettled(<BrandHeader command="init" version="0.0.0" />)

    expect(plainFrameOf(lastFrame())).toBe('✓✓ visual-check init · v0.0.0')
  })

  it('draws the mark in the cyan then the magenta plate, the name bold and the rest dim', async () => {
    const { lastFrame } = await renderSettled(<BrandHeader command="test" version="1.2.3" />)

    expect(lastFrame()).toBe(
      '\u001b[38;2;0;180;216m✓\u001b[38;2;255;45;135m✓\u001b[39m \u001b[1mvisual-check\u001b[22m' +
        '\u001b[2m test · v1.2.3\u001b[22m',
    )
  })

  it('draws the mark without colour when the theme has colour off', async () => {
    const { lastFrame } = await renderSettled(
      <ThemeContext value={{ colour: false }}>
        <BrandHeader command="init" version="0.0.0" />
      </ThemeContext>,
    )

    expect(lastFrame()).toBe('✓✓ \u001b[1mvisual-check\u001b[22m\u001b[2m init · v0.0.0\u001b[22m')
  })
})
