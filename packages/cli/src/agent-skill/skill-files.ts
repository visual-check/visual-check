import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { skillMarkdownOf, skillSourcePaths } from './skill-markdown.js'

/**
 * Where `init` installs the agent skill, relative to the workspace root.
 */
export const skillFolder = join('.agents', 'skills', 'visual-check')

/**
 * Writes the skill's `SKILL.md`, for `cliVersion`, and its runner script into `folder`, creating what's missing.
 * Gives the paths written, in that order.
 */
export function writeSkillFiles(folder: string, cliVersion: string): string[] {
  const markdown = join(folder, 'SKILL.md')
  const script = join(folder, 'scripts', 'run.mjs')

  mkdirSync(dirname(script), { recursive: true })
  writeFileSync(markdown, skillMarkdownOf(readFileSync(skillSourcePaths.markdown, 'utf8'), cliVersion))
  copyFileSync(skillSourcePaths.script, script)

  return [markdown, script]
}
