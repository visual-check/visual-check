import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChoiceLine } from './choice-line.js'
import { cleanupSettled, plainFrameOf, renderSettled } from './terminal.fixture.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(cleanupSettled)

describe('ChoiceLine', () => {
  it('draws the highlighted choice with ❯, in the accent colour', async () => {
    const { lastFrame } = await renderSettled(<ChoiceLine highlighted label="npm" />)

    expect(lastFrame()).toBe('\u001b[36m❯ npm\u001b[39m')
  })

  it('indents a choice that is not highlighted', async () => {
    const { lastFrame } = await renderSettled(<ChoiceLine highlighted={false} label="npm" />)

    expect(lastFrame()).toBe('  npm')
  })

  it('draws the mark before the label and the hint dim after it', async () => {
    const { lastFrame } = await renderSettled(<ChoiceLine highlighted={false} hint="lockfile" label="npm" mark="◉" />)

    expect(plainFrameOf(lastFrame())).toBe('  ◉ npm · lockfile')
    expect(lastFrame()).toContain('\u001b[2m · lockfile\u001b[22m')
  })
})
