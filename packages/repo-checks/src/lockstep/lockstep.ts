import type { Manifest } from '../workspace/manifests.ts'

/**
 * The packages that always release together at one version.
 *
 * @public
 */
export const lockstepPackages = ['@visual-check/cli', '@visual-check/storybook', '@visual-check/storybook-addon']

/**
 * Lists what keeps the lockstep packages from sharing one version: missing packages and differing versions.
 *
 * @public
 */
export function findLockstepProblems(manifests: readonly Manifest[]): string[] {
  const found = lockstepPackages.flatMap((name) => manifests.filter((manifest) => manifest.name === name))
  const problems = lockstepPackages
    .filter((name) => !found.some((manifest) => manifest.name === name))
    .map((name) => `${name} is missing from the workspace`)

  if (new Set(found.map((manifest) => manifest.version)).size > 1) {
    const versions = found.map((manifest) => `${manifest.name} ${manifest.version}`).join(', ')

    problems.push(`Lockstep packages must share one version: ${versions}`)
  }

  return problems
}
