import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextSteps, WrittenList } from '../init/closing-message.js'
import type { InitResult } from '../init/run-init.js'
import { Summary } from './summary.js'
import { cleanupSettled, plainFrameOf, renderSettled, renderSettledAt } from './terminal.fixture.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(cleanupSettled)

/**
 * What `init` writes in a pnpm project that holds none of it yet, and a script it replaces, worded.
 */
const written: WrittenList = {
  files: ['visual-check.config.ts', '.storybook/visual-check.ts', '.visual-check/.gitignore'],
  scripts: [
    'Added the scripts visual:check and visual:update to package.json.',
    'Replaced the script vc in package.json. It ran: vitest',
  ],
}

/**
 * What the pnpm project is told to do next.
 */
const nextSteps: NextSteps = {
  steps: [
    ['Start Storybook with ', { code: 'pnpm run storybook' }, '.'],
    ['Run ', { code: 'pnpm run visual:update' }, ' to write baselines. The first run downloads the browser image.'],
    [
      'Run ',
      { code: 'pnpm run visual:check' },
      '. It should pass. If a story fails, see ',
      { code: 'https://visual-check.vercel.app/docs/broken-stories' },
      '.',
    ],
    ['Commit ', { code: 'visual-check.config.ts' }, ' and ', { code: '.visual-check/' }, '.'],
  ],
  previews: [
    {
      file: '.storybook/preview.ts',
      lines: ["import { visualCheck } from './visual-check'", 'parameters: { ...visualCheck({}) },'],
    },
    {
      file: 'docs/.storybook/preview.tsx',
      lines: ["import { visualCheck } from './visual-check'", 'parameters: { ...visualCheck({}) },'],
    },
  ],
  ciUrl: 'https://visual-check.vercel.app/docs/ci',
}

/**
 * A result that exits with `exitCode` and has `messages`, which its stderr holds.
 */
function resultWith(exitCode: number, messages: readonly string[]): InitResult {
  return { exitCode, stdout: '', stderr: messages.map((message) => `${message}\n`).join(''), messages }
}

/**
 * The problem a failed install ends with.
 */
const installProblem = 'pnpm add x failed with exit code 1. Run it yourself, then run visual-check init again.'

