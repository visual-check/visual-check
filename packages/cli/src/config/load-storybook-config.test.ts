import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfigError } from './config-error.js'
import { loadConfig } from './load-config.js'
import { loadStorybookConfig, type StorybookConfigOptions } from './load-storybook-config.js'

/**
 * The projects the tests made, removed after each test.
 */
const projects: string[] = []

/**
 * The address of the running Storybook.
 */
const ownUrl = 'http://127.0.0.1:6009'

/**
 * A config with two Storybooks, each with a URL for every environment.
 */
const twoStorybooks = `export default { storybooks: {
  web: { url: { local: 'http://127.0.0.1:6006', ci: 'http://web:6006' }, dir: 'apps/web' },
  docs: { url: 'http://127.0.0.1:6007', dir: 'apps/docs' },
} }
`

/**
 * Makes a temporary project holding a `.git` folder, which ends the search there, and `files`, each a path relative to
 * the project mapped to its content. Returns the project's real path.
 */
function createProject(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-storybook-config-')))

  projects.push(root)
  for (const [path, content] of Object.entries({ '.git/HEAD': 'ref: refs/heads/main\n', ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }

  return root
}

/**
 * Loads the config of the Storybook whose config folder is `configDir`, relative to the project, of a local run from
 * the project's folder unless the options say otherwise.
 */
function load(root: string, configDir: string, options: Partial<StorybookConfigOptions> = {}) {
  return loadStorybookConfig({ configDir: join(root, configDir), url: ownUrl, cwd: root, ci: false, ...options })
}

/**
 * Gives the `ConfigError` that a load, which must fail, rejects with.
 */
async function configErrorOf(loading: Promise<unknown>): Promise<ConfigError> {
  const error = await loading.then(
    () => undefined,
    (rejection: unknown) => rejection,
  )

  expect(error).toBeInstanceOf(ConfigError)

  return error as ConfigError
}

afterEach(() => {
  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true })
  }
})

describe('loadStorybookConfig and the Storybook', () => {
  it('gives the Storybook whose config folder it is, at its own address', async () => {
    const root = createProject({ 'visual-check.config.ts': twoStorybooks, 'apps/docs/.storybook/main.ts': '' })
    const { config, storybook, configUrl } = await load(root, 'apps/docs/.storybook')

    expect(storybook).toStrictEqual({
      name: 'docs',
      dir: join(root, 'apps/docs'),
      configDir: join(root, 'apps/docs/.storybook'),
      baselines: join(root, 'apps/docs/.visual-check/baselines'),
      url: ownUrl,
    })
    expect(config.storybooks).toStrictEqual([storybook])
    expect(config.path).toBe(join(root, 'visual-check.config.ts'))
    expect(configUrl).toBe('http://127.0.0.1:6007')
  })

  it('gives the first of several with that config folder', async () => {
    const root = createProject({
      'visual-check.config.ts': `export default { storybooks: {
  light: { url: 'http://127.0.0.1:6006', baselines: 'light' },
  dark: { url: 'http://127.0.0.1:6007', baselines: 'dark' },
} }\n`,
    })

    expect((await load(root, '.storybook')).storybook.name).toBe('light')
  })

  it('finds a Storybook by the configDir the config sets', async () => {
    const root = createProject({
      'visual-check.config.ts':
        "export default { storybooks: { web: { url: 'http://127.0.0.1:6006', dir: 'apps/web', configDir: 'config' } } }\n",
    })

    expect((await load(root, 'apps/web/config')).storybook.name).toBe('web')
  })

  it.each([
    ['link/.storybook', 'apps/web'],
    ['apps/web/.storybook', 'link'],
  ])('finds the Storybook of %s when the config’s dir is %s, its other path', async (configDir, dir) => {
    const root = createProject({
      'visual-check.config.ts': `export default { storybooks: { web: { url: 'http://127.0.0.1:6006', dir: '${dir}' } } }\n`,
      'apps/web/.storybook/main.ts': '',
    })

    symlinkSync(join(root, 'apps/web'), join(root, 'link'), 'dir')
    expect((await load(root, configDir)).storybook.name).toBe('web')
  })

  it.runIf(existsSync(import.meta.filename.toUpperCase()))(
    'finds the Storybook by its config folder in another letter case, where that is the same folder',
    async () => {
      const root = createProject({ 'visual-check.config.ts': twoStorybooks, 'apps/web/.storybook/main.ts': '' })

      expect((await load(root, 'Apps/Web/.storybook')).storybook.name).toBe('web')
    },
  )

  it.each([
    [false, 'http://127.0.0.1:6006'],
    [true, 'http://web:6006'],
  ])('gives the config’s URL for the environment when ci is %s', async (ci, configUrl) => {
    const root = createProject({ 'visual-check.config.ts': twoStorybooks })

    expect((await load(root, 'apps/web/.storybook', { ci })).configUrl).toBe(configUrl)
  })

  it('needs no URL for the environment, its own or another Storybook’s', async () => {
    const root = createProject({
      'visual-check.config.ts': `export default { storybooks: {
  web: { url: { ci: 'http://web:6006' }, dir: 'apps/web' },
  docs: { url: { ci: 'http://docs:6006' }, dir: 'apps/docs' },
} }\n`,
    })
    const { storybook, configUrl } = await load(root, 'apps/web/.storybook')

    expect(storybook.url).toBe(ownUrl)
    expect(configUrl).toBeUndefined()
  })
})

