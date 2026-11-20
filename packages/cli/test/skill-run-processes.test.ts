import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanUpScripts,
  fakeCliCommand,
  fakeStorybookCommand,
  installSkill,
  npmStorybookPackage,
  readJsonLines,
  recordedPidsIn,
  runScript,
  serveIndex,
  unusedPort,
  urlOf,
  waitUntilGone,
} from './skill-run.fixture.js'

vi.setConfig({ testTimeout: 60_000 })
afterEach(cleanUpScripts)

/**
 * Whether the tests run on Windows, where a signal can't be sent to the script.
 */
const windows = process.platform === 'win32'

/**
 * The env vars that point the fake CLI at the install's calls file, plus `env`.
 */
function fakeEnv(stateDir: string, env: Record<string, string> = {}): Record<string, string> {
  return {
    FAKE_CLI_CALLS: join(stateDir, 'cli-calls.jsonl'),
    FAKE_STORYBOOK_STARTS: join(stateDir, 'storybook-starts.jsonl'),
    ...env,
  }
}

/**
 * The records of the fake Storybooks' starts in the install's state folder.
 */
function storybookStarts(stateDir: string): Record<string, unknown>[] {
  return readJsonLines(join(stateDir, 'storybook-starts.jsonl'))
}

/**
 * The records of the fake CLI's calls in the install's state folder, without its grandchildren's.
 */
function cliCalls(stateDir: string): Record<string, unknown>[] {
  return readJsonLines(join(stateDir, 'cli-calls.jsonl')).filter((record) => 'argv' in record)
}

/**
 * The pids the fake CLI and the fake Storybooks recorded in the install's state folder.
 */
function recordedPids(stateDir: string): number[] {
  return [
    ...recordedPidsIn(join(stateDir, 'cli-calls.jsonl')),
    ...recordedPidsIn(join(stateDir, 'storybook-starts.jsonl')),
  ]
}

/**
 * Waits until a fake Storybook has recorded its start in the install's state folder.
 */
async function waitForStorybookStart(stateDir: string): Promise<void> {
  const deadline = Date.now() + 15_000

  while (storybookStarts(stateDir).length === 0) {
    if (Date.now() >= deadline) {
      throw new Error('No fake Storybook started within 15 s.')
    }

    await sleep(50)
  }
}

/**
 * Whether a Storybook index answers at `url`.
 */
