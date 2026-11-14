import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from './run-cli.js'

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string
}

/**
 * The hint every usage error ends with.
 */
const usageHint = 'Run visual-check --help to see the commands and options.\n'

/**
 * The projects the tests made, removed after each test.
 */
const projects: string[] = []

/**
 * Makes a temporary project holding a `.git` folder, which ends the config search there, and `files`, each a path
 * relative to the project mapped to its content. Returns the project's real path.
 */
function createProject(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-run-')))

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
 * The servers the tests started, closed after each test.
 */
const servers: Server[] = []

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
 * Starts a server on a free port that answers every request with an index of the given stories. Returns its URL.
 */
async function startStorybook(storyIds: string[]): Promise<string> {
  const entries = Object.fromEntries(
    storyIds.map((id) => [
      id,
      { id, title: 'Button', name: id, importPath: './button.stories.tsx', type: 'story', subtype: 'story' },
    ]),
  )

  return await listen(
    createServer((_request, response) => {
      response.end(JSON.stringify({ v: 5, entries }))
    }),
  )
}

/**
 * Starts a server on a free port that records the URL of every request it gets. Returns its URL and the record.
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
 * Closes every server the tests started.
 */
async function closeServers(): Promise<void> {
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
}

afterEach(async () => {
  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true })
  }

  await closeServers()
})

