import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { skillMarkdownOf, skillSourcePaths, skillVersionOf } from '../agent-skill/skill-markdown.js'
import { cleanUpRuns, createProject, noLaunch, removeMarkerFolder, takeUnusedUrl, version } from './run-cli.fixture.js'
import { runCli } from './run-cli.js'

afterEach(cleanUpRuns)
afterAll(removeMarkerFolder)

/**
 * The installed skill's folder, relative to the project.
 */
const skillFolder = '.agents/skills/visual-check'

/**
 * A valid `setup.json`.
 */
const setupText = `${JSON.stringify(
  { cli: { command: ['pnpm', 'exec', 'visual-check'], cwd: '../../..' }, storybooks: {} },
  null,
  2,
)}\n`

/**
 * Makes a project whose Storybook is down, with the agent skill `skillVersion` wrote and `setup` as its `setup.json`.
 */
async function projectWithSkill(skillVersion = '0.0.0-old', setup = setupText): Promise<string> {
  return createProject({
    'visual-check.config.mjs': `export default { storybooks: { web: { url: '${await takeUnusedUrl()}' } } }\n`,
    [`${skillFolder}/SKILL.md`]: skillMarkdownOf(readFileSync(skillSourcePaths.markdown, 'utf8'), skillVersion),
    [`${skillFolder}/scripts/run.mjs`]: '// old\n',
    [`${skillFolder}/setup.json`]: setup,
  })
}

/**
 * Reads the bytes of each installed skill file, to compare before and after a run.
 */
function skillFilesOf(project: string): Buffer[] {
  return ['SKILL.md', 'scripts/run.mjs', 'setup.json'].map((path) => readFileSync(join(project, skillFolder, path)))
}

/**
 * The lines a refresh writes on stderr, from the project root.
 */
const refreshLines =
  `visual-check ${version} rewrote the agent skill, which another version wrote:\n` +
  `  ${skillFolder}/SKILL.md\n` +
  `  ${skillFolder}/scripts/run.mjs\n`

describe('runCli refreshing the agent skill', () => {
  it.each([['test', '--all'], ['update']])(
    'rewrites a skill another version wrote before %s does anything else',
    async (...args) => {
      const project = await projectWithSkill()
      const result = await runCli(args, {}, project, noLaunch)

      expect(result.exitCode).toBe(2)
      expect(result.stderr.startsWith(refreshLines)).toBe(true)
      expect(skillVersionOf(readFileSync(join(project, skillFolder, 'SKILL.md'), 'utf8'))).toBe(version)
      expect(readFileSync(join(project, skillFolder, 'scripts', 'run.mjs'))).toEqual(
        readFileSync(skillSourcePaths.script),
      )
      expect(readFileSync(join(project, skillFolder, 'setup.json'), 'utf8')).toBe(setupText)
    },
  )

  it('keeps stdout one JSON document with --reporter json', async () => {
    const project = await projectWithSkill()
    const result = await runCli(['test', '--all', '--reporter', 'json'], {}, project, noLaunch)

    expect(() => JSON.parse(result.stdout)).not.toThrow()
    expect(result.stderr).toContain(refreshLines)
  })

  it('reads and writes nothing in CI', async () => {
    const project = await projectWithSkill()
    const before = skillFilesOf(project)
    const result = await runCli(['test', '--all'], { CI: 'true' }, project, noLaunch)

    expect(skillFilesOf(project)).toEqual(before)
    expect(result.stderr).not.toContain('rewrote the agent skill')
  })

  it('leaves a skill this version wrote', async () => {
    const project = await projectWithSkill(version)
    const before = skillFilesOf(project)
    const result = await runCli(['test', '--all'], {}, project, noLaunch)

    expect(skillFilesOf(project)).toEqual(before)
    expect(result.stderr).not.toContain('rewrote the agent skill')
  })

  it('warns to run init again when setup.json lacks a key', async () => {
    const project = await projectWithSkill(undefined, '{"cli":{}}')
    const result = await runCli(['test', '--all'], {}, project, noLaunch)

    expect(result.stderr).toContain(
      `Warning: The agent skill's setup.json at ${skillFolder}/setup.json has no storybooks. ` +
        'Run visual-check init again to refresh it.\n',
    )
  })

  it('names the files relative to the folder the CLI runs in', async () => {
    const project = await projectWithSkill()
    const cwd = join(project, 'src')

    mkdirSync(cwd)

    const result = await runCli(['test', '--all'], {}, cwd, noLaunch)

    expect(result.stderr).toContain(`  ../${skillFolder}/SKILL.md\n`)
  })
})
