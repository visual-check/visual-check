import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installSkill } from './install-skill.js'
import { type SkillSetup, setupFileTextOf } from './setup-file.js'
import { skillMarkdownOf, skillSourcePaths, skillVersionOf } from './skill-markdown.js'

describe('installSkill', () => {
  let root: string
  let folder: string
  let setup: SkillSetup

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-skill-')))
    folder = join(root, '.agents', 'skills', 'visual-check')
    setup = {
      cli: { command: ['pnpm', 'exec', 'visual-check'], cwd: root },
      storybooks: { web: { command: ['pnpm', 'run', 'storybook'], cwd: join(root, 'packages', 'web') } },
    }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /**
   * Reads a file of the installed skill.
   */
  function readSkillFile(...path: string[]): string {
    return readFileSync(join(folder, ...path), 'utf8')
  }

  /**
   * Checks that the skill folder holds what `installSkill` writes for version 1.2.3 and `setup`.
   */
  function expectInstalled(): void {
    const markdown = readSkillFile('SKILL.md')

    expect(skillVersionOf(markdown)).toBe('1.2.3')
    expect(markdown).toBe(skillMarkdownOf(readFileSync(skillSourcePaths.markdown, 'utf8'), '1.2.3'))
    expect(readFileSync(join(folder, 'scripts', 'run.mjs'))).toEqual(readFileSync(skillSourcePaths.script))
    expect(readSkillFile('setup.json')).toBe(setupFileTextOf(setup, folder))
  }

  it('writes SKILL.md for the CLI version, the runner script and setup.json', () => {
    installSkill({ root, cliVersion: '1.2.3', setup })

    expectInstalled()
  })

  it('writes over the files already there', () => {
    installSkill({ root, cliVersion: '1.2.3', setup })
    writeFileSync(join(folder, 'SKILL.md'), 'old\n')
    writeFileSync(join(folder, 'scripts', 'run.mjs'), '// old\n')
    writeFileSync(join(folder, 'setup.json'), '{}\n')

    installSkill({ root, cliVersion: '1.2.3', setup })

    expectInstalled()
  })
})
