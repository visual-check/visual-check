import { mkdirSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanUpScripts,
  fakeCliCommand,
  installSkill,
  readJsonLines,
  recordedPidsIn,
  runScript,
  unusedPort,
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
  return { FAKE_CLI_CALLS: join(stateDir, 'cli-calls.jsonl'), ...env }
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

  it('passes an exit 2 with unreachable Storybooks through as it is', async () => {
    const install = installSkill({ cli: { command: fakeCliCommand(), cwd: '.' } })
    const storybooks = [{ name: 'web', url: `http://127.0.0.1:${await unusedPort()}` }]

    const result = await runScript(
      install,
      ['test'],
      fakeEnv(install.stateDir, { FAKE_CLI_STORYBOOKS: JSON.stringify(storybooks) }),
    ).exited

    expect(result.stdout.toString()).toBe(
      JSON.stringify({ exitCode: 2, storybooks, error: { message: 'Nothing answers.', storybooks }, call: 1 }),
    )
    expect(result.code).toBe(2)
    expect(readJsonLines(join(install.stateDir, 'cli-calls.jsonl'))).toHaveLength(1)
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
