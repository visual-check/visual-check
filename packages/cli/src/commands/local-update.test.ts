import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { localUpdateOf, updateScriptOf } from './local-update.js'

/**
 * The temporary folders the tests made, removed after each test.
 */
const temporaryFolders: string[] = []

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

/**
 * Makes a temporary folder holding the files given, removed after the test. Returns its real path.
 */
function projectWith(files: Record<string, string>): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-local-update-')))

  temporaryFolders.push(folder)

  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(folder, name), content)
  }

  return folder
}

describe('updateScriptOf', () => {
  it('picks the script whose command is exactly visual-check update', () => {
    expect(
      updateScriptOf({
        scripts: { 'visual:check': 'visual-check test', 'visual:update': ' visual-check update ', other: 'x' },
      }),
    ).toBe('visual:update')
  })

  it('picks the first such script, in order', () => {
    expect(updateScriptOf({ scripts: { 'b:update': 'visual-check update', 'a:update': 'visual-check update' } })).toBe(
      'b:update',
    )
  })

  it('takes a name with any character a code span shows as written', () => {
    expect(updateScriptOf({ scripts: { 'visual+update *now*': 'visual-check update' } })).toBe('visual+update *now*')
  })

  it.each([
    ['a command with options', { 'visual:update': 'visual-check update --storybook web' }],
    ['a value that is not text', { 'visual:update': ['visual-check update'] }],
    ['a name with a backtick', { 'visual`update': 'visual-check update' }],
    ['a name with a line break', { 'visual\nupdate': 'visual-check update', 'visual\rupdate': 'visual-check update' }],
  ])('ignores %s', (_, scripts) => {
    expect(updateScriptOf({ scripts })).toBeUndefined()
  })

  it.each([
    ['no scripts', {}],
    ['empty scripts', { scripts: {} }],
    ['scripts that are an array', { scripts: ['visual-check update'] }],
  ])('gives undefined for %s', (_, manifest) => {
    expect(updateScriptOf(manifest)).toBeUndefined()
  })
})

describe('localUpdateOf', () => {
  it("names the script in the package.json beside the config, with Docker for a container's platform", () => {
    const project = projectWith({
      'package.json': JSON.stringify({ scripts: { 'visual:update': 'visual-check update' } }),
    })

    expect(localUpdateOf(join(project, 'visual-check.config.ts'), 'linux/arm64')).toEqual({
      script: 'visual:update',
      docker: true,
    })
  })

  it('reads a package.json that starts with a byte order mark', () => {
    const project = projectWith({
      'package.json': `\uFEFF${JSON.stringify({ scripts: { 'visual:update': 'visual-check update' } })}`,
    })

    expect(localUpdateOf(join(project, 'visual-check.config.ts'), 'linux/amd64').script).toBe('visual:update')
  })

  it.each([
    ['missing', {}],
    ['invalid', { 'package.json': '{ "scripts": ' }],
    ['not an object', { 'package.json': '"visual-check update"' }],
  ])('gives no script when package.json is %s', (_, files) => {
    const project = projectWith(files)

    expect(localUpdateOf(join(project, 'visual-check.config.ts'), 'linux/amd64')).toEqual({
      script: undefined,
      docker: true,
    })
  })

  it('needs no Docker on the host platform', () => {
    const project = projectWith({})

    expect(localUpdateOf(join(project, 'visual-check.config.ts'), 'host')).toEqual({
      script: undefined,
      docker: false,
    })
  })
})
