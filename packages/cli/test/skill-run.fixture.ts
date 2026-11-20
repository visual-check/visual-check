import { type ChildProcess, spawn } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

/**
 * A command in a skill's `setup.json`: its words, the program first, and its folder.
 */
interface SetupCommand {
  /**
   * The command's words, the program first.
   */
  command: string[]
  /**
   * The folder the command runs in, relative to `setup.json`'s folder or absolute.
   */
  cwd: string
}

/**
 * What a test writes into a skill's `setup.json`.
 */
interface SetupFile {
  /**
   * The command that runs the CLI.
   */
  cli: SetupCommand
  /**
   * Each Storybook's start command, keyed by its config name. None when not given.
   */
  storybooks?: Record<string, SetupCommand>
}

/**
 * A skill installed into a temp folder.
 */
interface SkillInstall {
  /**
   * The temp folder, which the script runs in.
   */
  folder: string
  /**
   * The copy of the runner script, `<folder>/skill/scripts/run.mjs`.
   */
  script: string
  /**
   * The folder the fakes write their records into.
   */
  stateDir: string
}

/**
 * What a finished script run gave.
 */
interface ScriptResult {
  /**
   * The script's exit code, or `null` when a signal ended it.
   */
  code: number | null
  /**
   * The signal that ended the script, or `null`.
   */
  signal: NodeJS.Signals | null
  /**
   * The bytes the script wrote on stdout.
   */
  stdout: Buffer
  /**
   * What the script wrote on stderr.
   */
  stderr: string
}

/**
 * A script run in progress.
 */
interface RunningScript {
  /**
   * The script's process.
   */
  child: ChildProcess
  /**
   * Settles once the script and every process holding its stdout or stderr are gone.
   */
  exited: Promise<ScriptResult>
  /**
   * What the script wrote on stderr so far.
   */
  stderr: () => string
  /**
   * Settles once the script's stderr holds `text`, and rejects after `timeoutMs`.
   */
  waitForStderr: (text: string, timeoutMs: number) => Promise<void>
}

/**
 * The runner script under test.
 */
const scriptSource = fileURLToPath(new URL('../skill/scripts/run.mjs', import.meta.url))

/**
 * The fake CLI, which records each call and answers as the env vars a test sets say.
 */
const fakeCliPath = fileURLToPath(new URL('./skill-run-fakes/fake-cli.mjs', import.meta.url))

/**
 * The temp folders the fixtures made, removed by `cleanUpScripts`.
 */
const folders: string[] = []

/**
 * The scripts `runScript` started, killed by `cleanUpScripts`.
 */
const scripts: ChildProcess[] = []

/**
 * Makes a temp folder that `cleanUpScripts` removes.
 */
function temporaryFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'visual-check-skill-run-'))

  folders.push(folder)

  return folder
}

/**
 * Installs the runner script into a temp folder as the skill lays it out: `skill/scripts/run.mjs` and
 * `skill/setup.json`, plus a `state/` folder for the fakes' records. A string `setup` is written as it is, for the
 * cases with an invalid `setup.json`.
 *
 * @public
 */
export function installSkill(setup: SetupFile | string): SkillInstall {
  const folder = temporaryFolder()
  const script = join(folder, 'skill', 'scripts', 'run.mjs')
  const stateDir = join(folder, 'state')

  mkdirSync(join(folder, 'skill', 'scripts'), { recursive: true })
  mkdirSync(stateDir)
  copyFileSync(scriptSource, script)
  writeFileSync(
    join(folder, 'skill', 'setup.json'),
    typeof setup === 'string' ? setup : JSON.stringify({ storybooks: {}, ...setup }),
  )

  return { folder, script, stateDir }
}

/**
 * The command that runs the fake CLI.
 *
 * @public
 */
export function fakeCliCommand(): string[] {
  return [process.execPath, fakeCliPath]
}

/**
 * Runs the installed script with `args` in the install's folder, with `env` added to the test's environment.
 *
 * @public
 */
export function runScript(install: SkillInstall, args: string[], env: Record<string, string>): RunningScript {
  const child = spawn(process.execPath, [install.script, ...args], {
    cwd: install.folder,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stdout: Buffer[] = []
  let stderr = ''

  scripts.push(child)
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout.push(chunk)
  })
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk
  })

  const exited = new Promise<ScriptResult>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout: Buffer.concat(stdout), stderr })
    })
  })

  return {
    child,
    exited,
    stderr: () => stderr,
    waitForStderr: async (text, timeoutMs) => {
      const deadline = Date.now() + timeoutMs

      while (!stderr.includes(text)) {
        if (Date.now() >= deadline) {
          throw new Error(`The script's stderr didn't show ${JSON.stringify(text)} within ${timeoutMs} ms:\n${stderr}`)
        }

        await sleep(50)
      }
    },
  }
}

/**
 * The records of a JSON-lines file, none when it doesn't exist.
 *
 * @public
 */
export function readJsonLines(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) {
    return []
  }

  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

/**
 * A port on `127.0.0.1` that nothing listens on.
 *
 * @public
 */
export function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      server.close(() => {
        if (address === null || typeof address === 'string') {
          reject(new Error('The server has no port.'))
        } else {
          resolve(address.port)
        }
      })
    })
  })
}

/**
 * Whether the process `pid` is alive. One the test may not signal counts as alive.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Waits until every process of `pids` is gone, polling every 100 ms for up to `timeoutMs`. Returns the ones still
 * alive then.
 *
 * @public
 */
export async function waitUntilGone(pids: number[], timeoutMs: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (!pids.some(isAlive)) {
      return []
    }

    await sleep(100)
  }

  return pids.filter(isAlive)
}

/**
 * The pids recorded in the JSON-lines file at `path`, as `pid`, `childPid` or `keeperPid`.
 *
 * @public
 */
export function recordedPidsIn(path: string): number[] {
  return readJsonLines(path)
    .flatMap((record) => [record.pid, record.childPid, record.keeperPid])
    .filter((value) => typeof value === 'number')
}

/**
 * The pids recorded in the state files of the temp folders.
 */
function recordedPids(): number[] {
  const stateDirs = folders.map((folder) => join(folder, 'state')).filter((stateDir) => existsSync(stateDir))

  return stateDirs.flatMap((stateDir) => readdirSync(stateDir).flatMap((file) => recordedPidsIn(join(stateDir, file))))
}

/**
 * Kills every script the tests started and every process the fakes recorded, then removes the temp folders. For
 * `afterEach`.
 *
 * @public
 */
export function cleanUpScripts(): void {
  for (const script of scripts.splice(0)) {
    if (script.exitCode === null && script.signalCode === null) {
      script.kill('SIGKILL')
    }
  }

  for (const pid of recordedPids()) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // The process is already gone.
    }
  }

  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true, maxRetries: 5 })
  }
}
