import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { refreshSkill, type SkillRefresh, skillRefreshLinesOf } from './refresh-skill.js'
import { skillMarkdownOf, skillSourcePaths, skillVersionOf } from './skill-markdown.js'

/**
 * A valid `setup.json`, as `init` would write it at the workspace root.
 */
const setupText = `${JSON.stringify(
  { cli: { command: ['pnpm', 'exec', 'visual-check'], cwd: '../../..' }, storybooks: {} },
  null,
  2,
)}\n`

describe('refreshSkill', () => {
  let root: string
  let folder: string
  let claudeFolder: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-refresh-')))
    folder = join(root, '.agents', 'skills', 'visual-check')
    claudeFolder = join(root, '.claude', 'skills', 'visual-check')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /**
   * Installs a skill version 0.9.0 wrote, with an old runner script and `setup` as its `setup.json`.
   */
  function installOld(setup = setupText): void {
    mkdirSync(join(folder, 'scripts'), { recursive: true })
    writeFileSync(join(folder, 'SKILL.md'), skillMarkdownOf(readFileSync(skillSourcePaths.markdown, 'utf8'), '0.9.0'))
    writeFileSync(join(folder, 'scripts', 'run.mjs'), '// old\n')
    writeFileSync(join(folder, 'setup.json'), setup)
  }

  /**
   * Checks that `place` holds `SKILL.md` for version 1.0.0 and this version's runner script.
   */
  function expectRewritten(place: string): void {
    expect(skillVersionOf(readFileSync(join(place, 'SKILL.md'), 'utf8'))).toBe('1.0.0')
    expect(readFileSync(join(place, 'scripts', 'run.mjs'))).toEqual(readFileSync(skillSourcePaths.script))
  }

  it('gives nothing and writes nothing when no skill is installed', () => {
    expect(refreshSkill(root, '1.0.0')).toBeUndefined()
    expect(existsSync(join(root, '.agents'))).toBe(false)
  })

  it('gives nothing and leaves the files when this version wrote the skill', () => {
    installOld()

    const markdown = skillMarkdownOf(readFileSync(skillSourcePaths.markdown, 'utf8'), '1.0.0')

    writeFileSync(join(folder, 'SKILL.md'), markdown)

    expect(refreshSkill(root, '1.0.0')).toBeUndefined()
    expect(readFileSync(join(folder, 'SKILL.md'), 'utf8')).toBe(markdown)
    expect(readFileSync(join(folder, 'scripts', 'run.mjs'), 'utf8')).toBe('// old\n')
  })

  it('rewrites SKILL.md and the runner script another version wrote, and keeps setup.json', () => {
    installOld()

    expect(refreshSkill(root, '1.0.0')).toEqual({
      version: '1.0.0',
      rewritten: [join(folder, 'SKILL.md'), join(folder, 'scripts', 'run.mjs')],
      setupPath: join(folder, 'setup.json'),
      setupProblem: undefined,
      writeProblem: undefined,
    })
    expectRewritten(folder)
    expect(readFileSync(join(folder, 'setup.json'), 'utf8')).toBe(setupText)
  })

  it('rewrites the copy in .claude too, before .agents', () => {
    installOld()
    cpSync(folder, claudeFolder, { recursive: true })

    expect(refreshSkill(root, '1.0.0')?.rewritten).toEqual([
      join(claudeFolder, 'SKILL.md'),
      join(claudeFolder, 'scripts', 'run.mjs'),
      join(folder, 'SKILL.md'),
      join(folder, 'scripts', 'run.mjs'),
    ])
    expectRewritten(claudeFolder)
  })

  it.skipIf(process.platform === 'win32')('leaves a link in .claude, which shares the files', () => {
    installOld()
    mkdirSync(join(root, '.claude', 'skills'), { recursive: true })
    symlinkSync('../../.agents/skills/visual-check', claudeFolder, 'dir')

    expect(refreshSkill(root, '1.0.0')?.rewritten).toEqual([
      join(folder, 'SKILL.md'),
      join(folder, 'scripts', 'run.mjs'),
    ])
    expectRewritten(claudeFolder)
  })

  it('says what keeps setup.json from serving this version', () => {
    installOld('{"cli":{}}')

    expect(refreshSkill(root, '1.0.0')?.setupProblem).toBe('has no storybooks')
  })

  it("says a missing setup.json doesn't exist", () => {
    installOld()
    rmSync(join(folder, 'setup.json'))

    expect(refreshSkill(root, '1.0.0')?.setupProblem).toBe("doesn't exist")
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'reports a write that fails, throws nothing, and tries again on the next run',
    () => {
      installOld()
      // Read-only, so copying the new runner script over it fails.
      chmodSync(join(folder, 'scripts', 'run.mjs'), 0o400)

      try {
        expect(refreshSkill(root, '1.0.0')?.writeProblem).toEqual({ folder, reason: 'EACCES: permission denied' })
        expect(skillVersionOf(readFileSync(join(folder, 'SKILL.md'), 'utf8'))).toBe('0.9.0')
      } finally {
        chmodSync(join(folder, 'scripts', 'run.mjs'), 0o600)
      }

      expect(refreshSkill(root, '1.0.0')?.rewritten).toEqual([
        join(folder, 'SKILL.md'),
        join(folder, 'scripts', 'run.mjs'),
      ])
      expectRewritten(folder)
    },
  )

  it('reports a .claude that is a file, and leaves the skill to try again', () => {
    installOld()
    writeFileSync(join(root, '.claude'), '')

    const refresh = refreshSkill(root, '1.0.0')

    expect(refresh?.rewritten).toEqual([])
    expect(refresh?.writeProblem).toEqual({ folder: claudeFolder, reason: 'ENOTDIR: not a directory' })
    expect(skillVersionOf(readFileSync(join(folder, 'SKILL.md'), 'utf8'))).toBe('0.9.0')
  })
})

describe('skillRefreshLinesOf', () => {
  const root = join(tmpdir(), 'p')
  const folder = join(root, '.agents', 'skills', 'visual-check')
  const refresh: SkillRefresh = {
    version: '1.0.0',
    rewritten: [join(folder, 'SKILL.md'), join(folder, 'scripts', 'run.mjs')],
    setupPath: join(folder, 'setup.json'),
    setupProblem: undefined,
    writeProblem: undefined,
  }

  it('names the rewritten files under a heading, relative to the current folder', () => {
    expect(skillRefreshLinesOf(refresh, root)).toEqual([
      'visual-check 1.0.0 rewrote the agent skill, which another version wrote:',
      '  .agents/skills/visual-check/SKILL.md',
      '  .agents/skills/visual-check/scripts/run.mjs',
    ])
  })

  it('names them from a subfolder', () => {
    expect(skillRefreshLinesOf(refresh, join(root, 'apps', 'web')).slice(1)).toEqual([
      '  ../../.agents/skills/visual-check/SKILL.md',
      '  ../../.agents/skills/visual-check/scripts/run.mjs',
    ])
  })

  it('warns to run init again when setup.json needs it', () => {
    expect(skillRefreshLinesOf({ ...refresh, setupProblem: 'has no storybooks' }, root).at(-1)).toBe(
      "Warning: The agent skill's setup.json at .agents/skills/visual-check/setup.json has no storybooks. " +
        'Run visual-check init again to refresh it.',
    )
  })

  it('warns when a write failed, naming the folder, with no heading when nothing was rewritten', () => {
    const writeProblem = { folder, reason: 'EACCES: permission denied' }

    expect(skillRefreshLinesOf({ ...refresh, rewritten: [], writeProblem }, root)).toEqual([
      "Warning: visual-check couldn't rewrite the agent skill in .agents/skills/visual-check: " +
        'EACCES: permission denied. Run visual-check init again to rewrite it.',
    ])
  })
})
