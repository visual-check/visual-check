import { isAbsolute, posix, resolve } from 'node:path'
import { baselineNamesStory, type ChangedBaseline, rootRelative } from './changed-file-rules.js'

/**
 * A Storybook, as the affected stories rules read it.
 */
export interface AffectedStorybookInput {
  /**
   * The folder the Storybook runs in, an absolute path.
   */
  dir: string
  /**
   * The Storybook's config folder, an absolute path.
   */
  configDir: string
  /**
   * The Storybook's stories files, as `index.json` gives their import paths: relative to `dir`, such as
   * `./stories/card.stories.tsx`.
   */
  storiesFiles: readonly string[]
  /**
   * The folder that holds the Storybook's baselines, an absolute path.
   */
  baselines: string
  /**
   * The IDs of the Storybook's stories.
   */
  storyIds: readonly string[]
}

/**
 * Which of a Storybook's stories are affected: all of them, or those of some stories files plus some stories by ID.
 *
 * @public
 */
export type AffectedStorybook =
  | {
      /**
       * Every story of the Storybook is affected.
       */
      all: true
    }
  | {
      /**
       * Only the stories of `storiesFiles` and the stories of `storyIds` are affected.
       */
      all: false
      /**
       * The affected stories files, as the import paths the Storybook's input gives them.
       */
      storiesFiles: ReadonlySet<string>
      /**
       * The IDs of the stories affected besides those of `storiesFiles`, such as a changed baseline's story.
       */
      storyIds: ReadonlySet<string>
    }

/**
 * What the changed files reach, as the rules read it, before any Storybook's stories are read.
 */
export interface ChangeReach {
  /**
   * The project root that `reached` and `changedFiles` are relative to, an absolute path.
   */
  root: string
  /**
   * The graph files reached walking back from the changed files, relative to the root, `/`-separated.
   */
  reached: ReadonlySet<string>
  /**
   * The changed files the graph is asked about, relative to the root, `/`-separated: every changed file but the
   * ignored ones and the baselines.
   */
  changedFiles: readonly string[]
  /**
   * The packages whose changed files select every story of the Storybooks whose graph reaches them, relative to the
   * root, `/`-separated, and `.` for the root.
   */
  changedPackages: ReadonlySet<string>
  /**
   * The graph files reached walking back from every graph file under `changedPackages`, relative to the root,
   * `/`-separated.
   */
  reachedFromPackages: ReadonlySet<string>
  /**
   * The changed baselines.
   */
  changedBaselines: readonly ChangedBaseline[]
}

/**
 * Tells whether a root-relative path leaves the root: it is `..`, starts with `../`, or is absolute, as a path on
 * another Windows drive is.
 */
function isOutsideRoot(rootRelativePath: string): boolean {
  return rootRelativePath === '..' || rootRelativePath.startsWith('../') || isAbsolute(rootRelativePath)
}

/**
 * Gives the root-relative folders that hold a changed or reached file whose name starts with `preview` or `main`,
 * whatever its case.
 */
function foldersWithConfigFilesOf(...fileLists: Iterable<string>[]): Set<string> {
  const folders = new Set<string>()

  for (const files of fileLists) {
    for (const file of files) {
      const name = posix.basename(file).toLowerCase()

      if (name.startsWith('preview') || name.startsWith('main')) {
        folders.add(posix.dirname(file))
      }
    }
  }

  return folders
}

/**
 * Tells whether a root-relative folder is a package folder or inside one. Package folders cover whole path segments,
 * and `.` covers every folder.
 */
function isInPackage(folder: string, packageFolders: ReadonlySet<string>): boolean {
  return [...packageFolders].some(
    (packageFolder) => packageFolder === '.' || folder === packageFolder || folder.startsWith(`${packageFolder}/`),
  )
}

/**
 * A Storybook's paths, relative to the root, `/`-separated.
 */
