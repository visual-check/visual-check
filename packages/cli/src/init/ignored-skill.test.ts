import { execFileSync } from 'node:child_process'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { devNull } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findIgnoredPaths, ignoredPathsOf, ignoredSkillWarningOf } from './ignored-skill.js'
import { makeProject, removeProjects } from './project.fixture.js'

beforeEach(() => {
  // Leave the developer's own git config, such as a global excludes file, out of what git reports.
  vi.stubEnv('GIT_CONFIG_GLOBAL', devNull)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
})

afterEach(() => {
  removeProjects()
})

/**
 * The agent skill's folder and its link, as `init` gives them to git.
 */
const skillPaths = ['.agents/skills/visual-check', '.claude/skills/visual-check']

/**
 * Makes a repository with the agent skill's folder, its link, and `gitignore` as its `.gitignore`.
 */
function skillRepo(gitignore: string): string {
  const root = makeProject({ files: { '.gitignore': gitignore, '.agents/skills/visual-check/SKILL.md': 'skill\n' } })

  mkdirSync(join(root, '.claude', 'skills'), { recursive: true })
  symlinkSync('../../.agents/skills/visual-check', join(root, '.claude', 'skills', 'visual-check'))

  return root
}

describe('ignoredPathsOf', () => {
  it('gives none for no output', () => {
    expect(ignoredPathsOf('')).toEqual([])
  })

  it('reads one match', () => {
    expect(ignoredPathsOf('.gitignore\x001\x00.claude/skills/*\x00.claude/skills/visual-check\x00')).toEqual([
      { path: '.claude/skills/visual-check', source: '.gitignore', line: 1, pattern: '.claude/skills/*' },
    ])
  })

  it('reads two matches', () => {
    expect(
      ignoredPathsOf(
        '.gitignore\x002\x00.agents/\x00.agents/skills/visual-check\x00.gitignore\x003\x00.claude/\x00.claude/skills/visual-check\x00',
      ),
    ).toEqual([
      { path: '.agents/skills/visual-check', source: '.gitignore', line: 2, pattern: '.agents/' },
      { path: '.claude/skills/visual-check', source: '.gitignore', line: 3, pattern: '.claude/' },
    ])
  })

  it('drops a match of a negated pattern, which keeps the path', () => {
    expect(
      ignoredPathsOf('.gitignore\x002\x00!.claude/skills/visual-check\x00.claude/skills/visual-check\x00'),
    ).toEqual([])
  })

  it('keeps a source with a colon whole', () => {
    expect(ignoredPathsOf('C:\\Users\\me\\ignore\x004\x00.claude\x00.claude/skills/visual-check\x00')).toEqual([
      { path: '.claude/skills/visual-check', source: 'C:\\Users\\me\\ignore', line: 4, pattern: '.claude' },
    ])
  })
})

describe('ignoredSkillWarningOf', () => {
  it('gives nothing when git ignores neither path', () => {
    expect(ignoredSkillWarningOf([])).toBeUndefined()
  })

  it('names the one path and the rule that ignores it', () => {
    expect(
      ignoredSkillWarningOf([
        { path: '.claude/skills/visual-check', source: '.gitignore', line: 1, pattern: '.claude/skills/*' },
      ]),
    ).toBe(
      "Warning: git ignores .claude/skills/visual-check (.gitignore line 1: .claude/skills/*), so the agent skill won't reach other clones. Change that rule so git keeps it.",
    )
  })

  it('names both paths and their rules', () => {
    expect(
      ignoredSkillWarningOf([
        { path: '.agents/skills/visual-check', source: '.gitignore', line: 2, pattern: '.agents/' },
        { path: '.claude/skills/visual-check', source: '.gitignore', line: 3, pattern: '.claude/' },
      ]),
    ).toBe(
      "Warning: git ignores .agents/skills/visual-check (.gitignore line 2: .agents/) and .claude/skills/visual-check (.gitignore line 3: .claude/), so the agent skill won't reach other clones. Change those rules so git keeps them.",
    )
  })
})

describe('findIgnoredPaths', () => {
  it.skipIf(process.platform === 'win32')('reports the link a .claude/skills/* rule ignores', async () => {
    const root = skillRepo('.claude/skills/*\n')

    expect(await findIgnoredPaths(root, skillPaths)).toEqual([
      { path: '.claude/skills/visual-check', source: '.gitignore', line: 1, pattern: '.claude/skills/*' },
    ])
  })

  it.skipIf(process.platform === 'win32')('reports nothing when a later rule keeps the link', async () => {
    const root = skillRepo('.claude/skills/*\n!.claude/skills/visual-check\n')

    expect(await findIgnoredPaths(root, skillPaths)).toEqual([])
  })

  it.skipIf(process.platform === 'win32')('reports the link a .claude/ rule ignores', async () => {
    const root = skillRepo('.claude/\n')

    expect(await findIgnoredPaths(root, skillPaths)).toEqual([
      { path: '.claude/skills/visual-check', source: '.gitignore', line: 1, pattern: '.claude/' },
    ])
  })

  it.skipIf(process.platform === 'win32')('reports nothing for a tracked link', async () => {
    const root = skillRepo('')

    execFileSync('git', ['add', '.claude/skills/visual-check'], { cwd: root })
    writeFileSync(join(root, '.gitignore'), '.claude/skills/*\n')

    expect(await findIgnoredPaths(root, skillPaths)).toEqual([])
  })

  it('gives none outside a repository', async () => {
    const root = makeProject({ git: false })

    expect(await findIgnoredPaths(root, skillPaths)).toEqual([])
  })
})
