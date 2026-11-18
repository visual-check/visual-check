import type { ChangedFileRule } from './changed-file-rules.js'
import { packageFolderFinder } from './package-folder.js'

/**
 * A changed baseline.
 */
export interface ChangedBaseline {
  /**
   * The baselines folder that holds it, an absolute path.
   */
  folder: string
  /**
   * Its file name without `.png`, in NFC.
   */
  stem: string
}

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
 * The changed files that aren't ignored, sorted by what they select.
 */
interface SortedChanges {
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
 * Sorts the changed files by the rule each falls under. Gives `ignored` when every file is ignored, and `every-story`
 * when any file that isn't ignored selects every story.
 */
export async function sortChanges(
  root: string,
  files: readonly string[],
  ruleOf: (file: string) => ChangedFileRule,
): Promise<SortedChanges | 'ignored' | 'every-story'> {
  const ruled = files.map((file) => ({ file, rule: ruleOf(file) })).filter(({ rule }) => rule.kind !== 'ignored')

  if (ruled.length === 0) {
    return 'ignored'
  }

  if (ruled.some(({ rule }) => rule.kind === 'every-story')) {
    return 'every-story'
  }

  const packageFolderOf = packageFolderFinder(root)
  const sorted: SortedChanges = { graphFiles: [], baselines: [], packageScoped: [] }

  for (const { file, rule } of ruled) {
    if (rule.kind === 'baseline') {
      sorted.baselines.push({ folder: rule.folder, stem: rule.stem })
    } else {
      sorted.graphFiles.push(file)
    }
  }

  sorted.packageScoped = await Promise.all(
    ruled
      .filter(({ rule }) => rule.kind === 'package' || rule.kind === 'asset')
      .map(async ({ file, rule }) => ({
        file,
        packageFolder: await packageFolderOf(file),
        asset: rule.kind === 'asset',
      })),
  )

  return sorted
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
