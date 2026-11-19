import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Which build of `storybook/internal/common` a fake `storybook` package mimics: Storybook 9's CommonJS one, which takes
 * `noCache` and comes in as `.default` when imported, or Storybook 10's ESM one, which takes `skipCache`.
 */
type StorybookFlavour = '9' | '10'

/**
 * The folders the fixture made, removed by `removeStorybookFolders`.
 */
const folders: string[] = []

/**
 * The fake `loadMainConfig`'s body, shared by both flavours: it imports `<configDir>/main.mjs` and gives its default
 * export, and throws unless it gets the flavour's cache option.
 */
function loadMainConfigBody(cacheOption: string): string {
  return [
    `  if (options.${cacheOption} !== true) {`,
    `    throw new Error('${cacheOption} not given')`,
    '  }',
    "  const main = await import(pathToFileURL(join(options.configDir, 'main.mjs')).href)",
    '  return main.default',
  ].join('\n')
}

/**
 * The fake `normalizeStories`: each string entry becomes a matcher of that source, after the tag.
 */
function normalizeStoriesBody(tag: string): string {
  return `  return entries.map((entry) => ({ importPathMatcher: new RegExp(${JSON.stringify(tag)} + entry) }))`
}

/**
 * The fake `storybook/internal/common` of a flavour. Storybook 9's assigns `module.exports` an identifier, so Node
 * finds no named export in it and it comes in as `.default` only.
 */
function commonModuleOf(flavour: StorybookFlavour, tag: string): string {
  if (flavour === '9') {
    return [
      "const { join } = require('node:path')",
      "const { pathToFileURL } = require('node:url')",
      'const api = {',
      '  async loadMainConfig(options) {',
      loadMainConfigBody('noCache'),
      '  },',
      '  normalizeStories(entries) {',
      normalizeStoriesBody(tag),
      '  },',
      '}',
      'module.exports = api',
    ].join('\n')
  }

  return [
    "import { join } from 'node:path'",
    "import { pathToFileURL } from 'node:url'",
    'export async function loadMainConfig(options) {',
    loadMainConfigBody('skipCache'),
    '}',
    'export function normalizeStories(entries) {',
    normalizeStoriesBody(tag),
    '}',
  ].join('\n')
}

/**
 * The fake `storybook` package's `package.json` for a flavour: Storybook 9 gives `internal/common` under `require`,
 * Storybook 10 under `default`.
 */
function storybookPackageJsonOf(flavour: StorybookFlavour): Record<string, unknown> {
  if (flavour === '9') {
    return {
      name: 'storybook',
      version: '9.1.0',
      exports: { './internal/common': { require: './dist/common/index.cjs' } },
    }
  }

  return {
    name: 'storybook',
    version: '10.0.0',
    type: 'module',
    exports: { './internal/common': { default: './dist/common/index.js' } },
  }
}

/**
 * Writes the files under the folder, making their folders.
 */
function writeFiles(folder: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true })
    writeFileSync(join(folder, path), content)
  }
}

/**
 * A Storybook folder the fixture made.
 */
interface StorybookFolder {
  /**
   * The folder, a real absolute path.
   */
  dir: string
  /**
   * Its config folder, `.storybook` in it.
   */
  configDir: string
}

/**
 * What a Storybook folder the fixture makes holds.
 */
interface StorybookFolderOptions {
  /**
   * The content of `.storybook/main.mjs`.
   */
  main: string
  /**
   * The flavour of the fake `storybook` package in its `node_modules`, none when not given.
   */
  flavour?: StorybookFlavour
  /**
   * What the fake's matchers have before each `stories` entry's source, empty when not given.
   */
  tag?: string
}

/**
 * Makes a temporary Storybook folder with a `package.json`, a `.storybook/main.mjs` of the given content and, when a
 * flavour is given, a fake `storybook` package of that flavour in its `node_modules`. The fake's matchers have the
 * source of each `stories` entry after `tag`, empty by default. Gives the folder's real path and its config folder.
 *
 * @public
 */
export function makeStorybookFolder(options: StorybookFolderOptions): StorybookFolder {
  const { main, flavour, tag = '' } = options
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-storybook-')))

  folders.push(dir)
  writeFiles(dir, {
    'package.json': JSON.stringify({ name: 'storybook-under-test', private: true }),
    '.storybook/main.mjs': main,
  })

  if (flavour !== undefined) {
    const commonFile = flavour === '9' ? 'dist/common/index.cjs' : 'dist/common/index.js'

    writeFiles(join(dir, 'node_modules', 'storybook'), {
      'package.json': JSON.stringify(storybookPackageJsonOf(flavour)),
      [commonFile]: commonModuleOf(flavour, tag),
    })
  }

  return { dir, configDir: join(dir, '.storybook') }
}

/**
 * Removes the folders `makeStorybookFolder` made.
 *
 * @public
 */
export function removeStorybookFolders(): void {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
}
