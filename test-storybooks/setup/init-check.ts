// The Setup check (docs/prd/18-repo-ci.md › Setup under each package manager): it sets up a tiny Storybook the way a
// user would, with packages that aren't on npm yet. It packs visual-check's packages and serves them from a registry
// on 127.0.0.1, which the project's `.npmrc` names for the `@visual-check` scope; everything else comes from npm. On a
// copy of the fixture, it installs, runs `init --yes` through `pnpm dlx` and checks what init wrote and printed. Then
// it installs again, adds the browser image to the config, starts Storybook, runs one `update` and one `test`, and runs
// `init --yes` again, which must change nothing. `init` and `update` run without `CI` in their environment, as on a
// developer's machine; `test` runs in the environment the check gets, so in CI it runs as a project's CI does.
//
// Run it with `pnpm turbo run init-check --filter @visual-check/test-setup -- --package-manager pnpm`, which builds the
// packages first, with TEST_STORYBOOK_IMAGE naming the browser image. Port 6106, where the fixture's Storybook starts,
// must be free. It prints one line per step, then each of its problems, and exits 1 when a step fails, skipping the
// steps after it. It works in a temporary folder, which it removes at the end, and the project uses a store and cache
// of its own there, so nothing from an earlier run is reused. On a failure, it copies the project, without
// `node_modules`, and every command's output to `init-check-output/`. A SIGINT or SIGTERM stops every command it
// started, skips the steps left, cleans up as on a failure, and exits 130 or 143.
//
// `--package-manager <name>` picks the fixture in `fixtures/<name>` and the package manager that sets it up. There's a
// fixture for pnpm only so far.
//
// With `--init-only` it stops after the first `init`, and needs no TEST_STORYBOOK_IMAGE. It's for a machine without
// Docker: init's only warning must be that there's no docker command, naming `platform: 'host'`, so where there's a
// docker command, that step fails.
import { type ChildProcessByStdio, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { connect } from 'node:net'
import { constants, tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import type { Readable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import {
  configWithImage,
  type PackedManifest,
  packedPackages,
  type Registry,
  startRegistry,
  type Tarball,
} from './local-packages.ts'

/**
 * A started command, with its standard output and standard error piped.
 */
type CommandProcess = ChildProcessByStdio<null, Readable, Readable>

/**
 * The signals that interrupt the check.
 */
const interruptSignals = ['SIGINT', 'SIGTERM'] as const

/**
 * A signal that interrupts the check.
 */
type InterruptSignal = (typeof interruptSignals)[number]

/**
 * A command the check ran, with how it ended and what it printed.
 */
interface CommandRun {
  /**
   * What the command is for, which names its output file.
   */
  label: string
  /**
   * The command and its arguments, joined with spaces.
   */
  commandLine: string
  /**
   * The folder it ran in.
   */
  cwd: string
  /**
   * Its exit code, or `null` while it runs, when a signal ended it, or when it couldn't start.
   */
  exitCode: number | null
  /**
   * The signal that ended it, if one did.
   */
  signal: NodeJS.Signals | null
  /**
   * Whether it ran past its time limit, so the check killed it.
   */
  timedOut: boolean
  /**
   * Why it couldn't start, if it couldn't.
   */
  error: string | undefined
  /**
   * What it printed on standard output.
   */
  stdout: string
  /**
   * What it printed on standard error.
   */
  stderr: string
}

/**
 * How to run a command.
 */
interface CommandOptions {
  /**
   * The folder to run it in.
   */
  cwd: string
  /**
   * Its environment. The check's own when not given.
   */
  env?: NodeJS.ProcessEnv
  /**
   * How long it may run before the check kills it, in milliseconds. No limit when not given.
   */
  timeoutMilliseconds?: number
}

/**
 * A command that was started, and its run once it has ended.
 */
interface StartedCommand {
  /**
   * The command's process, the leader of its own process group.
   */
  child: CommandProcess
  /**
   * The run, which fills in as the command prints and ends.
   */
  run: CommandRun
  /**
   * Resolves with the run once the command has ended and its output is read.
   */
  finished: Promise<CommandRun>
}

/**
 * What the arguments say.
 */
interface Arguments {
  /**
   * The package manager whose fixture the check sets up, as `--package-manager` names it.
   */
  packageManager: string
  /**
   * Whether the check stops after the first `init`, as `--init-only` says.
   */
  initOnly: boolean
}

/**
 * What the check works on, and what it has made and run so far.
 */
interface Check {
  /**
   * The temporary folder that holds everything the check makes.
   */
  folder: string
  /**
   * The project, the copy of the fixture.
   */
  project: string
  /**
   * The fixture the project is a copy of.
   */
  fixture: string
  /**
   * Whether the check stops after the first `init`.
   */
  initOnly: boolean
  /**
   * Every command run so far, in order.
   */
  commands: CommandRun[]
  /**
   * The commands still running.
   */
  running: Set<StartedCommand>
  /**
   * The signal that interrupted the check, if one did.
   */
  interrupted: InterruptSignal | undefined
  /**
   * The packed packages, once packed.
   */
  tarballs: Tarball[]
  /**
   * The local registry, once started.
   */
  registry: Registry | undefined
  /**
   * Storybook, once started.
   */
  storybook: StartedCommand | undefined
}

/**
 * One step of the check.
 */
interface Step {
  /**
   * What the step checks, as its line says.
   */
  name: string
  /**
   * Runs the step and gives its problems, none when it passed.
   */
  run: () => Promise<string[]>
}

/**
 * The fields of a `package.json` the check reads.
 */
interface Manifest {
  /**
   * The scripts, by name.
   */
  scripts?: Record<string, string>
  /**
   * The development dependencies, with the range of each.
   */
  devDependencies?: Record<string, string>
}

/**
 * This package's folder.
 */
const packageDir = import.meta.dirname

/**
 * The repo's root.
 */
const repoRoot = join(packageDir, '..', '..')

/**
 * Where a failed run leaves the project and every command's output, for CI to keep.
 */
const outputDir = join(packageDir, 'init-check-output')

/**
 * A file each package's build writes, so the check can tell the packages are built before it packs them.
 */
const builtFiles = [
  'packages/cli/dist/bin.js',
  'packages/storybook/dist/index.js',
  'packages/storybook-addon/dist/preset.js',
]

/**
 * The port the fixture's Storybook starts on, as its `storybook` script says.
 */
const storybookPort = 6106

/**
 * The URL the fixture's Storybook is served at.
 */
const storybookUrl = `http://127.0.0.1:${storybookPort}`

/**
 * How long Storybook may take to answer for `index.json` after it starts, in milliseconds.
 */
const storybookReadyMilliseconds = 120_000

/**
 * How long Storybook's processes may take to exit once they're asked to, in milliseconds.
 */
const storybookStopMilliseconds = 10_000

/**
 * How long one command may run before the check kills it, in milliseconds. Installing and the first capture can be
 * slow on a cold machine.
 */
const commandTimeoutMilliseconds = 600_000

/**
 * How many of the last lines of a failed command's output a problem shows.
 */
const tailLineCount = 15

/**
 * The config `init` writes for the fixture: its one Storybook, at its URL.
 */
const expectedConfig = `import { defineConfig } from '@visual-check/cli'

export default defineConfig({
  storybooks: {
    'setup-fixture': { url: 'http://127.0.0.1:6106' },
  },
})
`

/**
 * The `visual-check.ts` `init` writes in the config folder.
 */
const expectedModesFile = `import { defineVisualCheck } from '@visual-check/storybook'

export const visualCheck = defineVisualCheck({
  modes: {
    // Each mode a story lists adds one snapshot besides its default capture. For example:
    // mobile: { viewport: { width: 375, height: 667, deviceScaleFactor: 2, touch: true } },
  },
})
`

/**
 * The `.gitignore` `init` writes in `.visual-check/`.
 */
const expectedGitignore = '/*\n!/baselines/\n!/.gitignore\n'

/**
 * The scripts `init` adds, by name.
 */
const addedScripts: Record<string, string> = {
  'visual:check': 'visual-check test',
  'visual:update': 'visual-check update',
}

/**
 * The addon, which `storybook add` adds to `devDependencies` and `.storybook/main.js` at a range of its own choosing.
 */
const addonPackage = '@visual-check/storybook-addon'

/**
 * The line the closing message ends with.
 */
const closingLine = 'To run visual-check in CI, see https://visual-check.vercel.app/docs/ci.\n'

/**
 * What init's Docker warning says on a machine with no docker command: the problem, then the fix that names
 * `platform: 'host'`.
 */
const noDockerTexts = ["there's no docker command on PATH", "platform: 'host'"]

/**
 * The browser image `update` and `test` run in, until the browser package names a published one.
 */
const image = process.env.TEST_STORYBOOK_IMAGE

/**
 * Gives an error's message, or the thrown value as text when it isn't an `Error`.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Reads the arguments, or gives the problem with them: one the check doesn't know, or a package manager that is
 * missing or has no fixture.
 */
function parseArguments(): Arguments | { problem: string } {
  try {
    const { values } = parseArgs({
      options: { 'package-manager': { type: 'string' }, 'init-only': { type: 'boolean', default: false } },
      strict: true,
    })

    return argumentsOf(values['package-manager'], values['init-only'])
  } catch (error) {
    return { problem: messageOf(error) }
  }
}

/**
 * Gives the arguments, or the problem with the package manager: none named, or one with no fixture.
 */
function argumentsOf(packageManager: string | undefined, initOnly: boolean): Arguments | { problem: string } {
  if (packageManager === undefined) {
    return { problem: '--package-manager is missing: pass --package-manager pnpm.' }
  }

  return packageManager === 'pnpm'
    ? { packageManager, initOnly }
    : { problem: `There's a fixture for pnpm only so far, so --package-manager must be pnpm, not ${packageManager}.` }
}

/**
 * Lists what the check needs and doesn't have: the built packages, and the browser image unless it stops after
 * `init`.
 */
function findSetupProblems(initOnly: boolean): string[] {
  return [
    ...builtFiles
      .filter((file) => !existsSync(join(repoRoot, file)))
      .map(
        (file) =>
          `${file} is missing: run the check with pnpm turbo run init-check --filter @visual-check/test-setup ` +
          '-- --package-manager pnpm, which builds the packages first.',
      ),
    ...(initOnly || image
      ? []
      : ['TEST_STORYBOOK_IMAGE is not set: set it to the browser image, such as visual-check-chromium:ci.']),
  ]
}

/**
 * The environment without `CI`, as on a developer's machine: `update` refuses to run under it.
 */
function localEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env }

  delete environment.CI

  return environment
}

/**
 * Starts a command in its own process group, so the check can stop it with everything it started, and records its
 * run. A command with a time limit has its group killed when it runs past it.
 *
 * @throws {Error} When the check was interrupted, so it starts no more commands.
 */
function startCommand(
  check: Check,
  label: string,
  command: string,
  args: readonly string[],
  options: CommandOptions,
): StartedCommand {
  if (check.interrupted !== undefined) {
    throw new Error(`The check was interrupted by ${check.interrupted}, so it runs no more commands.`)
  }

  const run: CommandRun = {
    label,
    commandLine: [command, ...args].join(' '),
    cwd: options.cwd,
    exitCode: null,
    signal: null,
    timedOut: false,
    error: undefined,
    stdout: '',
    stderr: '',
  }
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  const timer =
    options.timeoutMilliseconds === undefined
      ? undefined
      : setTimeout(() => {
          run.timedOut = true
          killGroup(child, 'SIGKILL')
        }, options.timeoutMilliseconds)

  child.stdout.setEncoding('utf8').on('data', (text: string) => {
    run.stdout += text
  })
  child.stderr.setEncoding('utf8').on('data', (text: string) => {
    run.stderr += text
  })

  const finished = new Promise<CommandRun>((resolve) => {
    child.on('error', (error) => {
      run.error = error.message
      clearTimeout(timer)
      resolve(run)
    })
    child.on('close', (code, signal) => {
      run.exitCode = code
      run.signal = signal
      clearTimeout(timer)
      resolve(run)
    })
  })
  const started = { child, run, finished }

  check.commands.push(run)
  check.running.add(started)
  void finished.then(() => {
    check.running.delete(started)
  })

  return started
}

/**
 * Runs a command to the end, or until its time limit kills it.
 *
 * @throws {Error} When the check was interrupted, so it starts no more commands.
 */
async function runCommand(
  check: Check,
  label: string,
  command: string,
  args: readonly string[],
  options: CommandOptions,
): Promise<CommandRun> {
  return await startCommand(check, label, command, args, {
    timeoutMilliseconds: commandTimeoutMilliseconds,
    ...options,
  }).finished
}

/**
 * Sends a signal to a command's process group. A group that is already gone is left alone.
 */
function killGroup(child: CommandProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return
  }

  try {
    process.kill(-child.pid, signal)
  } catch {
    // The group has already exited.
  }
}

