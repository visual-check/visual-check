import { existsSync, readFileSync } from 'node:fs'
import type { Manifest } from '../workspace/manifests.ts'
import { lockstepPackages } from './lockstep.ts'

/**
 * A package's options in `release-please-config.json` that the check reads.
 */
interface ReleasePleasePackage {
  /**
   * The name release-please gives the package in tags, release titles and plugins.
   */
  component?: string
}

/**
 * A plugin's options in `release-please-config.json` that the check reads.
 */
interface ReleasePleasePluginOptions {
  /**
   * The plugin, such as `linked-versions`.
   */
  type: string
  /**
   * The name of the group a linked-versions plugin links.
   */
  groupName?: string
  /**
   * The components a linked-versions plugin releases at one version.
   */
  components?: string[]
}

/**
 * A plugin in `release-please-config.json`: its type alone, or its type with options.
 */
type ReleasePleasePlugin = string | ReleasePleasePluginOptions

/**
 * The parts of the `release-please-config.json` file that the check reads.
 */
interface ReleasePleaseConfig {
  /**
   * The packages release-please releases, keyed by folder.
   */
  packages: Record<string, ReleasePleasePackage>
  /**
   * The plugins release-please runs.
   */
  plugins?: ReleasePleasePlugin[]
  /**
   * The title release-please reads back from a group's merged release PR.
   */
  'group-pull-request-title-pattern'?: string
}

/**
 * How release-please is set up to release the repository's packages, as the check reads it.
 *
 * @public
 */
export interface ReleasePleaseSetup {
  /**
   * The packages in `release-please-config.json`, keyed by folder.
   */
  packages: Record<string, ReleasePleasePackage>
  /**
   * The plugins in `release-please-config.json`.
   */
  plugins: ReleasePleasePlugin[]
  /**
   * The last released version of each package, keyed by folder, from `.release-please-manifest.json`.
   */
  releasedVersions: Record<string, string>
  /**
   * The `package.json` in each listed folder that has one, keyed by folder.
   */
  manifests: Record<string, Manifest>
  /**
   * The `group-pull-request-title-pattern` in `release-please-config.json`.
   */
  groupPullRequestTitlePattern?: string
}

/**
 * Reads release-please's config and manifest at the repository root, and the `package.json` in each folder the config
 * lists.
 *
 * @public
 */
export function readReleasePleaseSetup(root: URL): ReleasePleaseSetup {
  const config = JSON.parse(readFileSync(new URL('release-please-config.json', root), 'utf8')) as ReleasePleaseConfig
  const releasedVersions: Record<string, string> = JSON.parse(
    readFileSync(new URL('.release-please-manifest.json', root), 'utf8'),
  )
  const pattern = config['group-pull-request-title-pattern']
  const manifests: Record<string, Manifest> = {}

  for (const path of Object.keys(config.packages)) {
    const manifestUrl = new URL(`${path}/package.json`, root)

    if (existsSync(manifestUrl)) {
      manifests[path] = JSON.parse(readFileSync(manifestUrl, 'utf8')) as Manifest
    }
  }

  return {
    packages: config.packages,
    plugins: config.plugins ?? [],
    releasedVersions,
    manifests,
    ...(pattern === undefined ? {} : { groupPullRequestTitlePattern: pattern }),
  }
}

/**
 * Lists what keeps release-please from releasing exactly the lockstep group at one version: a lockstep package it
 * doesn't release or can't link, a linked-versions plugin missing or linking another group, a group title pattern it
 * can't read back, and a manifest version that differs from `package.json`. The browser package releases by itself on
 * its own version line, so its version and options aren't checked.
 *
 * @public
 */
export function findReleasePleaseProblems(setup: ReleasePleaseSetup): string[] {
  const paths = lockstepPackages.map((name) =>
    Object.keys(setup.packages).find((folder) => setup.manifests[folder]?.name === name),
  )
  const lockstepPaths = paths.filter((path) => path !== undefined)
  const unreleased = lockstepPackages
    .filter((_name, index) => paths[index] === undefined)
    .map((name) => `${name} isn't a package in release-please-config.json`)
  const componentless = lockstepPaths
    .filter((path) => setup.packages[path]?.component === undefined)
    .map((path) => `${path} has no component in release-please-config.json, which the linked-versions plugin needs`)

  return [
    ...unreleased,
    ...componentless,
    ...findLinkedVersionsProblems(setup, lockstepPaths),
    ...findVersionProblems(setup, lockstepPaths),
  ]
}

/**
 * Lists what keeps the linked-versions plugin from linking exactly the lockstep folders' components, and release-please
 * from making a release from that group's merged release PR.
 */
function findLinkedVersionsProblems(setup: ReleasePleaseSetup, lockstepPaths: readonly string[]): string[] {
  const linkedPlugins = setup.plugins.filter(
    (plugin): plugin is ReleasePleasePluginOptions => typeof plugin === 'object' && plugin.type === 'linked-versions',
  )
  const [linkedPlugin] = linkedPlugins

  if (linkedPlugins.length !== 1 || linkedPlugin === undefined) {
    return [`release-please-config.json needs one linked-versions plugin, and has ${linkedPlugins.length}`]
  }

  const problems: string[] = []
  const linked = linkedPlugin.components ?? []
  const linkedSet = new Set(linked)
  const group = lockstepPaths.flatMap((path) => setup.packages[path]?.component ?? [])

  if (linkedSet.size !== group.length || !group.every((component) => linkedSet.has(component))) {
    problems.push(
      `The linked-versions plugin links ${linked.join(', ')}, but the lockstep group is ${group.join(', ')}`,
    )
  }

  const pattern = `chore\${scope}: release ${linkedPlugin.groupName} libraries`

  if (setup.groupPullRequestTitlePattern !== pattern) {
    problems.push(
      `group-pull-request-title-pattern must be "${pattern}", the linked-versions plugin's release PR title, or release-please makes no release from that PR (googleapis/release-please#2306)`,
    )
  }

  return problems
}

/**
 * Lists the lockstep folders whose version in `.release-please-manifest.json` differs from their `package.json`.
 */
function findVersionProblems(setup: ReleasePleaseSetup, lockstepPaths: readonly string[]): string[] {
  return lockstepPaths.flatMap((path) => {
    const released = setup.releasedVersions[path]
    const version = setup.manifests[path]?.version

    if (released === version) {
      return []
    }

    return [`${path}: .release-please-manifest.json has ${released ?? 'no version'}, and package.json has ${version}`]
  })
}
