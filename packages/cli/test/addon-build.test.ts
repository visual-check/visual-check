import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * The built entry's URL.
 */
const entryUrl = new URL('../dist/addon-build.js', import.meta.url).href

/**
 * Imports the built entry.
 */
async function importEntry(): Promise<typeof import('../src/addon-build.js')> {
  return await import(entryUrl)
}

/**
 * The projects the tests made, removed after each test.
 */
const projects: string[] = []

afterEach(() => {
  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true })
  }
})

describe('the built addon-build entry', () => {
  it('exports storybookNameOf alone', async () => {
    const entry = await importEntry()

    expect(Object.keys(entry)).toStrictEqual(['storybookNameOf'])
  })

  it('names a project’s Storybook from its config folder', async () => {
    const { storybookNameOf } = await importEntry()
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-addon-build-')))

    projects.push(root)
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '.git/HEAD'), 'ref: refs/heads/main\n')
    writeFileSync(
      join(root, 'visual-check.config.ts'),
      "export default { storybooks: { web: { url: 'http://127.0.0.1:6006', dir: 'apps/web' } } }\n",
    )

    expect(await storybookNameOf({ configDir: join(root, 'apps/web/.storybook'), cwd: root })).toBe('web')
  })

  it('rejects when no config is found', async () => {
    const { storybookNameOf } = await importEntry()
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-addon-build-')))

    projects.push(root)
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '.git/HEAD'), 'ref: refs/heads/main\n')

    await expect(storybookNameOf({ configDir: join(root, '.storybook'), cwd: root })).rejects.toThrow(
      'No visual-check.config.ts (or .mts, .js, .mjs) found in the current folder or its parents. ' +
        'Run visual-check init to create one.',
    )
  })
})
