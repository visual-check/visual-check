import type { Manifest } from '../workspace/manifests.ts'

/**
 * Lists every dependency on Playwright declared by a published package, as `<package name>: <dependency name>`.
 */
export function findPlaywrightDependents(manifests: readonly Manifest[]): string[] {
  return manifests
    .filter((manifest) => !manifest.private)
    .flatMap((manifest) =>
      [manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies]
        .flatMap((dependencies) => Object.keys(dependencies ?? {}))
        .filter((dependency) => dependency.includes('playwright'))
        .map((dependency) => `${manifest.name}: ${dependency}`),
    )
}
