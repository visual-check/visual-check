import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageLine, NoteLine } from './message-line.js'
import { cleanupSettled, plainFrameOf, renderSettled, renderSettledAt } from './terminal.fixture.js'
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

  it('draws a hint of segments dim, with the folder it names in the accent colour, not dim', async () => {
    const { lastFrame } = await renderSettled(
      <NoteLine text={['hint: init sets up the workspace in ', { code: 'acme' }, ' ', { aside: '(../..)' }, '.']} />,
    )

    expect(plainFrameOf(lastFrame())).toBe('· init sets up the workspace in acme (../..).')
    expect(lastFrame()).toBe(
      '\u001b[2m·\u001b[22m \u001b[2minit sets up the workspace in \u001b[22m\u001b[36macme\u001b[39m' +
        '\u001b[2m (../..).\u001b[22m',
    )
  })

  it('draws a hint of segments without colour when the theme has colour off, the folder not dim', async () => {
    const { lastFrame } = await renderSettled(
      <ThemeContext value={{ colour: false }}>
        <NoteLine text={['hint: from ', { code: 'acme' }, '.']} />
      </ThemeContext>,
    )

    expect(lastFrame()).toBe('\u001b[2m·\u001b[22m \u001b[2mfrom \u001b[22macme\u001b[2m.\u001b[22m')
  })

  it('draws any other note plain', async () => {
    const { lastFrame } = await renderSettled(<NoteLine text="Found 2 Storybooks." />)

    expect(lastFrame()).toBe('Found 2 Storybooks.')
  })

  it('takes the prefixes only at the start and with their case', async () => {
    const { lastFrame } = await renderSettled(<NoteLine text="warning: a hint: b" />)

    expect(lastFrame()).toBe('warning: a hint: b')
  })

  it('wraps a long warning to a narrow terminal under its text, without spaces at the breaks', async () => {
    const { lastFrame } = await renderSettledAt(
      <NoteLine text="Warning: the Storybook config folder is missing, so init skips it." />,
      40,
    )

    expect(plainFrameOf(lastFrame())).toBe('▲ the Storybook config folder is\n  missing, so init skips it.')
  })

  it('wraps a long hint to a narrow terminal under its text, not under the glyph', async () => {
    const { lastFrame } = await renderSettledAt(
      <NoteLine text="hint: pass --yes to take every default, and init asks nothing." />,
      40,
    )

    expect(plainFrameOf(lastFrame())).toBe('· pass --yes to take every default, and\n  init asks nothing.')
  })

  it('wraps a long plain note to a narrow terminal, without spaces at the breaks', async () => {
    const { lastFrame } = await renderSettledAt(
      <NoteLine text="Found 2 Storybooks, in .storybook and in docs/.storybook." />,
      40,
    )

    expect(plainFrameOf(lastFrame())).toBe('Found 2 Storybooks, in .storybook and in\ndocs/.storybook.')
  })
})

describe('MessageLine', () => {
  it('draws a warning or a hint as a note', async () => {
    const { lastFrame } = await renderSettled(
      <>
        <MessageLine text="Warning: git is missing." />
        <MessageLine text="hint: run it again with --yes." />
      </>,
    )

    expect(plainFrameOf(lastFrame())).toBe('▲ git is missing.\n· run it again with --yes.')
  })

  it('draws any other message as a problem, after a cross, all in the danger colour', async () => {
    const { lastFrame } = await renderSettled(<MessageLine text="visual-check init stopped." />)

    expect(lastFrame()).toBe('\u001b[31m✕\u001b[39m \u001b[31mvisual-check init stopped.\u001b[39m')
  })

  it('draws a problem of segments with what it names in the accent colour', async () => {
    const { lastFrame } = await renderSettled(<MessageLine text={['Stopped in ', { code: 'acme' }, '.']} />)

    expect(lastFrame()).toBe('\u001b[31m✕\u001b[39m \u001b[31mStopped in \u001b[36macme\u001b[31m.\u001b[39m')
  })

  it('draws a problem without colour when the theme has colour off', async () => {
    const { lastFrame } = await renderSettled(
      <ThemeContext value={{ colour: false }}>
        <MessageLine text="visual-check init stopped." />
      </ThemeContext>,
    )

    expect(lastFrame()).toBe('✕ visual-check init stopped.')
  })

  it('wraps a long problem to a narrow terminal under its text, and keeps its later lines there too', async () => {
    const { lastFrame } = await renderSettledAt(
      <MessageLine text={'pnpm add failed with exit code 1. Run it yourself.\n  ERR_PNPM_FETCH_404'} />,
      40,
    )

    expect(plainFrameOf(lastFrame())).toBe(
      '✕ pnpm add failed with exit code 1. Run\n  it yourself.\n    ERR_PNPM_FETCH_404',
    )
  })

  it('keeps the later lines of a warning that spans lines under its text', async () => {
    const { lastFrame } = await renderSettled(
      <MessageLine text={"Warning: Fallow couldn't check the imports.\nIt could not read tsconfig.json."} />,
    )

    expect(plainFrameOf(lastFrame())).toBe("▲ Fallow couldn't check the imports.\n  It could not read tsconfig.json.")
  })
})
