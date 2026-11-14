import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const packageName = '@visual-check/chromium'

/**
 * A package manager the install command can be written for.
 */
export type PackageManager = 'npm' | 'pnpm' | 'yarn'

/**
 * Reads the majors out of a range: one or more `^N.0.0` joined by `||`. Throws on any other shape, because the range
 * comes from this package's own package.json.
 */
export function parseMajors(range: string): number[] {
  const majors = range.split('||').map((part) => /^\^(\d+)\.0\.0$/.exec(part.trim())?.[1])

  if (majors.some((major) => major === undefined)) {
    throw new Error(`The peer range of ${packageName} must be one or more ^N.0.0 joined by ||, got "${range}".`)
  }

  return majors.map(Number)
}

/**
 * Tells whether a version is a plain release of one of the majors. Prereleases and malformed versions are out.
 */
export function isInRange(version: string, majors: number[]): boolean {
  const match = /^(\d+)\.\d+\.\d+$/.exec(version)

  return match !== null && majors.includes(Number(match[1]))
}

/**
 * Builds the command that installs the newest major of the browser package.
 */
export function installCommand(packageManager: PackageManager, major: number): string {
  const specifier = `${packageName}@${major}`

  if (packageManager === 'pnpm') {
    return `pnpm add --save-dev ${specifier}`
  }

  if (packageManager === 'yarn') {
    return `yarn add --dev ${specifier}`
  }

  return `npm install --save-dev ${specifier}`
}

/**
 * What was found when looking for the browser package.
 */
export type Installed =
  | { status: 'missing' }
  | { status: 'unreadable'; reason: string }
  | { status: 'found'; version: string }

/**
 * Builds the message for a browser package that is missing, can't be read, or is outside the range. For a version
 * above every major in the range, it also suggests upgrading the CLI.
 */
export function browserPackageMessage(installed: Installed, range: string, majors: number[], command: string): string {
  if (installed.status === 'missing') {
    return `The browser package ${packageName} isn't installed. This CLI needs a version in ${range}.\nInstall it: ${command}\n`
  }

  if (installed.status === 'unreadable') {
    return `The browser package ${packageName} can't be read: ${installed.reason}.\nReinstall it: ${command}\n`
  }

  const message = `The browser package ${packageName} ${installed.version} is outside this CLI's range ${range}.\nInstall a version in range: ${command}\n`
  const installedMajor = Number(installed.version.split('.')[0])

  if (installedMajor > Math.max(...majors)) {
    return `${message}Or upgrade @visual-check/cli to a version whose range includes ${installedMajor}.\n`
  }

  return message
}

/**
 * Names the package manager at the start of the `npm_config_user_agent` value. Anything else is npm.
 */
function packageManagerOf(environment: Record<string, string | undefined>): PackageManager {
  const name = environment.npm_config_user_agent?.split('/')[0]

  return name === 'pnpm' || name === 'yarn' ? name : 'npm'
}

/**
 * Looks for the browser package and reads its version.
 */
function findInstalled(): Installed {
  try {
    const manifestPath = createRequire(import.meta.url).resolve(`${packageName}/package.json`)
    const { version } = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }

    return typeof version === 'string'
      ? { status: 'found', version }
      : { status: 'unreadable', reason: 'its package.json has no version' }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      return { status: 'missing' }
    }

    return { status: 'unreadable', reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Checks that the installed browser package is in this CLI's range. Returns the message to print when it is missing,
 * can't be read or is out of range, and `undefined` when it is fine. The environment names the package manager
 * the install command is written for.
 *
 * @public
 */
export function checkBrowserPackage(environment: Record<string, string | undefined>): string | undefined {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    peerDependencies: Record<string, string>
  }
  const range = manifest.peerDependencies[packageName]

  if (range === undefined) {
    throw new Error(`package.json has no peer dependency on ${packageName}.`)
  }

  const majors = parseMajors(range)
  const installed = findInstalled()

  if (installed.status === 'found' && isInRange(installed.version, majors)) {
    return undefined
  }

  const command = installCommand(packageManagerOf(environment), Math.max(...majors))

  return browserPackageMessage(installed, range, majors, command)
}
