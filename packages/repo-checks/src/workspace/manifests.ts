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
  /**
   * The subpaths the package exports, each to a file or to a map of conditions to files.
   */
  exports?: Record<string, string | Record<string, string>>
  /**
   * The root entry's declaration file, for resolvers that ignore `exports`.
   */
  types?: string
  /**
   * Declaration files by TypeScript version range and subpath, for resolvers that ignore `exports`.
   */
  typesVersions?: Record<string, Record<string, string[]>>
}

/**
 * A workspace package under `packages/`: its directory and its manifest.
 *
 * @public
 */
export interface WorkspacePackage {
  /**
   * The package's directory, ending in a slash.
   */
  directory: URL
  /**
   * The package's `package.json`.
   */
  manifest: Manifest
}

/**
 * Reads every workspace package under `packages/`, skipping directories without a manifest.
 *
 * @public
 */
export function readWorkspacePackages(root: URL): WorkspacePackage[] {
  const packagesDirectory = new URL('packages/', root)
  const packages: WorkspacePackage[] = []

  for (const entry of readdirSync(packagesDirectory, { withFileTypes: true })) {
    const directory = new URL(`${entry.name}/`, packagesDirectory)
    const manifestUrl = new URL('package.json', directory)

    if (entry.isDirectory() && existsSync(manifestUrl)) {
      packages.push({ directory, manifest: JSON.parse(readFileSync(manifestUrl, 'utf8')) as Manifest })
    }
  }

  return packages
}

/**
 * Reads the manifest of every workspace package under `packages/`, skipping directories without one.
 *
 * @public
 */
export function readWorkspaceManifests(root: URL): Manifest[] {
  return readWorkspacePackages(root).map((workspacePackage) => workspacePackage.manifest)
}
