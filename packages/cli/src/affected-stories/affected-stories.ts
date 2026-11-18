import { realpath } from 'node:fs/promises'
import { changedFileRuleOf } from './changed-file-rules.js'
import type { FindReachedFiles } from './fallow-graph.js'
import { changedFilesOf } from './git-changes.js'
import { changedPackagesOf, groupChanges } from './group-changes.js'
import { packageFolderFinder } from './package-folder.js'
import { type AffectedStorybook, type AffectedStorybookInput, affectedStorybooksOf } from './storybook-rules.js'

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
