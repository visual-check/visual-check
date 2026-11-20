import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type SkillSetup, setupFileTextOf } from './setup-file.js'
import { skillFolder, writeSkillFiles } from './skill-files.js'

/**
 * What `installSkill` writes: where, for which CLI version, and the `setup.json` content.
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
   * What `setup.json` holds.
   */
  setup: SkillSetup
}

/**
 * Installs the agent skill in `.agents/skills/visual-check/` under the root: `SKILL.md` for the CLI version, the
 * runner script and `setup.json`. Writes over what's there.
 *
 * @throws Any error writing a file.
 * @public
 */
export function installSkill({ root, cliVersion, setup }: SkillInstall): void {
  const folder = join(root, skillFolder)

  writeSkillFiles(folder, cliVersion)
  writeFileSync(join(folder, 'setup.json'), setupFileTextOf(setup, folder))
}
