// The Setup check (docs/prd/18-repo-ci.md › Setup under each package manager): it sets up a tiny Storybook the way a
// user would, with packages that aren't on npm yet, under npm, pnpm, Yarn 1 or Yarn 4. It packs visual-check's
// packages and serves them from a registry on 127.0.0.1, which the project's `.npmrc` or `.yarnrc.yml` names for the
// `@visual-check` scope; everything else comes from npm. On a copy of a fixture, it installs, runs `init --yes` the way
// the package manager runs a package it hasn't installed, and checks what init wrote and printed. Then it installs
// again from the lockfile. `init` must install the agent skill, linked from `.claude`, whose `setup.json` CLI command
// never downloads: the check runs it with `--help`. For the single-package fixture, it adds the browser image to the
// config, starts Storybook, runs one `update`, which must rewrite a skill an older CLI wrote, and one `test` with `CI`
// set, which must leave it alone, and runs `init --yes` again, which must change nothing. Then it stops Storybook and
// runs the skill's script, which must start and stop Storybook through `setup.json`. The monorepo fixture's two
// Storybooks share a port, so it stops after the install, the skill's CLI command and a run of each package's own
// `visual:check` script with `--help`, which must find the root's CLI. `init`, `update` and the skill's script run
// without `CI` in their environment, as on a developer's machine.
//
// Run it with `pnpm turbo run init-check --filter @visual-check/test-setup -- --package-manager pnpm`, which builds the
// packages first. For the single fixture, whose Storybook it starts, TEST_STORYBOOK_IMAGE must name the browser image
// and port 6106 must be free; the monorepo needs neither. Yarn needs the `corepack` command. It prints one line per
// step, then each of its problems, and exits 1 when a step fails, skipping the steps after it. It works in a temporary
// folder, which it removes at the end, and the project uses a store and cache of its own there, so nothing from an
// earlier run is reused. On a failure, it copies the project, without `node_modules`, and every command's output to
// `init-check-output/`. A SIGINT or SIGTERM stops every command it started, skips the steps left, cleans up as on a
// failure, and exits 130 or 143.
//
// `--package-manager npm|pnpm|yarn1|yarn4` picks the package manager, which the check declares in the copy's
// `packageManager` field; Yarn runs through Corepack. `--fixture single|monorepo` picks the fixture in
// `fixtures/<name>`, `single` by default.
//
// With `--init-only` it stops after the first `init`, and needs no TEST_STORYBOOK_IMAGE. It's for a machine without
// Docker: besides the fixture's own warnings, init's only warning must be that there's no docker command, naming
// `platform: 'host'`, so where there's a docker command, that step fails.
import { type ChildProcessByStdio, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { connect } from 'node:net'
import { constants, tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, posix, relative, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { type Fixture, fixtureNames, fixtures } from './fixtures.ts'
import {
  configWithImage,
  type PackedManifest,
  packedPackages,
  type Registry,
  startRegistry,
  type Tarball,
} from './local-packages.ts'
import {
  type CommandLine,
  commandLineOf,
  type PackageManager,
  packageManagerNames,
  packageManagers,
  projectFilesOf,
} from './package-managers.ts'
import { printResult } from './print-result.ts'

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
   * Its environment. The check's own, without `GITHUB_STEP_SUMMARY`, when not given.
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
   * The package manager that sets the fixture up, as `--package-manager` names it.
   */
  packageManager: PackageManager
  /**
   * The fixture the check sets up, as `--fixture` names it.
   */
  fixture: Fixture
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
   * The folder of the fixture the project is a copy of.
   */
  fixtureDir: string
  /**
   * That fixture, and what the check expects of it.
   */
  fixture: Fixture
  /**
   * The package manager that sets the project up.
   */
  packageManager: PackageManager
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
   * The dependencies, with the range of each.
   */
  dependencies?: Record<string, string>
  /**
   * The development dependencies, with the range of each.
   */
  devDependencies?: Record<string, string>
}

/**
 * The agent skill's files a refresh rewrites: its `SKILL.md` and its runner script.
 */
interface SkillFiles {
  /**
   * The text of `SKILL.md`.
   */
  markdown: string
  /**
   * The text of `scripts/run.mjs`.
   */
  script: string
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
 * The `visual-check.ts` `init` writes in the config folder.
 */
const expectedModesFile = `import { defineVisualCheck } from '@visual-check/storybook'

// To set options for every story, spread visualCheck into the parameters in your preview file:
//   import { visualCheck } from './visual-check'
//   parameters: { ...visualCheck({}) },
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
 * The addon, which `init` adds to `devDependencies` at its exact version, and `storybook add` to `.storybook/main.js`.
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
 * The folder `init` installs the agent skill in, relative to the project.
 */
const skillFolder = '.agents/skills/visual-check'

/**
 * The agent skill's link for Claude Code, relative to the project.
 */
const skillLink = '.claude/skills/visual-check'

/**
 * Where the skill's link points, relative to the folder that holds it.
 */
const skillLinkTarget = '../../.agents/skills/visual-check'

/**
 * The runner script in this repo, which `init` copies into the skill.
 */
const skillScriptSource = join(repoRoot, 'packages', 'cli', 'skill', 'scripts', 'run.mjs')

/**
 * Gives an error's message, or the thrown value as text when it isn't an `Error`.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Reads the arguments, or gives the problem with them: one the check doesn't know, a package manager that is missing
 * or unknown, or an unknown fixture.
 */
function parseArguments(): Arguments | { problem: string } {
  try {
    const { values } = parseArgs({
      options: {
        'package-manager': { type: 'string' },
        fixture: { type: 'string', default: 'single' },
        'init-only': { type: 'boolean', default: false },
      },
      strict: true,
    })

    return argumentsOf(values['package-manager'], values.fixture, values['init-only'])
  } catch (error) {
    return { problem: messageOf(error) }
  }
}

/**
 * Whether a value is one of a list's.
 */
function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value)
}

/**
 * Gives the arguments, or the problem with them: no package manager named, or a package manager or fixture the check
 * doesn't know.
 */
function argumentsOf(
  packageManager: string | undefined,
  fixture: string,
  initOnly: boolean,
): Arguments | { problem: string } {
  const packageManagerList = packageManagerNames.join(', ')

  if (packageManager === undefined) {
    return { problem: `--package-manager is missing: pass one of ${packageManagerList}.` }
  }

  if (!isOneOf(packageManagerNames, packageManager)) {
    return { problem: `--package-manager must be one of ${packageManagerList}, not ${packageManager}.` }
  }

  if (!isOneOf(fixtureNames, fixture)) {
    return { problem: `--fixture must be one of ${fixtureNames.join(', ')}, not ${fixture}.` }
  }

  return { packageManager: packageManagers[packageManager], fixture: fixtures[fixture], initOnly }
}

/**
 * Lists the problem with Corepack: a package manager that runs through its shim needs the `corepack` command to run.
 */
function corepackProblems(packageManager: PackageManager): string[] {
  if (!packageManager.usesCorepackShim) {
    return []
  }

  const { status, error } = spawnSync('corepack', ['--version'], { stdio: 'ignore' })

  return error === undefined && status === 0
    ? []
    : ["Yarn runs through Corepack, which Node 25 and later don't ship: run npm i -g corepack."]
}

/**
 * Lists the problem with the browser image: a run that starts a Storybook needs `TEST_STORYBOOK_IMAGE`.
 */
function imageProblems({ fixture, initOnly }: Arguments): string[] {
  return initOnly || !fixture.startsStorybook || image
    ? []
    : ['TEST_STORYBOOK_IMAGE is not set: set it to the browser image, such as visual-check-chromium:ci.']
}

/**
 * Lists what the check needs and doesn't have: the built packages, Corepack for Yarn, and the browser image when it
 * starts a Storybook.
 */
function findSetupProblems(parsed: Arguments): string[] {
  return [
    ...builtFiles
      .filter((file) => !existsSync(join(repoRoot, file)))
      .map(
        (file) =>
          `${file} is missing: run the check with pnpm turbo run init-check --filter @visual-check/test-setup ` +
          '-- --package-manager <name>, which builds the packages first.',
      ),
    ...corepackProblems(parsed.packageManager),
    ...imageProblems(parsed),
  ]
}

/**
 * The folder of Corepack's `yarn` shim, in the temporary folder.
 */
function shimFolderOf(check: Check): string {
  return join(check.folder, 'corepack', 'shims')
}

/**
 * The check's own environment without `GITHUB_STEP_SUMMARY`, so no run of the CLI writes the step summary of the CI job
 * running the check. For Yarn, the folder of Corepack's `yarn` shim goes first on the `PATH`, so `yarn` is the version
 * the project's `packageManager` field names, for `init` too. Corepack downloads it without asking into a home in the
 * temporary folder, and changes no `package.json`.
 */
function checkEnvironment(check: Check): NodeJS.ProcessEnv {
  const environment = { ...process.env }

  delete environment.GITHUB_STEP_SUMMARY

  if (!check.packageManager.usesCorepackShim) {
    return environment
  }

  return {
    ...environment,
    PATH: [shimFolderOf(check), environment.PATH].filter((path) => path !== undefined).join(delimiter),
    COREPACK_HOME: join(check.folder, 'corepack', 'home'),
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    COREPACK_ENABLE_AUTO_PIN: '0',
  }
}

/**
 * The check's environment without `CI` either, as on a developer's machine: `update` refuses to run under it.
 */
function localEnvironment(check: Check): NodeJS.ProcessEnv {
  const environment = checkEnvironment(check)

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
    commandLine: commandLineOf({ command, args: [...args] }),
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
    env: options.env ?? checkEnvironment(check),
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
 * Runs a package manager's command line in the project, to the end, or until its time limit kills it.
 *
 * @throws {Error} When the check was interrupted, so it starts no more commands.
 */
async function runInProject(
  check: Check,
  label: string,
  { command, args }: CommandLine,
  env: NodeJS.ProcessEnv = checkEnvironment(check),
): Promise<CommandRun> {
  return await runCommand(check, label, command, args, { cwd: check.project, env })
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
 * Copies the fixture into the temporary folder, without anything a local install left in it, and writes what the
 * package manager needs: the `packageManager` field, the workspace's packages for a monorepo, and the files that point
 * the `@visual-check` scope at the registry with a store and cache of the project's own.
 *
 * @throws {Error} When the registry hasn't started.
 */
function copyFixture(check: Check): void {
  const { folder, project, registry, packageManager } = check

  if (registry === undefined) {
    throw new Error("The registry hasn't started")
  }

  cpSync(check.fixtureDir, project, {
    recursive: true,
    filter: (source) => !['node_modules', 'storybook-static'].includes(basename(source)),
  })

  const { files, manifestFields } = projectFilesOf(packageManager, {
    registryUrl: registry.url,
    folder,
    workspaces: check.fixture.workspaces,
  })
  const manifestPath = join(project, 'package.json')

  for (const [path, content] of Object.entries(files)) {
    writeFileSync(join(project, path), content)
  }

  writeFileSync(
    manifestPath,
    `${JSON.stringify({ ...JSON.parse(readFileSync(manifestPath, 'utf8')), ...manifestFields }, null, 2)}\n`,
  )
}

/**
 * Copies the fixture with what the package manager needs, makes Corepack's `yarn` shim for Yarn, makes the project a
 * git repo, and installs it, as a project that has its dependencies is.
 *
 * @throws {Error} When the registry hasn't started.
 */
async function makeProject(check: Check): Promise<string[]> {
  const { project, packageManager } = check

  copyFixture(check)

  const problems = packageManager.usesCorepackShim ? await makeYarnShim(check) : []

  if (problems.length > 0) {
    return problems
  }

  const gitInit = await runCommand(check, 'git init', 'git', ['init', '-q'], { cwd: project })

  if (gitInit.exitCode !== 0) {
    return exitProblems(gitInit)
  }

  return exitProblems(await runInProject(check, 'install the fixture', packageManager.install))
}

/**
 * Makes Corepack's `yarn` shim in the temporary folder, whose folder goes first on every command's `PATH`. Unlike
 * `corepack enable` without a folder, it changes nothing outside the temporary folder, and neither does Corepack
 * after it, since its home is there too.
 */
async function makeYarnShim(check: Check): Promise<string[]> {
  const shimFolder = shimFolderOf(check)

  mkdirSync(shimFolder, { recursive: true })

  return exitProblems(
    await runCommand(check, 'corepack shim', 'corepack', ['enable', '--install-directory', shimFolder, 'yarn'], {
      cwd: check.folder,
    }),
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
 * Runs `init --yes` the way the package manager runs a package it hasn't installed, at the packed CLI's version,
 * without `CI`, and checks it: it exits 0, prints the fixture's warnings and, with `--init-only`, one that there's no
 * docker command, and no other, writes and adds what it should, and ends with the closing message's CI line.
 */
async function checkInit(check: Check): Promise<string[]> {
  const cliSpec = `@visual-check/cli@${cliTarballOf(check).manifest.version}`
  const run = await runInProject(
    check,
    'init',
    check.packageManager.dlx(cliSpec, ['init', '--yes']),
    localEnvironment(check),
  )
  const problems = exitProblems(run)

  if (problems.length > 0) {
    return problems
  }

  return [
    ...initWarningProblems(check, run.stderr),
    ...writtenFileProblems(check),
    ...manifestProblems(check),
    ...addonProblems(check),
    ...skillProblems(check),
    ...closingLineProblems(run.stdout),
  ]
}

/**
 * Gives the `setup.json` `init` writes in the skill: the package manager's never-downloading form of `visual-check`
 * from the root, and `<pm> run storybook` in the package of each Storybook, each `cwd` relative to the skill's folder.
 */
function expectedSetupFileOf(check: Check): string {
  const cli = check.packageManager.execBin('visual-check', [])
  const start = check.packageManager.runScript('storybook')
  const storybooks = Object.fromEntries(
    Object.entries(check.fixture.skillStorybooks).map(([name, dir]) => [
      name,
      { command: [start.command, ...start.args], cwd: posix.join('../../..', dir) },
    ]),
  )

  return `${JSON.stringify({ cli: { command: [cli.command, ...cli.args], cwd: '../../..' }, storybooks }, null, 2)}\n`
}

/**
 * Lists the problem with a file of the project: it's missing, or its content isn't what `isExpected` wants, which
 * `mismatch` describes.
 */
function projectFileProblems(
  check: Check,
  path: string,
  isExpected: (content: string) => boolean,
  mismatch: (content: string) => string,
): string[] {
  const content = readProjectFile(check, path)

  if (content === undefined) {
    return [`${path} is missing`]
  }

  return isExpected(content) ? [] : [`${path} ${mismatch(content)}`]
}

/**
 * Lists the problem with a file of the project whose content must be exactly `expected`: it's missing, or it differs.
 */
function exactFileProblems(check: Check, path: string, expected: string): string[] {
  return projectFileProblems(
    check,
    path,
    (content) => content === expected,
    (content) => `should be ${JSON.stringify(expected)}, and it is ${JSON.stringify(content)}`,
  )
}

/**
 * Lists the problem with the agent skill's `.claude` link: it must be a symbolic link to the skill's folder, through
 * which its `SKILL.md` is found.
 */
function skillLinkProblems(check: Check): string[] {
  const link = join(check.project, skillLink)

  if (!lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) {
    return [`${skillLink} isn't a symbolic link`]
  }

  const target = readlinkSync(link)

  if (target !== skillLinkTarget) {
    return [`${skillLink} should link to ${skillLinkTarget}, and it links to ${target}`]
  }

  return existsSync(join(link, 'SKILL.md')) ? [] : [`${skillLink} links to ${target}, where there's no SKILL.md`]
}