/**
 * Notes that a signal interrupted the check and asks every running command's process group to stop, so the step that
 * runs ends, the steps left are skipped, and the check cleans up.
 */
function interrupt(check: Check, signal: InterruptSignal): void {
  check.interrupted = signal
  console.log(`Interrupted by ${signal}: stopping every command the check started.`)

  for (const { child } of check.running) {
    killGroup(child, 'SIGTERM')
  }
}

/**
 * Interrupts the check on the first SIGINT or SIGTERM. A second signal of the same kind ends the process at once, as
 * it would without the check's listener. Gives the function that stops listening.
 */
function listenForInterruptions(check: Check): () => void {
  const listeners = interruptSignals.map((signal) => [signal, () => interrupt(check, signal)] as const)

  for (const [signal, listener] of listeners) {
    process.once(signal, listener)
  }

  return () => {
    for (const [signal, listener] of listeners) {
      process.off(signal, listener)
    }
  }
}

/**
 * Says how a command ended: it couldn't run, it timed out, a signal ended it, or it exited with a code.
 */
function endingOf(run: CommandRun): string {
  if (run.error !== undefined) {
    return `couldn't run: ${run.error}`
  }

  if (run.timedOut) {
    return `timed out after ${commandTimeoutMilliseconds / 1000} s`
  }

  return run.signal === null ? `exited ${run.exitCode}` : `was ended by ${run.signal}`
}

