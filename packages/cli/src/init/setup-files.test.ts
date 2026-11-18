import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  configEntryOf,
  configSourceOf,
  configStorybookOf,
  modesFileSource,
  pinDependency,
  setScripts,
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

describe('configStorybookOf', () => {
  it.each([
    ['/r/.storybook', '/r', { dir: '.', configDir: '.storybook' }, "web: { url: 'http://127.0.0.1:6006' },"],
    [
      '/r/packages/ui/.storybook',
      '/r/packages/ui',
      { dir: 'packages/ui', configDir: '.storybook' },
      "web: { dir: 'packages/ui', url: 'http://127.0.0.1:6006' },",
    ],
    [
      '/r/packages/ui/config/sb',
      '/r/packages/ui',
      { dir: 'packages/ui', configDir: 'config/sb' },
      "web: { dir: 'packages/ui', configDir: 'config/sb', url: 'http://127.0.0.1:6006' },",
    ],
    [
      '/r/docs/.storybook',
      '/r',
      { dir: '.', configDir: 'docs/.storybook' },
      "web: { configDir: 'docs/.storybook', url: 'http://127.0.0.1:6006' },",
    ],
  ])('places the config folder %s of the package %s relative to it', (configDir, packageDir, place, entry) => {
    const storybook = configStorybookOf({
      name: 'web',
      url: 'http://127.0.0.1:6006',
      configFolder: '/r',
      packageDir,
      configDir,
    })

    expect(storybook).toEqual({ name: 'web', url: 'http://127.0.0.1:6006', ...place })
    expect(configEntryOf(storybook)).toBe(entry)
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
  it('has the modes file source, whose comment shows how to spread visualCheck into the preview file', () => {
    expect(modesFileSource).toBe(`import { defineVisualCheck } from '@visual-check/storybook'

// To set options for every story, spread visualCheck into the parameters in your preview file:
//   import { visualCheck } from './visual-check'
//   parameters: { ...visualCheck({}) },
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

    writeIfMissing(path, 'content')

    expect(readFileSync(path, 'utf8')).toBe('content')
  })

  it('keeps an existing file as it is', () => {
    const folder = createFolder()
    const path = join(folder, 'file.txt')

    writeFileSync(path, 'original')

    writeIfMissing(path, 'new')

    expect(readFileSync(path, 'utf8')).toBe('original')
  })

  it('throws other errors', () => {
    const folder = createFolder()

    expect(() => writeIfMissing(join(folder, 'a'.repeat(300)), 'x')).toThrow(
      expect.objectContaining({ code: 'ENAMETOOLONG' }),
    )
  })
})

describe('setScripts', () => {
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
  const scripts = { 'visual:check': 'visual-check test', 'visual:update': 'visual-check update' }

  it('keeps tab indentation', () => {
    const path = manifestWith('{\n\t"name": "x",\n\t"scripts": {\n\t\t"build": "tsc"\n\t}\n}\n')

    expect(setScripts(path, scripts)).toEqual([])
    expect(readFileSync(path, 'utf8')).toBe(
      [
        '{',
        '\t"name": "x",',
        '\t"scripts": {',
        '\t\t"build": "tsc",',
        '\t\t"visual:check": "visual-check test",',
        '\t\t"visual:update": "visual-check update"',
        '\t}',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('keeps four-space indentation', () => {
    const path = manifestWith('{\n    "name": "x"\n}\n')

    setScripts(path, { a: 'b' })

    expect(readFileSync(path, 'utf8')).toBe('{\n    "name": "x",\n    "scripts": {\n        "a": "b"\n    }\n}\n')
  })

  it('uses two spaces when nothing is indented', () => {
    const path = manifestWith('{}')

    setScripts(path, { a: 'b' })

    expect(readFileSync(path, 'utf8')).toBe('{\n  "scripts": {\n    "a": "b"\n  }\n}')
  })

  it('keeps CRLF line endings', () => {
    const path = manifestWith('{\r\n  "name": "x"\r\n}\r\n')

    setScripts(path, { a: 'b' })

    expect(readFileSync(path, 'utf8')).toBe('{\r\n  "name": "x",\r\n  "scripts": {\r\n    "a": "b"\r\n  }\r\n}\r\n')
  })

  it('keeps a missing trailing newline missing', () => {
    const path = manifestWith('{\n  "name": "x"\n}')

    setScripts(path, { a: 'b' })

    expect(readFileSync(path, 'utf8')).toBe('{\n  "name": "x",\n  "scripts": {\n    "a": "b"\n  }\n}')
  })

  it('creates scripts as the last key and keeps the others in order', () => {
    const path = manifestWith('{\n  "version": "1.0.0",\n  "name": "x",\n  "dependencies": {\n    "a": "1"\n  }\n}\n')

    setScripts(path, { a: 'b' })

    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

    expect(Object.keys(manifest)).toEqual(['version', 'name', 'dependencies', 'scripts'])
    expect(manifest.dependencies).toEqual({ a: '1' })
  })

  it('replaces a script that runs something else in its place, and gives its name', () => {
    const path = manifestWith('{\n  "scripts": {\n    "visual:check": "mine",\n    "build": "tsc"\n  }\n}\n')

    expect(setScripts(path, scripts)).toEqual(['visual:check'])
    expect(readFileSync(path, 'utf8')).toBe(
      [
        '{',
        '  "scripts": {',
        '    "visual:check": "visual-check test",',
        '    "build": "tsc",',
        '    "visual:update": "visual-check update"',
        '  }',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('replaces a script that is not a text', () => {
    const path = manifestWith('{"scripts":{"a":["x"]}}')

    expect(setScripts(path, { a: 'b' })).toEqual(['a'])
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ scripts: { a: 'b' } })
  })

  it('gives every script it replaced, in the given order', () => {
    const path = manifestWith('{"scripts":{"visual:update":"vitest -u","visual:check":"vitest"}}')

    expect(setScripts(path, scripts)).toEqual(['visual:check', 'visual:update'])
  })

  it('leaves the file untouched when every script is already set', () => {
    const text = '{"scripts":{"visual:check":"visual-check test","visual:update":"visual-check update"}}'
    const path = manifestWith(text)
    const past = new Date(1_000_000_000_000)

    utimesSync(path, past, past)

    expect(setScripts(path, scripts)).toEqual([])
    expect(readFileSync(path, 'utf8')).toBe(text)
    expect(statSync(path).mtimeMs).toBe(past.getTime())
  })

  it('throws when scripts is not an object', () => {
    const path = manifestWith('{"scripts":"nope"}')

    expect(() => setScripts(path, scripts)).toThrow(
      new Error(`The "scripts" field of ${path} is not an object, so init can't add scripts to it.`),
    )
  })

  it('throws when scripts is an array', () => {
    const path = manifestWith('{"scripts":[]}')

    expect(() => setScripts(path, scripts)).toThrow(
      new Error(`The "scripts" field of ${path} is not an object, so init can't add scripts to it.`),
    )
  })

  it.each(['[]', 'null', '"text"'])('throws when the file is %s instead of an object', (text) => {
    const path = manifestWith(text)

    expect(() => setScripts(path, scripts)).toThrow(
      new Error(`${path} is not a JSON object, so init can't add scripts to it.`),
    )
    expect(readFileSync(path, 'utf8')).toBe(text)
  })
})

describe('pinDependency', () => {
  /**
   * Writes `text` to a `package.json` in a new folder and returns its path.
   */
  function manifestWith(text: string): string {
    const path = join(createFolder(), 'package.json')

    writeFileSync(path, text)

    return path
  }

  it('sets a range back to the exact version in the field that lists it, keeping the key order and indentation', () => {
    const path = manifestWith(
      '{\n    "name": "ui",\n    "devDependencies": {\n        "a": "1.0.0",\n        "addon": "^1.2.3",\n        "z": "2"\n    }\n}\n',
    )

    pinDependency(path, 'addon', '1.2.3')

    expect(readFileSync(path, 'utf8')).toBe(
      '{\n    "name": "ui",\n    "devDependencies": {\n        "a": "1.0.0",\n        "addon": "1.2.3",\n        "z": "2"\n    }\n}\n',
    )
  })

  it('keeps CRLF line endings and no trailing newline', () => {
    const path = manifestWith('{\r\n  "dependencies": {\r\n    "addon": "^1.2.3"\r\n  }\r\n}')

    pinDependency(path, 'addon', '1.2.3')

    expect(readFileSync(path, 'utf8')).toBe('{\r\n  "dependencies": {\r\n    "addon": "1.2.3"\r\n  }\r\n}')
  })

  it.each([
    ['already exact', '{ "devDependencies": { "addon": "1.2.3" } }'],
    ['not listed', '{ "devDependencies": { "other": "^1.0.0" } }'],
  ])('leaves the file alone when the dependency is %s', (_, text) => {
    const path = manifestWith(text)

    pinDependency(path, 'addon', '1.2.3')

    expect(readFileSync(path, 'utf8')).toBe(text)
  })

  it("throws for a file that isn't a JSON object, or is missing", () => {
    expect(() => pinDependency(manifestWith('[]'), 'addon', '1.2.3')).toThrow(
      /is not a JSON object, so init can't pin addon\.$/,
    )
    expect(() => pinDependency(join(createFolder(), 'package.json'), 'addon', '1.2.3')).toThrow(
      expect.objectContaining({ code: 'ENOENT' }),
    )
  })
})