/**
 * Lists what's wrong with the agent skill `init` installs: its `SKILL.md` must name the CLI's version, its runner
 * script must be this repo's, its `setup.json` must hold the commands that never download, and `.claude` must link to
 * it.
 */
function skillProblems(check: Check): string[] {
  const versionLine = `visual-check-version: ${JSON.stringify(cliTarballOf(check).manifest.version)}`
  const runnerScript = readFileSync(skillScriptSource, 'utf8')

  return [
    ...projectFileProblems(
      check,
      `${skillFolder}/SKILL.md`,
      (content) => content.includes(versionLine),
      () => `doesn't say ${versionLine}`,
    ),
    ...projectFileProblems(
      check,
      `${skillFolder}/scripts/run.mjs`,
      (content) => content === runnerScript,
      () => "isn't the CLI's runner script",
    ),
    ...exactFileProblems(check, `${skillFolder}/setup.json`, expectedSetupFileOf(check)),
    ...skillLinkProblems(check),
  ]
}

/**
 * Gives a path in a package folder of the project, relative to the project, as problems name it: `path` itself for
 * the root.
 */
function pathIn(dir: string, path: string): string {
  return dir === '.' ? path : `${dir}/${path}`
}

/**
 * Lists the problem with each Storybook's `.storybook/main.js` after `init`: it must list the addon, which
 * `storybook add` adds.
 */
