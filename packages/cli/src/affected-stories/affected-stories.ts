import { realpath } from 'node:fs/promises'
import { changedFileRuleOf } from './changed-file-rules.js'
import type { FindReachedFiles } from './fallow-graph.js'
import { changedFilesOf } from './git-changes.js'
import { changedPackagesOf, groupChanges } from './group-changes.js'
import { packageFolderFinder } from './package-folder.js'
import {
  type AffectedStorybook,
  type AffectedStorybookInput,
  affectedStorybooksOf,
  type ChangeReach,
  type RequiredStorybookInput,
  requiredStorybooksOf,
  whollyAffectedTestOf,
} from './storybook-rules.js'

/**
 * What the changed files since the base reach, worked out before any Storybook's stories are read.
 *
 * @public
 */
export interface TracedChanges {
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
   * What the changed files reach: `nothing` when no changed file counts (none changed, or `affected.ignore` matches
   * every one); `everything` when one selects every story of every Storybook, or git or the graph can't answer;
   * otherwise what the rules read. Read it with the Storybooks it was traced for: when each of them is affected as a
   * whole by its folders alone, the graph isn't asked, so `reached` is empty.
   */
  reach: 'nothing' | 'everything' | ChangeReach
}

/**
 * Reads, without starting it, the regular expressions a Storybook matches its stories files' import paths with, from
 * its `stories` globs. Gives `undefined` when they can't be read, and never rejects.
 *
 * @public
 */
export type ReadStoriesMatchers = (
  storybook: Pick<RequiredStorybookInput, 'dir' | 'configDir'>,
) => Promise<readonly RegExp[] | undefined>

/**
 * What `traceChanges` reads.
 */
interface TraceChangesOptions {
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
   * The Storybooks' folders, config folders and baselines folders. Only the folders count before the graph is asked.
   */
  storybooks: readonly Pick<AffectedStorybookInput, 'dir' | 'configDir' | 'baselines'>[]
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
function withRealPaths<T extends { dir: string; configDir: string; baselines: string }>(
  storybooks: readonly T[],
): Promise<T[]> {
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
 * Traces the changed files since the base: finds them, groups them by rule, and asks `findReachedFiles` what they
 * reach, then what their changed packages reach. It reads no Storybook's stories, so it can run before any Storybook
 * is reached.
 *
 * - A changed file that matches `affected.ignore` counts for nothing but `changedFiles`. When every one does, or none
 *   changed, the reach is `nothing`.
 * - The config file, a lockfile, `pnpm-workspace.yaml` or a match for `affected.selectAll` makes the reach
 *   `everything`.
 * - Any other file counts for what `affectedStorybooksIn` reads: a changed baseline, a package's config file or
 *   an image, a font or a data JSON file the graph doesn't hold, and the graph files with what they reach.
 *
 * The graph isn't asked when no changed file is left once the ignored ones are dropped, when one affects every story,
 * when no file is left to walk, or when every Storybook already has every story affected by its folders alone. When
 * git or the graph can't answer, the reach is `everything` and `fallback` says why. A `--base` that names no commit
 * rejects with `InvalidBaseError`.
 *
 * @public
 */
export async function traceChanges(options: TraceChangesOptions): Promise<TracedChanges> {
  const { baseRef, environment, cwd, storybooks, findReachedFiles } = options
  const changes = await changedFilesOf({ baseRef, environment, cwd })

  if ('cantAnswer' in changes) {
    return { base: null, changedFiles: null, fallback: changes.cantAnswer, reach: 'everything' }
  }

  const { root, base, files } = changes
  const traced = (reach: TracedChanges['reach'], fallback: string | null = null): TracedChanges => ({
    base,
    changedFiles: files.length,
    fallback,
    reach,
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
    return traced('nothing')
  }

  if (groups === 'every-story') {
    return traced('everything')
  }

  const { graphFiles, baselines, packageScoped } = groups
  const beforeGraph: ChangeReach = {
    root,
    changedFiles: graphFiles,
    changedBaselines: baselines,
    reached: new Set(),
    changedPackages: changedPackagesOf(packageScoped, undefined),
    reachedFromPackages: new Set(),
  }

  // Before the graph answers, nothing reaches a stories file, so only the Storybooks' folders count.
  const isWhollyAffectedBeforeGraph = whollyAffectedTestOf(beforeGraph)

  if (
    graphFiles.length === 0 ||
    realStorybooks.every((storybook) => isWhollyAffectedBeforeGraph(storybook, () => false))
  ) {
    return traced(beforeGraph)
  }

  const reached = await findReachedFiles(root, graphFiles)

  if ('cantAnswer' in reached) {
    return traced('everything', reached.cantAnswer)
  }

  const changedPackages = changedPackagesOf(packageScoped, reached.reached)

  return traced({
    ...beforeGraph,
    reached: reached.reached,
    changedPackages,
    reachedFromPackages: reached.reachedFromFolders([...changedPackages]),
  })
}

/**
 * Works out each Storybook's affected stories from the traced changes, by the rules of `affectedStorybooksOf`:
 *
 * - A changed baseline affects its story, and nothing when its Storybook isn't in the run.
 * - A package's config, such as `package.json`, `tsconfig*` or `.env*`, and an image, a font or a data JSON file the
 *   graph doesn't hold, affect every story of the Storybooks whose graph reaches its package.
 * - Any other file affects what the graph says it reaches.
 *
 * A reach of `nothing` affects no story, and `everything` every story of every Storybook.
 *
 * @public
 */
export async function affectedStorybooksIn(
  traced: TracedChanges,
  storybooks: readonly AffectedStorybookInput[],
): Promise<AffectedStorybook[]> {
  if (traced.reach === 'nothing') {
    return noStoryAffected(storybooks)
  }

  if (traced.reach === 'everything') {
    return everyStoryAffected(storybooks)
  }

  return affectedStorybooksOf(traced.reach, await withRealPaths(storybooks))
}

/**
 * Tells, for each Storybook, whether a local affected run requires it, from the traced changes, by the rules of
 * `requiredStorybooksOf`. A reach of `nothing` requires no Storybook, and `everything` every Storybook, both without
 * reading any globs. Otherwise `readStoriesMatchers` reads each Storybook's stories globs once, all at the same time,
 * from its real folders; a read that rejects counts as globs that can't be read.
 *
 * @public
 */
export async function requiredStorybooksIn(
  traced: TracedChanges,
  storybooks: readonly Pick<RequiredStorybookInput, 'dir' | 'configDir' | 'baselines'>[],
  readStoriesMatchers: ReadStoriesMatchers,
): Promise<boolean[]> {
  const { reach } = traced

  if (reach === 'nothing') {
    return storybooks.map(() => false)
  }

  if (reach === 'everything') {
    return storybooks.map(() => true)
  }

  // The globs are read from the real folders, which the rules compare the changed files with.
  const realStorybooks = await withRealPaths(
    storybooks.map(({ dir, configDir, baselines }) => ({ dir, configDir, baselines })),
  )
  const withMatchers = await Promise.all(
    realStorybooks.map(async (storybook) => ({
      ...storybook,
      // A reader that rejects despite its contract counts as one that can't read the globs.
      storiesMatchers: await readStoriesMatchers({ dir: storybook.dir, configDir: storybook.configDir }).catch(
        () => undefined,
      ),
    })),
  )

  return requiredStorybooksOf(reach, withMatchers)
}
