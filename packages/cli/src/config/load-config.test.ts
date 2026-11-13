import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigError } from './config-error.js'
import { type LoadConfigOptions, loadConfig } from './load-config.js'

/**
 * The projects the tests made, removed after each test.
 */
const projects: string[] = []

/**
 * A URL every Storybook in these tests answers at.
 */
const url = 'http://127.0.0.1:6006'

/**
 * The smallest valid config.
 */
const minimalConfig = `export default { storybooks: { web: { url: '${url}' } } }\n`

/**
 * An expression that reads `'jiti'` in a file jiti ran, which has CommonJS's `require`, and `'node'` in a file Node's
 * own loader ran as an ES module. A config names its Storybook with it, so a test sees who ran the file.
 */
const loaderProbe = "typeof require === 'function' ? 'jiti' : 'node'"

/**
 * A TypeScript helper that uses an `enum`, which Node's own type stripping rejects.
 */
const enumHelper = 'enum Port {\n  Storybook = 6006,\n}\n\nexport const port: number = Port.Storybook\n'

/**
 * A project whose config imports `@app/value`, which only its tsconfig `paths` map to `src/value.ts`.
 */
const tsconfigPathsProject = {
  'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["./src/*"] } } }\n',
  'src/value.ts': `export const value: string = '${url}'\n`,
  'visual-check.config.ts':
    "import { value } from '@app/value'\n\nexport default { storybooks: { web: { url: value } } }\n",
}

/**
 * The `@visual-check/cli` package folder, which holds the built `dist`.
 */
const cliPackage = fileURLToPath(new URL('../../', import.meta.url))

/**
 * Makes a temporary project holding a `.git` folder, which ends the search there, and `files`, each a path relative to
 * the project mapped to its content. Returns the project's real path.
 */
function createProject(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-config-')))
  projects.push(root)
  for (const [path, content] of Object.entries({ '.git/HEAD': 'ref: refs/heads/main\n', ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

/**
 * Loads the config of a local run from `cwd`, unless the options say otherwise.
 */
function load(cwd: string, options: Partial<LoadConfigOptions> = {}) {
  return loadConfig({ cwd, ci: false, ...options })
}

/**
 * Loads a config that must fail and returns its `ConfigError`.
 */
async function configErrorOf(cwd: string, options: Partial<LoadConfigOptions> = {}): Promise<ConfigError> {
  const error = await load(cwd, options).then(
    () => undefined,
    (rejection: unknown) => rejection,
  )
  expect(error).toBeInstanceOf(ConfigError)
  return error as ConfigError
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true })
  }
})

