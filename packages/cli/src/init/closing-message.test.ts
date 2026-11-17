import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ciLineOf,
  closingMessageTextOf,
  nextStepsOf,
  previewIntroOf,
  type SetUpStorybook,
  type Written,
  writtenLinesOf,
  writtenListOf,
} from './closing-message.js'

/**
 * The plain closing message for `input`, as `init` prints it.
 */
function closingMessageOf(input: Parameters<typeof nextStepsOf>[0]): string {
  return closingMessageTextOf(nextStepsOf(input))
}

/**
 * The plain lines for what `init` wrote, with the paths relative to `cwd`, as `init` prints them.
 */
function writtenLinesIn(written: Written, cwd: string): string[] {
  return writtenLinesOf(writtenListOf(written, cwd))
}

/**
 * The temporary folders the tests made, removed after each test.
 */
const temporaryFolders: string[] = []

/**
 * Makes a temporary folder holding `files`, each a path relative to the folder mapped to its content, and returns its
 * real path.
 */
function createFolder(files: Record<string, string>): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-closing-')))

  temporaryFolders.push(folder)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(folder, path, '..'), { recursive: true })
    writeFileSync(join(folder, path), content)
  }

  return folder
}

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

/**
 * The one Storybook of a project at `/project`, started by its `storybook` script under pnpm.
 */
const webApp: SetUpStorybook = {
  name: 'web-app',
  dir: '/project',
  configDir: '/project/.storybook',
  startCommand: 'pnpm run storybook',
}

/**
 * The scripts `init` adds by default.
 */
const defaultScripts = { test: { name: 'visual:check', add: true }, update: { name: 'visual:update', add: true } }

