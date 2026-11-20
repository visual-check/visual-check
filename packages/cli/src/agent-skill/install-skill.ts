import { cpSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type SkillSetup, setupFileTextOf } from './setup-file.js'
import { claudeLinkTarget, claudeSkillFolder, skillFolder, writeSkillFiles } from './skill-files.js'

/**
 * What `installSkill` writes: where, for which CLI version and OS, and the `setup.json` content.
 *
 * @public
 */
export interface SkillInstall {
  /**
   * The absolute workspace root.
   */
  root: string
  /**
   * The version of the CLI that installs the skill, which `SKILL.md` records.
   */
  cliVersion: string
  /**
   * The OS `init` runs on: Windows gets a copy instead of a link.
   */
  os: NodeJS.Platform
  /**
   * What `setup.json` holds.
   */
  setup: SkillSetup
}

/**
 * Installs the agent skill in `.agents/skills/visual-check/` under the root: `SKILL.md` for the CLI version, the
 * runner script and `setup.json`. Writes over what's there. Then shows it to Claude Code in
 * `.claude/skills/visual-check`.
 *
 * @throws Any error writing a file or making the link.
 * @public
 */
export function installSkill({ root, cliVersion, os, setup }: SkillInstall): void {
  const folder = join(root, skillFolder)

  writeSkillFiles(folder, cliVersion)
  writeFileSync(join(folder, 'setup.json'), setupFileTextOf(setup, folder))
  showSkillToClaude(root, os)
}

/**
 * Makes `.claude/skills/visual-check` show the installed skill: a relative link to it, or on Windows a copy of it.
 * Anything else at that path, such as an older copy or the file git checks a link out as on Windows, is replaced.
 */
function showSkillToClaude(root: string, os: NodeJS.Platform): void {
  const claudeFolder = join(root, claudeSkillFolder)

  mkdirSync(dirname(claudeFolder), { recursive: true })

  if (os === 'win32') {
    rmSync(claudeFolder, { recursive: true, force: true })
    cpSync(join(root, skillFolder), claudeFolder, { recursive: true })

    return
  }

  if (linkTargetOf(claudeFolder) === claudeLinkTarget) {
    return
  }

  rmSync(claudeFolder, { recursive: true, force: true })
  symlinkSync(claudeLinkTarget, claudeFolder, 'dir')
}

/**
 * Gives where the symbolic link at `path` points, as written, or `undefined` when nothing or no link is there.
 */
function linkTargetOf(path: string): string | undefined {
  return lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ? readlinkSync(path) : undefined
}
