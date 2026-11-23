// What the end-to-end checks of a test Storybook share: `e2e.ts`, which each test Storybook runs from its own folder, and
// `addon-e2e.ts`.
import { spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * The folder the check starts in, the test Storybook's package folder, which the CLI runs in.
 */
export const packageDir = process.cwd()

/**
 * The built CLI, through this package's workspace link to it.
 */
export const cliBin = join(packageDir, 'node_modules', '@visual-check', 'cli', 'dist', 'bin.js')

/**
 * The committed baselines.
 */
export const committedBaselines = join(packageDir, '.visual-check', 'baselines')

/**
 * Where a check puts what CI keeps when it fails, such as the baselines an `update` wrote that differ from the committed
 * ones.
 */
export const diagnosticsDir = join(packageDir, 'e2e-output')

/**
 * The browser package, through this package's workspace link to it, which names the Chromium version the CLI
 * downloads for the host.
 */
const browserPackagePath = join(packageDir, 'node_modules', '@visual-check', 'chromium', 'chromium.json')

/**
 * Chrome for Testing's name for the platform of each machine visual-check downloads a headless shell for, by Node's
 * OS and architecture.
 */
const chromeForTestingPlatforms: Record<string, string> = {
  'linux/x64': 'linux64',
  'linux/arm64': 'linux-arm64',
  'darwin/x64': 'mac-x64',
  'darwin/arm64': 'mac-arm64',
  'win32/x64': 'win64',
}

/**
 * What the CLI says when there's no docker command: the problem, then the fix that names `platform: 'host'`.
 */
export const noDockerTexts = [
  "visual-check runs the browser in Docker, and there's no docker command on PATH.",
  "Start or install Docker, or set platform: 'host' in the config.",
]

/**
 * The browser image every run uses, until the browser package names a published one.
 */
export const image = process.env.TEST_STORYBOOK_IMAGE

/**
 * The names visual-check gives its containers, as a `docker ps` name filter.
 */
const containerNamePattern = '^visual-check-[0-9a-f]{12}$'

/**
 * How long one docker command may take before it is killed, in milliseconds.
 */
const dockerTimeoutMilliseconds = 30_000

/**
 * The part of the browser package that the checks use.
 */
interface BrowserPackage {
  /**
   * The Chromium version, such as `157.0.8103.78`.
   */
  chromium: string
  /**
   * The SHA-256 of the headless shell's download, by Chrome for Testing's name for the platform.
   */
  sha256: Record<string, string>
}

/**
 * One end-to-end case: what it checks, and the check, which gives every problem it finds.
 */
export interface Case {
  /**
   * What the case checks.
   */
  name: string
  /**
   * Runs the case, resolving with its problems, none when it passes.
   */
  run: () => Promise<string[]>
}

/**
 * Reads the browser package.
 */
export function readBrowserPackage(): BrowserPackage {
  return JSON.parse(readFileSync(browserPackagePath, 'utf8')) as BrowserPackage
}

/**
 * Gives Chrome for Testing's name for this machine's platform, such as `mac-arm64`.
 *
 * @throws {Error} When visual-check downloads no headless shell for the machine.
 */
export function thisMachinesChromeForTestingPlatform(): string {
  const machine = `${process.platform}/${process.arch}`
  const platform = chromeForTestingPlatforms[machine]

  if (platform === undefined) {
    throw new Error(`visual-check downloads no headless shell for ${machine}, so --host can't run here`)
  }

  return platform
}

/**
 * Whether a file is at this path.
 */
export function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile()
}

/**
 * Finds the executable file with this name in the `PATH` folders. Gives its path, or `undefined` when none has it.
 */
export function executableOnPath(name: string): string | undefined {
  return (process.env.PATH ?? '')
    .split(delimiter)
    .map((folder) => join(folder, name))
    .find((path) => {
      try {
        accessSync(path, constants.X_OK)

        return isFile(path)
      } catch {
        return false
      }
    })
}

/**
 * Makes a temporary folder, hands it to `use`, and removes it however `use` ends.
 */
export async function withTemporaryFolder<T>(use: (folder: string) => Promise<T>): Promise<T> {
  const folder = mkdtempSync(join(tmpdir(), 'visual-check-e2e-'))

  try {
    return await use(folder)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

/**
 * The environment without `CI`, which `update` refuses to run under, and under which `test` stops before it captures
 * when its consistency check finds anything, and without `GITHUB_STEP_SUMMARY`, so no run writes the step summary of
 * the CI job running these tests. It's what every run of the CLI gets unless a case gives its own.
 */
export function localEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env }

  delete environment.CI
  delete environment.GITHUB_STEP_SUMMARY

  return environment
}