describe('closingMessageTextOf', () => {
  it('tells the four steps, the preview line and the CI docs for one Storybook under pnpm', () => {
    expect(
      closingMessageOf({
        cwd: '/project',
        packageManager: 'pnpm',
        configPath: '/project/visual-check.config.ts',
        storybooks: [webApp],
        scripts: defaultScripts,
      }),
    ).toBe(`visual-check is set up. Next:
  1. Start Storybook with pnpm run storybook.
  2. Run pnpm run visual:update to write baselines. The first run downloads the browser image.
  3. Run pnpm run visual:check. It should pass. If a story fails, see https://visual-check.vercel.app/docs/broken-stories.
  4. Commit visual-check.config.ts, .storybook/visual-check.ts and .visual-check/.

To set options for every story, spread visualCheck into the parameters in .storybook/preview.ts:
  import { visualCheck } from './visual-check'
  parameters: { ...visualCheck({}) },

To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.
`)
  })

  it('runs the scripts with npm', () => {
    const message = closingMessageOf({
      cwd: '/project',
      packageManager: 'npm',
      configPath: '/project/visual-check.config.ts',
      storybooks: [{ ...webApp, startCommand: 'npm run storybook' }],
      scripts: defaultScripts,
    })

    expect(message.split('\n').slice(1, 4)).toEqual([
      '  1. Start Storybook with npm run storybook.',
      '  2. Run npm run visual:update to write baselines. The first run downloads the browser image.',
      '  3. Run npm run visual:check. It should pass. If a story fails, see https://visual-check.vercel.app/docs/broken-stories.',
    ])
  })

  it('names each Storybook with its command, and gives each config folder its preview lines', () => {
    const docs: SetUpStorybook = {
      name: 'docs',
      dir: '/project',
      configDir: '/project/docs/.storybook',
      startCommand: 'pnpm exec storybook dev -p 6007 -c docs/.storybook',
    }

    expect(
      closingMessageOf({
        cwd: '/project',
        packageManager: 'pnpm',
        configPath: '/project/visual-check.config.ts',
        storybooks: [webApp, docs],
        scripts: defaultScripts,
      }),
    ).toBe(`visual-check is set up. Next:
  1. Start each Storybook: pnpm run storybook for web-app, pnpm exec storybook dev -p 6007 -c docs/.storybook for docs.
  2. Run pnpm run visual:update to write baselines. The first run downloads the browser image.
  3. Run pnpm run visual:check. It should pass. If a story fails, see https://visual-check.vercel.app/docs/broken-stories.
  4. Commit visual-check.config.ts, .storybook/visual-check.ts, docs/.storybook/visual-check.ts and .visual-check/.

To set options for every story, spread visualCheck into the parameters in .storybook/preview.ts:
  import { visualCheck } from './visual-check'
  parameters: { ...visualCheck({}) },

To set options for every story, spread visualCheck into the parameters in docs/.storybook/preview.ts:
  import { visualCheck } from './visual-check'
  parameters: { ...visualCheck({}) },

To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.
`)
  })

  it('lists each distinct .visual-check folder, the config folder last', () => {
    const message = closingMessageOf({
      cwd: '/project',
      packageManager: 'pnpm',
      configPath: '/project/visual-check.config.ts',
      storybooks: [{ ...webApp, dir: '/project/web', configDir: '/project/web/.storybook' }],
      scripts: defaultScripts,
    })

    expect(message.split('\n')[4]).toBe(
      '  4. Commit visual-check.config.ts, web/.storybook/visual-check.ts, web/.visual-check/ and .visual-check/.',
    )
  })

  it('tells to start the Storybook with the command the person gave', () => {
    const message = closingMessageOf({
      cwd: '/project',
      packageManager: 'pnpm',
      configPath: '/project/visual-check.config.ts',
      storybooks: [{ ...webApp, startCommand: 'make storybook' }],
      scripts: defaultScripts,
    })

    expect(message.split('\n')[1]).toBe('  1. Start Storybook with make storybook.')
  })

  it('names the preview file that exists in the config folder', () => {
    const project = createFolder({
      '.storybook/main.ts': '',
      '.storybook/preview.tsx': '',
      '.storybook/preview.js': '',
    })
    const message = closingMessageOf({
      cwd: project,
      packageManager: 'pnpm',
      configPath: join(project, 'visual-check.config.ts'),
      storybooks: [{ ...webApp, dir: project, configDir: join(project, '.storybook') }],
      scripts: defaultScripts,
    })

    expect(message).toContain(
      'To set options for every story, spread visualCheck into the parameters in .storybook/preview.tsx:\n',
    )
  })

  it('names preview.ts when the config folder has no preview file', () => {
    const project = createFolder({ '.storybook/main.ts': '', '.storybook/preview-head.html': '' })
    const message = closingMessageOf({
      cwd: project,
      packageManager: 'pnpm',
      configPath: join(project, 'visual-check.config.ts'),
      storybooks: [{ ...webApp, dir: project, configDir: join(project, '.storybook') }],
      scripts: defaultScripts,
    })

    expect(message).toContain(
      'To set options for every story, spread visualCheck into the parameters in .storybook/preview.ts:\n',
    )
  })

  it('runs an existing script that init did not add', () => {
    const message = closingMessageOf({
      cwd: '/project',
      packageManager: 'pnpm',
      configPath: '/project/visual-check.config.ts',
      storybooks: [webApp],
      scripts: { test: { name: 'vc', add: false }, update: { name: 'visual:update', add: true } },
    })

    expect(message.split('\n')[3]).toBe(
      '  3. Run pnpm run vc. It should pass. If a story fails, see https://visual-check.vercel.app/docs/broken-stories.',
    )
  })

  it('shows the paths relative to a subfolder init runs in', () => {
    const message = closingMessageOf({
      cwd: '/project/src',
      packageManager: 'pnpm',
      configPath: '/project/visual-check.config.ts',
      storybooks: [webApp],
      scripts: defaultScripts,
    })

    expect(message.split('\n')[4]).toBe(
      '  4. Commit ../visual-check.config.ts, ../.storybook/visual-check.ts and ../.visual-check/.',
    )
    expect(message).toContain('spread visualCheck into the parameters in ../.storybook/preview.ts:\n')
  })

  it('tells to add the Storybook to the config when the config holds none init could set up', () => {
    const message = closingMessageOf({
      cwd: '/project',
      packageManager: 'pnpm',
      configPath: '/project/visual-check.config.ts',
      storybooks: [],
      scripts: defaultScripts,
    })

    expect(message.split('\n').slice(0, 6)).toEqual([
      'visual-check is set up. Next:',
      '  1. Add your Storybook to visual-check.config.ts, as the hints say, then start it.',
      '  2. Run pnpm run visual:update to write baselines. The first run downloads the browser image.',
      '  3. Run pnpm run visual:check. It should pass. If a story fails, see https://visual-check.vercel.app/docs/broken-stories.',
      '  4. Commit visual-check.config.ts and .visual-check/.',
      '',
    ])
  })

  it('says nothing about remote content or the agent skill', () => {
    const message = closingMessageOf({
      cwd: '/project',
      packageManager: 'pnpm',
      configPath: '/project/visual-check.config.ts',
      storybooks: [webApp],
      scripts: defaultScripts,
    })

    expect(message).not.toMatch(/remote|skill/i)
  })
})