function addonProblems(check: Check): string[] {
  return check.fixture.storybookDirs
    .map((dir) => pathIn(dir, '.storybook/main.js'))
    .filter((path) => !readFileSync(join(check.project, path), 'utf8').includes(addonPackage))
    .map((path) => `${path} lists no ${addonPackage}: storybook add didn't add the addon`)
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
 * Lists the problems with init's warnings: it must print each of the fixture's, and no other, except with
 * `--init-only`, for a machine without Docker, exactly one more, which says there's no docker command and names
 * `platform: 'host'`.
 */
function initWarningProblems(check: Check, stderr: string): string[] {
  const warnings = warningsOf(stderr)
  const expected = check.fixture.expectedWarnings
  const missing = expected
    .filter((warning) => !warnings.includes(warning))
    .map((warning) => `init didn't warn: ${warning}`)
  const others = warnings.filter((warning) => !expected.includes(warning))

  return [
    ...missing,
    ...(check.initOnly ? noDockerWarningProblems(others) : others.map((warning) => `init warned: ${warning}`)),
  ]
}

/**
 * Lists the problem with init's warnings besides the fixture's on a machine without Docker: there must be exactly
 * one, which says there's no docker command and names `platform: 'host'`.
 */
function noDockerWarningProblems(others: readonly string[]): string[] {
  if (others.length === 1 && noDockerTexts.every((text) => others.join('').includes(text))) {
    return []
  }

  return [
    `init's only other warning should say ${noDockerTexts.map((text) => JSON.stringify(text)).join(' and ')}, ` +
      `and it warned: ${others.length === 0 ? 'nothing else' : others.join(' | ')}`,
  ]
}

/**
 * Lists each file `init` writes that isn't what it should be: the config and the root `.visual-check/.gitignore`,
 * and each Storybook's `visual-check.ts` and `.visual-check/.gitignore`. Lists the fixture's `.gitignore` too when
 * init changed it.
 */
function writtenFileProblems(check: Check): string[] {
  const expected: [path: string, content: string][] = [
    ['visual-check.config.ts', check.fixture.expectedConfig],
    ['.visual-check/.gitignore', expectedGitignore],
    ...check.fixture.storybookDirs.flatMap((dir): [string, string][] => [
      [pathIn(dir, '.storybook/visual-check.ts'), expectedModesFile],
      [pathIn(dir, '.visual-check/.gitignore'), expectedGitignore],
    ]),
    ['.gitignore', readFileSync(join(check.fixtureDir, '.gitignore'), 'utf8')],
  ]

  // The single fixture's Storybook is at the root, so its `.visual-check/.gitignore` is the root one.
  return [...new Map(expected)].flatMap(([path, content]) => exactFileProblems(check, path, content))
}

/**
 * Reads the scripts, `dependencies` and `devDependencies` of a `package.json`, each empty when it has none.
 */
function readManifest(path: string): Required<Manifest> {
  const { scripts, dependencies, devDependencies } = JSON.parse(readFileSync(path, 'utf8')) as Manifest

  return { scripts: scripts ?? {}, dependencies: dependencies ?? {}, devDependencies: devDependencies ?? {} }
}

/**
 * Gives the exact version of `@visual-check/chromium` the packed CLI names in its `devDependencies`, which `pnpm pack`
 * writes over `workspace:*`.
 *
 * @throws {Error} When that entry is missing or isn't a plain version.
 */
function packedBrowserVersionOf(check: Check): string {
  const browserVersion = cliTarballOf(check).manifest.devDependencies?.['@visual-check/chromium']

  if (browserVersion === undefined || !/^\d+\.\d+\.\d+$/.test(browserVersion)) {
    throw new Error(
      "The packed CLI's package.json names no plain version of @visual-check/chromium in its devDependencies, " +
        `it has ${describedValueOf(browserVersion)}`,
    )
  }

  return browserVersion
}

/**
 * Gives the spec `init` adds each of its own packages at, by the folder of the package it adds them to: the CLI at the
 * packed CLI's exact version and `@visual-check/chromium` at the exact version the packed CLI names in its
 * `devDependencies` at the root, and `@visual-check/storybook` and the addon at the CLI's exact version in each
 * Storybook's package.
 *
 * @throws {Error} When the packed CLI names no plain version of `@visual-check/chromium` in its `devDependencies`.
 */
function addedDependencySpecsOf(check: Check): Map<string, Record<string, string>> {
  const { version } = cliTarballOf(check).manifest
  const specs = new Map<string, Record<string, string>>([
    ['.', { '@visual-check/cli': version, '@visual-check/chromium': packedBrowserVersionOf(check) }],
  ])

  for (const dir of check.fixture.storybookDirs) {
    specs.set(dir, { ...specs.get(dir), '@visual-check/storybook': version, [addonPackage]: version })
  }

  return specs
}

/**
 * Describes a value in a problem: quoted, or `missing` when there's none.
 */
function describedValueOf(value: string | undefined): string {
  return value === undefined ? 'missing' : `"${value}"`
}

/**
 * Gives the scripts `init` adds to the `package.json` in `dir`: the two that run every Storybook at the root, and in a
 * package that gets scripts of its own, the same two names narrowed to its Storybook, run as the package manager runs
 * a binary the root installed.
 */
function addedScriptsIn(check: Check, dir: string): Record<string, string> {
  if (dir === '.') {
    return addedScripts
  }

  const name = check.fixture.packageStorybooks[dir]

  if (name === undefined) {
    return {}
  }

  const { rootBinScript } = check.packageManager

  return {
    'visual:check': rootBinScript('visual-check', ['test', '--storybook', name]),
    'visual:update': rootBinScript('visual-check', ['update', '--storybook', name]),
  }
}

/**
 * Lists what's wrong with the project's `package.json` files after `init`. Each must keep the fixture's scripts and
 * `devDependencies`. The root's gains the two scripts, the CLI at its exact version and the browser at the CLI's range;
 * each Storybook's package gains its own two scripts, narrowed to its Storybook, unless it's the root, and
 * `@visual-check/storybook` and the addon at the CLI's exact version. No package lists another of visual-check's
 * packages.
 */
function manifestProblems(check: Check): string[] {
  return [...addedDependencySpecsOf(check)].flatMap(([dir, addedSpecs]) => {
    const path = pathIn(dir, 'package.json')
    const fixture = readManifest(join(check.fixtureDir, path))
    const { scripts, dependencies, devDependencies } = readManifest(join(check.project, path))
    const expectedScripts = { ...fixture.scripts, ...addedScriptsIn(check, dir) }

    return [
      ...Object.entries(expectedScripts)
        .filter(([name, script]) => scripts[name] !== script)
        .map(
          ([name, script]) =>
            `${path}'s ${name} script should be "${script}", and it is ${describedValueOf(scripts[name])}`,
        ),
      ...Object.entries({ ...fixture.devDependencies, ...addedSpecs })
        .filter(([name, range]) => devDependencies[name] !== range)
        .map(
          ([name, range]) =>
            `${path}'s devDependencies should have ${name} at "${range}", and it is ` +
            describedValueOf(devDependencies[name]),
        ),
      ...Object.keys({ ...dependencies, ...devDependencies })
        .filter((name) => name.startsWith('@visual-check/') && !(name in addedSpecs))
        .map((name) => `${path} shouldn't list ${name}`),
    ]
  })
}

/**
 * Installs the project as it is after `init`, from its lockfile, which must hold everything `init` added, and checks
 * the project has its own `visual-check` binary, so running a script or a binary can't find another one on the PATH,
 * such as this workspace's.
 */
async function installAfterInit(check: Check): Promise<string[]> {
  const problems = exitProblems(await runInProject(check, 'install', check.packageManager.frozenInstall))

  if (problems.length > 0) {
    return problems
  }

  return existsSync(join(check.project, 'node_modules', '.bin', 'visual-check'))
    ? []
    : ["node_modules/.bin/visual-check is missing: the project's own CLI isn't installed"]
}

/**
 * The text `visual-check --help` starts with.
 */
const helpStart = 'Usage: visual-check'

/**
 * The check's environment with no `node_modules/.bin` folder on the `PATH`, such as this workspace's, which holds a
 * `visual-check` too. A script then finds only the binaries its package manager puts on its `PATH`.
 */
function environmentWithoutBins(check: Check): NodeJS.ProcessEnv {
  const environment = checkEnvironment(check)
  const binFolder = join('node_modules', '.bin')

  return {
    ...environment,
    PATH: (environment.PATH ?? '')
      .split(delimiter)
      .filter((folder) => !folder.endsWith(binFolder))
      .join(delimiter),
  }
}

/**
 * Runs the `visual:check` script of each package that gets scripts of its own, in its folder, with `--help`, which
 * needs no Storybook. It must start the CLI the root installed, which prints its help and exits 0.
 */
async function checkPackageScripts(check: Check): Promise<string[]> {
  const problems: string[] = []

  for (const dir of Object.keys(check.fixture.packageStorybooks)) {
    const { command, args } = check.packageManager.runScript('visual:check', ['--help'])
    const run = await runCommand(check, `visual-check in ${dir}`, command, args, {
      cwd: join(check.project, dir),
      env: environmentWithoutBins(check),
    })
    const exit = exitProblems(run)

    if (exit.length > 0) {
      problems.push(...exit.map((problem) => `in ${dir}: ${problem}`))
    } else if (!run.stdout.includes(helpStart)) {
      problems.push(`in ${dir}: ${run.commandLine} printed no help${tailOf(run)}`)
    }
  }

  return problems
}

/**
 * Runs the skill's CLI command from `setup.json`, from its `cwd`, with `--help` and no `node_modules/.bin` folder on
 * the `PATH`. It must start the project's own CLI, which prints its help and exits 0.
 */
async function checkSkillCli(check: Check): Promise<string[]> {
  const setupDir = join(check.project, skillFolder)
  const setup = JSON.parse(readFileSync(join(setupDir, 'setup.json'), 'utf8')) as {
    cli: { command: string[]; cwd: string }
  }
  const [command, ...args] = setup.cli.command

  if (command === undefined) {
    return ['setup.json names no CLI command']
  }

  const run = await runCommand(check, 'skill cli help', command, [...args, '--help'], {
    cwd: resolve(setupDir, setup.cli.cwd),
    env: environmentWithoutBins(check),
  })
  const problems = exitProblems(run)

  return problems.length > 0 || run.stdout.includes(helpStart)
    ? problems
    : [`${run.commandLine} printed no help${tailOf(run)}`]
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

  const { command, args } = check.packageManager.runScript('storybook')
  const storybook = startCommand(check, 'storybook', command, args, { cwd: check.project })

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
 * Reads the agent skill's `SKILL.md` and runner script.
 */
function readSkillFiles(check: Check): SkillFiles {
  return {
    markdown: readFileSync(join(check.project, skillFolder, 'SKILL.md'), 'utf8'),
    script: readFileSync(join(check.project, skillFolder, 'scripts', 'run.mjs'), 'utf8'),
  }
}

/**
 * Writes the agent skill's `SKILL.md` and runner script.
 */
function writeSkillFilesTo(check: Check, files: SkillFiles): void {
  writeFileSync(join(check.project, skillFolder, 'SKILL.md'), files.markdown)
  writeFileSync(join(check.project, skillFolder, 'scripts', 'run.mjs'), files.script)
}

/**
 * Gives the skill's files as an older CLI would have written them: `SKILL.md` at another version, and another runner
 * script.
 *
 * @throws {Error} When `SKILL.md` has no version line, so the stale files wouldn't differ from the fresh ones.
 */
function staleSkillOf(files: SkillFiles): SkillFiles {
  const versionPattern = /visual-check-version: "[^"]*"/

  if (!versionPattern.test(files.markdown)) {
    throw new Error(`${skillFolder}/SKILL.md has no visual-check-version line, so the check can't make it stale`)
  }

  return {
    markdown: files.markdown.replace(versionPattern, 'visual-check-version: "0.0.0-stale"'),
    script: '// An older runner script.\n',
  }
}

/**
 * Runs `update` through its script, without `CI`, after making the agent skill look as an older CLI wrote it, and
 * checks it exits 0, writes the one story's baseline, rewrites `SKILL.md` and the runner script, names them on
 * standard error, and keeps `setup.json`. On a failure, the skill's files stay as `update` left them.
 */
async function checkUpdate(check: Check): Promise<string[]> {
  const fresh = readSkillFiles(check)
  const setupBefore = readProjectFile(check, `${skillFolder}/setup.json`)

  writeSkillFilesTo(check, staleSkillOf(fresh))

  const run = await runInProject(
    check,
    'update',
    check.packageManager.runScript('visual:update'),
    localEnvironment(check),
  )
  const problems = exitProblems(run)

  if (problems.length > 0) {
    return problems
  }

  const baselines = pngFilesIn(join(check.project, '.visual-check', 'baselines'))
  const baselineProblems =
    baselines.length === 1
      ? []
      : [`.visual-check/baselines/ should hold one .png, and it holds ${baselines.length}: ${baselines.join(', ')}`]

  return [...baselineProblems, ...skillRefreshProblems(check, { fresh, setupBefore, run })]
}

/**
 * Lists what's wrong with the agent skill after `update` refreshed it: `SKILL.md` and the runner script must be the
 * fresh ones again, their paths on `update`'s standard error, and `setup.json` as it was.
 */
function skillRefreshProblems(
  check: Check,
  { fresh, setupBefore, run }: { fresh: SkillFiles; setupBefore: string | undefined; run: CommandRun },
): string[] {
  const refreshed = readSkillFiles(check)
  const files: [path: string, rewritten: boolean][] = [
    [`${skillFolder}/SKILL.md`, refreshed.markdown === fresh.markdown],
    [`${skillFolder}/scripts/run.mjs`, refreshed.script === fresh.script],
  ]
  const paths = files.map(([path]) => path)

  return [
    ...files.filter(([, rewritten]) => !rewritten).map(([path]) => `update didn't rewrite ${path}`),
    ...(readProjectFile(check, `${skillFolder}/setup.json`) === setupBefore
      ? []
      : [`update changed ${skillFolder}/setup.json`]),
    ...paths
      .filter((path) => !run.stderr.includes(path))
      .map((path) => `update's standard error doesn't name ${path}${tailOf(run)}`),
  ]
}

/**
 * Runs `test` through its script with `CI` set, after making the agent skill look as an older CLI wrote it, and checks
 * it exits 0 and leaves the skill alone. Then it writes the skill's files back, so `init` again changes nothing.
 */
async function checkTest(check: Check): Promise<string[]> {
  const fresh = readSkillFiles(check)
  const stale = staleSkillOf(fresh)

  writeSkillFilesTo(check, stale)

  try {
    const run = await runInProject(check, 'test', check.packageManager.runScript('visual:check'), {
      ...checkEnvironment(check),
      CI: 'true',
    })
    const problems = exitProblems(run)

    if (problems.length > 0) {
      return problems
    }

    const after = readSkillFiles(check)

    return after.markdown === stale.markdown && after.script === stale.script
      ? []
      : ['test with CI set rewrote the agent skill']
  } finally {
    writeSkillFilesTo(check, fresh)
  }
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
 * Gives the SHA-256 of a file's content, in hex, or for a symbolic link, such as the agent skill's `.claude` link, of
 * where it points.
 */
function sha256Of(path: string): string {
  const content = lstatSync(path).isSymbolicLink() ? `link to ${readlinkSync(path)}` : readFileSync(path)

  return createHash('sha256').update(content).digest('hex')
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
 * Runs `init --yes` again with the installed CLI, without `CI`, and checks it exits 0 without a warning and changes no
 * file git lists.
 */
async function checkInitAgain(check: Check): Promise<string[]> {
  const before = await snapshotProject(check, 'list files before init again')
  const run = await runInProject(
    check,
    'init again',
    check.packageManager.execBin('visual-check', ['init', '--yes']),
    localEnvironment(check),
  )
  const problems = exitProblems(run)

  if (problems.length > 0) {
    return problems
  }

  const after = await snapshotProject(check, 'list files after init again')

  return [...warningProblems('init again', run.stderr), ...snapshotProblems(before, after)]
}

/**
 * Waits until nothing listens on Storybook's port, or the time limit is up. Resolves with whether the port is free.
 */
async function waitForStorybookPortFree(): Promise<boolean> {
  const deadline = Date.now() + storybookStopMilliseconds

  while (Date.now() < deadline) {
    if (!(await isStorybookPortTaken())) {
      return true
    }

    await sleep(200)
  }

  return !(await isStorybookPortTaken())
}

/**
 * Stops the check's own Storybook, if it runs, and waits until its port is free.
 */
async function stopCheckStorybook(check: Check): Promise<string[]> {
  const { storybook } = check

  if (storybook !== undefined) {
    const problems = await stopStorybook(storybook)

    if (problems.length > 0) {
      return problems
    }

    check.storybook = undefined
  }

  return (await waitForStorybookPortFree())
    ? []
    : [`Something still listens on 127.0.0.1:${storybookPort} after the check stopped Storybook`]
}

/**
 * Stops the check's Storybook, then runs the skill's script with `test --all`, without `CI`. It must start Storybook
 * through `setup.json`, exit 0 with only the JSON report on standard output, and stop Storybook again.
 */
async function checkSkillScript(check: Check): Promise<string[]> {
  const stopped = await stopCheckStorybook(check)

  if (stopped.length > 0) {
    return stopped
  }

  const run = await runCommand(
    check,
    'skill script',
    process.execPath,
    [join(check.project, skillFolder, 'scripts', 'run.mjs'), 'test', '--all'],
    { cwd: check.project, env: localEnvironment(check) },
  )
  const portProblems = (await waitForStorybookPortFree())
    ? []
    : [
        `Something still listens on 127.0.0.1:${storybookPort} ${storybookStopMilliseconds / 1000} s after the ` +
          "skill's script ended",
      ]

  return [...exitProblems(run), ...skillReportProblems(run), ...skillStorybookLineProblems(check, run), ...portProblems]
}

/**
 * Lists each line the skill's script didn't print on standard error: that it starts and stops each Storybook.
 */
function skillStorybookLineProblems(check: Check, run: CommandRun): string[] {
  return Object.keys(check.fixture.skillStorybooks)
    .flatMap((name) => [`Starting Storybook ${name} `, `Stopped Storybook ${name}.`])
    .filter((line) => !run.stderr.includes(line))
    .map((line) => `the skill's script didn't say ${JSON.stringify(line)}${tailOf(run)}`)
}

/**
 * Reads the report the skill's script printed on standard output, or gives the problem with it: it printed nothing, or
 * something besides the JSON report.
 */
function skillReportOf(run: CommandRun): { report: { command?: unknown; exitCode?: unknown } } | { problem: string } {
  if (run.stdout.trim() === '') {
    return { problem: `the skill's script printed nothing on standard output${tailOf(run)}` }
  }

  try {
    return { report: JSON.parse(run.stdout) as { command?: unknown; exitCode?: unknown } }
  } catch {
    return { problem: `the skill's script printed something besides the JSON report on standard output${tailOf(run)}` }
  }
}

/**
 * Lists the problem with what the skill's script printed on standard output: it must be only the JSON report of a
 * `test` that exited 0.
 */
function skillReportProblems(run: CommandRun): string[] {
  const parsed = skillReportOf(run)

  if ('problem' in parsed) {
    return [parsed.problem]
  }

  const { report } = parsed

  return report.command === 'test' && report.exitCode === 0
    ? []
    : [`the skill's script's report should be of a test that exited 0, and it is ${JSON.stringify(report)}`]
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
 * Describes what `init` must warn, for the init step's line: the fixture's warnings and, with `--init-only`, that
 * there's no docker command.
 */
function initWarningsDescriptionOf(check: Check): string {
  const noDocker = check.initOnly ? ["that there's no docker command, naming platform: 'host'"] : []
  const warnings = [...check.fixture.warningsDescription, ...noDocker]

  return warnings.length === 0 ? 'without a warning' : `warning only ${warnings.join(' and ')}`
}

/**
 * The step that runs each package's own `visual:check` script, for a fixture whose packages get scripts of their own.
 * None for one whose only Storybook is at the root.
 */
function packageScriptStepsOf(check: Check): Step[] {
  const packageDirs = Object.keys(check.fixture.packageStorybooks)

  if (packageDirs.length === 0) {
    return []
  }

  return [
    {
      name:
        `package scripts: ${commandLineOf(check.packageManager.runScript('visual:check', ['--help']))} in ` +
        `${packageDirs.join(' and ')}, with no other visual-check on the PATH, runs the root's CLI`,
      run: () => checkPackageScripts(check),
    },
  ]
}

/**
 * The steps of the check, in order. `--init-only` stops after the first `init`, and a fixture that starts no Storybook,
 * such as the monorepo, whose Storybooks share a port, after the install that follows it.
 */
function stepsOf(check: Check): Step[] {
  const { packageManager, fixture } = check
  const where = fixture.workspaces === undefined ? '' : ' at the root and in each Storybook package'
  const steps: Step[] = [
    {
      name: 'pack: pnpm pack makes a tarball of each package a project installs',
      run: () => packPackages(check),
    },
    { name: 'registry: a local registry serves the tarballs', run: () => serveTarballs(check) },
    {
      name:
        `project: a copy of the ${fixture.name} fixture, declaring ${packageManager.packageManagerField} and the ` +
        `registry for @visual-check, installs with ${commandLineOf(packageManager.install)}`,
      run: () => makeProject(check),
    },
    {
      name:
        `init: ${commandLineOf(packageManager.dlx('@visual-check/cli', ['init', '--yes']))} exits 0 ` +
        `${initWarningsDescriptionOf(check)}, writes the config, visual-check.ts, .visual-check/.gitignore${where} ` +
        'and the agent skill with its .claude link, adds the scripts, the packages and the addon, leaves .gitignore ' +
        'alone, and ends with the CI line',
      run: () => checkInit(check),
    },
  ]

  if (check.initOnly) {
    return steps
  }

  const install: Step = {
    name:
      `install: ${commandLineOf(packageManager.frozenInstall)} exits 0, and the project has its own visual-check ` +
      'binary',
    run: () => installAfterInit(check),
  }

  const skillCli: Step = {
    name:
      "skill cli: setup.json's CLI command, from its cwd with --help and no node_modules/.bin on the PATH, prints " +
      "the CLI's help",
    run: () => checkSkillCli(check),
  }
  const packageScripts = packageScriptStepsOf(check)

  if (!fixture.startsStorybook) {
    return [...steps, install, skillCli, ...packageScripts]
  }

  return [
    ...steps,
    install,
    skillCli,
    ...packageScripts,
    { name: 'image: the config names the browser image', run: () => addImage(check) },
    {
      name:
        `storybook: ${commandLineOf(packageManager.runScript('storybook'))} answers for index.json within ` +
        `${storybookReadyMilliseconds / 1000} s`,
      run: () => startStorybook(check),
    },
    {
      name:
        `update: ${commandLineOf(packageManager.runScript('visual:update'))} without CI exits 0, writes one ` +
        'baseline, and rewrites the agent skill an older CLI wrote, keeping setup.json',
      run: () => checkUpdate(check),
    },
    {
      name:
        `test: ${commandLineOf(packageManager.runScript('visual:check'))} with CI set exits 0 and leaves the agent ` +
        'skill alone',
      run: () => checkTest(check),
    },
    {
      name:
        `init again: ${commandLineOf(packageManager.execBin('visual-check', ['init', '--yes']))} exits 0 without a ` +
        'warning and changes no file',
      run: () => checkInitAgain(check),
    },
    {
      name:
        `skill: with Storybook stopped, node ${skillFolder}/scripts/run.mjs test --all starts Storybook through ` +
        'setup.json, exits 0 with only the report on stdout, and stops it',
      run: () => checkSkillScript(check),
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
async function runCheck({ packageManager, fixture, initOnly }: Arguments): Promise<number> {
  rmSync(outputDir, { recursive: true, force: true })

  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-init-check-')))
  const check: Check = {
    folder,
    project: join(folder, 'project'),
    fixtureDir: join(packageDir, 'fixtures', fixture.name),
    fixture,
    packageManager,
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

    // The folder goes even when keeping the output fails, such as on a full disk.
    try {
      if (!passed) {
        keepOutput(check)
        console.log(`The project and every command's output are in ${relative(repoRoot, outputDir)}/.`)
      }
    } finally {
      rmSync(folder, { recursive: true, force: true })
      stopListening()
    }
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

  const setupProblems = findSetupProblems(parsed)

  if (setupProblems.length > 0) {
    console.error(setupProblems.join('\n'))

    return 1
  }

  return await runCheck(parsed)
}

process.exitCode = await main()
