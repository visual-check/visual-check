import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { skillMarkdownOf, skillSourcePaths } from './skill-markdown.js'

/**
 * Where `init` installs the agent skill, relative to the workspace root.
 */
export const skillFolder = join('.agents', 'skills', 'visual-check')

/**
 * Where Claude Code reads the skill, relative to the workspace root: a link to `skillFolder`, or a copy on Windows.
 */
export const claudeSkillFolder = join('.claude', 'skills', 'visual-check')

/**
 * The link's target, relative to the link's own folder, with `/` so the committed link works on every machine.
 */
export const claudeLinkTarget = '../../.agents/skills/visual-check'

/**
 * Writes the skill's runner script and then its `SKILL.md`, for `cliVersion`, into `folder`, creating what's missing.
 * `SKILL.md` goes last, so its version marks a complete write: a write that fails before it leaves the old version,
 * and the next run tries again. Gives the paths written, `SKILL.md` first.
 */
export function writeSkillFiles(folder: string, cliVersion: string): string[] {
  const markdown = join(folder, 'SKILL.md')
  const script = join(folder, 'scripts', 'run.mjs')

  mkdirSync(dirname(script), { recursive: true })
  copyFileSync(skillSourcePaths.script, script)
  writeFileSync(markdown, skillMarkdownOf(readFileSync(skillSourcePaths.markdown, 'utf8'), cliVersion))

  return [markdown, script]
}
