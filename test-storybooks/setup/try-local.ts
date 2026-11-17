// Tries this checkout's packages in another project, the way a user would, before they're on npm. It builds and packs
// the packages of the checkout it's in (a worktree included, with its uncommitted changes), serves them from a
// registry on 127.0.0.1 and runs `init` through `pnpm dlx` in the project, with the registry named for the
// `@visual-check` scope through the environment, so no `.npmrc` changes. Then it adds the browser image to the config,
// until the browser package names a published one.
//
// The project must be in a git repo with nothing uncommitted. `--restore` brings it back: it resets the repo to the
// commit it was on, removes every file the try added, `.visual-check/` folders included, and installs again.
//
//   pnpm try-local <project> [--yes] [--image <image>]
//   pnpm try-local --restore <project>
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { configWithImage, type PackedManifest, packedPackages, startRegistry, type Tarball } from './local-packages.ts'

/**
 * What the try records in the project's git folder, for `--restore`.
 */
interface TryRecord {
  /**
   * The commit the project's repo was on.
   */
  head: string
}

/**
 * The repo's root: the checkout this script is in, which may be a worktree.
 */
const repoRoot = join(import.meta.dirname, '..', '..')

/**
 * The file in the project's git folder that holds the record.
 */
const recordName = 'visual-check-try-local.json'

/**
 * The browser image the config names when `--image` names none: the one CI builds.
 */
const defaultImage = 'visual-check-chromium:ci'

/**
 * Each lockfile, and the package manager that installs from it.
 */
const lockfiles = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['package-lock.json', 'npm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
] as const

/**
 * How to run the script.
 */
const usage = [
  'Usage: pnpm try-local <project> [--yes] [--image <image>]',
  '       pnpm try-local --restore <project>',
].join('\n')

/**
 * A problem that stops the script, which it prints before exiting 1.
 */
class StopError extends Error {}

/**
 * Stops the script with the message.
 *
 * @throws {StopError} Always.
 */
function fail(message: string): never {
  throw new StopError(message)
}

/**
 * Runs a command with its output shown, or only its errors when `quiet`.
 *
 * @throws {StopError} When it fails.
 */
function run(command: string, args: readonly string[], cwd: string, quiet = false): void {
  const result = spawnSync(command, args, { cwd, stdio: ['inherit', quiet ? 'ignore' : 'inherit', 'inherit'] })

  if (result.status !== 0) {
    fail(`${[command, ...args].join(' ')} failed in ${cwd}${result.error ? `: ${result.error.message}` : '.'}`)
  }
}

/**
 * Runs git in `cwd` and gives its output, trimmed, or `undefined` when it fails.
 */
function gitOutput(cwd: string, args: readonly string[]): string | undefined {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })

  return result.status === 0 ? result.stdout.trim() : undefined
}

/**
 * Gives the root of the project's git repo.
 *
 * @throws {StopError} When the project isn't in one.
 */
function repoTopOf(project: string): string {
  return (
    gitOutput(project, ['rev-parse', '--show-toplevel']) ??
    fail(`${project} isn't in a git repo, so the try couldn't be undone.`)
  )
}

/**
 * Gives the path of the record in the project's git folder.
 */
function recordPathOf(project: string): string {
  return gitOutput(project, ['rev-parse', '--path-format=absolute', '--git-path', recordName]) ?? fail(usage)
}

/**
 * Packs each package a project installs into `destination`, and reads what it packed.
 */
function packPackages(destination: string): Tarball[] {
  for (const folder of packedPackages) {
    run('pnpm', ['pack', '--pack-destination', destination], join(repoRoot, 'packages', folder), true)
  }

  return readdirSync(destination)
    .filter((file) => file.endsWith('.tgz'))
    .map((file) => {
      const path = join(destination, file)
      const manifest = spawnSync('tar', ['-xzOf', path, 'package/package.json'], { encoding: 'utf8' }).stdout

      return { manifest: JSON.parse(manifest) as PackedManifest, path }
    })
}

/**
 * Runs `init` through `pnpm dlx` in the project, at the packed CLI's version, with the registry named for the
 * `@visual-check` scope and a package cache of its own in `folder`. Gives its exit code. A Ctrl-C reaches `init` too,
 * so the script waits for it to end.
 */
