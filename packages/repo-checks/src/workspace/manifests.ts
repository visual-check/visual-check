import { existsSync, readdirSync, readFileSync } from 'node:fs'

/**
 * The repository root, resolved from this file's location.
 *
 * @public
 */
export const repoRoot = new URL('../../../../', import.meta.url)

/**
 * The fields of a workspace package's `package.json` that the checks read.
 *
 * @public
 */
export interface Manifest {
  /**
   * The package name.
   */
  name: string
  /**
   * The package version.
   */
  version: string
  /**
   * Whether the package is kept off npm.
   */
  private?: boolean
  /**
   * Run-time dependencies.
   */
  dependencies?: Record<string, string>
  /**
   * Optional run-time dependencies.
   */
  optionalDependencies?: Record<string, string>
  /**
   * Peer dependencies.
   */
  peerDependencies?: Record<string, string>
}

/**
 * Reads the manifest of every workspace package under `packages/`, skipping directories without one.
 *
 * @public
 */
export function readWorkspaceManifests(root: URL): Manifest[] {
  const packagesDir = new URL('packages/', root)
  const manifests: Manifest[] = []
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    const manifestUrl = new URL(`${entry.name}/package.json`, packagesDir)
    if (entry.isDirectory() && existsSync(manifestUrl)) {
      manifests.push(JSON.parse(readFileSync(manifestUrl, 'utf8')) as Manifest)
    }
  }
  return manifests
}