describe('loadStorybookConfig and the config file', () => {
  it('takes the config nearest to the config folder', async () => {
    const root = createProject({
      'visual-check.config.ts': twoStorybooks,
      'apps/web/visual-check.config.mts': "export default { storybooks: { ui: { url: 'http://127.0.0.1:6008' } } }\n",
      'apps/web/.storybook/main.ts': '',
    })
    const { config, storybook } = await load(root, 'apps/web/.storybook')

    expect(config.path).toBe(join(root, 'apps/web/visual-check.config.mts'))
    expect(storybook.name).toBe('ui')
  })

  it('finds no config above .git', async () => {
    const root = createProject({ 'visual-check.config.ts': twoStorybooks, 'apps/web/.git': 'gitdir: elsewhere\n' })
    const error = await configErrorOf(load(root, 'apps/web/.storybook'))

    expect(error.message).toBe(
      'No visual-check.config.ts (or .mts, .js, .mjs) found in the current folder or its parents. ' +
        'Run visual-check init to create one.',
    )
    expect(error.configPath).toBeUndefined()
  })

  it.each(['url.ts', 'url.mjs'])('sees an edit to %s, which the config imports', async (name) => {
    const root = createProject({
      [name]: "export const url = 'http://127.0.0.1:6006'\n",
      'visual-check.config.ts': `import { url } from './${name}'\n\nexport default { storybooks: { web: { url } } }\n`,
    })

    expect((await load(root, '.storybook')).configUrl).toBe('http://127.0.0.1:6006')
    writeFileSync(join(root, name), "export const url = 'http://127.0.0.1:6007'\n")
    expect((await load(root, '.storybook')).configUrl).toBe('http://127.0.0.1:6007')
  })

  it('takes a default export that resolves', async () => {
    const root = createProject({
      'visual-check.config.ts':
        "export default Promise.resolve({ storybooks: { web: { url: 'http://127.0.0.1:6006' } } })\n",
    })

    expect((await load(root, '.storybook')).storybook.name).toBe('web')
  })
})

describe('loadStorybookConfig and the baselines folder', () => {
  /**
   * Gives a config of one Storybook in `apps/web` with those baselines, relative to it.
   */
  const configWith = (baselines: string): Record<string, string> => ({
    'visual-check.config.ts': `export default { storybooks: {
  web: { url: 'http://127.0.0.1:6006', dir: 'apps/web', baselines: '${baselines}' },
} }\n`,
  })

  it.each([
    ['.visual-check/snapshots', ''],
    ['.visual-check/diffs', ''],
    ['.visual-check/snapshots/web', 'inside apps/web/.visual-check/snapshots, '],
    ['.visual-check/diffs/a/b', 'inside apps/web/.visual-check/diffs, '],
    ['.visual-check/snapshots/..hidden', 'inside apps/web/.visual-check/snapshots, '],
  ])('fails on baselines in %s, whether or not the folder is there', async (baselines, inside) => {
    const root = createProject(configWith(baselines))
    const message =
      `storybooks.web.baselines is apps/web/${baselines}, ${inside}` +
      'where the Storybook addon writes its own images. Set another folder.'
    const error = await configErrorOf(load(root, 'apps/web/.storybook'))

    expect(error.message).toBe(message)
    expect(error.configPath).toBe(join(root, 'visual-check.config.ts'))

    mkdirSync(join(root, 'apps/web', baselines), { recursive: true })
    expect((await configErrorOf(load(root, 'apps/web/.storybook'))).message).toBe(message)
  })

  it.each(['linked', 'linked/web'])('fails on baselines in %s, a link to snapshots', async (baselines) => {
    const root = createProject({ ...configWith(baselines), 'apps/web/.visual-check/snapshots/a.png': '' })

    symlinkSync(join(root, 'apps/web/.visual-check/snapshots'), join(root, 'apps/web/linked'), 'dir')
    expect((await configErrorOf(load(root, 'apps/web/.storybook'))).message).toBe(
      `storybooks.web.baselines is apps/web/${baselines}, inside apps/web/.visual-check/snapshots, ` +
        'where the Storybook addon writes its own images. Set another folder.',
    )
  })

  it('fails on baselines that snapshots links to', async () => {
    const root = createProject({ ...configWith('baselines'), 'apps/web/baselines/a.png': '' })

    mkdirSync(join(root, 'apps/web/.visual-check'))
    symlinkSync(join(root, 'apps/web/baselines'), join(root, 'apps/web/.visual-check/snapshots'), 'dir')
    await configErrorOf(load(root, 'apps/web/.storybook'))
  })

  it('fails on baselines not there yet, under a link to the Storybook’s folder', async () => {
    const root = createProject({ ...configWith('../link/.visual-check/snapshots/web'), 'apps/web/package.json': '{}' })

    symlinkSync(join(root, 'apps/web'), join(root, 'apps/link'), 'dir')
    await configErrorOf(load(root, 'apps/web/.storybook'))
  })

  it.runIf(existsSync(import.meta.filename.toUpperCase()))(
    'fails on baselines in snapshots in another letter case, where that is the same folder',
    async () => {
      const root = createProject({
        ...configWith('.visual-check/Snapshots/web'),
        'apps/web/.visual-check/Snapshots/web/a.png': '',
      })

      await configErrorOf(load(root, 'apps/web/.storybook'))
    },
  )

  it.each([
    '.visual-check/baselines',
    '.visual-check/snapshots-old',
    '.visual-check',
    '../.visual-check/snapshots',
    'snapshots',
  ])('takes baselines in %s', async (baselines) => {
    const root = createProject(configWith(baselines))

    expect((await load(root, 'apps/web/.storybook')).storybook.baselines).toBe(join(root, 'apps/web', baselines))
  })

  it('leaves the CLI’s own load alone', async () => {
    const root = createProject(configWith('.visual-check/snapshots'))

    expect((await loadConfig({ cwd: root, ci: false })).storybooks).toHaveLength(1)
  })
})

