import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StorybookError } from './storybook-error.js'
import { checkStorybookVersion, classifyStorybookVersion, readInstalledStorybookVersion } from './storybook-version.js'

/**
 * The folders the tests made, removed after each test.
 */
const folders: string[] = []

/**
 * Makes a temporary folder. Returns its real path.
 */
function createFolder(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-version-')))

  folders.push(folder)

  return folder
}

/**
 * Writes `node_modules/storybook/package.json` with the given content under `folder`.
 */
function install(folder: string, content: string): void {
  const directory = join(folder, 'node_modules', 'storybook')

  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), content)
}

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

describe('classifyStorybookVersion', () => {
  it.each(['8.6.14', '9.0.0', '9.0.18'])('puts %s below the minimum', (version) => {
    expect(classifyStorybookVersion(version)).toBe('below-minimum')
  })

  it.each(['9.1.0', '9.1.0-beta.1', '9.2.3', '10.0.0', '11.0.0-alpha.3', '11.9.9', '9.1.0+build.5'])(
    'supports %s',
    (version) => {
      expect(classifyStorybookVersion(version)).toBe('supported')
    },
  )

  it.each(['12.0.0', '12.0.0-alpha.0', '13.1.0'])('puts %s above the maximum', (version) => {
    expect(classifyStorybookVersion(version)).toBe('above-maximum')
  })

  it.each(['', '9', '9.1', 'abc', 'v9.1.0', '0.0.0-pr-1234-sha-abc1234'])('can not tell %j', (version) => {
    expect(classifyStorybookVersion(version)).toBe('unknown')
  })
})

describe('readInstalledStorybookVersion', () => {
  it('reads the version of the install in the folder', () => {
    const folder = createFolder()

    install(folder, JSON.stringify({ name: 'storybook', version: '9.1.2' }))

    expect(readInstalledStorybookVersion(folder)).toBe('9.1.2')
  })

  it('reads an install whose package.json is not in its exports', () => {
    const folder = createFolder()

    install(folder, JSON.stringify({ version: '10.0.0', exports: { '.': './index.js' } }))

    expect(readInstalledStorybookVersion(folder)).toBe('10.0.0')
  })

  it('reads an install hoisted to a parent folder', () => {
    const folder = createFolder()

    install(folder, JSON.stringify({ version: '9.5.0' }))

    const nested = join(folder, 'apps', 'web')

    mkdirSync(nested, { recursive: true })

    expect(readInstalledStorybookVersion(nested)).toBe('9.5.0')
  })

  it('prefers the nearest install', () => {
    const folder = createFolder()

    install(folder, JSON.stringify({ version: '9.5.0' }))

    const nested = join(folder, 'web')

    install(nested, JSON.stringify({ version: '10.1.0' }))

    expect(readInstalledStorybookVersion(nested)).toBe('10.1.0')
  })

  it.each([
    ['broken', '{ broken'],
    ['versionless', JSON.stringify({ name: 'storybook' })],
  ])('stops at a %s nearest install instead of reading a parent', (_kind, content) => {
    const folder = createFolder()

    install(folder, JSON.stringify({ version: '8.6.0' }))

    const nested = join(folder, 'apps', 'web')

    install(nested, content)

    expect(readInstalledStorybookVersion(nested)).toBeUndefined()
  })

  it('returns undefined when nothing is installed', () => {
    expect(readInstalledStorybookVersion(createFolder())).toBeUndefined()
  })

  it('returns undefined when package.json has no version', () => {
    const folder = createFolder()

    install(folder, JSON.stringify({ name: 'storybook' }))

    expect(readInstalledStorybookVersion(folder)).toBeUndefined()
  })

  it('returns undefined when the version is not a string', () => {
    const folder = createFolder()

    install(folder, JSON.stringify({ version: 9 }))

    expect(readInstalledStorybookVersion(folder)).toBeUndefined()
  })

  it('returns undefined when package.json is not JSON', () => {
    const folder = createFolder()

    install(folder, '{ broken')

    expect(readInstalledStorybookVersion(folder)).toBeUndefined()
  })
})

describe('checkStorybookVersion', () => {
  it('returns nothing for a supported version', () => {
    const dir = createFolder()

    install(dir, JSON.stringify({ version: '9.1.0' }))

    expect(checkStorybookVersion({ name: 'web', dir }, dir)).toBeUndefined()
  })

  it('returns nothing when there is no install to read', () => {
    const dir = createFolder()

    expect(checkStorybookVersion({ name: 'web', dir }, dir)).toBeUndefined()
  })

  it('returns nothing for a version it cannot read', () => {
    const dir = createFolder()

    install(dir, JSON.stringify({ version: 'latest' }))

    expect(checkStorybookVersion({ name: 'web', dir }, dir)).toBeUndefined()
  })

  it('throws for a version below 9.1, naming the folder relative to the current folder', () => {
    const cwd = createFolder()
    const dir = join(cwd, 'web')

    install(dir, JSON.stringify({ version: '9.0.18' }))

    const check = () => checkStorybookVersion({ name: 'web', dir }, cwd)

    expect(check).toThrow(StorybookError)
    expect(check).toThrow(
      'Storybook web runs storybook 9.0.18, and visual-check needs 9.1 or later. Upgrade storybook in web.',
    )
  })

  it('names the current folder when the Storybook runs there', () => {
    const dir = createFolder()

    install(dir, JSON.stringify({ version: '8.6.14' }))

    expect(() => checkStorybookVersion({ name: 'web', dir }, dir)).toThrow('Upgrade storybook in the current folder.')
  })

  it('returns a warning for a version above 11', () => {
    const dir = createFolder()

    install(dir, JSON.stringify({ version: '12.0.0' }))

    expect(checkStorybookVersion({ name: 'web', dir }, dir)).toBe(
      'Warning: Storybook web runs storybook 12.0.0, and visual-check supports 9.1 to 11. The run carries on.',
    )
  })
})
