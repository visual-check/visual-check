import { realpath } from 'node:fs/promises'
import { isAbsolute, posix, resolve } from 'node:path'
import { baselineNamesStory, type ChangedBaseline, changedFileRuleOf, rootRelative } from './changed-file-rules.js'
import type { FindReachedFiles } from './fallow-graph.js'
import { changedFilesOf } from './git-changes.js'
import { changedPackagesOf, groupChanges } from './group-changes.js'
import { packageFolderFinder } from './package-folder.js'

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
 * The affected stories of each Storybook, and what they were worked out from.
 *
 * @public
 */
export interface AffectedStories {
  /**
   * The SHA of the base, `null` when git can't tell.
   */
  base: string | null
  /**
   * How many files changed since the base, `null` when git can't tell.
   */
  changedFiles: number | null
  /**
   * Why every story is affected, when the affected stories can't be worked out; else `null`.
   */
  fallback: string | null
  /**
   * The affected stories of each Storybook, in the order the Storybooks were given.
   */
  storybooks: AffectedStorybook[]
}

/**
 * What `affectedStorybooksOf` reads.
 */
interface AffectedStorybooksInput {
  /**
   * The project root that `reached` and `changedFiles` are relative to, an absolute path.
   */
  root: string
  /**
   * The Storybooks.
   */
  storybooks: readonly AffectedStorybookInput[]
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
 * What `workOutAffectedStories` reads.
 */
interface WorkOutAffectedStoriesOptions {
  /**
   * The ref `--base` names, `undefined` when it isn't given.
   */
  baseRef: string | undefined
  /**
   * The environment, for `GITHUB_BASE_REF`.
   */
  environment: Record<string, string | undefined>
  /**
   * The folder to run in, anywhere in the repository.
   */
  cwd: string
  /**
   * The Storybooks.
   */
  storybooks: readonly AffectedStorybookInput[]
  /**
   * The baselines folder of every configured Storybook, those the run leaves out included, absolute paths. A changed
   * `.png` directly in one is a baseline, which selects nothing in a Storybook the run leaves out.
   */
  baselinesFolders: readonly string[]
  /**
   * visual-check's config file, an absolute path.
   */
  configPath: string
  /**
   * The globs, relative to the config file's folder, whose matches select every story or nothing.
   */
  affected: {
    /**
     * A changed file that matches selects every story.
     */
    selectAll: readonly string[]
    /**
     * A changed file that matches selects nothing.
     */
    ignore: readonly string[]
  }
  /**
   * Finds the files the changed files reach.
   */
  findReachedFiles: FindReachedFiles
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
  input: AffectedStorybooksInput,
  configFoldersReachedFromPackages: ReadonlySet<string>,
): boolean {
  const { changedPackages, reachedFromPackages } = input

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
export function affectedStorybooksOf(input: AffectedStorybooksInput): AffectedStorybook[] {
  const { root, storybooks, reached } = input
  const configFolders = foldersWithConfigFilesOf(input.changedFiles, reached)
  const configFoldersReachedFromPackages = foldersWithConfigFilesOf(input.reachedFromPackages)

  return storybooks.map((storybook): AffectedStorybook => {
    const paths = pathsOf(root, storybook)

    if (
      isOutsideRoot(paths.folder) ||
      isOutsideRoot(paths.configFolder) ||
      configFolders.has(paths.configFolder) ||
      reachesChangedPackage(paths, input, configFoldersReachedFromPackages)
    ) {
      return { all: true }
    }

    const storiesFiles = [...paths.storiesFiles]
      .filter(([path]) => reached.has(path))
      .map(([, importPath]) => importPath)

    return {
      all: false,
      storiesFiles: new Set(storiesFiles),
      storyIds: new Set(storyIdsOfBaselines(storybook, input.changedBaselines)),
    }
  })
}

/**
 * Gives every Storybook with all its stories affected.
 */
function everyStoryAffected(storybooks: readonly AffectedStorybookInput[]): AffectedStorybook[] {
  return storybooks.map(() => ({ all: true }))
}

/**
 * Gives every Storybook with no story affected.
 */
function noStoryAffected(storybooks: readonly AffectedStorybookInput[]): AffectedStorybook[] {
  return storybooks.map(() => ({ all: false, storiesFiles: new Set<string>(), storyIds: new Set<string>() }))
}

/**
 * Gives the real path of a path, with symlinks resolved and, on Windows, short names expanded, so it compares with
 * git's top level. A path that can't be resolved, such as a missing one, is kept as it is.
 */
async function realPathOf(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

/**
 * Gives the Storybooks with their folder, config folder and baselines folder as real paths.
 */
function withRealPaths(storybooks: readonly AffectedStorybookInput[]): Promise<AffectedStorybookInput[]> {
  return Promise.all(
    storybooks.map(async (storybook) => ({
      ...storybook,
      dir: await realPathOf(storybook.dir),
      configDir: await realPathOf(storybook.configDir),
      baselines: await realPathOf(storybook.baselines),
    })),
  )
}

/**
 * Works out each Storybook's affected stories: finds the changed files since the base, groups them by rule, asks
 * `findReachedFiles` what they reach, then what their changed packages reach, and applies the rules of
 * `affectedStorybooksOf`.
 *
 * - A changed file that matches `affected.ignore` counts for nothing but `changedFiles`.
 * - The config file, a lockfile, `pnpm-workspace.yaml` or a match for `affected.selectAll` affects every story.
 * - A changed baseline affects its story, and nothing when its Storybook isn't in the run.
 * - A package's config, such as `package.json`, `tsconfig*` or `.env*`, and an image, a font or a data JSON file the
 *   graph doesn't hold, affect every story of the Storybooks whose graph reaches its package.
 * - Any other file affects what the graph says it reaches.
 *
 * The graph isn't asked when no changed file is left once the ignored ones are dropped, when one affects every story,
 * when no file is left to walk, or when every Storybook already has every story affected. When git or the graph can't
 * answer, every story is affected and `fallback` says why. A `--base` that names no commit rejects with
 * `InvalidBaseError`.
 *
 * @public
 */
export async function workOutAffectedStories(options: WorkOutAffectedStoriesOptions): Promise<AffectedStories> {
  const { baseRef, environment, cwd, storybooks, findReachedFiles } = options
  const changes = await changedFilesOf({ baseRef, environment, cwd })

  if ('cantAnswer' in changes) {
    return { base: null, changedFiles: null, fallback: changes.cantAnswer, storybooks: everyStoryAffected(storybooks) }
  }

  const { root, base, files } = changes
  const outcome = (affected: AffectedStorybook[], fallback: string | null = null): AffectedStories => ({
    base,
    changedFiles: files.length,
    fallback,
    storybooks: affected,
  })
  const realStorybooks = await withRealPaths(storybooks)
  const context = {
    root,
    configPath: await realPathOf(options.configPath),
    selectAll: options.affected.selectAll,
    ignore: options.affected.ignore,
    baselinesFolders: await Promise.all(options.baselinesFolders.map(realPathOf)),
  }
  const groups = await groupChanges(files, (file) => changedFileRuleOf(file, context), packageFolderFinder(root))

  if (groups === 'ignored') {
    return outcome(noStoryAffected(storybooks))
  }

  if (groups === 'every-story') {
    return outcome(everyStoryAffected(storybooks))
  }

  const { graphFiles, baselines, packageScoped } = groups
  const rulesInput = { root, storybooks: realStorybooks, changedFiles: graphFiles, changedBaselines: baselines }
  const beforeGraph = affectedStorybooksOf({
    ...rulesInput,
    reached: new Set(),
    changedPackages: changedPackagesOf(packageScoped, undefined),
    reachedFromPackages: new Set(),
  })

  if (graphFiles.length === 0 || beforeGraph.every(({ all }) => all)) {
    return outcome(beforeGraph)
  }

  const reached = await findReachedFiles(root, graphFiles)

  if ('cantAnswer' in reached) {
    return outcome(everyStoryAffected(storybooks), reached.cantAnswer)
  }

  const changedPackages = changedPackagesOf(packageScoped, reached.reached)

  return outcome(
    affectedStorybooksOf({
      ...rulesInput,
      reached: reached.reached,
      changedPackages,
      reachedFromPackages: reached.reachedFromFolders([...changedPackages]),
    }),
  )
}
