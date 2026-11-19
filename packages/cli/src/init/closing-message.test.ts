import { describe, expect, it } from 'vitest'
import {
  ciLineOf,
  closingMessageTextOf,
  commandColumnWidthOf,
  fitsCommandColumn,
  modesLineOf,
  nextHeadingOf,
  nextStepsOf,
  replacedScriptsLineOf,
  type SetUpStorybook,
} from './closing-message.js'

/**
 * The one Storybook of a project at `/project`, started by its `storybook` script under pnpm.
 */
const webApp: SetUpStorybook = {
  name: 'web-app',
  dir: '/project',
  configDir: '/project/.storybook',
  baselines: '/project/.visual-check/baselines',
  startCommand: 'pnpm run storybook',
}

/**
 * A second Storybook of the project at `/project`, in `docs/`.
 */
const docs: SetUpStorybook = {
  name: 'docs',
  dir: '/project/docs',
  configDir: '/project/docs/.storybook',
  baselines: '/project/docs/.visual-check/baselines',
  startCommand: 'pnpm run storybook:docs',
}

/**
 * The scripts `init` adds by default.
 */
const defaultScripts = { test: { name: 'visual:check', add: true }, update: { name: 'visual:update', add: true } }

/**
 * What the closing message tells the project at `/project` with its one Storybook under pnpm, which has no baselines,
 * with `overrides` in place.
 */
function inputOf(overrides: Partial<Parameters<typeof nextStepsOf>[0]> = {}): Parameters<typeof nextStepsOf>[0] {
  return {
    cwd: '/project',
    root: '/project',
    packageManager: 'pnpm',
    configPath: '/project/visual-check.config.ts',
    storybooks: [webApp],
    scripts: defaultScripts,
    needsBaselines: true,
    ...overrides,
  }
}

/**
 * The plain closing message for `input`, as `init` prints it.
 */
function closingMessageOf(input: Parameters<typeof nextStepsOf>[0]): string {
  return closingMessageTextOf(nextStepsOf(input))
}

describe('replacedScriptsLineOf', () => {
  it('gives no line when no script was replaced', () => {
    expect(replacedScriptsLineOf([])).toBe(undefined)
  })

  it('names one script in the singular', () => {
    expect(replacedScriptsLineOf(['visual:check'])).toBe('Replaced the script visual:check in package.json.')
  })

  it('names several scripts in one line', () => {
    expect(replacedScriptsLineOf(['visual:check', 'visual:update'])).toBe(
      'Replaced the scripts visual:check and visual:update in package.json.',
    )
    expect(replacedScriptsLineOf(['a', 'b', 'c'])).toBe('Replaced the scripts a, b and c in package.json.')
  })
})

