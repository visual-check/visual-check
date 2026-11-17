import { realpath } from 'node:fs/promises'
import { isAbsolute, posix, relative, resolve, sep } from 'node:path'
import type { FindReachedFiles } from './fallow-graph.js'
import { changedFilesOf } from './git-changes.js'

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
}

/**
 * Which of a Storybook's stories are affected: all of them, or those of some stories files.
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
       * Only the stories of `storiesFiles` are affected.
       */
      all: false
      /**
       * The affected stories files, as the import paths the Storybook's input gives them.
       */
      storiesFiles: ReadonlySet<string>
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
 * What `affectedStoriesFilesOf` reads.
 */
interface AffectedStoriesFilesInput {
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
   * The changed files, relative to the root, `/`-separated.
   */
  changedFiles: readonly string[]
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
   * Finds the files the changed files reach.
   */
  findReachedFiles: FindReachedFiles
}

/**
 * Gives an absolute path relative to the root, `/`-separated. Only the platform's separator is replaced, so a POSIX
 * file name holding a literal `\` keeps it.
 */
function rootRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
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
function foldersWithConfigFilesOf(changedFiles: readonly string[], reached: ReadonlySet<string>): Set<string> {
  const folders = new Set<string>()

  for (const files of [changedFiles, reached]) {
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
 * Works out each Storybook's affected stories files from the reached and the changed files. A changed or reached
 * `preview*` or `main*` file directly in a Storybook's config folder affects every story of that Storybook. Names are
 * compared lowercased, since the file system may not tell `Preview.tsx` from `preview.tsx`, and the prefixes also
 * match files such as `previewer.ts` or `maintenance.ts`: selecting too many stories is accepted over missing one.
 * A Storybook whose folder or config folder is outside the root has every story affected, since git doesn't see its
 * changes. Otherwise the reached stories files are affected. Changed files count for the config files only, since
 * some, such as `preview-head.html` or a deleted `preview.ts`, aren't in the graph.
 */
export function affectedStoriesFilesOf(input: AffectedStoriesFilesInput): AffectedStorybook[] {
  const { root, storybooks, reached, changedFiles } = input
  const foldersWithConfigFiles = foldersWithConfigFilesOf(changedFiles, reached)

  return storybooks.map((storybook) => {
    const folder = rootRelative(root, storybook.dir)
    const configFolder = rootRelative(root, storybook.configDir)

    if (isOutsideRoot(folder) || isOutsideRoot(configFolder)) {
      return { all: true }
    }

    if (foldersWithConfigFiles.has(configFolder || '.')) {
      return { all: true }
    }

    const storiesFiles = storybook.storiesFiles.filter((importPath) =>
      reached.has(rootRelative(root, resolve(storybook.dir, importPath))),
    )

    return { all: false, storiesFiles: new Set(storiesFiles) }
  })
}

/**
 * Gives every Storybook with all its stories affected.
 */
function everyStoryAffected(storybooks: readonly AffectedStorybookInput[]): AffectedStorybook[] {
  return storybooks.map(() => ({ all: true }))
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
 * Gives the Storybooks with their folder and config folder as real paths.
 */
function withRealPaths(storybooks: readonly AffectedStorybookInput[]): Promise<AffectedStorybookInput[]> {
  return Promise.all(
    storybooks.map(async (storybook) => ({
      ...storybook,
      dir: await realPathOf(storybook.dir),
      configDir: await realPathOf(storybook.configDir),
    })),
  )
}

/**
 * Works out each Storybook's affected stories: finds the changed files since the base, asks `findReachedFiles` what
 * they reach and applies the rules. With no changed files nothing is affected, and the graph isn't asked. When git or
 * the graph can't answer, every story is affected and `fallback` says why. A `--base` that names no commit rejects
 * with `InvalidBaseError`.
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

  if (files.length === 0) {
    return {
      base,
      changedFiles: 0,
      fallback: null,
      storybooks: storybooks.map(() => ({ all: false, storiesFiles: new Set<string>() })),
    }
  }

  const reached = await findReachedFiles(root, files)

  if ('cantAnswer' in reached) {
    return {
      base,
      changedFiles: files.length,
      fallback: reached.cantAnswer,
      storybooks: everyStoryAffected(storybooks),
    }
  }

  return {
    base,
    changedFiles: files.length,
    fallback: null,
    storybooks: affectedStoriesFilesOf({
      root,
      storybooks: await withRealPaths(storybooks),
      reached: reached.reached,
      changedFiles: files,
    }),
  }
}