/**
 * Gives the problem with how a command ended, with the end of what it printed, or none when it exited 0.
 */
function exitProblems(run: CommandRun): string[] {
  return run.exitCode === 0 && run.error === undefined ? [] : [`${run.commandLine} ${endingOf(run)}${tailOf(run)}`]
}

/**
 * Gives the last lines of what a command printed on each stream, indented under the problem, or nothing when it
 * printed nothing.
 */
function tailOf(run: CommandRun): string {
  const streams: [string, string][] = [
    ['stdout', run.stdout],
    ['stderr', run.stderr],
  ]

  return streams
    .map(([name, output]) => [name, output.trimEnd().split('\n').slice(-tailLineCount)] as const)
    .filter(([, lines]) => lines.join('') !== '')
    .map(([name, lines]) => `\n      ${name} ends:\n${lines.map((line) => `        ${line}`).join('\n')}`)
    .join('')
}

/**
 * Packs each package a project installs into the temporary folder, and reads the `package.json` in each tarball.
 *
 * @throws {Error} When a tarball can't be read.
 */
async function packPackages(check: Check): Promise<string[]> {
  const destination = join(check.folder, 'tarballs')
  const problems: string[] = []

  for (const folder of packedPackages) {
    const run = await runCommand(check, `pack ${folder}`, 'pnpm', ['pack', '--pack-destination', destination], {
      cwd: join(repoRoot, 'packages', folder),
    })

    problems.push(...exitProblems(run))
  }

  if (problems.length > 0) {
    return problems
  }

  for (const file of readdirSync(destination).filter((name) => name.endsWith('.tgz'))) {
    check.tarballs.push(await readTarball(check, join(destination, file)))
  }

  return []
}