async function answers(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/index.json`, { signal: AbortSignal.timeout(2_000) })

    await response.body?.cancel()

    return response.ok
  } catch {
    return false
  }
}

/**
 * Expects `text` to hold each of `parts`, in that order.
 */
function expectInOrder(text: string, parts: string[]): void {
  let from = 0

  for (const part of parts) {
    const index = text.indexOf(part, from)

    expect(index, `${JSON.stringify(part)} after position ${from} of:\n${text}`).toBeGreaterThanOrEqual(0)
    from = index + part.length
  }
}

/**
 * The fake CLI's report for its call `call` of a run whose Storybooks are `storybooks`, `unreachable` making it a run
 * error.
 */
function documentOf(call: number, exitCode: number, storybooks: { name: string; url: string }[], unreachable = false) {
  const error = unreachable ? { message: 'Nothing answers.', storybooks } : null

  return JSON.stringify({ exitCode, storybooks, error, call })
}

describe('the runner script', () => {
  it("runs the CLI from setup.json in its folder with the caller's arguments, then --reporter json", async () => {
    const install = installSkill({ cli: { command: fakeCliCommand(), cwd: '../work' } })
    const args = ['test', '--filter', '^(a|b)&<c> d$', '--base', 'HEAD~1']

    mkdirSync(join(install.folder, 'work'))

    const result = await runScript(install, args, fakeEnv(install.stateDir)).exited
    const [call] = readJsonLines(join(install.stateDir, 'cli-calls.jsonl'))

    expect(result.code).toBe(0)
    expect(call?.argv).toEqual([...args, '--reporter', 'json'])
    expect(realpathSync(String(call?.cwd))).toBe(realpathSync(join(install.folder, 'work')))
  })

  it.each([
    [0, null],
    [1, null],
    [2, { message: 'Run error.', storybooks: [] }],
  ])("prints the CLI's stdout unchanged, passes its stderr through and exits %s with it", async (code, error) => {
    const install = installSkill({ cli: { command: fakeCliCommand(), cwd: '.' } })

    const result = await runScript(install, ['test'], fakeEnv(install.stateDir, { FAKE_CLI_EXIT: String(code) })).exited

    expect(result.stdout.toString()).toBe(JSON.stringify({ exitCode: code, storybooks: [], error, call: 1 }))
    expect(result.stderr).toContain('fake cli on stderr')
    expect(result.code).toBe(code)
  })

  it.each([
    ['is missing', undefined, "it doesn't exist"],
    ["isn't JSON", '{ "cli": ', "it isn't valid JSON"],
    ['has no CLI command', '{ "storybooks": {} }', 'cli.command must be a list of words'],
  ])('exits 2 naming setup.json when it %s, and never runs the CLI', async (_case, text, reason) => {
    const install = installSkill(text ?? '{}')

    if (text === undefined) {
      rmSync(join(install.folder, 'skill', 'setup.json'))
    }

    const result = await runScript(install, ['test'], fakeEnv(install.stateDir)).exited

    expect(result.code).toBe(2)
    expect(result.stdout).toHaveLength(0)
    expect(result.stderr).toContain(`Can't read the skill's setup.json at skill/setup.json: ${reason}`)
    expect(result.stderr).toContain('Run visual-check init again to write it.')
    expect(readJsonLines(join(install.stateDir, 'cli-calls.jsonl'))).toEqual([])
  })

  it("exits 2 naming the folder when the CLI's folder is missing", async () => {
    const install = installSkill({ cli: { command: fakeCliCommand(), cwd: '../missing' } })

    const result = await runScript(install, ['test'], fakeEnv(install.stateDir)).exited

    expect(result.code).toBe(2)
    expect(result.stdout).toHaveLength(0)
    expect(result.stderr).toContain(
      `Couldn't run ${fakeCliCommand().join(' ')} test --reporter json in ${join(realpathSync(install.folder), 'missing')}`,
    )
    expect(result.stderr).toContain("the folder doesn't exist")
  })

  // On Windows the command runs through cmd.exe, which reports a missing program itself and exits 1.
  it.skipIf(windows)('exits 2 naming the command when the CLI program is missing', async () => {
    const install = installSkill({ cli: { command: ['visual-check-missing-program'], cwd: '.' } })

    const result = await runScript(install, ['test'], fakeEnv(install.stateDir)).exited

    expect(result.code).toBe(2)
    expect(result.stdout).toHaveLength(0)
    expect(result.stderr).toContain("Couldn't run visual-check-missing-program test --reporter json in ")
  })

  it.skipIf(windows)("stops the CLI's process tree on SIGINT and exits 130", async () => {
    const install = installSkill({ cli: { command: fakeCliCommand(), cwd: '.' } })
    const script = runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, { FAKE_CLI_CHILD: '1', FAKE_CLI_RELEASE: join(install.stateDir, 'release') }),
    )

    await script.waitForStderr('capturing', 15_000)
    script.child.kill('SIGINT')

    const result = await script.exited
    const pids = recordedPidsIn(join(install.stateDir, 'cli-calls.jsonl'))

    expect(result.code).toBe(130)
    // The fake CLI, its keeper and its grandchild.
    expect(pids).toHaveLength(3)
    expect(await waitUntilGone(pids, 10_000)).toEqual([])
  })

  it("stops the CLI's process tree when the script itself is killed", async () => {
    const install = installSkill({ cli: { command: fakeCliCommand(), cwd: '.' } })
    const script = runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, { FAKE_CLI_CHILD: '1', FAKE_CLI_RELEASE: join(install.stateDir, 'release') }),
    )

    await script.waitForStderr('capturing', 15_000)
    // TerminateProcess on Windows, which no handler of the script can catch.
    script.child.kill(windows ? undefined : 'SIGKILL')

    const pids = recordedPidsIn(join(install.stateDir, 'cli-calls.jsonl'))

    // The fake CLI, its keeper and its grandchild.
    expect(pids).toHaveLength(3)
    expect(await waitUntilGone(pids, 10_000)).toEqual([])
  })

  it.runIf(windows)('exits 2 for an argument holding a double quote, naming it, and never runs the CLI', async () => {
    const install = installSkill({ cli: { command: fakeCliCommand(), cwd: '.' } })

    const result = await runScript(install, ['test', '--filter', 'say "hi"'], fakeEnv(install.stateDir)).exited

    expect(result.code).toBe(2)
    expect(result.stdout).toHaveLength(0)
    expect(result.stderr).toContain(
      `On Windows the script can't pass an argument that holds a double quote, a line break or a %name%: say "hi"`,
    )
    expect(readJsonLines(join(install.stateDir, 'cli-calls.jsonl'))).toEqual([])
  })
})

