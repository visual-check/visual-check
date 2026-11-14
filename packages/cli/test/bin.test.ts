import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const binaryPath = fileURLToPath(new URL('../dist/bin.js', import.meta.url))
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * The projects the tests made, removed after each test.
 */
const projects: string[] = []

/**
 * The servers the tests started, closed after each test.
 */
const servers: Server[] = []

/**
 * How long a spawned binary may run before it is killed, in milliseconds.
 */
const timeout = 4_000

/**
 * What a case gives the binary: the folder it runs in and what it adds to the environment.
 */
interface CaseOptions {
  /**
   * The folder the binary runs in. The test's own folder when not given.
   */
  cwd?: string
  /**
   * What the case adds to the environment. `CI` is stripped from the inherited environment unless it is given here, so
   * a case never inherits `CI=true` from a CI runner.
   */
  env?: Record<string, string>
}

/**
 * Builds the spawn options for a case: the inherited environment without `CI`, plus what the case adds, and the
 * timeout.
 */
function spawnOptionsOf(options: CaseOptions) {
  const environment = { ...process.env, ...options.env }

  if (options.env?.CI === undefined) {
    delete environment.CI
  }

  return { env: environment, timeout, ...(options.cwd === undefined ? {} : { cwd: options.cwd }) }
}

/**
 * Runs the built binary with the given command-line arguments and returns the spawned process's result.
 */
const run = (options: CaseOptions, ...commandLineArguments: string[]) =>
  spawnSync(process.execPath, [binaryPath, ...commandLineArguments], {
    encoding: 'utf8',
    ...spawnOptionsOf(options),
  })

/**
 * Makes a temporary project holding a `.git` folder, which ends the config search there, and `files`, each a path
 * relative to the project mapped to its content. Returns the project's real path.
 */
function createProject(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-bin-')))
  projects.push(root)
  mkdirSync(join(root, '.git'))
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')

  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }

  return root
}

/**
 * Runs the built binary without blocking, so a server in this process can answer it. Resolves with its exit code and
 * the text it wrote.
 */
function runAsynchronously(options: CaseOptions, ...commandLineArguments: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [binaryPath, ...commandLineArguments], spawnOptionsOf(options))
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (status) => {
      resolve({ status, stdout, stderr })
    })
  })
}

/**
 * Starts the server on a free port, to be closed after the test. Returns its URL.
 */
async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/**
 * Takes a port nothing listens on: listens on a free port, reads it and closes that server. Returns the URL it had.
 */
async function takeUnusedUrl(): Promise<string> {
  const server = createServer()
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })

  return url
}

/**
 * Starts a server on a free port that records the URL of every request it gets. Returns its address and the record.
 */
async function startRecordingServer(): Promise<{ url: string; requests: string[] }> {
  const requests: string[] = []
  const url = await listen(
    createServer((request, response) => {
      requests.push(request.url ?? '')
      response.end('{}')
    }),
  )

  return { url, requests }
}

/**
 * Starts a server on a free port that serves a Storybook index with the given entries. Returns its address.
 */
async function startStorybookServer(entries: Record<string, Record<string, unknown>>): Promise<string> {
  return await listen(
    createServer((_request, response) => {
      response.end(JSON.stringify({ v: 5, entries }))
    }),
  )
}

/**
 * Builds an index entry for `button.stories.tsx` with the given ID and the given fields over the story defaults.
 */
function entryOf(id: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: 'Button',
    name: id,
    importPath: './button.stories.tsx',
    type: 'story',
    subtype: 'story',
    ...fields,
  }
}

afterEach(async () => {
  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true })
  }

  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => {
            resolve()
          })
        }),
    ),
  )
})

describe('visual-check binary', () => {
  it('prints the package version for --version', () => {
    const result = run({}, '--version')
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`${version}\n`)
  })

  it('lists init, test and update for --help', () => {
    const result = run({}, '--help')
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/^ {2}init +/m)
    expect(result.stdout).toMatch(/^ {2}test +/m)
    expect(result.stdout).toMatch(/^ {2}update +/m)
  })

  it('exits 2 with the hint for an unknown flag', () => {
    const result = run({}, '--nope')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Run visual-check --help to see the commands and options.')
  })

  it('exits 2 when --all and --filter are given together', () => {
    const result = run({}, 'test', '--all', '--filter', 'x')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("--all and --filter can't be used together")
  })

  it('exits 2 for update when CI is set, before reaching any Storybook', async () => {
    const { url, requests } = await startRecordingServer()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
    })
    const result = await runAsynchronously({ cwd: project, env: { CI: 'true' } }, 'update')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('visual-check update only runs locally, and the CI environment variable is set.')
    expect(requests).toEqual([])
  })

  it('exits 2 for --url with several Storybooks and no --storybook', () => {
    const project = createProject({
      'visual-check.config.mjs':
        "export default { storybooks: { web: { url: 'http://127.0.0.1:6006' }, docs: { url: 'http://127.0.0.1:6007' } } }\n",
    })
    const result = run({ cwd: project }, 'test', '--url', 'http://127.0.0.1:1')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("--url sets one Storybook's URL")
    expect(result.stderr).toContain('--storybook')
  })

  it('exits 2 with the config error for an unknown config key', () => {
    const project = createProject({
      'visual-check.config.mjs': "export default { storybooks: { web: { url: 'http://127.0.0.1:6006' } }, nope: 1 }\n",
    })
    const result = run({ cwd: project }, 'test')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('nope: unknown key')
  })

  it('exits 2 and points to init when no config is found', () => {
    const project = createProject({})
    const result = run({ cwd: project }, 'test')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('No visual-check.config.ts')
    expect(result.stderr).toContain('visual-check init')
  })

  it('exits 2 when a Storybook has no URL for the environment', () => {
    const project = createProject({
      'visual-check.config.mjs':
        "export default { storybooks: { web: { url: { local: 'http://127.0.0.1:6006' } } } }\n",
    })
    const result = run({ cwd: project, env: { CI: 'true' } }, 'test')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Storybook web has no URL for CI')
  })
})