/**
 * Reads the `package.json` in a tarball.
 *
 * @throws {Error} When `tar` can't read it.
 */
async function readTarball(check: Check, path: string): Promise<Tarball> {
  const run = await runCommand(check, `read ${basename(path)}`, 'tar', ['-xzOf', path, 'package/package.json'], {
    cwd: dirname(path),
  })

  if (run.exitCode !== 0) {
    throw new Error(exitProblems(run).join('\n'))
  }

  return { manifest: JSON.parse(run.stdout) as PackedManifest, path }
}

/**
 * Gives the packed CLI.
 *
 * @throws {Error} When there's none.
 */
function cliTarballOf(check: Check): Tarball {
  const tarball = check.tarballs.find(({ manifest }) => manifest.name === '@visual-check/cli')

  if (tarball === undefined) {
    throw new Error('pnpm pack made no tarball of @visual-check/cli')
  }

  return tarball
}

/**
 * Starts the registry for the packed packages.
 */
async function serveTarballs(check: Check): Promise<string[]> {
  check.registry = await startRegistry(check.tarballs)

  return []
}

/**
 * Copies the fixture into the temporary folder, without anything a local install left in it, points the `@visual-check`
 * scope at the registry with a store and cache of the project's own, makes it a git repo, and installs it, as a
 * project that has its dependencies is.
 */
async function makeProject(check: Check): Promise<string[]> {
  const { folder, project, registry } = check

  cpSync(check.fixture, project, {
    recursive: true,
    filter: (source) => !['node_modules', 'storybook-static'].includes(basename(source)),
  })
  writeFileSync(
    join(project, '.npmrc'),
    [
      `@visual-check:registry=${registry?.url}/`,
      `store-dir=${join(folder, 'store')}`,
      `cache-dir=${join(folder, 'cache')}`,
      '',
    ].join('\n'),
  )

  const gitInit = await runCommand(check, 'git init', 'git', ['init', '-q'], { cwd: project })

  if (gitInit.exitCode !== 0) {
    return exitProblems(gitInit)
  }

  // Under CI, pnpm takes --frozen-lockfile by default, and the fixture has no lockfile.
  return exitProblems(
    await runCommand(check, 'install the fixture', 'pnpm', ['install', '--no-frozen-lockfile'], { cwd: project }),
  )
}

/**
 * Reads a file of the project as text, or gives `undefined` when it isn't there.
 */
function readProjectFile(check: Check, path: string): string | undefined {
  const fullPath = join(check.project, path)

  return existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : undefined
}

/**
 * Runs `init --yes` through `pnpm dlx` at the packed CLI's version, without `CI`, and checks it: it exits 0, warns
 * only that there's no docker command with `--init-only` and not at all without, writes and adds what it should, and
 * ends with the closing message's CI line.
 */
async function checkInit(check: Check): Promise<string[]> {
  const cliSpec = `@visual-check/cli@${cliTarballOf(check).manifest.version}`
  const run = await runCommand(check, 'init', 'pnpm', ['dlx', cliSpec, 'init', '--yes'], {
    cwd: check.project,
    env: localEnvironment(),
  })
  const problems = exitProblems(run)

  if (problems.length > 0) {
    return problems
  }

  return [
    ...(check.initOnly ? noDockerWarningProblems(run.stderr) : warningProblems('init', run.stderr)),
    ...writtenFileProblems(check),
    ...manifestProblems(check),
    ...addonProblems(check),
    ...closingLineProblems(run.stdout),
  ]
}