describe('the runner script with fake Storybooks', () => {
  it('starts a Storybook the run needs, runs the CLI again, and stops it', async () => {
    const port = await unusedPort()
    const storybooks = [{ name: 'docs', url: urlOf(port) }]
    const install = installSkill({
      cli: { command: fakeCliCommand(), cwd: '.' },
      storybooks: { docs: { command: fakeStorybookCommand('docs', port), cwd: '.' } },
    })

    const result = await runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, { FAKE_CLI_STORYBOOKS: JSON.stringify(storybooks), FAKE_CLI_EXIT: '1' }),
    ).exited
    const [start] = storybookStarts(install.stateDir)

    expectInOrder(result.stderr, [
      'Starting Storybook docs in skill: ',
      `Storybook docs answers at ${urlOf(port)} after `,
      'capturing',
      'Stopped Storybook docs.',
    ])
    expect(result.stderr).not.toContain('Reused')
    expect(start?.argv).toEqual(['-p', String(port), '--name', 'docs', '--ci', '--exact-port'])
    expect(result.stdout.toString()).toBe(documentOf(2, 1, storybooks))
    expect(result.code).toBe(1)
    expect(await answers(urlOf(port))).toBe(false)
    expect(await waitUntilGone(recordedPids(install.stateDir), 10_000)).toEqual([])
  })

  it('starts only the Storybooks the run needs', async () => {
    const port = await unusedPort()
    const install = installSkill({
      cli: { command: fakeCliCommand(), cwd: '.' },
      storybooks: {
        web: { command: fakeStorybookCommand('web', 0), cwd: '.' },
        docs: { command: fakeStorybookCommand('docs', port), cwd: '.' },
      },
    })

    const result = await runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, { FAKE_CLI_STORYBOOKS: JSON.stringify([{ name: 'docs', url: urlOf(port) }]) }),
    ).exited

    expect(result.code).toBe(0)
    expect(result.stderr).not.toContain('Starting Storybook web')
    expect(storybookStarts(install.stateDir).filter((record) => 'argv' in record)).toEqual([
      expect.objectContaining({ name: 'docs' }),
    ])
  })

  it('starts a Storybook through npm with the flags after --, and stops its whole tree', async () => {
    const port = await unusedPort()
    const install = installSkill({
      cli: { command: fakeCliCommand(), cwd: '.' },
      storybooks: { docs: npmStorybookPackage('docs', port) },
    })

    const result = await runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, { FAKE_CLI_STORYBOOKS: JSON.stringify([{ name: 'docs', url: urlOf(port) }]) }),
    ).exited
    const [start] = storybookStarts(install.stateDir)

    expect(result.code).toBe(0)
    expect(result.stderr).toContain('Starting Storybook docs in ')
    expect(result.stderr).toContain(': npm run storybook -- --ci --exact-port')
    expect(start?.argv).toEqual(['-p', String(port), '--name', 'docs', '--ci', '--exact-port'])
    expect(await answers(urlOf(port))).toBe(false)
    expect(await waitUntilGone(recordedPids(install.stateDir), 10_000)).toEqual([])
  })

  it('reuses a Storybook that already runs, and leaves it running', async () => {
    const server = await serveIndex()
    const install = installSkill({
      cli: { command: fakeCliCommand(), cwd: '.' },
      storybooks: { web: { command: fakeStorybookCommand('web', server.port, ['--fail']), cwd: '.' } },
    })

    const result = await runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, { FAKE_CLI_STORYBOOKS: JSON.stringify([{ name: 'web', url: server.url }]) }),
    ).exited

    expect(result.code).toBe(0)
    expect(result.stderr).not.toContain('Starting Storybook')
    expect(result.stderr.trimEnd()).toMatch(
      new RegExp(`Reused Storybook web, which was already running at ${server.url}\\.$`),
    )
    expect(await answers(server.url)).toBe(true)
  })

  it('reuses a Storybook that something else started on the port first', async () => {
    const server = await serveIndex()
    const install = installSkill({
      cli: { command: fakeCliCommand(), cwd: '.' },
      storybooks: { web: { command: fakeStorybookCommand('web', server.port), cwd: '.' } },
    })

    const release = join(install.stateDir, 'release')
    const script = runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, {
        FAKE_CLI_STORYBOOKS: JSON.stringify([{ name: 'web', url: server.url }]),
        FAKE_CLI_UNREACHABLE_FIRST: 'web',
        FAKE_CLI_RELEASE: release,
      }),
    )

    // The server answers before the fake Storybook gets to the port, so the start looks `started`, and only the stop
    // tells the fake's tree ended by itself (on EADDRINUSE). The second run ends once that tree is gone, which a run of
    // a real CLI, longer than a Storybook's start, allows for, but a fake CLI's quick one doesn't under load.
    await script.waitForStderr('capturing', 15_000)
    await waitForStorybookStart(install.stateDir)

    const [start] = storybookStarts(install.stateDir)

    expect(await waitUntilGone([start?.pid, start?.parentPid].map(Number), 15_000)).toEqual([])
    writeFileSync(release, '')

    const result = await script.exited

    expect(result.code).toBe(0)
    expect(result.stderr).toContain('Starting Storybook web')
    expect(result.stderr).toContain(`Reused Storybook web, which was already running at ${server.url}.`)
    expect(result.stderr).not.toContain('Stopped Storybook web.')
    expect(cliCalls(install.stateDir)).toHaveLength(2)
    expect(await answers(server.url)).toBe(true)
  })

  it('exits 2 at once, naming both ports, when a Storybook starts on another port than its URL', async () => {
    // A port nothing listens on, so the CLI finds the Storybook unreachable. The fake starts on a port the system picks.
    const url = urlOf(await unusedPort())
    const storybooks = [{ name: 'docs', url }]
    const install = installSkill({
      cli: { command: fakeCliCommand(), cwd: '.' },
      storybooks: { docs: { command: fakeStorybookCommand('docs', 0), cwd: '.' } },
    })
    const startedAt = Date.now()

    const result = await runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, { FAKE_CLI_STORYBOOKS: JSON.stringify(storybooks) }),
    ).exited
    const startedPort = storybookStarts(install.stateDir).find((record) => 'port' in record)?.port

    expect(Date.now() - startedAt).toBeLessThan(20_000)
    expect(result.code).toBe(2)
    expectInOrder(result.stderr, [
      `Storybook docs started on port ${startedPort}, but its URL ${url} is on port ${new URL(url).port}.`,
      'Stopped Storybook docs.',
    ])
    expect(result.stdout.toString()).toBe(documentOf(1, 2, storybooks, true))
    expect(cliCalls(install.stateDir)).toHaveLength(1)
    expect(await waitUntilGone(recordedPids(install.stateDir), 10_000)).toEqual([])
  })

  it('exits 2 with the end of its output when a Storybook exits before it answers', async () => {
    const url = urlOf(await unusedPort())
    const install = installSkill({
      cli: { command: fakeCliCommand(), cwd: '.' },
      storybooks: { docs: { command: fakeStorybookCommand('docs', 0, ['--fail']), cwd: '.' } },
    })

    const result = await runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, { FAKE_CLI_STORYBOOKS: JSON.stringify([{ name: 'docs', url }]) }),
    ).exited

    expect(result.code).toBe(2)
    expect(result.stderr).toContain(
      `Storybook docs exited with code 1 before it answered at ${url}/index.json. The end of its output:\n  line 16\n`,
    )
    expect(result.stderr).toContain('  line 30\n')
    expect(result.stderr).not.toContain('  line 15\n')
    expect(result.stderr).not.toContain('Stopped Storybook docs.')
    expect(cliCalls(install.stateDir)).toHaveLength(1)
  })

  it('exits 2 without waiting for a process a failed Storybook left behind holding its output', async () => {
    const url = urlOf(await unusedPort())
    const install = installSkill({
      cli: { command: fakeCliCommand(), cwd: '.' },
      storybooks: { docs: { command: fakeStorybookCommand('docs', 0, ['--fail', '--orphan']), cwd: '.' } },
    })
    const startedAt = Date.now()

    const result = await runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, { FAKE_CLI_STORYBOOKS: JSON.stringify([{ name: 'docs', url }]) }),
    ).exited

    expect(Date.now() - startedAt).toBeLessThan(20_000)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(`Storybook docs exited with code 1 before it answered at ${url}/index.json.`)
    expect(result.stderr).toContain('  line 30\n')
  })

  it('stops the other starts when one Storybook fails to start', async () => {
    const webPort = await unusedPort()
    const storybooks = [
      { name: 'web', url: urlOf(webPort) },
      { name: 'docs', url: urlOf(await unusedPort()) },
    ]
    const install = installSkill({
      cli: { command: fakeCliCommand(), cwd: '.' },
      storybooks: {
        web: { command: fakeStorybookCommand('web', webPort, ['--wait', '30000']), cwd: '.' },
        docs: { command: fakeStorybookCommand('docs', 0, ['--fail']), cwd: '.' },
      },
    })
    const startedAt = Date.now()

    const result = await runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, { FAKE_CLI_STORYBOOKS: JSON.stringify(storybooks) }),
    ).exited

    expect(Date.now() - startedAt).toBeLessThan(20_000)
    expect(result.code).toBe(2)
    expectInOrder(result.stderr, ['Storybook docs exited with code 1 before it answered', 'Stopped Storybook web.'])
    expect(result.stderr).not.toContain('Storybook web answers at')
    expect(result.stderr).not.toContain('Stopped Storybook docs.')
    expect(cliCalls(install.stateDir)).toHaveLength(1)
    expect(await waitUntilGone(recordedPids(install.stateDir), 10_000)).toEqual([])
  })

  it.skipIf(windows)('stops a Storybook it waits for on SIGINT, and exits 130', async () => {
    const port = await unusedPort()
    const install = installSkill({
      cli: { command: fakeCliCommand(), cwd: '.' },
      storybooks: { docs: { command: fakeStorybookCommand('docs', port, ['--wait', '30000']), cwd: '.' } },
    })
    const script = runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, { FAKE_CLI_STORYBOOKS: JSON.stringify([{ name: 'docs', url: urlOf(port) }]) }),
    )

    await script.waitForStderr('Starting Storybook docs', 15_000)
    await waitForStorybookStart(install.stateDir)
    script.child.kill('SIGINT')

    const result = await script.exited

    expect(result.code).toBe(130)
    expect(result.stderr).toContain('Stopped Storybook docs.')
    expect(cliCalls(install.stateDir)).toHaveLength(1)
    expect(await waitUntilGone(recordedPids(install.stateDir), 10_000)).toEqual([])
  })

  it('exits 2 when setup.json has no start command for a Storybook the run needs', async () => {
    const storybooks = [{ name: 'docs', url: urlOf(await unusedPort()) }]
    const install = installSkill({ cli: { command: fakeCliCommand(), cwd: '.' } })

    const result = await runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, { FAKE_CLI_STORYBOOKS: JSON.stringify(storybooks) }),
    ).exited

    expect(result.code).toBe(2)
    expect(result.stderr).toContain(
      'setup.json has no start command for Storybook docs. Run visual-check init again to refresh it.',
    )
    expect(result.stdout.toString()).toBe(documentOf(1, 2, storybooks, true))
    expect(storybookStarts(install.stateDir)).toEqual([])
  })

  it('exits 2 when the second run finds a Storybook it just started unreachable', async () => {
    const port = await unusedPort()
    const storybooks = [{ name: 'docs', url: urlOf(port) }]
    const install = installSkill({
      cli: { command: fakeCliCommand(), cwd: '.' },
      storybooks: { docs: { command: fakeStorybookCommand('docs', port), cwd: '.' } },
    })

    const result = await runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, {
        FAKE_CLI_STORYBOOKS: JSON.stringify(storybooks),
        FAKE_CLI_UNREACHABLE_SECOND: 'docs',
      }),
    ).exited

    expect(result.code).toBe(2)
    expectInOrder(result.stderr, [
      `Storybook docs answers at ${urlOf(port)} after `,
      `Storybook docs stopped answering at ${urlOf(port)} during the run, so the run's results can't be trusted.`,
      'Stopped Storybook docs.',
    ])
    expect(result.stdout.toString()).toBe(documentOf(2, 2, storybooks, true))
    expect(await waitUntilGone(recordedPids(install.stateDir), 10_000)).toEqual([])
  })

  it('exits 2 naming the fault when the script itself fails, and stops what it started', async () => {
    // The CLI names a Storybook with a URL that doesn't parse, which the script doesn't expect.
    const storybooks = [{ name: 'docs', url: 'not a url' }]
    const install = installSkill({
      cli: { command: fakeCliCommand(), cwd: '.' },
      storybooks: { docs: { command: fakeStorybookCommand('docs', 0), cwd: '.' } },
    })

    const result = await runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, { FAKE_CLI_STORYBOOKS: JSON.stringify(storybooks) }),
    ).exited

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('The runner script failed: TypeError: Invalid URL')
    expect(result.stdout).toHaveLength(0)
    expect(await waitUntilGone(recordedPids(install.stateDir), 10_000)).toEqual([])
  })

  it('exits 2 when a Storybook stops answering during the run', async () => {
    const server = await serveIndex()
    const storybooks = [{ name: 'web', url: server.url }]
    const install = installSkill({ cli: { command: fakeCliCommand(), cwd: '.' } })
    const release = join(install.stateDir, 'release')
    const script = runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, {
        FAKE_CLI_STORYBOOKS: JSON.stringify(storybooks),
        FAKE_CLI_RELEASE: release,
        FAKE_CLI_EXIT: '1',
      }),
    )

    await script.waitForStderr('capturing', 15_000)
    await server.close()
    writeFileSync(release, '')

    const result = await script.exited

    expect(result.code).toBe(2)
    expect(result.stderr).toContain(
      `Storybook web stopped answering at ${server.url} during the run, so the run's results can't be trusted.`,
    )
    expect(result.stderr).not.toContain('Reused')
    expect(result.stdout.toString()).toBe(documentOf(1, 1, storybooks))
  })

  /**
   * Starts the script with one fake Storybook to start and a fake CLI that captures until the test ends it, and waits
   * until the CLI captures after the start.
   */
  async function startCapturingRun() {
    const port = await unusedPort()
    const install = installSkill({
      cli: { command: fakeCliCommand(), cwd: '.' },
      storybooks: { docs: { command: fakeStorybookCommand('docs', port), cwd: '.' } },
    })
    const script = runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, {
        FAKE_CLI_STORYBOOKS: JSON.stringify([{ name: 'docs', url: urlOf(port) }]),
        FAKE_CLI_CHILD: '1',
        FAKE_CLI_RELEASE: join(install.stateDir, 'release'),
      }),
    )

    await script.waitForStderr('capturing', 30_000)

    return { install, script, url: urlOf(port) }
  }

  it.skipIf(windows)('stops the Storybook and the CLI it started on SIGINT, and exits 130', async () => {
    const { install, script, url } = await startCapturingRun()

    script.child.kill('SIGINT')

    const result = await script.exited
    const pids = recordedPids(install.stateDir)

    expect(result.code).toBe(130)
    expect(result.stderr).toContain('Stopped Storybook docs.')
    // Each call's fake CLI and keeper, the second's grandchild, and the fake Storybook and its grandchild.
    expect(pids).toHaveLength(7)
    expect(await waitUntilGone(pids, 10_000)).toEqual([])
    expect(await answers(url)).toBe(false)
  })

  it('stops the Storybook and the CLI it started when the script itself is killed', async () => {
    const { install, script, url } = await startCapturingRun()

    // TerminateProcess on Windows, which no handler of the script can catch.
    script.child.kill(windows ? undefined : 'SIGKILL')

    const pids = recordedPids(install.stateDir)

    expect(pids).toHaveLength(7)
    expect(await waitUntilGone(pids, 10_000)).toEqual([])
    expect(await answers(url)).toBe(false)
  })
})
