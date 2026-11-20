import {
  lstatSync,
  lutimesSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installSkill } from './install-skill.js'
import { type SkillSetup, setupFileTextOf } from './setup-file.js'
import { skillMarkdownOf, skillSourcePaths, skillVersionOf } from './skill-markdown.js'

describe('installSkill', () => {
  let root: string
  let folder: string
  let claudeFolder: string
  let setup: SkillSetup

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-skill-')))
    folder = join(root, '.agents', 'skills', 'visual-check')
    claudeFolder = join(root, '.claude', 'skills', 'visual-check')
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
    installSkill({ root, cliVersion: '1.2.3', os: 'linux', setup })

    expectInstalled()
  })

  it('writes over the files already there', () => {
    installSkill({ root, cliVersion: '1.2.3', os: 'linux', setup })
    writeFileSync(join(folder, 'SKILL.md'), 'old\n')
    writeFileSync(join(folder, 'scripts', 'run.mjs'), '// old\n')
    writeFileSync(join(folder, 'setup.json'), '{}\n')

    installSkill({ root, cliVersion: '1.2.3', os: 'linux', setup })

    expectInstalled()
  })

  /**
   * Checks that `.claude/skills/visual-check` is a relative link to the installed skill.
   */
  function expectLinked(): void {
    expect(lstatSync(claudeFolder).isSymbolicLink()).toBe(true)
    expect(readlinkSync(claudeFolder)).toBe('../../.agents/skills/visual-check')
    expect(readFileSync(join(claudeFolder, 'SKILL.md'), 'utf8')).toBe(readSkillFile('SKILL.md'))
  }

  /**
   * Checks that `.claude/skills/visual-check` is a real folder holding the installed skill's files, byte for byte.
   */
  function expectCopied(): void {
    expect(lstatSync(claudeFolder).isDirectory()).toBe(true)

    for (const path of ['SKILL.md', join('scripts', 'run.mjs'), 'setup.json']) {
      expect(readFileSync(join(claudeFolder, path))).toEqual(readFileSync(join(folder, path)))
    }
  }

  it.skipIf(process.platform === 'win32')('links .claude/skills/visual-check to the skill', () => {
    installSkill({ root, cliVersion: '1.2.3', os: 'linux', setup })

    expectLinked()
  })

  it.skipIf(process.platform === 'win32')("replaces a folder at the link's path with the link", () => {
    mkdirSync(claudeFolder, { recursive: true })
    writeFileSync(join(claudeFolder, 'SKILL.md'), 'old\n')

    installSkill({ root, cliVersion: '1.2.3', os: 'linux', setup })

    expectLinked()
  })

  it.skipIf(process.platform === 'win32')("replaces a file at the link's path with the link", () => {
    mkdirSync(join(root, '.claude', 'skills'), { recursive: true })
    writeFileSync(claudeFolder, 'old\n')

    installSkill({ root, cliVersion: '1.2.3', os: 'linux', setup })

    expectLinked()
  })

  it.skipIf(process.platform === 'win32')('leaves the right link alone', () => {
    installSkill({ root, cliVersion: '1.2.3', os: 'linux', setup })
    lutimesSync(claudeFolder, 0, 0)

    installSkill({ root, cliVersion: '1.2.3', os: 'linux', setup })

    expect(lstatSync(claudeFolder).mtimeMs).toBe(0)
  })

  it.skipIf(process.platform === 'win32')('replaces a link pointing elsewhere, leaving what it pointed to', () => {
    const elsewhere = join(root, 'elsewhere')

    mkdirSync(elsewhere)
    writeFileSync(join(elsewhere, 'SKILL.md'), 'other\n')
    mkdirSync(join(root, '.claude', 'skills'), { recursive: true })
    symlinkSync(elsewhere, claudeFolder, 'dir')

    installSkill({ root, cliVersion: '1.2.3', os: 'linux', setup })

    expectLinked()
    expect(readFileSync(join(elsewhere, 'SKILL.md'), 'utf8')).toBe('other\n')
  })

  it('copies the skill to .claude on Windows', () => {
    installSkill({ root, cliVersion: '1.2.3', os: 'win32', setup })

    expectCopied()
  })

  it("replaces git's link stand-in file with the copy on Windows", () => {
    mkdirSync(join(root, '.claude', 'skills'), { recursive: true })
    writeFileSync(claudeFolder, '../../.agents/skills/visual-check')

    installSkill({ root, cliVersion: '1.2.3', os: 'win32', setup })

    expectCopied()
  })
})