/**
 * Lists the problem with `.storybook/main.js` after `init`: it must list the addon, which `storybook add` adds.
 */
function addonProblems(check: Check): string[] {
  return readFileSync(join(check.project, '.storybook', 'main.js'), 'utf8').includes(addonPackage)
    ? []
    : [`.storybook/main.js lists no ${addonPackage}: storybook add didn't add the addon`]
}

/**
 * Lists the problem with what `init` printed on standard output: it must end with the closing message's CI line.
 */
function closingLineProblems(stdout: string): string[] {
  return stdout.endsWith(closingLine)
    ? []
    : [`init's output doesn't end with ${JSON.stringify(closingLine)}: ${JSON.stringify(stdout.slice(-300))}`]
}

/**
 * Lists init's warnings: the lines of its standard error that start with `Warning:`.
 */
function warningsOf(stderr: string): string[] {
  return stderr.split('\n').filter((line) => line.startsWith('Warning:'))
}

/**
 * Lists each warning a run printed as a problem.
 */
function warningProblems(command: string, stderr: string): string[] {
  return warningsOf(stderr).map((warning) => `${command} warned: ${warning}`)
}

/**
 * Lists the problems with init's warnings on a machine without Docker: there must be exactly one, which says there's
 * no docker command and names `platform: 'host'`.
 */
function noDockerWarningProblems(stderr: string): string[] {
  const warnings = warningsOf(stderr)

  if (warnings.length === 1 && noDockerTexts.every((text) => warnings.join('').includes(text))) {
    return []
  }

  return [
    `init's only warning should say ${noDockerTexts.map((text) => JSON.stringify(text)).join(' and ')}, ` +
      `and it warned: ${warnings.length === 0 ? 'nothing' : warnings.join(' | ')}`,
  ]
}

/**
 * Lists each file `init` writes that isn't what it should be, and the fixture's `.gitignore` when init changed it.
 */
function writtenFileProblems(check: Check): string[] {
  const expected: [path: string, content: string][] = [
    ['visual-check.config.ts', expectedConfig],
    ['.storybook/visual-check.ts', expectedModesFile],
    ['.visual-check/.gitignore', expectedGitignore],
    ['.gitignore', readFileSync(join(check.fixture, '.gitignore'), 'utf8')],
  ]

  return expected.flatMap(([path, content]) => {
    const actual = readProjectFile(check, path)

    if (actual === content) {
      return []
    }

    return [
      actual === undefined
        ? `${path} is missing`
        : `${path} should be ${JSON.stringify(content)}, and it is ${JSON.stringify(actual)}`,
    ]
  })
}

/**
 * Reads the scripts and `devDependencies` of a `package.json`, empty when it has none.
 */
function readManifest(path: string): Required<Manifest> {
  const { scripts, devDependencies } = JSON.parse(readFileSync(path, 'utf8')) as Manifest

  return { scripts: scripts ?? {}, devDependencies: devDependencies ?? {} }
}

/**
 * Gives the range `init` adds each of its own packages at: the packed CLI's version for the CLI and
 * `@visual-check/storybook`, and the CLI's peer range for `@visual-check/chromium`.
 *
 * @throws {Error} When the packed CLI has no peer dependency on `@visual-check/chromium`.
 */
function addedDependencyRangesOf(check: Check): Record<string, string> {
  const { version, peerDependencies } = cliTarballOf(check).manifest
  const browserRange = peerDependencies?.['@visual-check/chromium']

  if (browserRange === undefined) {
    throw new Error("The packed CLI's package.json has no peer dependency on @visual-check/chromium")
  }

  return { '@visual-check/cli': version, '@visual-check/chromium': browserRange, '@visual-check/storybook': version }
}

/**
 * Describes a value in a problem: quoted, or `missing` when there's none.
 */
function describedValueOf(value: string | undefined): string {
  return value === undefined ? 'missing' : `"${value}"`
}

/**
 * Lists what's wrong with the project's `package.json` after `init`: it must keep the fixture's scripts and
 * `devDependencies`, and add the two scripts, its three packages at their exact ranges, and the addon.
 */
function manifestProblems(check: Check): string[] {
  const fixture = readManifest(join(check.fixture, 'package.json'))
  const { scripts, devDependencies } = readManifest(join(check.project, 'package.json'))

  return [
    ...Object.entries({ ...fixture.scripts, ...addedScripts })
      .filter(([name, script]) => scripts[name] !== script)
      .map(
        ([name, script]) =>
          `package.json's ${name} script should be "${script}", and it is ${describedValueOf(scripts[name])}`,
      ),
    ...Object.entries({ ...fixture.devDependencies, ...addedDependencyRangesOf(check) })
      .filter(([name, range]) => devDependencies[name] !== range)
      .map(
        ([name, range]) =>
          `package.json's devDependencies should have ${name} at "${range}", and it is ` +
          describedValueOf(devDependencies[name]),
      ),
    ...(devDependencies[addonPackage] === undefined ? [`package.json's devDependencies have no ${addonPackage}`] : []),
  ]
}

