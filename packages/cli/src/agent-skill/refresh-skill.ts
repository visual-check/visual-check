import { lstatSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { systemReasonOf } from '../system-error/system-reason.js'
import { setupFileProblemOf } from './setup-file.js'
import { claudeSkillFolder, skillFolder, writeSkillFiles } from './skill-files.js'
import { skillVersionOf } from './skill-markdown.js'

/**
 * A write of the agent skill's files that failed: the folder being written, and the file system's reason.
 *
 * @public
 */
export interface SkillWriteProblem {
  /**
   * The absolute folder being written when the write failed.
   */
  folder: string
  /**
   * The operating system's reason, such as `EACCES: permission denied`.
   */
  reason: string
}

/**
 * What a refresh of the installed agent skill did.
 *
 * @public
 */
export interface SkillRefresh {
  /**
   * The CLI version the skill was rewritten for.
   */
  version: string
  /**
   * The absolute paths rewritten: `SKILL.md` and the runner script in the `.claude` copy, then in `.agents`.
   */
  rewritten: string[]
  /**
   * The absolute path of the installed `setup.json`, which a refresh keeps.
   */
  setupPath: string
  /**
   * What keeps `setup.json` from serving this version, or `undefined`.
   */
  setupProblem: string | undefined
  /**
   * Where and why a file couldn't be written, or `undefined` when every write worked.
   */
  writeProblem: SkillWriteProblem | undefined
}

/**
 * Rewrites the agent skill installed under `root` when another CLI version wrote it: `SKILL.md` and the runner script
 * in `.agents/skills/visual-check/`, and in `.claude/skills/visual-check/` when that's a real folder, a copy. A link
 * there shares the files. The `.claude` copy goes first and `.agents/…/SKILL.md` last, so its version marks a complete
 * refresh: one that fails is tried again on the next run. Keeps `setup.json`, and says what keeps it from serving this
 * version; the runner script checks the values itself when it runs. Gives `undefined` when no skill is installed, or
 * this version wrote it. A file system error is reported, never thrown.
 *
 * @throws Any error besides one of the file system's, which carry the call that failed.
 * @public
 */
export function refreshSkill(root: string, cliVersion: string): SkillRefresh | undefined {
  const folder = join(root, skillFolder)
  const markdown = textOrUndefined(join(folder, 'SKILL.md'))

  if (markdown === undefined || skillVersionOf(markdown) === cliVersion) {
    return undefined
  }

  const claudeFolder = join(root, claudeSkillFolder)
  const rewritten: string[] = []
  // The folder being looked at or written, which a failure names.
  let current = claudeFolder
  let writeProblem: SkillWriteProblem | undefined

  try {
    const places = [...(isRealFolder(claudeFolder) ? [claudeFolder] : []), folder]

    for (const place of places) {
      current = place
      rewritten.push(...writeSkillFiles(place, cliVersion))
    }
  } catch (error) {
    if (!isSystemError(error)) {
      throw error
    }

    writeProblem = { folder: current, reason: systemReasonOf(error) }
  }

  const setupPath = join(folder, 'setup.json')

  return {
    version: cliVersion,
    rewritten,
    setupPath,
    setupProblem: setupFileProblemOf(textOrUndefined(setupPath)),
    writeProblem,
  }
}

/**
 * Words what a refresh did, for stderr, a line each: the rewritten paths under a heading, relative to `cwd` with `/`,
 * then a warning when `setup.json` needs `init` again, then one when a write failed.
 *
 * @public
 */
export function skillRefreshLinesOf(refresh: SkillRefresh, cwd: string): string[] {
  const pathOf = (path: string): string => relative(cwd, path).split(sep).join('/') || '.'
  const lines =
    refresh.rewritten.length === 0
      ? []
      : [
          `visual-check ${refresh.version} rewrote the agent skill, which another version wrote:`,
          ...refresh.rewritten.map((path) => `  ${pathOf(path)}`),
        ]

  if (refresh.setupProblem !== undefined) {
    lines.push(
      `Warning: The agent skill's setup.json at ${pathOf(refresh.setupPath)} ${refresh.setupProblem}. ` +
        'Run visual-check init again to refresh it.',
    )
  }

  if (refresh.writeProblem !== undefined) {
    lines.push(
      `Warning: visual-check couldn't rewrite the agent skill in ${pathOf(refresh.writeProblem.folder)}: ` +
        `${refresh.writeProblem.reason}. ` +
        'Run visual-check init again to rewrite it.',
    )
  }

  return lines
}

/**
 * Reads a text file, or gives `undefined` when the file system can't: it's missing, a folder, or unreadable.
 *
 * @throws Any error besides one of the file system's, which carry the call that failed.
 */
function textOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (isSystemError(error)) {
      return undefined
    }

    throw error
  }
}

/**
 * Whether `path` is a real folder, not a link to one.
 */
function isRealFolder(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false })?.isDirectory() === true
}

/**
 * Whether `error` is one the file system gave, which carries the call that failed. Node's errors for a bad argument
 * carry a `code` too, but no call.
 */
function isSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).syscall === 'string'
}
