import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addScripts,
  configEntryOf,
  configSourceOf,
  modesFileSource,
  visualCheckGitignore,
  writeIfMissing,
} from './setup-files.js'

/**
 * The temporary folders the tests made, removed after each test.
 */
const temporaryFolders: string[] = []

/**
 * Makes an empty temporary folder and returns its real path.
 */
function createFolder(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-setup-')))

  temporaryFolders.push(folder)

  return folder
}

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

/**
 * Wraps Storybook lines in the config around them.
 */
function configWith(...lines: string[]): string {
  return [
    "import { defineConfig } from '@visual-check/cli'",
    '',
    'export default defineConfig({',
    '  storybooks: {',
    ...lines.map((line) => `    ${line}`),
    '  },',
    '})',
    '',
  ].join('\n')
}

describe('configSourceOf', () => {
  it('writes one root Storybook with only its url', () => {
    expect(configSourceOf([{ name: 'setup-fixture', url: 'http://127.0.0.1:6106' }])).toBe(
      `import { defineConfig } from '@visual-check/cli'

export default defineConfig({
  storybooks: {
    'setup-fixture': { url: 'http://127.0.0.1:6106' },
  },
})
`,
    )
  })

  it('quotes a name that starts with a digit', () => {
    expect(configSourceOf([{ name: '2d', url: 'http://localhost:6006' }])).toBe(
      configWith("'2d': { url: 'http://localhost:6006' },"),
    )
  })

  it('escapes line breaks in strings', () => {
    expect(configSourceOf([{ name: 'web', url: 'a\nb\rc\u2028d\u2029e' }])).toBe(
      configWith("web: { url: 'a\\nb\\rc\\u2028d\\u2029e' },"),
    )
  })

  it('leaves a plain identifier name unquoted', () => {
    expect(configSourceOf([{ name: 'web', url: 'http://localhost:6006' }])).toBe(
      configWith("web: { url: 'http://localhost:6006' },"),
    )
  })

  it('writes a configDir that is not the default', () => {
    expect(configSourceOf([{ name: 'web', url: 'http://localhost:6006', configDir: 'docs/.storybook' }])).toBe(
      configWith("web: { configDir: 'docs/.storybook', url: 'http://localhost:6006' },"),
    )
  })

  it('writes a configDir at the package root', () => {
    expect(configSourceOf([{ name: 'web', url: 'http://localhost:6006', configDir: '.' }])).toBe(
      configWith("web: { configDir: '.', url: 'http://localhost:6006' },"),
    )
  })

  it('leaves out the default configDir', () => {
    expect(configSourceOf([{ name: 'web', url: 'http://localhost:6006', configDir: '.storybook' }])).toBe(
      configWith("web: { url: 'http://localhost:6006' },"),
    )
  })

  it('writes a dir that is not the config folder', () => {
    expect(configSourceOf([{ name: 'web', url: 'http://localhost:6006', dir: 'apps/web' }])).toBe(
      configWith("web: { dir: 'apps/web', url: 'http://localhost:6006' },"),
    )
  })

  it('leaves out a dir of the config folder', () => {
    expect(configSourceOf([{ name: 'web', url: 'http://localhost:6006', dir: '.' }])).toBe(
      configWith("web: { url: 'http://localhost:6006' },"),
    )
  })

  it('orders dir, configDir, url', () => {
    expect(configSourceOf([{ name: 'web', url: 'http://localhost:6006', configDir: 'cfg', dir: 'apps/web' }])).toBe(
      configWith("web: { dir: 'apps/web', configDir: 'cfg', url: 'http://localhost:6006' },"),
    )
  })

  it('escapes quotes and backslashes in strings', () => {
    expect(configSourceOf([{ name: 'web', url: "http://x/it's\\a" }])).toBe(
      configWith("web: { url: 'http://x/it\\'s\\\\a' },"),
    )
  })

  it('writes two Storybooks in the given order', () => {
    expect(
      configSourceOf([
        { name: 'web', url: 'http://localhost:6006', dir: 'apps/web' },
        { name: 'docs-site', url: 'http://localhost:6007', dir: 'apps/docs' },
      ]),
    ).toBe(
      configWith(
        "web: { dir: 'apps/web', url: 'http://localhost:6006' },",
        "'docs-site': { dir: 'apps/docs', url: 'http://localhost:6007' },",
      ),
    )
  })

  it('never writes platform or image', () => {
    const source = configSourceOf([{ name: 'web', url: 'http://localhost:6006', dir: 'apps/web', configDir: '.' }])

    expect(source).not.toContain('platform')
    expect(source).not.toContain('image')
  })
})

describe('configEntryOf', () => {
  it('gives one line with a bare key for an identifier', () => {
    expect(configEntryOf({ name: 'web', url: 'http://127.0.0.1:6006' })).toBe("web: { url: 'http://127.0.0.1:6006' },")
  })

  it('quotes a key that is not an identifier and keeps configDir when it is not the default', () => {
    expect(configEntryOf({ name: 'web-app', url: 'http://127.0.0.1:6007', configDir: 'docs/.storybook' })).toBe(
      "'web-app': { configDir: 'docs/.storybook', url: 'http://127.0.0.1:6007' },",
    )
  })
})