describe('runCli', () => {
  it('prints the package version for --version', async () => {
    expect(await runCli(['--version'], {}, process.cwd())).toEqual({ exitCode: 0, stdout: `${version}\n`, stderr: '' })
  })

  it('prints the help text for --help', async () => {
    expect(await runCli(['--help'], {}, process.cwd())).toEqual({
      exitCode: 0,
      stdout: `Usage: visual-check <command> [options]

Commands:
  init     Set up visual-check in this project
  test     Capture snapshots and compare them with baselines
  update   Write missing and failing baselines and delete orphans (local only)

Options for test and update:
  --all               Cover every story
  --filter <regex>    Cover every story whose ID matches
  --storybook <name>  Cover only this Storybook
  --url <url>         Use this URL for the Storybook (with several Storybooks, needs --storybook)
  --config <path>     Use this config instead of searching for one

Other options:
  --help     Show this help
  --version  Show the version
`,
      stderr: '',
    })
  })

  it('exits 2 with a hint when no command is given', async () => {
    expect(await runCli([], {}, process.cwd())).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: `No command given.\n${usageHint}`,
    })
  })

  it('exits 2 with the parse error and the hint for an unknown flag', async () => {
    const result = await runCli(['--nope'], {}, process.cwd())

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain("Unknown option '--nope'")
    expect(result.stderr.endsWith(`\n${usageHint}`)).toBe(true)
  })

  it('exits 2 for init, which is not available yet', async () => {
    expect(await runCli(['init'], {}, process.cwd())).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: "visual-check init isn't available yet. Write visual-check.config.ts by hand for now.\n",
    })
  })

  it('exits 2 for update in CI before looking at the config', async () => {
    const project = createProject({})

    expect(await runCli(['update'], { CI: 'true' }, project)).toEqual({
      exitCode: 2,
      stdout: '',
      stderr:
        'visual-check update only runs locally, and the CI environment variable is set. ' +
        'Run it on your machine and commit the baselines, or unset CI.\n',
    })
  })

  it('prints the story count of the Storybook for test', async () => {
    const url = await startStorybook(['button--primary', 'button--secondary'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
      'button.stories.tsx': '',
    })

    expect(await runCli(['test'], {}, project)).toEqual({
      exitCode: 0,
      stdout: 'Storybook web: 2 stories\n',
      stderr: '',
    })
  })

  it('says 1 story for a single story, and counts only the stories --filter matches', async () => {
    const url = await startStorybook(['button--primary', 'button--secondary'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
      'button.stories.tsx': '',
    })

    expect((await runCli(['update', '--filter', 'secondary$'], {}, project)).stdout).toBe('Storybook web: 1 story\n')
    expect((await runCli(['test', '--all'], {}, project)).stdout).toBe('Storybook web: 2 stories\n')
  })

  it('prints one count line per Storybook in the run', async () => {
    const web = await startStorybook(['a', 'b', 'c'])
    const docs = await startStorybook(['d'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${docs}' } } }\n`,
      'web/button.stories.tsx': '',
      'docs/button.stories.tsx': '',
    })

    expect((await runCli(['test'], {}, project)).stdout).toBe('Storybook web: 3 stories\nStorybook docs: 1 story\n')
  })

  it('suggests --storybook when one of several Storybooks is down', async () => {
    const web = await startStorybook(['a'])
    const down = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${down}' } } }\n`,
      'web/button.stories.tsx': '',
      'docs/button.stories.tsx': '',
    })
    const result = await runCli(['test'], {}, project)

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(`Storybook docs doesn't answer at ${down}/index.json`)
    expect(result.stderr).not.toContain('Storybook web')
    expect(result.stderr.endsWith('To check one Storybook on its own, pass --storybook <name>.\n')).toBe(true)
  })

  it('prints the warnings of Storybooks newer than 11 in config order, and carries on', async () => {
    const web = await startStorybook(['a'])
    const docs = await startStorybook(['b'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${docs}' } } }\n`,
      'web/button.stories.tsx': '',
      'docs/button.stories.tsx': '',
      'web/node_modules/storybook/package.json': JSON.stringify({ version: '12.1.0' }),
      'docs/node_modules/storybook/package.json': JSON.stringify({ version: '13.0.0' }),
    })
    const result = await runCli(['test'], {}, project)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe(
      'Warning: Storybook web runs storybook 12.1.0, and visual-check supports 9.1 to 11. The run carries on.\n' +
        'Warning: Storybook docs runs storybook 13.0.0, and visual-check supports 9.1 to 11. The run carries on.\n',
    )
  })

  it('prints a warning before the problems of the same run', async () => {
    const down = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${down}' } } }\n`,
      'node_modules/storybook/package.json': JSON.stringify({ version: '12.0.0' }),
    })
    const result = await runCli(['test'], {}, project)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/^Warning: Storybook web runs storybook 12\.0\.0.*\nStorybook web doesn't answer at /)
  })

  it('fails a Storybook older than 9.1 without reaching its index', async () => {
    const { url, requests } = await startRecordingServer()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${url}' } } }\n`,
      'node_modules/storybook/package.json': JSON.stringify({ version: '9.0.0' }),
    })
    const result = await runCli(['test'], {}, project)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Storybook web runs storybook 9.0.0, and visual-check needs 9.1 or later.')
    expect(requests).toEqual([])
  })

  it('reports every Storybook that is down, in config order', async () => {
    const first = await takeUnusedUrl()
    const second = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${first}' }, docs: { dir: 'docs', url: '${second}' } } }\n`,
    })
    const result = await runCli(['test'], {}, project)

    expect(result.stderr.indexOf('Storybook web doesn')).toBeGreaterThanOrEqual(0)
    expect(result.stderr.indexOf('Storybook web doesn')).toBeLessThan(result.stderr.indexOf('Storybook docs doesn'))
  })

  it('does not suggest --storybook for problems that are not an unreachable Storybook', async () => {
    const failing = await listen(
      createServer((_request, response) => {
        response.statusCode = 500
        response.end('boom')
      }),
    )
    const web = await startStorybook(['a'])
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { dir: 'web', url: '${web}' }, docs: { dir: 'docs', url: '${failing}' } } }\n`,
      'docs/button.stories.tsx': '',
    })
    const result = await runCli(['test'], {}, project)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("Storybook docs's index.json failed")
    expect(result.stderr).toContain("Storybook web's index.json lists stories files that aren't on disk")
    expect(result.stderr).not.toContain('--storybook')
    expect(result.stderr.indexOf("Storybook web's")).toBeLessThan(result.stderr.indexOf("Storybook docs's"))
  })

  it('does not suggest --storybook when the only Storybook is down', async () => {
    const down = await takeUnusedUrl()
    const project = createProject({
      'visual-check.config.mjs': `export default { storybooks: { web: { url: '${down}' } } }\n`,
    })
    const result = await runCli(['test'], {}, project)

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("Storybook web doesn't answer")
    expect(result.stderr).not.toContain('--storybook')
  })

  it('exits 2 with the config error for a broken config', async () => {
    const project = createProject({
      'visual-check.config.mjs': "export default { storybooks: { web: { url: 'http://127.0.0.1:6006' } }, nope: 1 }\n",
    })
    const result = await runCli(['test'], {}, project)

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('nope')
    expect(result.stderr.endsWith('\n')).toBe(true)
  })

  it('hands --storybook, --url and --config to the config', async () => {
    const url = await startStorybook(['a'])
    const project = createProject({
      'other.config.mjs':
        "export default { storybooks: { web: { dir: 'web', url: { local: 'http://127.0.0.1:6008' } }, docs: { dir: 'docs', url: { local: 'http://127.0.0.1:6007' } } } }\n",
      'web/button.stories.tsx': '',
    })

    expect(
      await runCli(
        ['test', '--config', 'other.config.mjs', '--storybook', 'web', '--url', url],
        { CI: 'true' },
        project,
      ),
    ).toEqual({ exitCode: 0, stdout: 'Storybook web: 1 story\n', stderr: '' })
  })
})