describe('nextStepsOf', () => {
  it('gives the four steps, the modes file and the CI docs for one Storybook', () => {
    expect(nextStepsOf(inputOf())).toEqual({
      steps: [
        [{ command: 'pnpm run storybook', text: ['Start Storybook, and keep it running'] }],
        [{ command: 'pnpm run visual:update', text: ['Write the first baselines'] }],
        [{ command: 'pnpm run visual:check', text: ['Check the stories against the baselines'] }],
        [{ text: ['Commit the changes, baselines included'] }],
      ],
      runFrom: undefined,
      modesFiles: ['.storybook/visual-check.ts'],
      ciUrl: 'https://visual-check.vercel.app/docs/ci',
    })
  })

  it('leaves out writing the first baselines when every Storybook has them', () => {
    expect(nextStepsOf(inputOf({ needsBaselines: false })).steps).toEqual([
      [{ command: 'pnpm run storybook', text: ['Start Storybook, and keep it running'] }],
      [{ command: 'pnpm run visual:check', text: ['Check the stories against the baselines'] }],
      [{ text: ['Commit the changes, baselines included'] }],
    ])
  })

  it('starts each Storybook on a row of its own, named, and lists each modes file', () => {
    const nextSteps = nextStepsOf(inputOf({ storybooks: [webApp, docs] }))

    expect(nextSteps.steps[0]).toEqual([
      { command: 'pnpm run storybook', text: ['Start web-app, and keep it running'] },
      { command: 'pnpm run storybook:docs', text: ['Start docs, and keep it running'] },
    ])
    expect(nextSteps.modesFiles).toEqual(['.storybook/visual-check.ts', 'docs/.storybook/visual-check.ts'])
  })

  it('names a modes file two Storybooks share once', () => {
    const shared = { ...docs, dir: '/project', configDir: '/project/.storybook' }

    expect(nextStepsOf(inputOf({ storybooks: [webApp, shared] })).modesFiles).toEqual(['.storybook/visual-check.ts'])
  })

  it('tells to add the Storybook to the config, and names no modes file, when none was set up', () => {
    const nextSteps = nextStepsOf(inputOf({ storybooks: [] }))

    expect(nextSteps.steps[0]).toEqual([
      {
        text: ['Add your Storybook to ', { code: 'visual-check.config.ts' }, ', as the hints say, then start it'],
      },
    ])
    expect(nextSteps.modesFiles).toEqual([])
  })

  it("names the root's folder to run the steps from, with the paths relative to it, when init runs in a package", () => {
    const nextSteps = nextStepsOf(inputOf({ cwd: '/project/packages/ui' }))

    expect(nextSteps.runFrom).toEqual([{ code: 'project' }])
    expect(nextSteps.modesFiles).toEqual(['.storybook/visual-check.ts'])
    expect(nextStepsOf(inputOf({ cwd: '/project/packages/ui', storybooks: [] })).steps[0]?.[0]?.text).toEqual([
      'Add your Storybook to ',
      { code: 'visual-check.config.ts' },
      ', as the hints say, then start it',
    ])
  })

  it.each([
    ['npm', 'npm run visual:update', 'npm run visual:check'],
    ['pnpm', 'pnpm run visual:update', 'pnpm run visual:check'],
    ['yarn', 'yarn run visual:update', 'yarn run visual:check'],
  ] as const)('runs the scripts with %s', (packageManager, update, test) => {
    const { steps } = nextStepsOf(inputOf({ packageManager }))

    expect(steps.slice(1, 3).map((rows) => rows.map(({ command }) => command))).toEqual([[update], [test]])
  })

  it('runs the scripts by the names the answers give, an existing one included', () => {
    const { steps } = nextStepsOf(
      inputOf({ scripts: { test: { name: 'vc', add: false }, update: { name: 'vc:update', add: true } } }),
    )

    expect(steps.slice(1, 3).map((rows) => rows.map(({ command }) => command))).toEqual([
      ['pnpm run vc:update'],
      ['pnpm run vc'],
    ])
  })

  it('starts the Storybook with the command the person gave', () => {
    const { steps } = nextStepsOf(inputOf({ storybooks: [{ ...webApp, startCommand: 'make storybook' }] }))

    expect(steps[0]).toEqual([{ command: 'make storybook', text: ['Start Storybook, and keep it running'] }])
  })
})

describe('commandColumnWidthOf', () => {
  it('gives the longest command of every step and row, then three spaces', () => {
    expect(
      commandColumnWidthOf([
        [{ command: 'pnpm run storybook', text: [] }],
        [
          { command: 'abc', text: [] },
          { command: 'pnpm run visual:update', text: [] },
        ],
        [{ text: ['Commit'] }],
      ]),
    ).toBe(25)
  })

  it('gives 0 when no row has a command', () => {
    expect(commandColumnWidthOf([[{ text: ['Commit'] }]])).toBe(0)
    expect(commandColumnWidthOf([])).toBe(0)
  })

  it('counts a command of 32 characters, and leaves out one of 33', () => {
    const thirtyTwo = 'x'.repeat(32)

    expect(commandColumnWidthOf([[{ command: thirtyTwo, text: [] }]])).toBe(35)
    expect(commandColumnWidthOf([[{ command: `${thirtyTwo}x`, text: [] }], [{ command: 'abc', text: [] }]])).toBe(6)
    expect(commandColumnWidthOf([[{ command: `${thirtyTwo}x`, text: [] }]])).toBe(0)
  })
})

describe('fitsCommandColumn', () => {
  it('fits a command with three spaces after it in the column', () => {
    expect(fitsCommandColumn('abc', 6)).toBe(true)
    expect(fitsCommandColumn('abc', 7)).toBe(true)
  })

  it('does not fit a command that leaves less than three spaces', () => {
    expect(fitsCommandColumn('abcd', 6)).toBe(false)
    expect(fitsCommandColumn('abc', 0)).toBe(false)
  })
})

describe('modesLineOf', () => {
  it('points to one modes file, with its path as code', () => {
    expect(modesLineOf(['.storybook/visual-check.ts'])).toEqual([
      'To set options for every story, see ',
      { code: '.storybook/visual-check.ts' },
      '.',
    ])
  })

  it('names several modes files, each as code', () => {
    expect(modesLineOf(['a.ts', 'b.ts', 'c.ts'])).toEqual([
      'To set options for every story, see ',
      { code: 'a.ts' },
      ', ',
      { code: 'b.ts' },
      ' and ',
      { code: 'c.ts' },
      '.',
    ])
  })
})

describe('nextHeadingOf', () => {
  it('gives Next in the root', () => {
    expect(nextHeadingOf(undefined)).toEqual(['Next'])
  })

  it('names the root to run the steps from below it, as it is named', () => {
    expect(nextHeadingOf([{ code: 'acme' }, ' ', { aside: '(../..)' }])).toEqual([
      'Next, from ',
      { code: 'acme' },
      ' ',
      { aside: '(../..)' },
    ])
  })
})

