import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { CantAnswer } from './fallow-graph.js'

/**
 * The files changed since the base, in the repository that holds the folder.
 */
export interface ChangedFiles {
  /**
   * The repository's top level, an absolute path with the platform's separators, unlike the `/`-separated `files`.
   */
  root: string
  /**
   * The SHA of the base: the merge base of `HEAD` and the base branch.
   */
  base: string
  /**
   * The files the commits since the base, the index or the working tree changed, plus untracked files that aren't
   * gitignored. A rename gives both its old and its new path. Paths are relative to the root, `/`-separated, sorted
   * and each listed once.
   */
  files: string[]
}

/**
 * What `changedFilesOf` reads.
 */
interface ChangedFilesOptions {
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
}

/**
 * A `--base` that names no commit in the repository.
 *
 * @public
 */
export class InvalidBaseError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `InvalidBaseError`.
   */
  override name = 'InvalidBaseError'
}

/**
 * `execFile` that returns a promise.
 */
const execFileAsync = promisify(execFile)

/**
 * The most output a git command may write, in bytes. A big change lists many thousand paths.
 */
const maxOutputBytes = 64 * 1024 * 1024

/**
 * The branches tried for the base after `origin/$GITHUB_BASE_REF`, in order.
 */
const fallbackBaseRefs = ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']

/**
 * Runs git in `cwd` and gives its output. Optional locks are off, so `git status` leaves the index as it was. It
 * rejects when git fails or can't start.
 */
async function git(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['--no-pager', ...args], {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    encoding: 'utf8',
    maxBuffer: maxOutputBytes,
    windowsHide: true,
  })

  return stdout
}

/**
 * Gives a command's output without its final newline.
 */
function lineOf(stdout: string): string {
  return stdout.replace(/\r?\n$/, '')
}

/**
 * Gives the first line of what a failed git command wrote to stderr, else of the error's message, without git's
 * leading `fatal: `.
 */
function failureLineOf(error: unknown): string {
  const { stderr, message } = error as { stderr?: string; message?: string }
  const text = stderr?.trim() || message || String(error)

  return (text.split(/\r?\n/)[0] as string).replace(/^fatal: /, '')
}

/**
 * Gives why a failed git command can't answer, from its stderr.
 */
function gitFailed(error: unknown): CantAnswer {
  return { cantAnswer: `git failed: ${failureLineOf(error)}` }
}

/**
 * Gives the exit code of a failed git command, `undefined` when it never ran.
 */
function exitCodeOf(error: unknown): number | undefined {
  const { code } = error as { code?: unknown }

  return typeof code === 'number' ? code : undefined
}

/**
 * Gives the paths of `-z` output.
 */
function pathsOf(stdout: string): string[] {
  return stdout.split('\0').filter((path) => path !== '')
}

/**
 * Gives the repository's top level, or why there's none.
 */
async function topLevelOf(cwd: string): Promise<string | CantAnswer> {
  try {
    return resolve(lineOf(await git(['rev-parse', '--show-toplevel'], cwd)))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Spawning fails with ENOENT both when git is missing and when `cwd` is.
      return { cantAnswer: existsSync(cwd) ? "git isn't installed" : "the folder doesn't exist" }
    }

    if (/not a git repository/.test(failureLineOf(error))) {
      return { cantAnswer: "the folder isn't in a git repository" }
    }

    return gitFailed(error)
  }
}

/**
 * Gives the SHA of the commit `ref` names, or `undefined` when it names none: `rev-parse --verify --quiet` exits with
 * 1 and no output then. Any other failure throws.
 */
async function commitOf(ref: string, root: string): Promise<string | undefined> {
  try {
    return lineOf(await git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], root))
  } catch (error) {
    if (exitCodeOf(error) === 1) {
      return undefined
    }

    throw error
  }
}

/**
 * Joins names into a list that reads "a, b and c".
 */