/**
 * Installs the project as it is after `init`, from its lockfile, which must hold everything `init` added, and checks
 * the project has its own `visual-check` binary, so `pnpm run` and `pnpm exec` can't find another one on the PATH,
 * such as this workspace's.
 */
async function installAfterInit(check: Check): Promise<string[]> {
  const problems = exitProblems(
    await runCommand(check, 'install', 'pnpm', ['install', '--frozen-lockfile'], { cwd: check.project }),
  )

  if (problems.length > 0) {
    return problems
  }

  return existsSync(join(check.project, 'node_modules', '.bin', 'visual-check'))
    ? []
    : ["node_modules/.bin/visual-check is missing: the project's own CLI isn't installed"]
}

/**
 * Adds the browser image to the config, after `storybooks`, as the test Storybooks' configs do until the browser
 * package names a published image.
 */
async function addImage(check: Check): Promise<string[]> {
  const path = join(check.project, 'visual-check.config.ts')
  const config = readFileSync(path, 'utf8')
  const withImage = configWithImage(config, image ?? '')

  if (withImage === undefined) {
    return [
      `visual-check.config.ts doesn't end as init writes it, so the image has no place: ${JSON.stringify(config)}`,
    ]
  }

  writeFileSync(path, withImage)

  return []
}

/**
 * Whether anything listens on Storybook's port of 127.0.0.1.
 */
async function isStorybookPortTaken(): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: storybookPort })

    socket.setTimeout(5_000)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
}

/**
 * Whether Storybook answers for `index.json` with 200.
 */
async function isStorybookAnswering(): Promise<boolean> {
  try {
    const response = await fetch(`${storybookUrl}/index.json`, { signal: AbortSignal.timeout(5_000) })

    await response.body?.cancel()

    return response.ok
  } catch {
    return false
  }
}

/**
 * Starts the fixture's `storybook` script and waits until it answers for `index.json`. It fails at once when anything
 * already listens on its port, which would stand in for it.
 */
async function startStorybook(check: Check): Promise<string[]> {
  if (await isStorybookPortTaken()) {
    return [
      `Something already listens on 127.0.0.1:${storybookPort}: stop it, since the fixture's Storybook starts there.`,
    ]
  }

  const storybook = startCommand(check, 'storybook', 'pnpm', ['run', 'storybook'], { cwd: check.project })

  check.storybook = storybook

  const outcome = await waitForStorybook(storybook)

  if (outcome === 'answering') {
    return []
  }

  return outcome === 'ended'
    ? [`Storybook ${endingOf(storybook.run)} before it answered for ${storybookUrl}/index.json${tailOf(storybook.run)}`]
    : [`Storybook didn't answer for ${storybookUrl}/index.json within ${storybookReadyMilliseconds / 1000} s`]
}

/**
 * Waits until Storybook answers for `index.json`, ends, or runs past the time limit. Resolves with which came first.
 */
async function waitForStorybook(storybook: StartedCommand): Promise<'answering' | 'ended' | 'timed out'> {
  const deadline = Date.now() + storybookReadyMilliseconds
  let ended = false

  void storybook.finished.then(() => {
    ended = true
  })

  while (Date.now() < deadline) {
    if (ended) {
      return 'ended'
    }

    if (await isStorybookAnswering()) {
      return 'answering'
    }

    await sleep(500)
  }

  return 'timed out'
}

/**
 * Lists the paths, relative to the folder, of the `.png` files in it and the folders under it.
 */
function pngFilesIn(folder: string): string[] {
  if (!existsSync(folder)) {
    return []
  }

  return readdirSync(folder, { recursive: true, encoding: 'utf8' }).filter((path) => path.endsWith('.png'))
}

/**
 * Runs `update` through its script, without `CI`, and checks it exits 0 and writes the one story's baseline.
 */
async function checkUpdate(check: Check): Promise<string[]> {
  const run = await runCommand(check, 'update', 'pnpm', ['run', 'visual:update'], {
    cwd: check.project,
    env: localEnvironment(),
  })
  const problems = exitProblems(run)

  if (problems.length > 0) {
    return problems
  }

  const baselines = pngFilesIn(join(check.project, '.visual-check', 'baselines'))

  return baselines.length === 1
    ? []
    : [`.visual-check/baselines/ should hold one .png, and it holds ${baselines.length}: ${baselines.join(', ')}`]
}

/**
 * Runs `test` through its script, in the check's own environment, and checks it exits 0.
 */
async function checkTest(check: Check): Promise<string[]> {
  return exitProblems(await runCommand(check, 'test', 'pnpm', ['run', 'visual:check'], { cwd: check.project }))
}

