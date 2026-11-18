import type { ChangedBaseline, ChangedFileRule } from './changed-file-rules.js'

/**
 * A changed file that selects every story of the Storybooks whose graph reaches its package.
 */
interface PackageScopedFile {
  /**
   * The file, relative to the root, `/`-separated.
   */
  file: string
  /**
   * Its package's folder, relative to the root, `/`-separated, and `.` for the root.
   */
  packageFolder: string
  /**
   * Whether it's an asset, which counts only when the graph doesn't hold it.
   */
  asset: boolean
}

/**
 * The changed files that aren't ignored, grouped by what they select.
 */
interface ChangeGroups {
  /**
   * The files the graph is asked about: all but the baselines.
   */
  graphFiles: string[]
  /**
   * The changed baselines.
   */
  baselines: ChangedBaseline[]
  /**
   * The changed files scoped to their package.
   */
  packageScoped: PackageScopedFile[]
}

/**
 * Groups the changed files by the rule `ruleOf` gives each, and finds the package of each package-scoped file with
 * `packageFolderOf`. Gives `ignored` when every file is ignored, and `every-story` when any file that isn't ignored
 * selects every story, looking up no package then.
 */
export async function groupChanges(
  files: readonly string[],
  ruleOf: (file: string) => ChangedFileRule,
  packageFolderOf: (file: string) => Promise<string>,
): Promise<ChangeGroups | 'ignored' | 'every-story'> {
  const ruled = files.map((file) => ({ file, rule: ruleOf(file) })).filter(({ rule }) => rule.kind !== 'ignored')

  if (ruled.length === 0) {
    return 'ignored'
  }

  if (ruled.some(({ rule }) => rule.kind === 'every-story')) {
    return 'every-story'
  }

  const groups: ChangeGroups = { graphFiles: [], baselines: [], packageScoped: [] }

  for (const { file, rule } of ruled) {
    if (rule.kind === 'baseline') {
      groups.baselines.push({ folder: rule.folder, stem: rule.stem })
    } else {
      groups.graphFiles.push(file)
    }
  }

  groups.packageScoped = await Promise.all(
    ruled
      .filter(({ rule }) => rule.kind === 'package' || rule.kind === 'asset')
      .map(async ({ file, rule }) => ({
        file,
        packageFolder: await packageFolderOf(file),
        asset: rule.kind === 'asset',
      })),
  )

  return groups
}

/**
 * Gives the folders of the packages that count as changed: those of the package-scoped files, an asset's only when the
 * graph doesn't hold it. Before the graph answers, `reached` is `undefined` and no asset counts.
 */
export function changedPackagesOf(
  packageScoped: readonly PackageScopedFile[],
  reached: ReadonlySet<string> | undefined,
): Set<string> {
  return new Set(
    packageScoped
      .filter(({ file, asset }) => !asset || (reached !== undefined && !reached.has(file)))
      .map(({ packageFolder }) => packageFolder),
  )
}