describe('writtenLinesOf', () => {
  /**
   * No script added or replaced.
   */
  const noScripts = { added: [], replaced: [] }

  it('lists each file written relative to the folder init runs in, then the two scripts added', () => {
    expect(
      writtenLinesIn(
        {
          files: [
            '/project/visual-check.config.ts',
            '/project/.storybook/visual-check.ts',
            '/project/.visual-check/.gitignore',
          ],
          scripts: { added: ['visual:check', 'visual:update'], replaced: [] },
        },
        '/project',
      ),
    ).toEqual([
      'Wrote visual-check.config.ts',
      'Wrote .storybook/visual-check.ts',
      'Wrote .visual-check/.gitignore',
      'Added the scripts visual:check and visual:update to package.json.',
    ])
  })

  it('names one script added in the singular', () => {
    expect(writtenLinesIn({ files: [], scripts: { added: ['visual:update'], replaced: [] } }, '/project')).toEqual([
      'Added the script visual:update to package.json.',
    ])
  })

  it('gives a line per script replaced, with what it ran', () => {
    const replaced = [
      { name: 'visual:check', previous: 'vitest --project visual' },
      { name: 'visual:update', previous: 'vitest -u' },
    ]

    expect(writtenLinesIn({ files: [], scripts: { added: [], replaced } }, '/project')).toEqual([
      'Replaced the script visual:check in package.json. It ran: vitest --project visual',
      'Replaced the script visual:update in package.json. It ran: vitest -u',
    ])
  })

  it('has no scripts line when it added none', () => {
    expect(
      writtenLinesIn({ files: ['/project/.storybook/visual-check.ts'], scripts: noScripts }, '/project/src'),
    ).toEqual(['Wrote ../.storybook/visual-check.ts'])
  })

  it('gives no line when it wrote nothing', () => {
    expect(writtenLinesIn({ files: [], scripts: noScripts }, '/project')).toEqual([])
  })
})