describe('Summary', () => {
  it('sums up a run that got to the end: what it wrote, the warnings, the next steps, the snippets and CI', async () => {
    const { lastFrame } = await renderSettledAt(
      <Summary
        result={{
          ...resultWith(0, ["Warning: Docker isn't running.", 'hint: Add -p 6006.']),
          stdout: 'ignored\n',
          summary: { written, nextSteps },
        }}
      />,
      160,
    )

    expect(plainFrameOf(lastFrame())).toBe(`
✓ visual-check is set up
  ✓ visual-check.config.ts
  ✓ .storybook/visual-check.ts
  ✓ .visual-check/.gitignore
  ✓ Added the scripts visual:check and visual:update to package.json.
  ✓ Replaced the script vc in package.json. It ran: vitest
▲ Docker isn't running.
· Add -p 6006.

Next
  1  Start Storybook with pnpm run storybook.
  2  Run pnpm run visual:update to write baselines. The first run downloads the browser image.
  3  Run pnpm run visual:check. It should pass. If a story fails, see https://visual-check.vercel.app/docs/broken-stories.
  4  Commit visual-check.config.ts and .visual-check/.

To set options for every story, spread visualCheck into the parameters in .storybook/preview.ts:
╭──────────────────────────────────────────────╮
│ import { visualCheck } from './visual-check' │
│ parameters: { ...visualCheck({}) },          │
╰──────────────────────────────────────────────╯

To set options for every story, spread visualCheck into the parameters in docs/.storybook/preview.tsx:
╭──────────────────────────────────────────────╮
│ import { visualCheck } from './visual-check' │
│ parameters: { ...visualCheck({}) },          │
╰──────────────────────────────────────────────╯

CI  https://visual-check.vercel.app/docs/ci`)
  })

  it('keeps its layout at 80 columns: a long step wraps under its own text', async () => {
    const { lastFrame } = await renderSettledAt(
      <Summary
        result={{
          ...resultWith(0, ["Warning: Docker isn't running."]),
          summary: { written, nextSteps: { ...nextSteps, previews: nextSteps.previews.slice(0, 1) } },
        }}
      />,
      80,
    )

    expect(plainFrameOf(lastFrame())).toBe(`
✓ visual-check is set up
  ✓ visual-check.config.ts
  ✓ .storybook/visual-check.ts
  ✓ .visual-check/.gitignore
  ✓ Added the scripts visual:check and visual:update to package.json.
  ✓ Replaced the script vc in package.json. It ran: vitest
▲ Docker isn't running.

Next
  1  Start Storybook with pnpm run storybook.
  2  Run pnpm run visual:update to write baselines. The first run downloads the
     browser image.
  3  Run pnpm run visual:check. It should pass. If a story fails, see
     https://visual-check.vercel.app/docs/broken-stories.
  4  Commit visual-check.config.ts and .visual-check/.

To set options for every story, spread visualCheck into the parameters in
.storybook/preview.ts:
╭──────────────────────────────────────────────╮
│ import { visualCheck } from './visual-check' │
│ parameters: { ...visualCheck({}) },          │
╰──────────────────────────────────────────────╯

CI  https://visual-check.vercel.app/docs/ci`)
  })

  it('draws the heading in bold accent, the checks, commands, paths and URLs in accent, and the boxes dim', async () => {
    const { lastFrame } = await renderSettledAt(
      <Summary
        result={{
          ...resultWith(0, []),
          summary: {
            written: { files: ['visual-check.config.ts'], scripts: [] },
            nextSteps: {
              steps: [nextSteps.steps[0] ?? []],
              previews: nextSteps.previews.slice(0, 1),
              ciUrl: nextSteps.ciUrl,
            },
          },
        }}
      />,
      160,
    )

    expect(lastFrame()).toBe(
      '\n\u001b[1m\u001b[36m✓ visual-check is set up\u001b[39m\u001b[22m\n' +
        '  \u001b[36m✓\u001b[39m visual-check.config.ts\n' +
        '\n\u001b[1mNext\u001b[22m\n' +
        '  1  Start Storybook with \u001b[36mpnpm run storybook\u001b[39m.\n' +
        '\nTo set options for every story, spread visualCheck into the parameters in \u001b[36m.storybook/preview.ts\u001b[39m:\n' +
        '\u001b[2m╭──────────────────────────────────────────────╮\u001b[22m\n' +
        "\u001b[2m│\u001b[22m import { visualCheck } from './visual-check' \u001b[2m│\u001b[22m\n" +
        '\u001b[2m│\u001b[22m parameters: { ...visualCheck({}) },          \u001b[2m│\u001b[22m\n' +
        '\u001b[2m╰──────────────────────────────────────────────╯\u001b[22m\n' +
        '\nCI  \u001b[36mhttps://visual-check.vercel.app/docs/ci\u001b[39m',
    )
  })

  it('wraps a long step under its own text, not under its number', async () => {
    const { lastFrame } = await renderSettledAt(
      <Summary
        result={{
          ...resultWith(0, []),
          summary: {
            written: { files: [], scripts: [] },
            nextSteps: { steps: [nextSteps.steps[1] ?? []], previews: [], ciUrl: nextSteps.ciUrl },
          },
        }}
      />,
      50,
    )

    expect(plainFrameOf(lastFrame())).toBe(`
✓ visual-check is set up

Next
  1  Run pnpm run visual:update to write
     baselines. The first run downloads the
     browser image.

CI  https://visual-check.vercel.app/docs/ci`)
  })

  it('shows a warning that spans lines under its triangle, its later lines included', async () => {
    const { lastFrame } = await renderSettled(
      <Summary
        result={{
          ...resultWith(0, [
            "Warning: Fallow couldn't check this project's imports: Fallow broke.\nIt could not read tsconfig.json.",
          ]),
          summary: {
            written: { files: [], scripts: [] },
            nextSteps: { steps: [], previews: [], ciUrl: nextSteps.ciUrl },
          },
        }}
      />,
    )

    expect(plainFrameOf(lastFrame())).toBe(`
✓ visual-check is set up
▲ Fallow couldn't check this project's imports: Fallow broke.
  It could not read tsconfig.json.

Next

CI  https://visual-check.vercel.app/docs/ci`)
  })

  it('sums up a run whose install failed: what it wrote, then the warnings and the problem', async () => {
    const { lastFrame } = await renderSettled(
      <Summary
        result={{
          ...resultWith(2, ['Warning: Port 7000 is not 6006.', installProblem]),
          summary: { written: { files: ['../visual-check.config.ts'], scripts: [] } },
        }}
      />,
    )

    expect(lastFrame()).toBe(
      '\n  \u001b[36m✓\u001b[39m ../visual-check.config.ts\n' +
        '\u001b[33m▲\u001b[39m \u001b[33mPort 7000 is not 6006.\u001b[39m\n' +
        `\u001b[31m✕\u001b[39m \u001b[31m${installProblem}\u001b[39m`,
    )
  })

  it('shows a run that stopped before it wrote: its warnings and hints as notes, and why it stopped', async () => {
    const { lastFrame } = await renderSettled(
      <Summary
        result={resultWith(2, [
          'Warning: Docker is missing.',
          'hint: Add -p 6006.',
          'visual-check init stopped.\n  It wrote nothing.',
        ])}
      />,
    )

    expect(plainFrameOf(lastFrame())).toBe(
      '▲ Docker is missing.\n· Add -p 6006.\n✕ visual-check init stopped.\n    It wrote nothing.',
    )
  })

  it('draws nothing for a run that stopped with nothing to say', async () => {
    const { lastFrame } = await renderSettled(<Summary result={resultWith(2, [])} />)

    expect(lastFrame()).toBe('')
  })
})
