// The no-framework check (PRD 01 › `@visual-check/storybook`: a missing framework never breaks the install, only
// importing that framework's entry fails). It packs `@visual-check/storybook` and installs it alone, with npm and with
// pnpm, each in a project whose only dependency it is. Both install a missing peer that isn't optional, so either
// catches a framework peer that lost `optional`; Yarn installs no peers, so it would add nothing. In each project, no
// framework may resolve from the installed package, the root entry must import, and each framework's entry must fail
// with `ERR_MODULE_NOT_FOUND` for its framework only.
//
// Run it with `pnpm turbo run no-framework-check --filter @visual-check/test-setup`, which builds the package first.
// It prints one line per package manager, then each of its problems, and exits 1 on any. It works in a temporary
// folder, which it removes at the end.
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { frameworkProblemsOf, importProblemsOf, packageEntries } from './no-framework.ts'
import { printResult } from './print-result.ts'

/**
 * A package manager the check installs the package with.
 */
interface PackageManager {
  /**
   * Its command, which names it in the output too.
   */
  command: 'npm' | 'pnpm'
  /**
   * The arguments that install a project's dependencies, running no install scripts.
   */
  installArguments: string[]
}

/**
 * The package managers the check installs the package with, in order.
 */
const packageManagers: PackageManager[] = [
  { command: 'npm', installArguments: ['install', '--no-audit', '--no-fund', '--ignore-scripts'] },
  // Under CI, pnpm takes --frozen-lockfile by default, and the project has no lockfile.
  { command: 'pnpm', installArguments: ['install', '--no-frozen-lockfile', '--ignore-scripts'] },
]

/**
 * The folder of `@visual-check/storybook` in this repo.
 */
const storybookFolder = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'storybook')

/**
 * Why a command failed, for a problem: the error when it didn't start, such as a missing command, else its exit code
 * and the last 20 lines of its output.
 */
function failureOf(run: SpawnSyncReturns<string>): string {
  if (run.error !== undefined) {
    return run.error.message
  }

  return `exited ${run.status}:\n${`${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-20).join('\n')}`
}

/**
 * Packs `@visual-check/storybook` into `destination`, and gives the tarball's path.
 */
function pack(destination: string): string {
  const run = spawnSync('pnpm', ['pack', '--pack-destination', destination], { cwd: storybookFolder, encoding: 'utf8' })

  if (run.status !== 0) {
    throw new Error(`pnpm pack ${failureOf(run)}`)
  }

  const tarballs = readdirSync(destination).filter((name) => name.endsWith('.tgz'))
  const [tarball] = tarballs

  if (tarball === undefined || tarballs.length > 1) {
    throw new Error(`pnpm pack made ${tarballs.length} tarballs of @visual-check/storybook`)
  }

  return join(destination, tarball)
}

/**
 * Installs the tarball alone in a new project in `project` with the package manager, and gives the problems with
 * that project.
 */
function problemsOf(packageManager: PackageManager, project: string, tarball: string): string[] {
  mkdirSync(project)
  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify(
      {
        name: 'no-framework-check',
        private: true,
        type: 'module',
        dependencies: { '@visual-check/storybook': `file:${tarball}` },
      },
      null,
      2,
    )}\n`,
  )

  const install = spawnSync(packageManager.command, packageManager.installArguments, { cwd: project, encoding: 'utf8' })

  if (install.status !== 0) {
    return [`${packageManager.command} install ${failureOf(install)}`]
  }

  const installed = realpathSync(join(project, 'node_modules', '@visual-check', 'storybook'))
  const require = createRequire(join(installed, 'package.json'))
  const problems = frameworkProblemsOf((specifier) => require.resolve(specifier))

  for (const [index, entry] of packageEntries.entries()) {
    const file = join(project, `import-${index}.mjs`)

    writeFileSync(file, `import '${entry.specifier}'\n`)

    const run = spawnSync(process.execPath, [file], { cwd: project, encoding: 'utf8' })

    problems.push(...importProblemsOf(entry, run))
  }

  return problems
}

if (!existsSync(join(storybookFolder, 'dist', 'index.js'))) {
  console.error(
    'packages/storybook/dist/index.js is missing. Run `pnpm turbo run no-framework-check --filter ' +
      '@visual-check/test-setup`, which builds it first.',
  )
  process.exit(1)
}

const temporary = mkdtempSync(join(tmpdir(), 'visual-check-no-framework-'))

try {
  const packed = join(temporary, 'packed')

  mkdirSync(packed)

  const tarball = pack(packed)

  for (const packageManager of packageManagers) {
    const started = performance.now()
    const problems = problemsOf(packageManager, join(temporary, packageManager.command), tarball)

    printResult(packageManager.command, (performance.now() - started) / 1000, problems)

    if (problems.length > 0) {
      process.exitCode = 1
    }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