describe('ciLineOf', () => {
  it('points to the CI docs page, with its URL as code', () => {
    expect(ciLineOf('https://visual-check.vercel.app/docs/ci')).toEqual([
      'To run visual-check in CI, see ',
      { code: 'https://visual-check.vercel.app/docs/ci' },
      '.',
    ])
  })
})

describe('closingMessageTextOf', () => {
  it('numbers the steps, puts the commands in a column padded to the longest, then the modes and CI lines', () => {
    expect(closingMessageOf(inputOf())).toBe(`visual-check is set up. Next:
  1. pnpm run storybook       Start Storybook, and keep it running
  2. pnpm run visual:update   Write the first baselines
  3. pnpm run visual:check    Check the stories against the baselines
  4. Commit the changes, baselines included

To set options for every story, see .storybook/visual-check.ts.
To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.
`)
  })

  it('leaves out writing the first baselines when every Storybook has them', () => {
    expect(closingMessageOf(inputOf({ needsBaselines: false }))).toBe(`visual-check is set up. Next:
  1. pnpm run storybook      Start Storybook, and keep it running
  2. pnpm run visual:check   Check the stories against the baselines
  3. Commit the changes, baselines included

To set options for every story, see .storybook/visual-check.ts.
To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.
`)
  })

  it('puts each Storybook on a row of its own, indented to the commands, and names each modes file', () => {
    expect(closingMessageOf(inputOf({ storybooks: [webApp, docs] }))).toBe(`visual-check is set up. Next:
  1. pnpm run storybook        Start web-app, and keep it running
     pnpm run storybook:docs   Start docs, and keep it running
  2. pnpm run visual:update    Write the first baselines
  3. pnpm run visual:check     Check the stories against the baselines
  4. Commit the changes, baselines included

To set options for every story, see .storybook/visual-check.ts and docs/.storybook/visual-check.ts.
To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.
`)
  })

  it('puts a command too long for the column on its own line, and its text under the other texts', () => {
    const designSystem = {
      ...webApp,
      startCommand: 'pnpm exec storybook dev -p 6006 -c packages/design-system/.storybook',
    }

    expect(closingMessageOf(inputOf({ storybooks: [designSystem] }))).toBe(`visual-check is set up. Next:
  1. pnpm exec storybook dev -p 6006 -c packages/design-system/.storybook
                              Start Storybook, and keep it running
  2. pnpm run visual:update   Write the first baselines
  3. pnpm run visual:check    Check the stories against the baselines
  4. Commit the changes, baselines included

To set options for every story, see .storybook/visual-check.ts.
To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.
`)
  })

  it('puts a long command of a later row on its own line too, indented to the commands', () => {
    const designSystem = {
      ...docs,
      startCommand: 'pnpm exec storybook dev -p 6006 -c packages/design-system/.storybook',
    }

    expect(
      closingMessageOf(inputOf({ storybooks: [webApp, designSystem], needsBaselines: false })),
    ).toBe(`visual-check is set up. Next:
  1. pnpm run storybook      Start web-app, and keep it running
     pnpm exec storybook dev -p 6006 -c packages/design-system/.storybook
                             Start docs, and keep it running
  2. pnpm run visual:check   Check the stories against the baselines
  3. Commit the changes, baselines included

To set options for every story, see .storybook/visual-check.ts and docs/.storybook/visual-check.ts.
To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.
`)
  })

  it('tells to add the Storybook, and has no modes line, when none was set up', () => {
    expect(closingMessageOf(inputOf({ storybooks: [] }))).toBe(`visual-check is set up. Next:
  1. Add your Storybook to visual-check.config.ts, as the hints say, then start it
  2. pnpm run visual:update   Write the first baselines
  3. pnpm run visual:check    Check the stories against the baselines
  4. Commit the changes, baselines included

To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.
`)
  })

  it('says to run the steps from the root when init runs in a package, with the paths relative to it', () => {
    const ui = {
      ...docs,
      dir: '/project/packages/ui',
      configDir: '/project/packages/ui/.storybook',
      startCommand: 'pnpm --filter ui run storybook',
    }

    expect(
      closingMessageOf(inputOf({ cwd: '/project/packages/ui', storybooks: [ui] })),
    ).toBe(`visual-check is set up. Next, from project:
  1. pnpm --filter ui run storybook   Start Storybook, and keep it running
  2. pnpm run visual:update           Write the first baselines
  3. pnpm run visual:check            Check the stories against the baselines
  4. Commit the changes, baselines included

To set options for every story, see packages/ui/.storybook/visual-check.ts.
To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.
`)
  })

  it('says nothing about remote content or the agent skill', () => {
    expect(closingMessageOf(inputOf())).not.toMatch(/remote|skill/i)
  })
})
