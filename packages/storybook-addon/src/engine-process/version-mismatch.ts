/**
 * A number without leading zeros.
 */
const numberPattern = '0|[1-9]\\d*'

/**
 * A prerelease identifier: a number without leading zeros, or text with a letter or `-`.
 */
const prereleasePattern = `(?:${numberPattern}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`

/**
 * A version in the form `major.minor.patch[-prerelease][+build]`.
 */
const versionPattern = new RegExp(
  `^(${numberPattern})\\.(${numberPattern})\\.(${numberPattern})` +
    `(?:-(${prereleasePattern}(?:\\.${prereleasePattern})*))?` +
    '(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$',
)

/**
 * What orders a version: its three numbers, then its prerelease identifiers, which a release has none of.
 */
interface Precedence {
  /**
   * The major, minor and patch numbers, as written.
   */
  numbers: string[]
  /**
   * The prerelease identifiers, empty for a release.
   */
  prerelease: string[]
}

/**
 * Reads what orders a version, or `undefined` when it isn't one.
 */
function precedenceOf(version: string): Precedence | undefined {
  const match = versionPattern.exec(version)

  if (match === null) {
    return undefined
  }

  const [, major = '', minor = '', patch = '', prerelease] = match

  return { numbers: [major, minor, patch], prerelease: prerelease === undefined ? [] : prerelease.split('.') }
}

/**
 * Whether an identifier is a number.
 */
function isNumeric(identifier: string): boolean {
  return /^\d+$/.test(identifier)
}

/**
 * Compares two numbers without leading zeros, which may be beyond what a JavaScript number holds exactly.
 */
function compareNumbers(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length - right.length
  }

  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Compares two prerelease identifiers: numbers by value, below the others, which compare as text.
 */
function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = isNumeric(left)
  const rightNumeric = isNumeric(right)

  if (leftNumeric && rightNumeric) {
    return compareNumbers(left, right)
  }

  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1
  }

  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Compares two prerelease lists. A release, with none, is above its prereleases; a longer list is above its start.
 */
function comparePrereleases(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return right.length - left.length
  }

  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const order = compareIdentifiers(left[index] ?? '', right[index] ?? '')

    if (order !== 0) {
      return order
    }
  }

  return left.length - right.length
}

/**
 * Compares two versions by semver precedence. Gives `undefined` when either isn't a version.
 */
function compareVersions(left: string, right: string): number | undefined {
  const leftPrecedence = precedenceOf(left)
  const rightPrecedence = precedenceOf(right)

  if (leftPrecedence === undefined || rightPrecedence === undefined) {
    return undefined
  }

  for (let index = 0; index < leftPrecedence.numbers.length; index++) {
    const order = compareNumbers(leftPrecedence.numbers[index] ?? '', rightPrecedence.numbers[index] ?? '')

    if (order !== 0) {
      return order
    }
  }

  return comparePrereleases(leftPrecedence.prerelease, rightPrecedence.prerelease)
}

/**
 * Says what to do when the addon and the CLI it runs are at different versions, or gives `undefined` when they're at
 * one. It names the older package, or says to install one version of both when the two can't be ordered.
 */
export function versionProblemOf(addonVersion: string, cliVersion: string): string | undefined {
  if (addonVersion === cliVersion) {
    return undefined
  }

  const order = compareVersions(addonVersion, cliVersion)
  const opening =
    `The Storybook addon is @visual-check/storybook-addon ${addonVersion} and runs @visual-check/cli ${cliVersion}, ` +
    'but they run only at one version.'

  if (order === undefined || order === 0) {
    return `${opening} Install one version of both, then restart Storybook.`
  }

  return order > 0
    ? `${opening} Upgrade @visual-check/cli to ${addonVersion}, then restart Storybook.`
    : `${opening} Upgrade @visual-check/storybook-addon to ${cliVersion}, then restart Storybook.`
}
