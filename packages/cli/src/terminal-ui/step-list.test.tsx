import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetupStep } from './init-view-state.js'
import { emptyOutputTail, type OutputTail } from './output-tail.js'
import { durationOf, elapsedOf, StepList } from './step-list.js'
import { advanceTimers, cleanupSettled, plainFrameOf, renderSettled, renderSettledAt } from './terminal.fixture.js'
import { ThemeContext } from './theme.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

beforeEach(() => {
  // Only the spinner's and the list's own timers are faked: React and Ink keep their real ones to draw.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})

afterEach(async () => {
  await cleanupSettled()
  vi.useRealTimers()
})

/**
 * When the plan of the steps in these tests was given.
 */
const plannedAt = 10_000

/**
 * The title of the step that installs visual-check's three packages.
 */
const installTitle = "Install visual-check's packages"

/**
 * A step titled `title`, pending unless `changes` says otherwise.
 */
function stepOf(id: number, title: string, changes: Partial<SetupStep> = {}): SetupStep {
  return { id, title, state: 'pending', output: emptyOutputTail, ...changes }
}

/**
 * A tail that holds the lines `1` to `count`.
 */
function numberedOutput(count: number): OutputTail {
  return { lines: Array.from({ length: count }, (_, index) => `${index + 1}`), unfinished: '' }
}

/**
 * Three steps: the first done in 0.4 s, the second running since 10.4 s with a command and four lines of output, the
 * third pending.
 */
const runningSteps: SetupStep[] = [
  stepOf(1, 'Write the files', { state: 'done', startedAt: 10_000, endedAt: 10_400 }),
  stepOf(2, 'Install', {
    state: 'running',
    command: 'pnpm add x',
    output: { lines: ['one', 'two', 'three'], unfinished: 'fo' },
    startedAt: 10_400,
  }),
  stepOf(3, 'Check'),
]

describe('durationOf', () => {
  it.each([
    [0, '0.0s'],
    [400, '0.4s'],
    [449, '0.4s'],
    [9999, '9.9s'],
    [10_000, '10s'],
    [12_900, '12s'],
    [59_999, '59s'],
    [60_000, '1m 00s'],
    [65_000, '1m 05s'],
    [3_725_000, '62m 05s'],
    [-50, '0.0s'],
  ])('words %i ms as %s', (milliseconds, words) => {
    expect(durationOf(milliseconds)).toBe(words)
  })
})

describe('elapsedOf', () => {
  it('counts up to now while a step runs', () => {
    expect(elapsedOf(runningSteps, plannedAt, 13_000)).toBe(3000)
  })

  it('counts up to the last time a step ended once none runs', () => {
    const steps = [
      stepOf(1, 'Write', { state: 'done', startedAt: 10_000, endedAt: 10_400 }),
      stepOf(2, 'Install', { state: 'failed', startedAt: 10_400, endedAt: 12_000 }),
      stepOf(3, 'Check'),
    ]

    expect(elapsedOf(steps, plannedAt, 20_000)).toBe(2000)
  })

  it('counts nothing before a step starts', () => {
    expect(elapsedOf([stepOf(1, 'Write')], plannedAt, 20_000)).toBe(0)
  })
})

describe('StepList', () => {
  it('draws a blank line, the bar with the time taken, then each step pending, dim after a circle', async () => {
    const { lastFrame } = await renderSettled(
      <StepList clock={() => plannedAt} startedAt={plannedAt} steps={[stepOf(1, 'Write'), stepOf(2, 'Install')]} />,
    )

    expect(lastFrame()).toBe(
      '\n\u001b[2m────────────────────\u001b[22m 0/2\u001b[2m · 0.0s\u001b[22m\n' +
        '\u001b[2m○\u001b[22m \u001b[2mWrite\u001b[22m\n\u001b[2m○\u001b[22m \u001b[2mInstall\u001b[22m',
    )
  })

  it('draws a running step with the spinner, its duration, its command and the last three lines of its output', async () => {
    const { lastFrame } = await renderSettled(
      <StepList clock={() => 13_000} startedAt={plannedAt} steps={runningSteps} />,
    )

    expect(plainFrameOf(lastFrame())).toBe(
      '\n━━━━━━━───────────── 1/3 · 3.0s\n' +
        '✓ Write the files 0.4s\n' +
        '⠋ Install 2.6s\n' +
        '  pnpm add x\n' +
        '  │ two\n  │ three\n  │ fo\n' +
        '○ Check',
    )
  })

  it("draws a running step's command and output dim, the spinner in the cyan plate", async () => {
    const { lastFrame } = await renderSettled(
      <StepList clock={() => 13_000} startedAt={plannedAt} steps={[runningSteps[1] as SetupStep]} />,
    )

    expect(lastFrame()).toBe(
      '\n\u001b[2m────────────────────\u001b[22m 0/1\u001b[2m · 3.0s\u001b[22m\n' +
        '\u001b[38;2;0;180;216m⠋\u001b[39m Install\u001b[2m 2.6s\u001b[22m\n' +
        '  \u001b[2mpnpm add x\u001b[22m\n' +
        '  \u001b[2m│ two\u001b[22m\n  \u001b[2m│ three\u001b[22m\n  \u001b[2m│ fo\u001b[22m',
    )
  })

  it("cuts a running step's command and output at the terminal's edge rather than wrap them", async () => {
    const step = stepOf(1, 'Install', {
      state: 'running',
      command: `pnpm add ${'x'.repeat(40)}`,
      output: { lines: ['y'.repeat(40)], unfinished: '' },
      startedAt: plannedAt,
    })
    const { lastFrame } = await renderSettledAt(
      <StepList clock={() => plannedAt} startedAt={plannedAt} steps={[step]} />,
      40,
    )

    expect(plainFrameOf(lastFrame())).toBe(
      `\n──────────────────── 0/1 · 0.0s\n⠋ Install 0.0s\n  pnpm add ${'x'.repeat(28)}…\n  │ ${'y'.repeat(35)}…`,
    )
  })

  it("puts a running step's duration right after its title at 80 columns, with its command and output under it", async () => {
    const steps = [
      stepOf(1, 'Write the files and scripts', { state: 'done', startedAt: 10_000, endedAt: 10_000 }),
      stepOf(2, installTitle, {
        state: 'running',
        command:
          'pnpm add --save-dev @visual-check/cli@0.0.0 @visual-check/chromium@^157.0.0 @visual-check/storybook@0.0.0',
        output: { lines: ['Progress: resolved 1, reused 0, downloaded 0, added 0'], unfinished: '' },
        startedAt: 10_000,
      }),
      stepOf(3, 'Check for unlisted dependencies'),
    ]
    const { lastFrame } = await renderSettledAt(
      <StepList clock={() => 13_000} startedAt={plannedAt} steps={steps} />,
      80,
    )

    expect(plainFrameOf(lastFrame())).toBe(`
━━━━━━━───────────── 1/3 · 3.0s
✓ Write the files and scripts 0.0s
⠋ Install visual-check's packages 3.0s
  pnpm add --save-dev @visual-check/cli@0.0.0 @visual-check/chromium@^157.0.0 @…
  │ Progress: resolved 1, reused 0, downloaded 0, added 0
○ Check for unlisted dependencies`)
  })

  it("puts an ended step's duration right after its title at 80 columns, and never splits it", async () => {
    const steps = [stepOf(1, installTitle, { state: 'done', startedAt: 10_000, endedAt: 75_000 })]
    const { lastFrame } = await renderSettledAt(
      <StepList clock={() => 75_000} startedAt={plannedAt} steps={steps} />,
      80,
    )

    expect(plainFrameOf(lastFrame())).toBe(`
━━━━━━━━━━━━━━━━━━━━ 1/1 · 1m 05s
✓ Install visual-check's packages 1m\u00a005s`)
  })

  it('wraps a long title under itself, not under its glyph, with its duration after its last word', async () => {
    const title = 'Add the Storybook addon to a Storybook whose name is long enough to wrap at eighty columns'
    const steps = [stepOf(1, title, { state: 'done', startedAt: 10_000, endedAt: 75_000 })]
    const { lastFrame } = await renderSettledAt(
      <StepList clock={() => 75_000} startedAt={plannedAt} steps={steps} />,
      80,
    )

    // Ink keeps the space it breaks a line at, at the end of the line.
    expect(plainFrameOf(lastFrame()).split('\n').slice(2)).toEqual([
      '✓ Add the Storybook addon to a Storybook whose name is long enough to wrap at ',
      '  eighty columns 1m\u00a005s',
    ])
  })

  it('draws each ended step with its glyph and colour, then how long it took, dim', async () => {
    const steps = [
      stepOf(1, 'Write', { state: 'done', startedAt: 10_000, endedAt: 10_400 }),
      stepOf(2, 'Add the addon', { state: 'warned', startedAt: 10_400, endedAt: 22_400 }),
      stepOf(3, 'Check', { state: 'failed', startedAt: 22_400, endedAt: 87_400 }),
    ]
    const { lastFrame } = await renderSettled(<StepList clock={() => 90_000} startedAt={plannedAt} steps={steps} />)

    expect(lastFrame()).toBe(
      '\n\u001b[36m━━━━━━━━━━━━━━━━━━━━\u001b[39m 3/3\u001b[2m · 1m 17s\u001b[22m\n' +
        '\u001b[36m✓\u001b[39m \u001b[36mWrite\u001b[39m\u001b[2m 0.4s\u001b[22m\n' +
        '\u001b[33m▲\u001b[39m \u001b[33mAdd the addon\u001b[39m\u001b[2m 12s\u001b[22m\n' +
        '\u001b[31m✕\u001b[39m \u001b[31mCheck\u001b[39m\u001b[2m 1m\u00a005s\u001b[22m',
    )
  })

  it('keeps the last fifteen lines of the output of a step that failed, and none of one that ended otherwise', async () => {
    const steps = [
      stepOf(1, 'Write', { state: 'done', output: numberedOutput(2), startedAt: 10_000, endedAt: 10_000 }),
      stepOf(2, 'Install', {
        state: 'failed',
        command: 'pnpm add x',
        output: { ...numberedOutput(15), unfinished: '16' },
        startedAt: 10_000,
        endedAt: 10_000,
      }),
    ]
    const { lastFrame } = await renderSettled(<StepList clock={() => plannedAt} startedAt={plannedAt} steps={steps} />)
    const outputLines = Array.from({ length: 15 }, (_, index) => `  │ ${index + 2}`)

    expect(plainFrameOf(lastFrame())).toBe(
      ['', '━━━━━━━━━━━━━━━━━━━━ 2/2 · 0.0s', '✓ Write 0.0s', '✕ Install 0.0s', ...outputLines].join('\n'),
    )
  })

  it('draws no colour when the theme has colour off', async () => {
    const { lastFrame } = await renderSettled(
      <ThemeContext value={{ colour: false }}>
        <StepList
          clock={() => plannedAt}
          startedAt={plannedAt}
          steps={[stepOf(1, 'Write', { state: 'done', startedAt: 10_000, endedAt: 10_400 })]}
        />
      </ThemeContext>,
    )

    expect(lastFrame()).toBe('\n━━━━━━━━━━━━━━━━━━━━ 1/1\u001b[2m · 0.4s\u001b[22m\n✓ Write\u001b[2m 0.4s\u001b[22m')
  })

  it('counts the durations up every second while a step runs', async () => {
    let now = 13_000
    const { lastFrame } = await renderSettled(<StepList clock={() => now} startedAt={plannedAt} steps={runningSteps} />)

    now = 14_999
    await advanceTimers(999)

    expect(plainFrameOf(lastFrame()).split('\n').slice(1, 4)).toEqual([
      '━━━━━━━───────────── 1/3 · 3.0s',
      '✓ Write the files 0.4s',
      '⠹ Install 2.6s',
    ])

    await advanceTimers(1)

    expect(plainFrameOf(lastFrame()).split('\n').slice(1, 4)).toEqual([
      '━━━━━━━───────────── 1/3 · 4.9s',
      '✓ Write the files 0.4s',
      '⠹ Install 4.5s',
    ])
  })

  it('stops counting once no step runs, and when it unmounts', async () => {
    const instance = await renderSettled(<StepList clock={() => 13_000} startedAt={plannedAt} steps={runningSteps} />)

    // The spinner's timer, and the list's.
    expect(vi.getTimerCount()).toBe(2)

    await act(async () => {
      instance.rerender(
        <StepList
          clock={() => 13_000}
          startedAt={plannedAt}
          steps={runningSteps.map((step) => ({ ...step, state: 'done', endedAt: 13_000 }))}
        />,
      )
    })

    expect(vi.getTimerCount()).toBe(0)

    await act(async () => {
      instance.rerender(<StepList clock={() => 13_000} startedAt={plannedAt} steps={runningSteps} />)
    })

    expect(vi.getTimerCount()).toBe(2)

    await cleanupSettled()

    expect(vi.getTimerCount()).toBe(0)
  })
})
