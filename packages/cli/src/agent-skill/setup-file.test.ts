import { describe, expect, it } from 'vitest'
import { type SkillSetup, setupFileProblemOf, setupFileTextOf } from './setup-file.js'

/**
 * The skill folder `setup.json` is written in, in a project at `/p`.
 */
const setupDir = '/p/.agents/skills/visual-check'

/**
 * A setup with the CLI at the root and two Storybooks, the second in a workspace package.
 */
const setup: SkillSetup = {
  cli: { command: ['pnpm', 'exec', 'visual-check'], cwd: '/p' },
  storybooks: {
    web: { command: ['pnpm', 'run', 'storybook'], cwd: '/p/apps/web' },
    docs: { command: ['pnpm', 'exec', 'storybook', 'dev', '-p', '6100'], cwd: '/p' },
  },
}

describe('setupFileTextOf', () => {
  it('gives each folder relative to the skill folder', () => {
    const parsed = JSON.parse(setupFileTextOf(setup, setupDir))

    expect(parsed.cli.cwd).toBe('../../..')
    expect(parsed.storybooks.web.cwd).toBe('../../../apps/web')
    expect(parsed.storybooks.docs.cwd).toBe('../../..')
  })

  it('gives the skill folder itself as .', () => {
    const own = { cli: { command: ['visual-check'], cwd: setupDir }, storybooks: {} }

    expect(JSON.parse(setupFileTextOf(own, setupDir)).cli.cwd).toBe('.')
  })

  it('writes two-space JSON ending in a line break, the CLI first and the Storybooks in order', () => {
    const expected = {
      cli: { command: ['pnpm', 'exec', 'visual-check'], cwd: '../../..' },
      storybooks: {
        web: { command: ['pnpm', 'run', 'storybook'], cwd: '../../../apps/web' },
        docs: { command: ['pnpm', 'exec', 'storybook', 'dev', '-p', '6100'], cwd: '../../..' },
      },
    }

    expect(setupFileTextOf(setup, setupDir)).toBe(`${JSON.stringify(expected, null, 2)}\n`)
  })
})

describe('setupFileProblemOf', () => {
  it("says a setup.json that is missing doesn't exist", () => {
    expect(setupFileProblemOf(undefined)).toBe("doesn't exist")
  })

  it('says text that is not JSON is not valid JSON', () => {
    expect(setupFileProblemOf('nope')).toBe("isn't valid JSON")
  })

  it('names every key a document that is not an object lacks', () => {
    expect(setupFileProblemOf('[]')).toBe('has no cli or storybooks')
  })

  it('names the key the runner script reads that is missing', () => {
    expect(setupFileProblemOf('{"cli":{}}')).toBe('has no storybooks')
  })

  it('finds nothing when every key is there, whatever the values', () => {
    expect(setupFileProblemOf('{"cli":{},"storybooks":{}}')).toBeUndefined()
  })
})