describe('visual-check binary reaching Storybooks', () => {
  it('exits 2 at once for a Storybook that is down, naming it and its URL', async () => {
    const down = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${down}' } } }\n`,
    })
    const started = Date.now()
    const result = await runAsynchronously({ cwd: project }, 'test')
    expect(result.status).toBe(2)
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(result.stderr).toContain(`Storybook web doesn't answer at ${down}/index.json (ECONNREFUSED)`)
    expect(result.stderr).not.toContain('--storybook')
  })

  it('suggests --storybook when one of several Storybooks is down', async () => {
    const url = await startStorybookServer({ a: entryOf('button--primary') })
    const down = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${url}' }, docs: { dir: 'docs', url: '${down}' } } }\n`,
      'web/button.stories.tsx': '',
    })
    const result = await runAsynchronously({ cwd: project }, 'test')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain(`Storybook docs doesn't answer at ${down}/index.json`)
    expect(result.stderr).toContain('To check one Storybook on its own, pass --storybook <name>.')
  })

  it('exits 2 for a stories file the index lists and the disk lacks', async () => {
    const url = await startStorybookServer({ a: entryOf('button--primary') })
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
    })
    const result = await runAsynchronously({ cwd: project }, 'test')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("lists stories files that aren't on disk: button.stories.tsx")
  })

  it('counts stories only, not docs or test entries', async () => {
    const url = await startStorybookServer({
      a: entryOf('button--primary'),
      b: entryOf('button--secondary'),
      c: entryOf('button--primary:test', { subtype: 'test' }),
      d: entryOf('button--docs', { type: 'docs', subtype: undefined }),
    })
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
      'button.stories.tsx': '',
    })
    const result = await runAsynchronously({ cwd: project }, 'test')
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('Storybook web: 2 stories\n')
  })

  it('narrows the count with --filter', async () => {
    const url = await startStorybookServer({ a: entryOf('button--primary'), b: entryOf('button--secondary') })
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
      'button.stories.tsx': '',
    })
    const result = await runAsynchronously({ cwd: project }, 'test', '--filter', 'primary$')
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('Storybook web: 1 story\n')
  })

  it('narrows the run to one Storybook with --storybook, which --url points at a server', async () => {
    const url = await startStorybookServer({ a: entryOf('button--primary') })
    const down = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${down}' }, docs: { dir: 'docs', url: '${down}' } } }\n`,
      'web/button.stories.tsx': '',
    })
    const result = await runAsynchronously({ cwd: project }, 'test', '--storybook', 'web', '--url', url)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('Storybook web: 1 story\n')
  })

  it('exits 2 for a storybook older than 9.1, naming the version, and leaves its index unread', async () => {
    const { url, requests } = await startRecordingServer()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
      'node_modules/storybook/package.json': JSON.stringify({ version: '9.0.0' }),
    })
    const result = await runAsynchronously({ cwd: project }, 'test')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Storybook web runs storybook 9.0.0, and visual-check needs 9.1 or later.')
    expect(result.stderr).toContain('Upgrade storybook in the current folder.')
    expect(requests).toEqual([])
  })

  it('warns once on standard error for a storybook newer than 11 and carries on', async () => {
    const url = await startStorybookServer({ a: entryOf('button--primary') })
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
      'button.stories.tsx': '',
      'node_modules/storybook/package.json': JSON.stringify({ version: '12.0.0' }),
    })
    const result = await runAsynchronously({ cwd: project }, 'test')
    expect(result.status).toBe(0)
    expect(result.stderr).toBe(
      'Warning: Storybook web runs storybook 12.0.0, and visual-check supports 9.1 to 11. The run carries on.\n',
    )
    expect(result.stdout).toBe('Storybook web: 1 story\n')
  })

  it('skips the version check when no storybook is installed', async () => {
    const url = await startStorybookServer({ a: entryOf('button--primary') })
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
      'button.stories.tsx': '',
    })
    const result = await runAsynchronously({ cwd: project }, 'test')
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })
})