function listOf(names: readonly string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * Finds the base branch: `--base` when given, else the first candidate that resolves. It gives the ref and its
 * commit, or why there's none, and throws `InvalidBaseError` for a `--base` that names no commit. Any other git
 * failure throws as it is.
 */
async function baseBranchOf(
  options: ChangedFilesOptions,
  root: string,
): Promise<{ ref: string; commit: string } | CantAnswer> {
  if (options.baseRef !== undefined) {
    const commit = await commitOf(options.baseRef, root)

    if (commit === undefined) {
      throw new InvalidBaseError(`--base names ${options.baseRef}, which isn't a commit in this repository.`)
    }

    return { ref: options.baseRef, commit }
  }

  const githubBaseRef = options.environment.GITHUB_BASE_REF
  const candidates = [...(githubBaseRef ? [`origin/${githubBaseRef}`] : []), ...fallbackBaseRefs]

  for (const ref of candidates) {
    const commit = await commitOf(ref, root)

    if (commit !== undefined) {
      return { ref, commit }
    }
  }

  return { cantAnswer: `no base branch found (tried ${listOf(candidates)})` }
}

/**
 * Lists the files changed since `base`: what the commits since it changed, plus what `git status` shows, which is the
 * index and the working tree compared with `HEAD` and the untracked files that aren't gitignored. A rename gives both
 * paths. Neither command writes: `git diff <base>` would, since it refreshes the index's cached file stats on disk,
 * while `git status` with optional locks off refreshes them in memory only.
 */
async function filesChangedSince(base: string, root: string): Promise<string[]> {
  const [committed, status] = await Promise.all([
    git(['diff-tree', '-r', '--name-only', '--no-renames', '-z', base, 'HEAD'], root),
    git(['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'], root),
  ])
  // Each status entry is two status letters, a space and the path. `--no-renames` (git 2.18 and later) makes it one
  // path per entry, so a rename never adds a second path token.
  const uncommitted = pathsOf(status).map((entry) => entry.slice(3))

  return [...new Set([...pathsOf(committed), ...uncommitted])].sort()
}

/**
 * Does the work of `changedFilesOf`; a git failure it doesn't handle throws.
 */
async function findChanges(options: ChangedFilesOptions): Promise<ChangedFiles | CantAnswer> {
  const root = await topLevelOf(options.cwd)

  if (typeof root !== 'string') {
    return root
  }

  if ((await commitOf('HEAD', root)) === undefined) {
    return { cantAnswer: 'the repository has no commits yet' }
  }

  const branch = await baseBranchOf(options, root)

  if ('cantAnswer' in branch) {
    return branch
  }

  let base: string

  try {
    base = lineOf(await git(['merge-base', 'HEAD', branch.commit], root))
  } catch (error) {
    if (exitCodeOf(error) !== 1) {
      return gitFailed(error)
    }

    return { cantAnswer: `there's no merge base with ${branch.ref}, as in a shallow clone or with unrelated history` }
  }

  try {
    return { root, base, files: await filesChangedSince(base, root) }
  } catch (error) {
    return { cantAnswer: `git couldn't list the changed files: ${failureLineOf(error)}` }
  }
}

/**
 * Finds the base and the files changed since it, reading git only: it never fetches and never changes git's state.
 * The base is the merge base of `HEAD` and the first of `--base`, `origin/$GITHUB_BASE_REF`, `origin/HEAD`,
 * `origin/main`, `origin/master`, `main` and `master` that resolves. Anything that keeps it from answering gives
 * `CantAnswer`, git failures included, except a `--base` that names no commit, which throws `InvalidBaseError`.
 */
export async function changedFilesOf(options: ChangedFilesOptions): Promise<ChangedFiles | CantAnswer> {
  try {
    return await findChanges(options)
  } catch (error) {
    if (error instanceof InvalidBaseError) {
      throw error
    }

    return gitFailed(error)
  }
}