describe('writtenListOf', () => {
  it('gives the paths of the files written relative to the folder init runs in, and a line per script change', () => {
    expect(
      writtenListOf(
        {
          files: ['/project/visual-check.config.ts', '/project/.storybook/visual-check.ts'],
          scripts: { added: ['visual:update'], replaced: [{ name: 'visual:check', previous: 'vitest' }] },
        },
        '/project/src',
      ),
    ).toEqual({
      files: ['../visual-check.config.ts', '../.storybook/visual-check.ts'],
      scripts: [
        'Added the script visual:update to package.json.',
        'Replaced the script visual:check in package.json. It ran: vitest',
      ],
    })
  })

  it('gives nothing when it wrote nothing', () => {
    expect(writtenListOf({ files: [], scripts: { added: [], replaced: [] } }, '/project')).toEqual({
      files: [],
      scripts: [],
    })
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

describe('previewIntroOf', () => {
  it('leads into the snippet, with the preview file as code', () => {
    expect(previewIntroOf('.storybook/preview.ts')).toEqual([
      'To set options for every story, spread visualCheck into the parameters in ',
      { code: '.storybook/preview.ts' },
      ':',
    ])
  })
})

describe('nextStepsOf', () => {
  /**
   * The third step under pnpm with the default scripts.
   */
  const testStep = [
    'Run ',
    { code: 'pnpm run visual:check' },
    '. It should pass. If a story fails, see ',
    { code: 'https://visual-check.vercel.app/docs/broken-stories' },
    '.',
  ]

  it('gives the four steps, the preview snippet and the CI docs for one Storybook, with the commands and paths as code', () => {
    expect(
      nextStepsOf({
        cwd: '/project',
        packageManager: 'pnpm',
        configPath: '/project/visual-check.config.ts',
        storybooks: [webApp],
        scripts: defaultScripts,
      }),
    ).toEqual({
      steps: [
        ['Start Storybook with ', { code: 'pnpm run storybook' }, '.'],
        ['Run ', { code: 'pnpm run visual:update' }, ' to write baselines. The first run downloads the browser image.'],
        testStep,
        [
          'Commit ',
          { code: 'visual-check.config.ts' },
          ', ',
          { code: '.storybook/visual-check.ts' },
          ' and ',
          { code: '.visual-check/' },
          '.',
        ],
      ],
      previews: [
        {
          file: '.storybook/preview.ts',
          lines: ["import { visualCheck } from './visual-check'", 'parameters: { ...visualCheck({}) },'],
        },
      ],
      ciUrl: 'https://visual-check.vercel.app/docs/ci',
    })
  })

  it('names each Storybook with its command, and gives each config folder its preview snippet', () => {
    const docs: SetUpStorybook = {
      name: 'docs',
      dir: '/project/docs',
      configDir: '/project/docs/.storybook',
      startCommand: 'pnpm exec storybook dev -p 6007',
    }
    const nextSteps = nextStepsOf({
      cwd: '/project',
      packageManager: 'npm',
      configPath: '/project/visual-check.config.ts',
      storybooks: [webApp, docs],
      scripts: { test: { name: 'vc', add: false }, update: { name: 'vc:update', add: true } },
    })

    expect(nextSteps.steps).toEqual([
      [
        'Start each Storybook: ',
        { code: 'pnpm run storybook' },
        ' for web-app, ',
        { code: 'pnpm exec storybook dev -p 6007' },
        ' for docs.',
      ],
      ['Run ', { code: 'npm run vc:update' }, ' to write baselines. The first run downloads the browser image.'],
      [
        'Run ',
        { code: 'npm run vc' },
        '. It should pass. If a story fails, see ',
        { code: 'https://visual-check.vercel.app/docs/broken-stories' },
        '.',
      ],
      [
        'Commit ',
        { code: 'visual-check.config.ts' },
        ', ',
        { code: '.storybook/visual-check.ts' },
        ', ',
        { code: 'docs/.storybook/visual-check.ts' },
        ', ',
        { code: '.visual-check/' },
        ' and ',
        { code: 'docs/.visual-check/' },
        '.',
      ],
    ])
    expect(nextSteps.previews.map(({ file }) => file)).toEqual(['.storybook/preview.ts', 'docs/.storybook/preview.ts'])
  })

  it('tells to add the Storybook to the config, and gives no preview snippet, when none was set up', () => {
    const nextSteps = nextStepsOf({
      cwd: '/project',
      packageManager: 'pnpm',
      configPath: '/project/visual-check.config.ts',
      storybooks: [],
      scripts: defaultScripts,
    })

    expect(nextSteps.steps[0]).toEqual([
      'Add your Storybook to ',
      { code: 'visual-check.config.ts' },
      ', as the hints say, then start it.',
    ])
    expect(nextSteps.steps[3]).toEqual([
      'Commit ',
      { code: 'visual-check.config.ts' },
      ' and ',
      { code: '.visual-check/' },
      '.',
    ])
    expect(nextSteps.previews).toEqual([])
  })
})