interface StorybookPaths {
  /**
   * The Storybook's folder, `.` for the root.
   */
  folder: string
  /**
   * The Storybook's config folder, `.` for the root.
   */
  configFolder: string
  /**
   * The import path of each stories file, by the file's path.
   */
  storiesFiles: Map<string, string>
}

/**
 * Gives a Storybook's paths relative to the root.
 */
function pathsOf(root: string, storybook: AffectedStorybookInput): StorybookPaths {
  return {
    folder: rootRelative(root, storybook.dir) || '.',
    configFolder: rootRelative(root, storybook.configDir) || '.',
    storiesFiles: new Map(
      storybook.storiesFiles.map((importPath) => [rootRelative(root, resolve(storybook.dir, importPath)), importPath]),
    ),
  }
}

/**
 * Tells whether a Storybook's graph reaches a changed package: the root is one, its folder is inside one, or
 * `reachedFromPackages` holds one of its stories files or, by `configFoldersReachedFromPackages`, a `preview*` or
 * `main*` file directly in its config folder.
 */
function reachesChangedPackage(
  paths: StorybookPaths,
  reach: ChangeReach,
  configFoldersReachedFromPackages: ReadonlySet<string>,
): boolean {
  const { changedPackages, reachedFromPackages } = reach

  if (changedPackages.size === 0) {
    return false
  }

  return (
    isInPackage(paths.folder, changedPackages) ||
    configFoldersReachedFromPackages.has(paths.configFolder) ||
    [...paths.storiesFiles.keys()].some((path) => reachedFromPackages.has(path))
  )
}

/**
 * Gives the IDs of a Storybook's stories that a changed baseline in its baselines folder names.
 */
function storyIdsOfBaselines(
  storybook: AffectedStorybookInput,
  changedBaselines: readonly ChangedBaseline[],
): string[] {
  const stems = changedBaselines.filter(({ folder }) => folder === storybook.baselines).map(({ stem }) => stem)

  return storybook.storyIds.filter((id) => stems.some((stem) => baselineNamesStory(stem, id)))
}

/**
 * Works out each Storybook's affected stories from the reached and the changed files, the changed packages and the
 * changed baselines. A Storybook has every story affected when:
 *
 * - its folder or config folder is outside the root, since git doesn't see its changes;
 * - a changed or reached `preview*` or `main*` file sits directly in its config folder. Names are compared lowercased,
 *   since the file system may not tell `Preview.tsx` from `preview.tsx`, and the prefixes also match files such as
 *   `previewer.ts` or `maintenance.ts`: selecting too many stories is accepted over missing one. Changed files count
 *   for the config files only, since some, such as `preview-head.html` or a deleted `preview.ts`, aren't in the graph;
 * - its graph reaches a changed package: the root is one, its folder is inside one, or `reachedFromPackages` holds one
 *   of its stories files or a `preview*` or `main*` file directly in its config folder.
 *
 * Otherwise its reached stories files are affected, plus the stories a changed baseline in its baselines folder names.
 */
export function affectedStorybooksOf(
  reach: ChangeReach,
  storybooks: readonly AffectedStorybookInput[],
): AffectedStorybook[] {
  const { root, reached } = reach
  const configFolders = foldersWithConfigFilesOf(reach.changedFiles, reached)
  const configFoldersReachedFromPackages = foldersWithConfigFilesOf(reach.reachedFromPackages)

  return storybooks.map((storybook): AffectedStorybook => {
    const paths = pathsOf(root, storybook)

    if (
      isOutsideRoot(paths.folder) ||
      isOutsideRoot(paths.configFolder) ||
      configFolders.has(paths.configFolder) ||
      reachesChangedPackage(paths, reach, configFoldersReachedFromPackages)
    ) {
      return { all: true }
    }

    const storiesFiles = [...paths.storiesFiles]
      .filter(([path]) => reached.has(path))
      .map(([, importPath]) => importPath)

    return {
      all: false,
      storiesFiles: new Set(storiesFiles),
      storyIds: new Set(storyIdsOfBaselines(storybook, reach.changedBaselines)),
    }
  })
}