describe('loadConfig loading', () => {
  it.each(['visual-check.config.ts', 'visual-check.config.mts', 'visual-check.config.js', 'visual-check.config.mjs'])(
    'loads and resolves %s',
    async (name) => {
      const root = createProject({ [name]: minimalConfig })
      const resolved = await load(root)
      expect(resolved.path).toBe(join(root, name))
      expect(resolved.storybooks).toMatchObject([{ name: 'web', dir: root, url }])
    },
  )

  it('loads a .ts config that uses an enum', async () => {
    const root = createProject({
      'visual-check.config.ts':
        'enum Port {\n  Storybook = 6006,\n}\n\n' +
        "export default { storybooks: { web: { url: 'http://127.0.0.1:' + Port.Storybook } } }\n",
    })
    expect((await load(root)).storybooks[0]?.url).toBe(url)
  })

  it('loads a TypeScript helper the config imports, reading it afresh on every load', async () => {
    const root = createProject({
      'storybook-url.ts': `export const storybookUrl: string = '${url}'\n`,
      'visual-check.config.ts':
        "import { storybookUrl } from './storybook-url.ts'\n\n" +
        'export default { storybooks: { web: { url: storybookUrl } } }\n',
    })
    expect((await load(root)).storybooks[0]?.url).toBe(url)
    writeFileSync(join(root, 'storybook-url.ts'), "export const storybookUrl: string = 'http://127.0.0.1:6007'\n")
    expect((await load(root)).storybooks[0]?.url).toBe('http://127.0.0.1:6007')
  })

  it('runs an .mjs config through jiti, not Node’s own loader', async () => {
    const root = createProject({
      'visual-check.config.mjs': `export default { storybooks: { [${loaderProbe}]: { url: '${url}' } } }\n`,
    })
    expect((await load(root)).storybooks).toMatchObject([{ name: 'jiti', url }])
  })

  it('loads an .mjs config that imports a TypeScript helper with an enum', async () => {
    const root = createProject({
      'port.ts': enumHelper,
      'visual-check.config.mjs':
        "import { port } from './port.ts'\n\n" +
        "export default { storybooks: { web: { url: 'http://127.0.0.1:' + port } } }\n",
    })
    expect((await load(root)).storybooks[0]?.url).toBe(url)
  })

  it('runs a .js config in a "type": "module" package through jiti, not Node’s own loader', async () => {
    const root = createProject({
      'package.json': '{ "type": "module" }\n',
      'visual-check.config.js': `export default { storybooks: { [${loaderProbe}]: { url: '${url}' } } }\n`,
    })
    expect((await load(root)).storybooks).toMatchObject([{ name: 'jiti', url }])
  })

  it('loads a config that imports defineConfig from @visual-check/cli', async () => {
    const root = createProject({
      'visual-check.config.ts':
        "import { defineConfig } from '@visual-check/cli'\n\n" +
        `export default defineConfig({ storybooks: { web: { url: '${url}' } } })\n`,
    })
    mkdirSync(join(root, 'node_modules/@visual-check'), { recursive: true })
    symlinkSync(cliPackage, join(root, 'node_modules/@visual-check/cli'), 'dir')
    expect((await load(root)).storybooks[0]?.url).toBe(url)
  })

  it('doesn’t resolve tsconfig paths', async () => {
    const root = createProject(tsconfigPathsProject)
    const { message } = await configErrorOf(root)
    expect(message).toMatch(/^Couldn't load visual-check\.config\.ts: /)
    expect(message).toContain("Cannot find module '@app/value'")
  })

  it.each(['visual-check.config.ts', 'visual-check.config.mjs'])('reads %s afresh on every load', async (name) => {
    const root = createProject({ [name]: minimalConfig })
    expect((await load(root)).storybooks[0]?.url).toBe(url)
    writeFileSync(join(root, name), "export default { storybooks: { web: { url: 'http://127.0.0.1:6007' } } }\n")
    expect((await load(root)).storybooks[0]?.url).toBe('http://127.0.0.1:6007')
  })

  it('picks url.ci in CI', async () => {
    const root = createProject({
      'visual-check.config.ts': `export default { storybooks: { web: { url: { local: '${url}', ci: 'http://storybook:6006' } } } }\n`,
    })
    expect((await load(root, { ci: true })).storybooks[0]?.url).toBe('http://storybook:6006')
  })
})

describe('loadConfig with JITI_* environment variables', () => {
  it('doesn’t resolve tsconfig paths when JITI_TSCONFIG_PATHS is true', async () => {
    vi.stubEnv('JITI_TSCONFIG_PATHS', 'true')
    const root = createProject(tsconfigPathsProject)
    const { message } = await configErrorOf(root)
    expect(message).toMatch(/^Couldn't load visual-check\.config\.ts: /)
    expect(message).toContain("Cannot find module '@app/value'")
  })

  it('runs the TypeScript a config imports through jiti when JITI_TRY_NATIVE is true', async () => {
    vi.stubEnv('JITI_TRY_NATIVE', 'true')
    const root = createProject({
      'loader.ts': `export const loader: string = ${loaderProbe}\n`,
      'visual-check.config.ts': `import { loader } from './loader.ts'\n\nexport default { storybooks: { [loader]: { url: '${url}' } } }\n`,
    })
    expect((await load(root)).storybooks).toMatchObject([{ name: 'jiti', url }])
  })
})

describe('loadConfig with --config', () => {
  it('takes the given path over the search', async () => {
    const root = createProject({
      'apps/web/visual-check.config.ts': minimalConfig,
      'configs/custom.ts': "export default { storybooks: { web: { url: 'http://127.0.0.1:6007' } } }\n",
    })
    const resolved = await load(join(root, 'apps/web'), { path: join(root, 'configs/custom.ts') })
    expect(resolved.path).toBe(join(root, 'configs/custom.ts'))
    expect(resolved.storybooks[0]?.url).toBe('http://127.0.0.1:6007')
  })

  it('resolves a relative path against cwd', async () => {
    const root = createProject({ 'apps/web/.keep': '', 'configs/custom.mts': minimalConfig })
    const resolved = await load(join(root, 'apps/web'), { path: '../../configs/custom.mts' })
    expect(resolved.path).toBe(join(root, 'configs/custom.mts'))
    expect(resolved.storybooks[0]?.dir).toBe(join(root, 'configs'))
  })

  it('fails on a path with no file', async () => {
    const root = createProject({})
    expect((await configErrorOf(root, { path: 'configs/missing.ts' })).message).toBe(
      'No config at configs/missing.ts. Check the path given to --config.',
    )
  })

  it('fails on a folder', async () => {
    const root = createProject({ 'visual-check.config.ts/.keep': '' })
    expect((await configErrorOf(root, { path: 'visual-check.config.ts' })).message).toBe(
      'No config at visual-check.config.ts. Check the path given to --config.',
    )
  })

  it.each(['visual-check.config.json', 'visual-check.config.yaml'])('fails on %s', async (name) => {
    const root = createProject({ [name]: '{}\n' })
    expect((await configErrorOf(root, { path: name })).message).toBe(
      `Can't use ${name} as a config: a config is a .ts, .mts, .js or .mjs file, and JSON and YAML aren't supported. ` +
        'Write visual-check.config.ts and pass its path to --config.',
    )
  })

  it('names cwd as the current folder', async () => {
    const root = createProject({})
    expect((await configErrorOf(root, { path: '.' })).message).toBe(
      "Can't use the current folder as a config: a config is a .ts, .mts, .js or .mjs file, and JSON and YAML aren't " +
        'supported. Write visual-check.config.ts and pass its path to --config.',
    )
  })
})

describe('loadConfig failures', () => {
  it('points to visual-check init when no config is found', async () => {
    const root = createProject({ 'apps/web/.keep': '' })
    expect((await configErrorOf(join(root, 'apps/web'))).message).toBe(
      'No visual-check.config.ts (or .mts, .js, .mjs) found in the current folder or its parents. ' +
        'Run visual-check init to create one.',
    )
  })

  it('fails on a config with no default export', async () => {
    const root = createProject({ 'visual-check.config.ts': 'export const config = { storybooks: {} }\n' })
    expect((await configErrorOf(root)).message).toBe(
      'visual-check.config.ts must export a config object: export default defineConfig({ ... }).',
    )
  })

  it('fails on a config that throws, keeping the error as the cause', async () => {
    const root = createProject({ 'visual-check.config.ts': "throw new Error('No Storybook here')\n" })
    const error = await configErrorOf(root)
    expect(error.message).toBe("Couldn't load visual-check.config.ts: No Storybook here")
    expect(error.cause).toBeInstanceOf(Error)
    expect((error.cause as Error).message).toBe('No Storybook here')
  })

  it('fails on a config with a syntax error, naming the config relative to cwd', async () => {
    const root = createProject({ 'visual-check.config.ts': 'export default {\n' })
    const error = await configErrorOf(root)
    expect(error.message).toMatch(/^Couldn't load visual-check\.config\.ts: /)
    expect(error.message).toContain(' visual-check.config.ts:2')
    expect(error.message).not.toContain(root)
    expect((error.cause as Error).message).toContain(join(root, 'visual-check.config.ts'))
  })

  it('fails on a config that imports a missing file', async () => {
    const root = createProject({
      'visual-check.config.ts':
        "import { url } from './missing.ts'\n\nexport default { storybooks: { web: { url } } }\n",
    })
    const { message } = await configErrorOf(root)
    expect(message).toMatch(/^Couldn't load visual-check\.config\.ts: /)
    expect(message).toContain("Cannot find module './missing.ts'")
  })

  it('fails on a default export that rejects, keeping the error as the cause', async () => {
    const root = createProject({ 'visual-check.config.ts': "export default Promise.reject(new Error('boom'))\n" })
    const error = await configErrorOf(root)
    expect(error.message).toBe("Couldn't load visual-check.config.ts: boom")
    expect((error.cause as Error).message).toBe('boom')
  })

  it('loads a default export that resolves', async () => {
    const root = createProject({
      'visual-check.config.ts': `export default Promise.resolve({ storybooks: { web: { url: '${url}' } } })\n`,
    })
    expect((await load(root)).storybooks[0]?.url).toBe(url)
  })

  it('surfaces validation issues, naming the config relative to cwd', async () => {
    const root = createProject({
      'visual-check.config.ts': `export default { storybooks: { web: { url: '${url}' } }, colour: 'red' }\n`,
      'apps/.keep': '',
    })
    const { message } = await configErrorOf(join(root, 'apps'))
    expect(message).toMatch(/^\.\.\/visual-check\.config\.ts is invalid:\n/)
    expect(message).toContain('colour: unknown key.')
  })
})
