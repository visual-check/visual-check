import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { StorybookError } from './storybook-error.js'

/**
 * Where a Storybook version stands against the versions visual-check supports.
 */
type VersionStanding = 'supported' | 'below-minimum' | 'above-maximum' | 'unknown'

/**
 * The oldest supported release line.
 */
const minimumVersion = { major: 9, minor: 1 }

/**
 * The newest supported major version.
 */
const newestSupportedMajor = 11

/**
 * The oldest supported release line as text, such as `9.1`.
 */
const minimumText = `${minimumVersion.major}.${minimumVersion.minor}`

/**
 * Compares a version's major.minor with the supported range, from the minimum release line to the newest supported
 * major. A prerelease counts as its release line. A version that isn't `<major>.<minor>.<patch>` with an optional
 * `-prerelease` and `+build` is `unknown`, and so is one with major 0: Storybook's canary builds are `0.0.0-pr-...`.
 */
export function classifyStorybookVersion(version: string): VersionStanding {
  const match = /^(\d+)\.(\d+)\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version)

  if (match === null) {
    return 'unknown'
  }

  const major = Number(match[1])
  const minor = Number(match[2])

  if (major === 0) {
    return 'unknown'
  }

  if (major < minimumVersion.major || (major === minimumVersion.major && minor < minimumVersion.minor)) {
    return 'below-minimum'
  }

  return major > newestSupportedMajor ? 'above-maximum' : 'supported'
}

/**
 * Reads the `version` of a `package.json` file. Returns `undefined` when the file can't be read or parsed, or has no
 * string `version`.
 */
function readVersionOf(path: string): string | undefined {
  try {
    const { version } = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }

    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

/**
 * Finds the version of the `storybook` package installed for `dir`: the first `node_modules/storybook/package.json`
 * in `dir` or a parent folder, so a hoisted install counts. Node's own resolution isn't used, because it also looks in
 * global folders, such as the ones `NODE_PATH` names. Returns `undefined` when there's no install, or the nearest one
 * has no readable version; a farther install is never read instead. Yarn Plug'n'Play has no `node_modules`, so the
 * check is skipped there.
 */
export function readInstalledStorybookVersion(dir: string): string | undefined {
  let folder = dir

  for (;;) {
    const path = join(folder, 'node_modules', 'storybook', 'package.json')

    if (existsSync(path)) {
      return readVersionOf(path)
    }

    const parent = dirname(folder)

    if (parent === folder) {
      return undefined
    }

    folder = parent
  }
}

/**
 * Checks the `storybook` version installed for the Storybook's folder. A version that can't be read or isn't a
 * version is skipped. Returns a warning for a version above the newest supported major, and `undefined` otherwise.
 *
 * @throws {StorybookError} For a version below the minimum release line.
 *
 * @public
 */
export function checkStorybookVersion(storybook: { name: string; dir: string }, cwd: string): string | undefined {
  const version = readInstalledStorybookVersion(storybook.dir)

  if (version === undefined) {
    return undefined
  }

  const standing = classifyStorybookVersion(version)

  if (standing === 'below-minimum') {
    throw new StorybookError(
      `Storybook ${storybook.name} runs storybook ${version}, and visual-check needs ${minimumText} or later. ` +
        `Upgrade storybook in ${relative(cwd, storybook.dir) || 'the current folder'}.`,
    )
  }

  if (standing === 'above-maximum') {
    return (
      `Warning: Storybook ${storybook.name} runs storybook ${version}, ` +
      `and visual-check supports ${minimumText} to ${newestSupportedMajor}. The run carries on.`
    )
  }

  return undefined
}