function runInit(project: string, cliVersion: string, registryUrl: string, folder: string, yes: boolean) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    'npm_config_@visual-check:registry': `${registryUrl}/`,
    npm_config_cache_dir: join(folder, 'cache'),
  }

  delete environment.CI

  const args = ['dlx', `@visual-check/cli@${cliVersion}`, 'init', ...(yes ? ['--yes'] : [])]
  const child = spawn('pnpm', args, { cwd: project, stdio: 'inherit', env: environment })
  const waitForInit = () => undefined

  process.on('SIGINT', waitForInit)

  return new Promise<number>((resolveExit) => {
    child.on('error', (error) => {
      console.error(error.message)
      resolveExit(127)
    })
    child.on('close', (code) => {
      process.off('SIGINT', waitForInit)
      resolveExit(code ?? 130)
    })
  })
}

/**
 * Gives the config at `path` with the image added, or `undefined` when there's no config, it names an image already,
 * or it doesn't end as `init` writes it.
 */
function configWithImageAt(path: string, image: string): string | undefined {
  if (!existsSync(path)) {
    return undefined
  }

  const config = readFileSync(path, 'utf8')

  return /^\s*image:/m.test(config) ? undefined : configWithImage(config, image)
}

/**
 * Says how to build the image when Docker doesn't have it.
 */