describe('loadStorybookConfig failures', () => {
  it.each([
    ['throws', "throw new Error('No Storybook here')\n"],
    ['can’t be parsed', 'export default {\n'],
    ['imports a missing file', "import './missing.ts'\n\nexport default {}\n"],
    ['holds a function', "export default { storybooks: () => ({ web: { url: 'http://127.0.0.1:6006' } }) }\n"],
    ['is invalid', "export default { storybooks: { web: { url: 'http://127.0.0.1:6006' } }, colour: 'red' }\n"],
  ])('fails with loadConfig’s message on a config that %s', async (_, content) => {
    const root = createProject({ 'visual-check.config.ts': content })
    const error = await configErrorOf(load(root, '.storybook'))

    expect(error.message).toBe((await configErrorOf(loadConfig({ cwd: root, ci: false }))).message)
    expect(error.configPath).toBe(join(root, 'visual-check.config.ts'))
  })

  it('names the config relative to the folder the process runs in', async () => {
    const root = createProject({ 'visual-check.config.ts': "throw new Error('No Storybook here')\n" })
    const { message } = await configErrorOf(load(root, 'apps/web/.storybook', { cwd: join(root, 'apps/web') }))

    expect(message).toBe("Couldn't load ../../visual-check.config.ts: No Storybook here")
  })

  it('stops loading when its signal aborts', async () => {
    const reason = new Error('cancelled')
    const root = createProject({ 'visual-check.config.ts': 'while (true);\n' })
    const controller = new AbortController()
    const loading = load(root, '.storybook', { signal: controller.signal })

    controller.abort(reason)
    await expect(loading).rejects.toBe(reason)
  })

  it('fails when two other Storybooks share baselines', async () => {
    const root = createProject({
      'visual-check.config.ts': `export default { storybooks: {
  web: { url: 'http://127.0.0.1:6006', dir: 'apps/web' },
  docs: { url: 'http://127.0.0.1:6007', dir: 'apps/docs' },
  old: { url: 'http://127.0.0.1:6008', dir: 'apps/docs' },
} }\n`,
    })
    const error = await configErrorOf(load(root, 'apps/web/.storybook'))

    expect(error.message).toBe(
      "visual-check.config.ts can't be used:\n" +
        '  - Storybooks docs and old both keep baselines in apps/docs/.visual-check/baselines. ' +
        'Give each its own dir or baselines.',
    )
    expect(error.configPath).toBe(join(root, 'visual-check.config.ts'))
  })

  it('names the one Storybook the config lists when its config folder is another', async () => {
    const root = createProject({
      'visual-check.config.ts': "export default { storybooks: { web: { url: 'http://127.0.0.1:6006' } } }\n",
    })
    const error = await configErrorOf(load(root, 'apps/ui/.storybook'))

    expect(error.message).toBe(
      'visual-check.config.ts lists no Storybook whose config folder is apps/ui/.storybook. It lists web (.storybook).',
    )
    expect(error.configPath).toBe(join(root, 'visual-check.config.ts'))
  })

  it('names every Storybook the config lists, in config order, when none has that config folder', async () => {
    const root = createProject({ 'visual-check.config.ts': twoStorybooks })

    expect((await configErrorOf(load(root, 'apps/ui/.storybook'))).message).toBe(
      'visual-check.config.ts lists no Storybook whose config folder is apps/ui/.storybook. ' +
        'It lists web (apps/web/.storybook) and docs (apps/docs/.storybook).',
    )
  })
})
