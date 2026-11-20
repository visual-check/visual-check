// A fake visual-check CLI for the runner script's tests. It records each call, then answers as the env vars a test
// sets say:
//
// - FAKE_CLI_CALLS: the JSON-lines file it appends `{ argv, cwd, pid, keeperPid }` to, and `{ childPid }` for a
//   grandchild. `keeperPid` is `null` unless FAKE_CLI_CHILD is `1`.
// - FAKE_CLI_STORYBOOKS: the Storybooks of the run, `[{ name, url }]`. Those whose index fetch throws are unreachable,
//   and so are the names in FAKE_CLI_UNREACHABLE_FIRST on the first call and FAKE_CLI_UNREACHABLE_SECOND on the
//   second. Any unreachable one makes a run error.
// - FAKE_CLI_CHILD: `1` starts a grandchild that runs until the fake ends it, and records the keeper's pid.
// - FAKE_CLI_RELEASE: a file the fake waits for before it answers.
// - FAKE_CLI_EXIT: the exit code it answers with, 0 when not given.

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * A Storybook of the run, as the report names it.
 *
 * @typedef {object} Storybook
 * @property {string} name The Storybook's config name.
 * @property {string} url The Storybook's URL.
 */

/**
 * The fake's environment.
 */
const environment = process.env

/**
 * The JSON-lines file the fake records its calls in.
 */
const callsPath = environment.FAKE_CLI_CALLS ?? 'fake-cli-calls.jsonl'

/**
 * Which call of the fake this is, from 1.
 */
const call =
  1 +
  (existsSync(callsPath) ? readFileSync(callsPath, 'utf8').split('\n') : []).filter((line) => line.includes('"argv"'))
    .length

/**
 * The pid of the keeper that runs the fake's tree: its parent outside Windows, and its parent's parent, `cmd.exe`'s
 * parent, on Windows.
 *
 * @returns {number | null}
 */
function keeperPidOf() {
  if (process.platform !== 'win32') {
    return process.ppid
  }

  const query = `(Get-CimInstance Win32_Process -Filter "ProcessId=${process.ppid}").ParentProcessId`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', query], { encoding: 'utf8', windowsHide: true })
  const pid = Number(result.stdout.trim())

  return Number.isInteger(pid) && pid > 0 ? pid : null
}

/**
 * The URL of a Storybook's `index.json`. The tests give plain URLs, with no query, hash or credentials.
 *
 * @param {string} url The Storybook's URL.
 * @returns {string}
 */
function indexUrlOf(url) {
  return new URL('index.json', url.endsWith('/') ? url : `${url}/`).href
}

/**
 * The Storybooks of `storybooks` where nothing answers, plus those named unreachable on this call.
 *
 * @param {Storybook[]} storybooks The Storybooks of the run.
 * @returns {Promise<Storybook[]>}
 */
async function unreachableOf(storybooks) {
  const named = { 1: environment.FAKE_CLI_UNREACHABLE_FIRST, 2: environment.FAKE_CLI_UNREACHABLE_SECOND }[call]
  const unreachableNow = (named ?? '').split(',')

  /** @type {Storybook[]} */
  const unreachable = []

  for (const storybook of storybooks) {
    if (unreachableNow.includes(storybook.name)) {
      unreachable.push(storybook)

      continue
    }

    try {
      await fetch(indexUrlOf(storybook.url), { signal: AbortSignal.timeout(2_000) })
    } catch {
      unreachable.push(storybook)
    }
  }

  return unreachable
}

/**
 * Writes `document` on stdout and exits with `code`.
 *
 * @param {Record<string, unknown>} document The report.
 * @param {number} code The exit code.
 */
function answer(document, code) {
  process.stdout.write(JSON.stringify(document), () => {
    process.exit(code)
  })
}

// Only the tests that check a tree stops look for the keeper, since on Windows that takes about a second.
const keeperPid = environment.FAKE_CLI_CHILD === '1' ? keeperPidOf() : null

appendFileSync(
  callsPath,
  `${JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), pid: process.pid, keeperPid })}\n`,
)
process.stderr.write('fake cli on stderr\n')

/** @type {Storybook[]} */
const storybooks = JSON.parse(environment.FAKE_CLI_STORYBOOKS ?? '[]')
const unreachable = await unreachableOf(storybooks)

if (unreachable.length > 0) {
  answer({ exitCode: 2, storybooks, error: { message: 'Nothing answers.', storybooks: unreachable }, call }, 2)
} else {
  const grandchild =
    environment.FAKE_CLI_CHILD === '1'
      ? spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
      : undefined

  if (grandchild !== undefined) {
    appendFileSync(callsPath, `${JSON.stringify({ childPid: grandchild.pid })}\n`)
  }

  process.stderr.write('capturing\n')

  const release = environment.FAKE_CLI_RELEASE

  while (release !== undefined && !existsSync(release)) {
    await sleep(50)
  }

  const code = Number(environment.FAKE_CLI_EXIT ?? '0')

  grandchild?.kill()
  answer(
    { exitCode: code, storybooks, error: code === 2 ? { message: 'Run error.', storybooks: [] } : null, call },
    code,
  )
}
