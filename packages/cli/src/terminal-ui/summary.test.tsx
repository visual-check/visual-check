import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextSteps } from '../init/closing-message.js'
import type { InitResult } from '../init/run-init.js'
import { Summary } from './summary.js'
import { cleanupSettled, plainFrameOf, renderSettled, renderSettledAt } from './terminal.fixture.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(cleanupSettled)

/**
 * The line that names the two scripts `init` replaced.
 */
const replacedLine = 'Replaced the scripts visual:check and visual:update in package.json.'

/**
 * What the pnpm project, which has no baselines yet, is told to do next.
 */
const nextSteps: NextSteps = {
  steps: [
    [{ command: 'pnpm storybook', text: ['Start Storybook, and keep it running'] }],
    [{ command: 'pnpm visual:update', text: ['Write the first baselines'] }],
    [{ command: 'pnpm visual:check', text: ['Check the stories against the baselines'] }],
    [{ text: ['Commit the changes, baselines included'] }],
  ],
  runFrom: undefined,
  modesFiles: ['.storybook/visual-check.ts'],
  ciUrl: 'https://visual-check.vercel.app/docs/ci',
}

/**
 * The warning Fallow's check gives for a package the project imports and doesn't list.
 */
const fallowWarning =
  "Warning: package.json doesn't list tailwindcss, imported in src/app/(landings)/bingo/landing-page.globals.css. " +
  "visual-check can't tell which stories it affects."

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
  it('sums up a run that got to the end: the scripts it replaced, the warnings, the next steps, then where to go on', async () => {
    const { lastFrame } = await renderSettledAt(
      <Summary
        result={{ ...resultWith(0, [fallowWarning]), stdout: 'ignored\n', summary: { replacedLine, nextSteps } }}
      />,
      160,
    )

    expect(plainFrameOf(lastFrame())).toBe(`
✓ visual-check is set up
  Replaced the scripts visual:check and visual:update in package.json.
▲ package.json doesn't list tailwindcss, imported in src/app/(landings)/bingo/landing-page.globals.css. visual-check can't tell which stories it affects.

Next
  1  pnpm storybook       Start Storybook, and keep it running
  2  pnpm visual:update   Write the first baselines
  3  pnpm visual:check    Check the stories against the baselines
  4  Commit the changes, baselines included

To set options for every story, see .storybook/visual-check.ts.
To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.`)
  })

  it("names the workspace root's folder to run the steps from, in accent, when init runs in a package", async () => {
    const { lastFrame } = await renderSettledAt(
      <Summary
        result={{
          ...resultWith(0, []),
          summary: {
            nextSteps: { ...nextSteps, steps: nextSteps.steps.slice(0, 1), runFrom: [{ code: 'acme-monorepo' }] },
          },
        }}
      />,
      160,
    )

    expect(lastFrame()).toContain('\u001b[1mNext, from \u001b[36macme-monorepo\u001b[39m\u001b[22m\n')
    expect(plainFrameOf(lastFrame())).toBe(`
✓ visual-check is set up

Next, from acme-monorepo
  1  pnpm storybook   Start Storybook, and keep it running

To set options for every story, see .storybook/visual-check.ts.
To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.`)
  })

  it('shows the install steps to run under Rush between the warnings and the next steps', async () => {
    const manualInstall = {
      heading: ["Install visual-check's packages yourself, then add the addon:"],
      commands: [
        'cd . && rush add --dev --exact --skip-update -p @visual-check/cli@1.0.0',
        'rush update',
        'cd libs/ui && pnpm exec storybook add @visual-check/storybook-addon@1.0.0 --yes --skip-install',
      ],
    }
    const { lastFrame } = await renderSettledAt(
      <Summary result={{ ...resultWith(0, [fallowWarning]), summary: { manualInstall, nextSteps } }} />,
      160,
    )

    expect(plainFrameOf(lastFrame())).toBe(`
✓ visual-check is set up
▲ package.json doesn't list tailwindcss, imported in src/app/(landings)/bingo/landing-page.globals.css. visual-check can't tell which stories it affects.

Install visual-check's packages yourself, then add the addon:
  cd . && rush add --dev --exact --skip-update -p @visual-check/cli@1.0.0
  rush update
  cd libs/ui && pnpm exec storybook add @visual-check/storybook-addon@1.0.0 --yes --skip-install

Next
  1  pnpm storybook       Start Storybook, and keep it running
  2  pnpm visual:update   Write the first baselines
  3  pnpm visual:check    Check the stories against the baselines
  4  Commit the changes, baselines included

To set options for every story, see .storybook/visual-check.ts.
To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.`)
  })

  it("names the workspace root's folder in the Rush heading in accent, with an aside dim", async () => {
    const manualInstall = {
      heading: ["Install visual-check's packages yourself, from ", { code: 'acme' }, ' ', { aside: '(../..)' }, ':'],
      commands: ['rush update'],
    }
    const { lastFrame } = await renderSettledAt(
      <Summary result={{ ...resultWith(0, []), summary: { manualInstall } }} />,
      160,
    )

    expect(lastFrame()).toContain(
      "Install visual-check's packages yourself, from \u001b[36macme\u001b[39m \u001b[2m(../..)\u001b[22m:\n",
    )
  })

  it('draws a hint that names a folder in a run that stopped, with the folder in accent', async () => {
    const hint = ['hint: init sets up the workspace in ', { code: 'acme' }, ', where the config goes.']
    const { lastFrame } = await renderSettled(
      <Summary result={{ exitCode: 2, stdout: '', stderr: '', messages: [hint, 'Stopped.'] }} />,
    )

    expect(lastFrame()).toContain('\u001b[2minit sets up the workspace in \u001b[22m\u001b[36macme\u001b[39m')
    expect(plainFrameOf(lastFrame())).toBe('· init sets up the workspace in acme, where the config goes.\n✕ Stopped.')
  })

  it('puts each Storybook on a row of its own, its command in the same column, and wraps text under itself', async () => {
    const { lastFrame } = await renderSettledAt(
      <Summary
        result={{
          ...resultWith(0, []),
          summary: {
            nextSteps: {
              ...nextSteps,
              steps: [
                [
                  { command: 'pnpm storybook', text: ['Start web-app, and keep it running'] },
                  { command: 'pnpm storybook:docs', text: ['Start docs, and keep it running'] },
                ],
                ...nextSteps.steps.slice(1),
              ],
              modesFiles: ['.storybook/visual-check.ts', 'docs/.storybook/visual-check.ts'],
            },
          },
        }}
      />,
      60,
    )

    expect(plainFrameOf(lastFrame())).toBe(`
✓ visual-check is set up

Next
  1  pnpm storybook        Start web-app, and keep it
                           running
     pnpm storybook:docs   Start docs, and keep it running
  2  pnpm visual:update    Write the first baselines
  3  pnpm visual:check     Check the stories against the
                           baselines
  4  Commit the changes, baselines included

To set options for every story, see
.storybook/visual-check.ts and
docs/.storybook/visual-check.ts.
To run visual-check in CI, see
https://visual-check.vercel.app/docs/ci.`)
  })

  it('puts a command too long for the column on its own line, and its text under the other texts', async () => {
    const { lastFrame } = await renderSettledAt(
      <Summary
        result={{
          ...resultWith(0, []),
          summary: {
            nextSteps: {
              ...nextSteps,
              steps: [
                [
                  {
                    command: 'pnpm exec storybook dev -p 6006 -c packages/design-system/.storybook',
                    text: ['Start Storybook, and keep it running'],
                  },
                ],
                ...nextSteps.steps.slice(1),
              ],
            },
          },
        }}
      />,
      80,
    )

    expect(plainFrameOf(lastFrame())).toBe(`
✓ visual-check is set up

Next
  1  pnpm exec storybook dev -p 6006 -c packages/design-system/.storybook
                          Start Storybook, and keep it running
  2  pnpm visual:update   Write the first baselines
  3  pnpm visual:check    Check the stories against the baselines
  4  Commit the changes, baselines included

To set options for every story, see .storybook/visual-check.ts.
To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.`)
  })

  describe('a start command of 31 characters, the default for a Storybook without a start script', () => {
    /**
     * The next steps of a Storybook started by `storybook dev` on its config URL's port.
     */
    const defaultStartSteps: NextSteps = {
      ...nextSteps,
      steps: [
        [{ command: 'pnpm exec storybook dev -p 6006', text: ['Start Storybook, and keep it running'] }],
        ...nextSteps.steps.slice(1),
      ],
    }

    it('keeps the command in the column at 80 columns', async () => {
      const { lastFrame } = await renderSettledAt(
        <Summary result={{ ...resultWith(0, []), summary: { nextSteps: defaultStartSteps } }} />,
        80,
      )

      expect(plainFrameOf(lastFrame())).toBe(`
✓ visual-check is set up

Next
  1  pnpm exec storybook dev -p 6006   Start Storybook, and keep it running
  2  pnpm visual:update                Write the first baselines
  3  pnpm visual:check                 Check the stories against the baselines
  4  Commit the changes, baselines included

To set options for every story, see .storybook/visual-check.ts.
To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.`)
    })

    it('puts every command on a line of its own at 40 columns, too narrow for the column', async () => {
      const { lastFrame } = await renderSettledAt(
        <Summary result={{ ...resultWith(0, []), summary: { nextSteps: defaultStartSteps } }} />,
        40,
      )

      expect(plainFrameOf(lastFrame())).toBe(`
✓ visual-check is set up

Next
  1  pnpm exec storybook dev -p 6006
     Start Storybook, and keep it
     running
  2  pnpm visual:update
     Write the first baselines
  3  pnpm visual:check
     Check the stories against the
     baselines
  4  Commit the changes, baselines
     included

To set options for every story, see
.storybook/visual-check.ts.
To run visual-check in CI, see
https://visual-check.vercel.app/docs/ci.`)
    })

    it('starts a wrapped line of its text with no space at 60 columns', async () => {
      const { lastFrame } = await renderSettledAt(
        <Summary result={{ ...resultWith(0, []), summary: { nextSteps: defaultStartSteps } }} />,
        60,
      )

      expect(plainFrameOf(lastFrame())).toBe(`
✓ visual-check is set up

Next
  1  pnpm exec storybook dev -p 6006   Start Storybook, and
                                       keep it running
  2  pnpm visual:update                Write the first
                                       baselines
  3  pnpm visual:check                 Check the stories
                                       against the baselines
  4  Commit the changes, baselines included

To set options for every story, see
.storybook/visual-check.ts.
To run visual-check in CI, see
https://visual-check.vercel.app/docs/ci.`)
    })
  })

  it('wraps a command on a line of its own under its own first letter at 40 columns', async () => {
    const { lastFrame } = await renderSettledAt(
      <Summary
        result={{
          ...resultWith(0, []),
          summary: {
            nextSteps: {
              ...nextSteps,
              steps: [
                [
                  {
                    command: 'pnpm exec storybook dev -p 60066 -c packages/ui/.storybook',
                    text: ['Start Storybook, and keep it running'],
                  },
                ],
                ...nextSteps.steps.slice(1),
              ],
            },
          },
        }}
      />,
      40,
    )

    expect(plainFrameOf(lastFrame())).toBe(`
✓ visual-check is set up

Next
  1  pnpm exec storybook dev -p 60066 -c
     packages/ui/.storybook
     Start Storybook, and keep it
     running
  2  pnpm visual:update
     Write the first baselines
  3  pnpm visual:check
     Check the stories against the
     baselines
  4  Commit the changes, baselines
     included

To set options for every story, see
.storybook/visual-check.ts.
To run visual-check in CI, see
https://visual-check.vercel.app/docs/ci.`)
  })

  it('wraps the replaced line under its own first letter at 39 columns', async () => {
    const { lastFrame } = await renderSettledAt(
      <Summary result={{ ...resultWith(2, []), summary: { replacedLine } }} />,
      39,
    )

    // Its first line fills its 37 columns exactly, and the next one starts at the same indent.
    expect(plainFrameOf(lastFrame())).toBe(`
  Replaced the scripts visual:check and
  visual:update in package.json.`)
  })

  it('starts the text of a row without a command where the commands start', async () => {
    const { lastFrame } = await renderSettledAt(
      <Summary
        result={{
          ...resultWith(0, []),
          summary: {
            nextSteps: {
              ...nextSteps,
              steps: [
                [
                  {
                    text: [
                      'Add your Storybook to ',
                      { code: 'visual-check.config.ts' },
                      ', as the hints say, then start it',
                    ],
                  },
                ],
                ...nextSteps.steps.slice(1),
              ],
              modesFiles: [],
            },
          },
        }}
      />,
      50,
    )

    // The first line of the first step fills its 45 columns exactly, and the next one starts with no space.
    expect(plainFrameOf(lastFrame())).toBe(`
✓ visual-check is set up

Next
  1  Add your Storybook to visual-check.config.ts,
     as the hints say, then start it
  2  pnpm visual:update   Write the first
                          baselines
  3  pnpm visual:check    Check the stories
                          against the baselines
  4  Commit the changes, baselines included

To run visual-check in CI, see
https://visual-check.vercel.app/docs/ci.`)
  })

  it('draws the heading in bold accent, the replaced line dim, the commands in accent, the last lines dim but their paths and URLs in accent', async () => {
    const { lastFrame } = await renderSettledAt(
      <Summary
        result={{
          ...resultWith(0, []),
          summary: {
            replacedLine: 'Replaced the script vc in package.json.',
            nextSteps: { ...nextSteps, steps: nextSteps.steps.slice(0, 1) },
          },
        }}
      />,
      160,
    )

    expect(lastFrame()).toBe(
      '\n\u001b[1m\u001b[36m✓ visual-check is set up\u001b[39m\u001b[22m\n' +
        '  \u001b[2mReplaced the script vc in package.json.\u001b[22m\n' +
        '\n\u001b[1mNext\u001b[22m\n' +
        '  1  \u001b[36mpnpm storybook\u001b[39m   Start Storybook, and keep it running\n' +
        '\n\u001b[2mTo set options for every story, see \u001b[22m\u001b[36m.storybook/visual-check.ts\u001b[39m' +
        '\u001b[2m.\u001b[22m\n' +
        '\u001b[2mTo run visual-check in CI, see \u001b[22m\u001b[36mhttps://visual-check.vercel.app/docs/ci\u001b[39m' +
        '\u001b[2m.\u001b[22m',
    )
  })

  it('shows a warning that spans lines under its triangle, its later lines included', async () => {
    const { lastFrame } = await renderSettled(
      <Summary
        result={{
          ...resultWith(0, [
            "Warning: Fallow couldn't check the imports: Fallow broke.\nIt could not read tsconfig.json.",
          ]),
          summary: { nextSteps: { ...nextSteps, steps: [], modesFiles: [] } },
        }}
      />,
    )

    expect(plainFrameOf(lastFrame())).toBe(`
✓ visual-check is set up
▲ Fallow couldn't check the imports: Fallow broke.
  It could not read tsconfig.json.

Next

To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.`)
  })

  it('sums up a run whose install failed: the scripts it replaced, then the warnings and the problem', async () => {
    const { lastFrame } = await renderSettled(
      <Summary
        result={{
          ...resultWith(2, ['Warning: Port 7000 is not 6006.', installProblem]),
          summary: { replacedLine },
        }}
      />,
    )

    expect(plainFrameOf(lastFrame())).toBe(`
  Replaced the scripts visual:check and visual:update in package.json.
▲ Port 7000 is not 6006.
✕ ${installProblem}`)
  })

  it('sums up a run whose install failed and that replaced no script: the problem alone', async () => {
    const { lastFrame } = await renderSettled(<Summary result={{ ...resultWith(2, [installProblem]), summary: {} }} />)

    expect(lastFrame()).toBe(`\n\u001b[31m✕\u001b[39m \u001b[31m${installProblem}\u001b[39m`)
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