describe('file contents', () => {
  it('has the modes file source', () => {
    expect(modesFileSource).toBe(`import { defineVisualCheck } from '@visual-check/storybook'

export const visualCheck = defineVisualCheck({
  modes: {
    // Each mode a story lists adds one snapshot besides its default capture. For example:
    // mobile: { viewport: { width: 375, height: 667, deviceScaleFactor: 2, touch: true } },
  },
})
`)
  })

  it('has the .visual-check/.gitignore content', () => {
    expect(visualCheckGitignore).toBe('/*\n!/baselines/\n!/.gitignore\n')
  })
})

describe('writeIfMissing', () => {
  it('writes into a missing nested folder', () => {
    const path = join(createFolder(), 'a', 'b', 'file.txt')

    expect(writeIfMissing(path, 'content')).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('content')
  })

  it('keeps an existing file as it is', () => {
    const folder = createFolder()
    const path = join(folder, 'file.txt')

    writeFileSync(path, 'original')

    expect(writeIfMissing(path, 'new')).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe('original')
  })

  it('throws other errors', () => {
    const folder = createFolder()

    expect(() => writeIfMissing(join(folder, 'a'.repeat(300)), 'x')).toThrow(
      expect.objectContaining({ code: 'ENAMETOOLONG' }),
    )
  })
})

describe('addScripts', () => {
  /**
   * Writes `text` to a `package.json` in a new folder and returns its path.
   */
  function manifestWith(text: string): string {
    const path = join(createFolder(), 'package.json')

    writeFileSync(path, text)

    return path
  }

  /**
   * The scripts the tests add.
   */
  const scripts = { 'visual:test': 'visual-check test', 'visual:update': 'visual-check update' }

  it('keeps tab indentation', () => {
    const path = manifestWith('{\n\t"name": "x",\n\t"scripts": {\n\t\t"build": "tsc"\n\t}\n}\n')

    expect(addScripts(path, scripts)).toEqual(['visual:test', 'visual:update'])
    expect(readFileSync(path, 'utf8')).toBe(
      [
        '{',
        '\t"name": "x",',
        '\t"scripts": {',
        '\t\t"build": "tsc",',
        '\t\t"visual:test": "visual-check test",',
        '\t\t"visual:update": "visual-check update"',
        '\t}',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('keeps four-space indentation', () => {
    const path = manifestWith('{\n    "name": "x"\n}\n')

    addScripts(path, { a: 'b' })

    expect(readFileSync(path, 'utf8')).toBe('{\n    "name": "x",\n    "scripts": {\n        "a": "b"\n    }\n}\n')
  })

  it('uses two spaces when nothing is indented', () => {
    const path = manifestWith('{}')

    addScripts(path, { a: 'b' })

    expect(readFileSync(path, 'utf8')).toBe('{\n  "scripts": {\n    "a": "b"\n  }\n}')
  })

  it('keeps CRLF line endings', () => {
    const path = manifestWith('{\r\n  "name": "x"\r\n}\r\n')

    addScripts(path, { a: 'b' })

    expect(readFileSync(path, 'utf8')).toBe('{\r\n  "name": "x",\r\n  "scripts": {\r\n    "a": "b"\r\n  }\r\n}\r\n')
  })

  it('keeps a missing trailing newline missing', () => {
    const path = manifestWith('{\n  "name": "x"\n}')

    addScripts(path, { a: 'b' })

    expect(readFileSync(path, 'utf8')).toBe('{\n  "name": "x",\n  "scripts": {\n    "a": "b"\n  }\n}')
  })

  it('creates scripts as the last key and keeps the others in order', () => {
    const path = manifestWith('{\n  "version": "1.0.0",\n  "name": "x",\n  "dependencies": {\n    "a": "1"\n  }\n}\n')

    addScripts(path, { a: 'b' })

    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

    expect(Object.keys(manifest)).toEqual(['version', 'name', 'dependencies', 'scripts'])
    expect(manifest.dependencies).toEqual({ a: '1' })
  })

  it('leaves an existing script alone and does not return it', () => {
    const path = manifestWith('{\n  "scripts": {\n    "visual:test": "mine"\n  }\n}\n')

    expect(addScripts(path, scripts)).toEqual(['visual:update'])
    expect(JSON.parse(readFileSync(path, 'utf8')).scripts).toEqual({
      'visual:test': 'mine',
      'visual:update': 'visual-check update',
    })
  })

  it('leaves the file untouched when nothing is added', () => {
    const text = '{"scripts":{"visual:test":"a","visual:update":"b"}}'
    const path = manifestWith(text)
    const past = new Date(1_000_000_000_000)

    utimesSync(path, past, past)

    expect(addScripts(path, scripts)).toEqual([])
    expect(readFileSync(path, 'utf8')).toBe(text)
    expect(statSync(path).mtimeMs).toBe(past.getTime())
  })

  it('throws when scripts is not an object', () => {
    const path = manifestWith('{"scripts":"nope"}')

    expect(() => addScripts(path, scripts)).toThrow(
      new Error(`The "scripts" field of ${path} is not an object, so init can't add scripts to it.`),
    )
  })

  it('throws when scripts is an array', () => {
    const path = manifestWith('{"scripts":[]}')

    expect(() => addScripts(path, scripts)).toThrow(
      new Error(`The "scripts" field of ${path} is not an object, so init can't add scripts to it.`),
    )
  })

  it.each(['[]', 'null', '"text"'])('throws when the file is %s instead of an object', (text) => {
    const path = manifestWith(text)

    expect(() => addScripts(path, scripts)).toThrow(
      new Error(`${path} is not a JSON object, so init can't add scripts to it.`),
    )
    expect(readFileSync(path, 'utf8')).toBe(text)
  })
})