/**
 * Hashes every file git lists in the project, tracked or not and not ignored, by path.
 *
 * @throws {Error} When git can't list them.
 */
async function snapshotProject(check: Check, label: string): Promise<Map<string, string>> {
  const run = await runCommand(check, label, 'git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: check.project,
  })

  if (run.exitCode !== 0) {
    throw new Error(exitProblems(run).join('\n'))
  }

  const paths = run.stdout.split('\0').filter((path) => path !== '')

  return new Map(paths.map((path) => [path, sha256Of(join(check.project, path))]))
}

/**
 * Gives the SHA-256 of a file's content, in hex.
 */
function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Lists every file one snapshot has and the other hasn't, or whose content changed.
 */
function snapshotProblems(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort()

  return paths.flatMap((path) => {
    if (!before.has(path)) {
      return [`init again added ${path}`]
    }

    if (!after.has(path)) {
      return [`init again removed ${path}`]
    }

    return before.get(path) === after.get(path) ? [] : [`init again changed ${path}`]
  })
}

/**
 * Runs `init --yes` again with the installed CLI, without `CI`, and checks it exits 0 without a warning, prints no
 * `Wrote` line, and changes no file git lists.
 */
async function checkInitAgain(check: Check): Promise<string[]> {
  const before = await snapshotProject(check, 'list files before init again')
  const run = await runCommand(check, 'init again', 'pnpm', ['exec', 'visual-check', 'init', '--yes'], {
    cwd: check.project,
    env: localEnvironment(),
  })
  const problems = exitProblems(run)

  if (problems.length > 0) {
    return problems
  }

  const after = await snapshotProject(check, 'list files after init again')

  return [
    ...warningProblems('init again', run.stderr),
    ...run.stdout
      .split('\n')
      .filter((line) => line.startsWith('Wrote '))
      .map((line) => `init again wrote a file: ${line}`),
    ...snapshotProblems(before, after),
  ]
}

/**
 * Stops Storybook with everything it started: asks its process group to stop, then kills it when it hasn't within
 * the time limit.
 */
async function stopStorybook(storybook: StartedCommand): Promise<string[]> {
  /**
   * Waits until Storybook has ended or the time limit is up. Resolves with whether it ended.
   */
  const hasEnded = async (): Promise<boolean> =>
    await Promise.race([storybook.finished.then(() => true), sleep(storybookStopMilliseconds).then(() => false)])

  killGroup(storybook.child, 'SIGTERM')

  if (await hasEnded()) {
    return []
  }

  killGroup(storybook.child, 'SIGKILL')

  return (await hasEnded())
    ? []
    : [`Storybook's processes didn't exit within ${(2 * storybookStopMilliseconds) / 1000} s of being stopped`]
}

/**
 * The steps of the check, in order. `--init-only` stops after the first `init`.
 */
function stepsOf(check: Check): Step[] {
  const initName = check.initOnly
    ? "init: pnpm dlx @visual-check/cli init --yes exits 0, its only warning says there's no docker command and " +
      "names platform: 'host', it writes the config, visual-check.ts and .visual-check/.gitignore, adds the scripts, " +
      'the packages and the addon, leaves .gitignore alone, and ends with the CI line'
    : 'init: pnpm dlx @visual-check/cli init --yes exits 0 without a warning, writes the config, visual-check.ts and ' +
      '.visual-check/.gitignore, adds the scripts, the packages and the addon, leaves .gitignore alone, and ends ' +
      'with the CI line'
  const steps: Step[] = [
    {
      name: 'pack: pnpm pack makes a tarball of each package a project installs',
      run: () => packPackages(check),
    },
    { name: 'registry: a local registry serves the tarballs', run: () => serveTarballs(check) },
    {
      name: 'project: a copy of the fixture, with the registry for @visual-check in its .npmrc, installs',
      run: () => makeProject(check),
    },
    { name: initName, run: () => checkInit(check) },
  ]

  if (check.initOnly) {
    return steps
  }

  return [
    ...steps,
    {
      name: 'install: pnpm install --frozen-lockfile exits 0, and the project has its own visual-check binary',
      run: () => installAfterInit(check),
    },
    { name: 'image: the config names the browser image', run: () => addImage(check) },
    {
      name: `storybook: pnpm run storybook answers for index.json within ${storybookReadyMilliseconds / 1000} s`,
      run: () => startStorybook(check),
    },
    {
      name: 'update: pnpm run visual:update without CI exits 0 and writes one baseline',
      run: () => checkUpdate(check),
    },
    { name: 'test: pnpm run visual:check exits 0', run: () => checkTest(check) },
    {
      name: 'init again: pnpm exec visual-check init --yes exits 0 without a warning and changes no file',
      run: () => checkInitAgain(check),
    },
  ]
}

/**
 * Runs a step and gives its problems. A step that throws has the error's message as its one problem.
 */
