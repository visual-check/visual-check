import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { type Manifest, readWorkspacePackages, repoRoot, type WorkspacePackage } from '../workspace/manifests.ts'
import { findPublicTypeProblems } from './public-types.ts'

/**
 * The temporary directories the tests made, removed after each test.
 */
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

/**
 * A package that exports a root entry and `./sub`, each with a `types` condition, as `@visual-check/storybook` does.
 */
const exportsOnly: Manifest = {
  name: 'fixture',
  version: '1.0.0',
  exports: {
    '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    './sub': { types: './dist/sub.d.ts', default: './dist/sub.js' },
  },
}

/**
 * The same package with `types` and `typesVersions` for `node10` resolution.
 */
const withNode10Types: Manifest = {
  ...exportsOnly,
  types: './dist/index.d.ts',
  typesVersions: { '*': { sub: ['./dist/sub.d.ts'] } },
}

/**
 * Writes the package into `node_modules` of a new ES module project, with its declaration files, and returns the
 * package and the project's directory, which imports it.
 */
function install(manifest: Manifest, declarations = ['index.d.ts', 'sub.d.ts']): [WorkspacePackage, URL] {
  const root = mkdtempSync(join(tmpdir(), 'public-types-'))
  const packageDirectory = join(root, 'node_modules', manifest.name)

  directories.push(root)
  mkdirSync(join(packageDirectory, 'dist'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'importer', type: 'module' }))
  writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({ type: 'module', ...manifest }))

  for (const declaration of declarations) {
    writeFileSync(join(packageDirectory, 'dist', declaration), 'export declare const value: number\n')
  }

  return [{ directory: pathToFileURL(`${packageDirectory}/`), manifest }, pathToFileURL(`${root}/`)]
}

/**
 * Matches TypeScript's error for an import whose types the given resolution can't find.
 */
const cannotFind = (resolution: string, specifier: string): unknown =>
  expect.stringMatching(
    new RegExp(`^${resolution}: Cannot find module '${specifier}' or its corresponding type declarations\\.`),
  )

describe('findPublicTypeProblems', () => {
  it('returns no problems when types and typesVersions match the exports', () => {
    const [workspacePackage, importer] = install(withNode10Types)

    expect(findPublicTypeProblems([workspacePackage], importer)).toEqual([])
  })

  it('reports exports-only types, which node10 resolution misses', () => {
    const [workspacePackage, importer] = install(exportsOnly)

    expect(findPublicTypeProblems([workspacePackage], importer)).toEqual([
      'fixture: "types" must be "./dist/index.d.ts", as the "." export\'s types condition',
      'fixture: "typesVersions" › "*" › "sub" must be ["./dist/sub.d.ts"], as the "./sub" export\'s types condition',
      cannotFind('node10', 'fixture'),
      cannotFind('node10', 'fixture/sub'),
    ])
  })

  it('reports typesVersions that point elsewhere than the types condition', () => {
    const [workspacePackage, importer] = install({
      ...withNode10Types,
      typesVersions: { '*': { sub: ['./dist/other.d.ts'] } },
    })

    expect(findPublicTypeProblems([workspacePackage], importer)).toEqual([
      'fixture: "typesVersions" › "*" › "sub" must be ["./dist/sub.d.ts"], as the "./sub" export\'s types condition',
      "fixture: ./dist/other.d.ts doesn't exist. Build the package first.",
      cannotFind('node10', 'fixture/sub'),
    ])
  })

  it('reports a typesVersions subpath with no public export', () => {
    const [workspacePackage, importer] = install({
      ...withNode10Types,
      typesVersions: { '*': { sub: ['./dist/sub.d.ts'], gone: ['./dist/sub.d.ts'] } },
    })

    expect(findPublicTypeProblems([workspacePackage], importer)).toEqual([
      'fixture: "typesVersions" › "*" › "gone" names no public export',
    ])
  })

  it('reports a declaration file the package lacks', () => {
    const [workspacePackage, importer] = install(withNode10Types, ['index.d.ts'])

    expect(findPublicTypeProblems([workspacePackage], importer)).toEqual([
      "fixture: ./dist/sub.d.ts doesn't exist. Build the package first.",
      cannotFind('node10', 'fixture/sub'),
      cannotFind('bundler', 'fixture/sub'),
      cannotFind('nodenext', 'fixture/sub'),
    ])
  })

  it('ignores internal subpaths and private packages', () => {
    const [workspacePackage, importer] = install({
      ...withNode10Types,
      exports: {
        ...withNode10Types.exports,
        './internal/protocol': { types: './dist/protocol.d.ts', default: './dist/protocol.js' },
      },
    })
    const [privatePackage] = install({ ...exportsOnly, name: 'private-fixture', private: true })

    expect(findPublicTypeProblems([workspacePackage, privatePackage], importer)).toEqual([])
  })

  it('reports a package with public types that the importer lacks', () => {
    const [workspacePackage] = install(withNode10Types)
    const [, importer] = install({ name: 'other', version: '1.0.0' }, [])

    expect(findPublicTypeProblems([workspacePackage], importer)).toEqual([
      `fixture has public types but isn't installed where they're type-checked: ${importer.href}`,
    ])
  })

  // repo-checks depends on every package with public types, so turbo builds them before this runs.
  it('finds no problems in the real workspace', { timeout: 60_000 }, () => {
    expect(findPublicTypeProblems(readWorkspacePackages(repoRoot), new URL('packages/repo-checks/', repoRoot))).toEqual(
      [],
    )
  })
})
