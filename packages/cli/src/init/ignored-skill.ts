import { execFile } from 'node:child_process'
import { sep } from 'node:path'
import { promisify } from 'node:util'
import { listOf } from './list-of.js'

/**
 * A path git ignores, with the rule that ignores it.
 */
export interface IgnoredPath {
  /**
   * The path, relative to the folder git ran in and `/` separated.
   */
  path: string
  /**
   * The file the rule is in, such as `.gitignore`: relative to the repository's root, or absolute for a file outside
   * it, such as the global excludes file.
   */
  source: string
  /**
   * The rule's line in that file, from 1.
   */
  line: number
  /**
   * The rule's pattern, such as `.claude/skills/*`.
   */
  pattern: string
}

/**
 * Asks git which of `paths`, relative to `root`, it ignores in the repository around `root`. Gives none when git can't
 * tell. Never throws.
 *
 * @public
 */
export type FindIgnoredPaths = (root: string, paths: readonly string[]) => Promise<IgnoredPath[]>

/**
 * `execFile` that returns a promise.
 */
const execFileAsync = promisify(execFile)

/**
 * How many NUL-terminated fields `git check-ignore -v -z` prints for each path: source, line, pattern, path.
 */
const fieldsPerMatch = 4

/**
 * Reads what `git check-ignore -v -z --stdin` prints: four NUL-terminated fields for each path a rule matched. A match
 * of a negated pattern, which starts with `!`, keeps the path, so it's left out.
 */
export function ignoredPathsOf(output: string): IgnoredPath[] {
  const fields = output.split('\0')
  const ignored: IgnoredPath[] = []

  for (let index = 0; index + fieldsPerMatch <= fields.length; index += fieldsPerMatch) {
    const [source = '', line = '', pattern = '', path = ''] = fields.slice(index, index + fieldsPerMatch)

    if (!pattern.startsWith('!')) {
      ignored.push({ path, source, line: Number(line), pattern })
    }
  }

  return ignored
}

/**
 * Asks git which of `paths`, relative to `root`, it ignores in the repository around `root`, each with the rule that
 * ignores it. `-z` takes the paths on stdin only, so they go there, `/` separated. Gives none when git finds none (it
 * exits 1), outside a repository, without git, or when git fails.
 *
 * @public
 */
export async function findIgnoredPaths(root: string, paths: readonly string[]): Promise<IgnoredPath[]> {
  const run = execFileAsync('git', ['check-ignore', '-v', '-z', '--stdin'], { cwd: root, windowsHide: true })

  // A git that has already exited closes stdin under the write: its exit code says what happened.
  run.child.stdin?.on('error', () => undefined)
  run.child.stdin?.end(paths.map((path) => `${path.split(sep).join('/')}\0`).join(''))

  try {
    return ignoredPathsOf((await run).stdout)
  } catch {
    return []
  }
}

/**
 * The warning that git ignores the agent skill's folder or its link, naming each path and the rule that ignores it, or
 * `undefined` when it ignores neither.
 *
 * @public
 */
export function ignoredSkillWarningOf(ignored: readonly IgnoredPath[]): string | undefined {
  if (ignored.length === 0) {
    return undefined
  }

  const paths = listOf(ignored.map(({ path, source, line, pattern }) => `${path} (${source} line ${line}: ${pattern})`))
  const change = ignored.length === 1 ? 'Change that rule so git keeps it.' : 'Change those rules so git keeps them.'

  return `Warning: git ignores ${paths}, so the agent skill won't reach other clones. ${change}`
}
