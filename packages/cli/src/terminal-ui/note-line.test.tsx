import { Box } from 'ink'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteLine } from './note-line.js'
import { cleanupSettled, plainFrameOf, renderSettled } from './terminal.fixture.js'
import { ThemeContext } from './theme.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(cleanupSettled)

describe('NoteLine', () => {
  it('draws a warning with a triangle in place of its prefix', async () => {
    const { lastFrame } = await renderSettled(<NoteLine text="Warning: git is missing." />)

    expect(plainFrameOf(lastFrame())).toBe('▲ git is missing.')
  })

  it('draws a warning in the caution colour', async () => {
    const { lastFrame } = await renderSettled(<NoteLine text="Warning: git is missing." />)

    expect(lastFrame()).toBe('\u001b[33m▲\u001b[39m \u001b[33mgit is missing.\u001b[39m')
  })

  it('draws a warning without colour when the theme has colour off', async () => {
    const { lastFrame } = await renderSettled(
      <ThemeContext value={{ colour: false }}>
        <NoteLine text="Warning: git is missing." />
      </ThemeContext>,
    )

    expect(lastFrame()).toBe('▲ git is missing.')
  })

  it('draws a hint dim, with a dot in place of its prefix', async () => {
    const { lastFrame } = await renderSettled(<NoteLine text="hint: run it again with --yes." />)

    expect(lastFrame()).toBe('\u001b[2m·\u001b[22m \u001b[2mrun it again with --yes.\u001b[22m')
  })

  it('draws any other note plain', async () => {
    const { lastFrame } = await renderSettled(<NoteLine text="Found 2 Storybooks." />)

    expect(lastFrame()).toBe('Found 2 Storybooks.')
  })

  it('takes the prefixes only at the start and with their case', async () => {
    const { lastFrame } = await renderSettled(<NoteLine text="warning: a hint: b" />)

    expect(lastFrame()).toBe('warning: a hint: b')
  })

  // Ink wraps without trimming, so a wrapped line keeps the space it broke at.
  it('wraps a long warning under its text, not under the glyph', async () => {
    const { lastFrame } = await renderSettled(
      <Box width={20}>
        <NoteLine text="Warning: the Storybook config folder is missing." />
      </Box>,
    )

    expect(plainFrameOf(lastFrame())).toBe('▲ the Storybook \n  config folder is \n  missing.')
  })

  it('wraps a long hint under its text, not under the glyph', async () => {
    const { lastFrame } = await renderSettled(
      <Box width={22}>
        <NoteLine text="hint: pass --yes to take every default." />
      </Box>,
    )

    expect(plainFrameOf(lastFrame())).toBe('· pass --yes to take \n  every default.')
  })
})