async function problemsOf(step: Step): Promise<string[]> {
  try {
    return await step.run()
  } catch (error) {
    return [messageOf(error)]
  }
}

/**
 * Prints one line for a step, marked passed or failed, with how long it took, then one indented line for each of its
 * problems.
 */
function printResult(name: string, seconds: number, problems: readonly string[]): void {
  console.log(
    [
      `${problems.length === 0 ? '✓' : '✗'} ${name} (${seconds.toFixed(1)} s)`,
      ...problems.map((problem) => `    ${problem}`),
    ].join('\n'),
  )
}

/**
 * Runs a step, prints its result, and gives its problems.
 */
async function runStep(step: Step): Promise<string[]> {
  const started = performance.now()
  const problems = await problemsOf(step)

  printResult(step.name, (performance.now() - started) / 1000, problems)

  return problems
}

/**
 * Runs the steps in order. A step that fails, or a signal that interrupts the check, skips the steps after it, which
 * build on it. Resolves with whether every step ran and passed.
 */
async function runSteps(check: Check, steps: readonly Step[]): Promise<boolean> {
  for (const step of steps) {
    const problems = await runStep(step)

    if (problems.length > 0 || check.interrupted !== undefined) {
      return false
    }
  }

  return true
}

/**
 * Stops Storybook, as a step of its own, and the registry, whichever were started. Resolves with whether Storybook's
 * processes exited.
 */
async function stopServers(check: Check): Promise<boolean> {
  const { storybook } = check
  const problems =
    storybook === undefined
      ? []
      : await runStep({ name: "stop: Storybook's processes exit", run: () => stopStorybook(storybook) })

  await check.registry?.stop()

  return problems.length === 0
}

/**
 * Gives a command's output file name: its place in the run, then its label in kebab case.
 */
function outputFileOf(run: CommandRun, index: number): string {
  const slug = run.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')

  return `${String(index + 1).padStart(2, '0')}-${slug}.log`
}

/**
 * Copies the project, without `node_modules`, into the output folder, with a file for each command's output and one
 * for the requests the registry didn't answer with 200.
 */
function keepOutput(check: Check): void {
  mkdirSync(outputDir, { recursive: true })

  if (existsSync(check.project)) {
    cpSync(check.project, join(outputDir, 'project'), {
      recursive: true,
      filter: (source) => basename(source) !== 'node_modules',
    })
  }

  check.commands.forEach((run, index) => {
    writeFileSync(
      join(outputDir, outputFileOf(run, index)),
      [
        `$ ${run.commandLine}`,
        `in ${run.cwd}`,
        run.exitCode === null && run.signal === null && run.error === undefined ? 'still running' : endingOf(run),
        '--- stdout ---',
        run.stdout,
        '--- stderr ---',
        run.stderr,
      ].join('\n'),
    )
  })
  writeFileSync(
    join(outputDir, 'registry.log'),
    (check.registry?.unexpectedRequests ?? []).map((request) => `${request}\n`).join(''),
  )
}

/**
 * Gives the check's exit code: 128 plus the signal's number when a signal interrupted it, as a shell would, else 0
 * when every step passed and 1 when one failed.
 */
function exitCodeOf(check: Check, passed: boolean): number {
  if (check.interrupted !== undefined) {
    return 128 + constants.signals[check.interrupted]
  }

  return passed ? 0 : 1
}

/**
 * Runs the check in a temporary folder, then stops Storybook and the registry, keeps the output when anything failed
 * or a signal interrupted it, and removes the folder. Gives the exit code.
 */
async function runCheck({ packageManager, initOnly }: Arguments): Promise<number> {
  rmSync(outputDir, { recursive: true, force: true })

  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-init-check-')))
  const check: Check = {
    folder,
    project: join(folder, 'project'),
    fixture: join(packageDir, 'fixtures', packageManager),
    initOnly,
    commands: [],
    running: new Set(),
    interrupted: undefined,
    tarballs: [],
    registry: undefined,
    storybook: undefined,
  }
  const stopListening = listenForInterruptions(check)
  let passed = false

  try {
    passed = await runSteps(check, stepsOf(check))
  } finally {
    passed = (await stopServers(check)) && passed

    if (!passed) {
      keepOutput(check)
      console.log(`The project and every command's output are in ${relative(repoRoot, outputDir)}/.`)
    }

    rmSync(folder, { recursive: true, force: true })
    stopListening()
  }

  return exitCodeOf(check, passed)
}

/**
 * Reads the arguments, checks the check has what it needs, and runs it. Gives the exit code.
 */
async function main(): Promise<number> {
  const parsed = parseArguments()

  if ('problem' in parsed) {
    console.error(parsed.problem)

    return 1
  }

  const setupProblems = findSetupProblems(parsed.initOnly)

  if (setupProblems.length > 0) {
    console.error(setupProblems.join('\n'))

    return 1
  }

  return await runCheck(parsed)
}

process.exitCode = await main()