function hintImageBuild(image: string): void {
  if (spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0) {
    return
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'

  console.log(
    `Docker has no ${image} image. Build it from ${repoRoot}:\n` +
      `  packages/chromium/image/build.sh ${arch} --output type=docker,name=${image}`,
  )
}

/**
 * Adds the browser image to the config `init` wrote, and says how to build the image when Docker doesn't have it.
 */
function addImage(project: string, image: string): void {
  const path = join(project, 'visual-check.config.ts')
  const withImage = configWithImageAt(path, image)

  if (withImage === undefined) {
    console.log(`\nThe config got no image. Name '${image}' under image in it, unless it names one already.`)
  } else {
    writeFileSync(path, withImage)
    console.log(`\nThe config names the image ${image}.`)
  }

  hintImageBuild(image)
}

/**
 * Checks the project can be tried: it has a `package.json`, wasn't tried already, and its repo has nothing
 * uncommitted, so `--restore` can bring it back.
 *
 * @throws {StopError} When it can't.
 */
function checkCanTry(project: string, top: string, recordPath: string): void {
  if (!existsSync(join(project, 'package.json'))) {
    fail(`${project} has no package.json.`)
  }

  if (existsSync(recordPath)) {
    fail(`try-local already ran in ${top}. Run pnpm try-local --restore ${project} first.`)
  }

  if (gitOutput(top, ['status', '--porcelain']) !== '') {
    fail(`${top} has uncommitted changes. Commit or stash them first, so --restore can bring the project back.`)
  }
}

/**
 * Packs the packages into `folder`, serves them, records the project's commit and runs `init`. Gives its exit code.
 */
async function initFromTarballs(
  project: string,
  top: string,
  recordPath: string,
  folder: string,
  yes: boolean,
): Promise<number> {
  const tarballs = packPackages(join(folder, 'tarballs'))
  const cli = tarballs.find(({ manifest }) => manifest.name === '@visual-check/cli') ?? fail('No CLI was packed.')
  const record: TryRecord = { head: gitOutput(top, ['rev-parse', 'HEAD']) ?? fail(`${top} has no commit.`) }
  const registry = await startRegistry(tarballs)

  writeFileSync(recordPath, `${JSON.stringify(record)}\n`)

  return runInit(project, cli.manifest.version, registry.url, folder, yes).finally(registry.stop)
}

/**
 * Builds and packs this checkout's packages, serves them, and runs `init` in the project. Records the project's commit
 * first, so `--restore` can bring it back.
 */
async function tryLocal(project: string, image: string, yes: boolean): Promise<void> {
  const top = repoTopOf(project)
  const recordPath = recordPathOf(project)

  checkCanTry(project, top, recordPath)
  console.log(`Building visual-check from ${gitOutput(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])} at ${repoRoot}`)
  run('pnpm', ['turbo', 'run', 'build', '--filter=@visual-check/test-setup^...', '--output-logs=errors-only'], repoRoot)

  const folder = mkdtempSync(join(tmpdir(), 'visual-check-try-local-'))

  try {
    const exitCode = await initFromTarballs(project, top, recordPath, folder, yes)

    if (exitCode === 0) {
      addImage(project, image)
    } else {
      process.exitCode = exitCode
    }

    console.log(`\nWhen you're done, bring the project back with:\n  pnpm try-local --restore ${project}`)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

/**
 * Gives the project's folder and each folder above it, up to the repo's root.
 */
function foldersUpTo(project: string, top: string): string[] {
  const parts = relative(top, project)
    .split(sep)
    .filter((part) => part !== '')

  return [...parts.map((_, index) => join(top, ...parts.slice(0, parts.length - index))), top]
}

/**
 * Gives the folder nearest to the project, up to the repo's root, that holds a lockfile, and the package manager of
 * that lockfile. Gives `undefined` when there's none.
 */
function nearestLockfileOf(project: string, top: string): { folder: string; packageManager: string } | undefined {
  for (const folder of foldersUpTo(project, top)) {
    const lockfile = lockfiles.find(([name]) => existsSync(join(folder, name)))

    if (lockfile !== undefined) {
      return { folder, packageManager: lockfile[1] }
    }
  }

  return undefined
}

/**
 * Installs again with the package manager whose lockfile is nearest to the project.
 */
function installAgain(project: string, top: string): void {
  const lockfile = nearestLockfileOf(project, top)

  if (lockfile === undefined) {
    console.log('No lockfile was found, so node_modules is as the try left it.')
  } else {
    run(lockfile.packageManager, ['install'], lockfile.folder)
  }
}

/**
 * Brings the project's repo back to the commit it was on before the try: drops every change, removes every file the
 * try added, `.visual-check/` folders included, and installs again.
 */
function restore(project: string): void {
  const top = repoTopOf(project)
  const recordPath = recordPathOf(project)

  if (!existsSync(recordPath)) {
    fail(`try-local has nothing to restore in ${top}.`)
  }

  const { head } = JSON.parse(readFileSync(recordPath, 'utf8')) as TryRecord

  if (gitOutput(top, ['rev-parse', 'HEAD']) !== head) {
    fail(`${top} is no longer on ${head}, where the try started. Reset it yourself, then delete ${recordPath}.`)
  }

  run('git', ['reset', '--hard', '--quiet'], top)
  run('git', ['clean', '-fd'], top)
  run('git', ['clean', '-fdx', '--', ':(glob)**/.visual-check/**'], top)
  installAgain(project, top)
  rmSync(recordPath)
  console.log(`\n${top} is back on ${head}.`)
}

/**
 * Reads the arguments.
 *
 * @throws {StopError} When there isn't exactly one project.
 */
function argumentsOf() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { restore: { type: 'boolean' }, yes: { type: 'boolean' }, image: { type: 'string' } },
  })
  const [target, ...others] = positionals

  if (target === undefined || others.length > 0) {
    fail(usage)
  }

  return { target, ...values }
}

/**
 * Gives the project's real path. pnpm runs the script from the repo root, so a relative path is taken from
 * `INIT_CWD`, where pnpm was called.
 *
 * @throws {StopError} When there's no such folder.
 */
function projectOf(target: string): string {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: pnpm runs this script, not Turbo.
  const project = resolve(process.env.INIT_CWD ?? process.cwd(), target)

  return existsSync(project) ? realpathSync(project) : fail(`${project} doesn't exist.`)
}

/**
 * Tries the packages in the project, or restores it.
 */
async function main(): Promise<void> {
  const { target, restore: restoring, yes, image } = argumentsOf()
  const project = projectOf(target)

  if (restoring === true) {
    restore(project)
  } else {
    await tryLocal(project, image ?? defaultImage, yes === true)
  }
}

try {
  await main()
} catch (error) {
  if (!(error instanceof StopError)) {
    throw error
  }

  console.error(error.message)
  process.exitCode = 1
}
