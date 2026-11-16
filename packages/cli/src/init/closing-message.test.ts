import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closingMessageOf, type SetUpStorybook, writtenLinesOf } from './closing-message.js'

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
const defaultScripts = { test: { name: 'visual:test', add: true }, update: { name: 'visual:update', add: true } }

describe('closingMessageOf', () => {
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
  3. Run pnpm run visual:test. It should pass. If a story fails, see https://visual-check.vercel.app/docs/broken-stories.
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
      '  3. Run npm run visual:test. It should pass. If a story fails, see https://visual-check.vercel.app/docs/broken-stories.',
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
  3. Run pnpm run visual:test. It should pass. If a story fails, see https://visual-check.vercel.app/docs/broken-stories.
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

  it.each([
    ['pnpm', 'pnpm exec visual-check update', 'pnpm exec visual-check test'],
    ['npm', 'npx visual-check update', 'npx visual-check test'],
    ['yarn', 'yarn visual-check update', 'yarn visual-check test'],
    ['bun', 'bunx visual-check update', 'bunx visual-check test'],
  ] as const)('runs the binary under %s when init added no script for it', (packageManager, update, test) => {
    const message = closingMessageOf({
      cwd: '/project',
      packageManager,
      configPath: '/project/visual-check.config.ts',
      storybooks: [webApp],
      scripts: { test: undefined, update: undefined },
    })

    expect(message.split('\n').slice(2, 4)).toEqual([
      `  2. Run ${update} to write baselines. The first run downloads the browser image.`,
      `  3. Run ${test}. It should pass. If a story fails, see https://visual-check.vercel.app/docs/broken-stories.`,
    ])
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
      '  3. Run pnpm run visual:test. It should pass. If a story fails, see https://visual-check.vercel.app/docs/broken-stories.',
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
  it('lists each file written relative to the folder init runs in, then the two scripts added', () => {
    expect(
      writtenLinesOf(
        {
          files: [
            '/project/visual-check.config.ts',
            '/project/.storybook/visual-check.ts',
            '/project/.visual-check/.gitignore',
          ],
          scripts: ['visual:test', 'visual:update'],
        },
        '/project',
      ),
    ).toEqual([
      'Wrote visual-check.config.ts',
      'Wrote .storybook/visual-check.ts',
      'Wrote .visual-check/.gitignore',
      'Added the scripts visual:test and visual:update to package.json.',
    ])
  })

  it('names one script added in the singular', () => {
    expect(writtenLinesOf({ files: [], scripts: ['visual:update'] }, '/project')).toEqual([
      'Added the script visual:update to package.json.',
    ])
  })

  it('has no scripts line when it added none', () => {
    expect(writtenLinesOf({ files: ['/project/.storybook/visual-check.ts'], scripts: [] }, '/project/src')).toEqual([
      'Wrote ../.storybook/visual-check.ts',
    ])
  })

  it('gives no line when it wrote nothing', () => {
    expect(writtenLinesOf({ files: [], scripts: [] }, '/project')).toEqual([])
  })
})