/**
 * Runs a docker command and gives its standard output. It is killed when it runs past its time limit.
 *
 * @throws {Error} When the command fails or runs past its time limit.
 */
export function docker(args: string[]): string {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: dockerTimeoutMilliseconds })

  if (result.status !== 0) {
    throw new Error(`docker ${args[0]} failed: ${String(result.error ?? result.stderr.trim())}`)
  }

  return result.stdout
}

/**
 * Lists the IDs of visual-check's containers: running ones, or all of them, stopped ones included.
 */
export function visualCheckContainers(which: 'running' | 'all'): string[] {
  const all = which === 'all' ? ['-a'] : []

  return docker(['ps', ...all, '--filter', `name=${containerNamePattern}`, '-q'])
    .split('\n')
    .filter((line) => line !== '')
}

/**
 * Lists the IDs of visual-check's containers that weren't there before.
 */
export function newContainers(which: 'running' | 'all', before: ReadonlySet<string>): string[] {
  return visualCheckContainers(which).filter((id) => !before.has(id))
}

/**
 * Checks the condition every 200 ms until it holds or the time is up. Resolves with whether it held.
 */
export async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  timeoutMilliseconds: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMilliseconds

  while (!(await condition())) {
    if (Date.now() >= deadline) {
      return false
    }

    await sleep(200)
  }

  return true
}

/**
 * Gives the problem unless the condition holds, or none when it does.
 */
export function problemUnless(condition: boolean, problem: string): string[] {
  return condition ? [] : [problem]
}

/**
 * A running process.
 */
export interface RunningProcess {
  /**
   * Its process ID.
   */
  pid: number
  /**
   * The process ID of its parent.
   */
  parent: number
  /**
   * Its command line.
   */
  command: string
}

/**
 * Lists the running processes, from `ps`, outside Windows. One that is ending, with no command line any more, isn't
 * listed.
 */
export function runningProcesses(): RunningProcess[] {
  const listed = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })

  if (listed.error !== undefined || listed.status !== 0) {
    throw new Error(`Couldn't list the running processes with ps: ${listed.error ?? `it exited with ${listed.status}`}`)
  }

  return listed.stdout
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\S.*)$/.exec(line) ?? [])
    .map(([, pid, parent, command = '']) => ({ pid: Number(pid), parent: Number(parent), command }))
    .filter(({ command }) => command !== '' && !command.includes('<defunct>'))
}

/**
 * Lists the children of each of these processes, by their parent's process ID.
 */
function childrenByParent(processes: RunningProcess[]): Map<number, number[]> {
  const children = new Map<number, number[]>()

  for (const { pid, parent } of processes) {
    children.set(parent, [...(children.get(parent) ?? []), pid])
  }

  return children
}

/**
 * Lists the processes that descend from the process `pid`, among these ones, outside Windows.
 */
export function descendantsOf(pid: number, processes = runningProcesses()): number[] {
  const children = childrenByParent(processes)
  // On macOS the process 0 is its own parent, so the walk never visits it, nor any process twice.
  const seen = new Set([0, pid])
  const tree = [pid].filter((id) => id !== 0)

  for (let index = 0; index < tree.length; index += 1) {
    tree.push(...takeUnseen(children.get(tree[index] ?? 0) ?? [], seen))
  }

  return tree.slice(1)
}

/**
 * Takes from `pids` the process IDs not in `seen` yet, and adds them to it.
 */
function takeUnseen(pids: number[], seen: Set<number>): number[] {
  const unseen = pids.filter((pid) => !seen.has(pid))

  for (const pid of unseen) {
    seen.add(pid)
  }

  return unseen
}

/**
 * Whether the process `pid` still runs: signal 0 reaches it, or reaches it but may not signal it.
 */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Runs every case, prints its result, and resolves with whether all of them passed.
 */
export async function runCases(cases: Case[]): Promise<boolean> {
  let passed = true

  for (const testCase of cases) {
    const problems = await problemsOf(testCase)

    printResult(testCase.name, problems)
    passed = passed && problems.length === 0
  }

  return passed
}

/**
 * Prints one line for a case, marked passed or failed, then one indented line for each of its problems.
 */
function printResult(name: string, problems: string[]): void {
  console.log(
    [`${problems.length === 0 ? '✓' : '✗'} ${name}`, ...problems.map((problem) => `    ${problem}`)].join('\n'),
  )
}

/**
 * Runs a case and gives its problems. A case that throws has the error's message as its one problem.
 */
export async function problemsOf(testCase: Case): Promise<string[]> {
  try {
    return await testCase.run()
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
}
