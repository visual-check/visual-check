import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import ts from 'typescript5'
import type { Manifest, WorkspacePackage } from '../workspace/manifests.ts'

/**
 * A subpath a published package exports with a `types` condition, which other projects import.
 */
interface PublicTypeEntry {
  /**
   * The subpath, such as `.` or `./react`.
   */
  subpath: string
  /**
   * The import specifier, such as `@visual-check/storybook/react`.
   */
  specifier: string
  /**
   * The declaration file the `types` condition names, relative to the package.
   */
  types: string
}

/**
 * The module resolution modes a consumer on TypeScript 5 may use, with the module kind each one needs.
 */
const resolutions = {
  node10: { module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10 },
  bundler: { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
  nodenext: { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext },
} satisfies Record<string, ts.CompilerOptions>

/**
 * Lists the subpaths a published package exports with a `types` condition. `./internal/*` subpaths are for our own
 * packages, so they aren't public.
 */
function listPublicTypeEntries(manifest: Manifest): PublicTypeEntry[] {
  if (manifest.private) {
    return []
  }

  return Object.entries(manifest.exports ?? {}).flatMap(([subpath, target]) => {
    const types = typeof target === 'string' ? undefined : target.types

    if (types === undefined || subpath.startsWith('./internal/')) {
      return []
    }

    return [{ subpath, specifier: subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`, types }]
  })
}

/**
 * Checks that `types` and `typesVersions`, which `node10` resolution reads in place of `exports`, name the same
 * declaration files as the `types` conditions in `exports`.
 */
function findTypesFieldProblems(manifest: Manifest, entries: readonly PublicTypeEntry[]): string[] {
  const problems: string[] = []
  const typesVersions = manifest.typesVersions?.['*'] ?? {}

  for (const entry of entries) {
    if (entry.subpath === '.') {
      if (manifest.types !== entry.types) {
        problems.push(`${manifest.name}: "types" must be "${entry.types}", as the "." export's types condition`)
      }
    } else if (!isDeepStrictEqual(typesVersions[entry.subpath.slice(2)], [entry.types])) {
      problems.push(
        `${manifest.name}: "typesVersions" › "*" › "${entry.subpath.slice(2)}" must be ["${entry.types}"], as the "${entry.subpath}" export's types condition`,
      )
    }
  }

  const subpaths = new Set(entries.map((entry) => entry.subpath.slice(2)))

  for (const subpath of Object.keys(typesVersions)) {
    if (!subpaths.has(subpath)) {
      problems.push(`${manifest.name}: "typesVersions" › "*" › "${subpath}" names no public export`)
    }
  }

  return problems
}

/**
 * Lists the declaration files `types`, `typesVersions` and the `types` conditions name that the package doesn't have.
 */
function findMissingTypeFiles(
  { directory, manifest }: WorkspacePackage,
  entries: readonly PublicTypeEntry[],
): string[] {
  const paths = new Set([
    ...(manifest.types === undefined ? [] : [manifest.types]),
    ...Object.values(manifest.typesVersions?.['*'] ?? {}).flat(),
    ...entries.map((entry) => entry.types),
  ])

  return [...paths]
    .filter((path) => !existsSync(new URL(path, directory)))
    .map((path) => `${manifest.name}: ${path} doesn't exist. Build the package first.`)
}

/**
 * Type-checks a file in `importer` that imports each specifier, with TypeScript 5 and the given resolution, and
 * returns its errors. The file exists only in memory.
 */
function typeCheckImports(
  importer: URL,
  specifiers: readonly string[],
  resolution: keyof typeof resolutions,
): string[] {
  const fileName = fileURLToPath(new URL('public-types-fixture.ts', importer)).replaceAll('\\', '/')
  const text = specifiers.map((specifier, index) => `import type * as entry${index} from '${specifier}'\n`).join('')
  const options: ts.CompilerOptions = {
    ...resolutions[resolution],
    target: ts.ScriptTarget.ES2022,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  }
  const host = ts.createCompilerHost(options)
  const { fileExists, readFile, getSourceFile } = host

  host.fileExists = (name) => name === fileName || fileExists.call(host, name)
  host.readFile = (name) => (name === fileName ? text : readFile.call(host, name))
  host.getSourceFile = (name, languageVersion, ...rest) =>
    name === fileName
      ? ts.createSourceFile(name, text, languageVersion)
      : getSourceFile.call(host, name, languageVersion, ...rest)

  return ts
    .getPreEmitDiagnostics(ts.createProgram([fileName], options, host))
    .map((diagnostic) => `${resolution}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`)
}

/**
 * Checks that a consumer on TypeScript 5 resolves the types of every public export of the given packages under
 * `node10`, `bundler` and `nodenext` resolution. `node10` ignores `exports`, so it needs `types` and `typesVersions`.
 * The imports are type-checked from `importer`, a directory whose `node_modules` holds the packages, built.
 *
 * @public
 */
export function findPublicTypeProblems(packages: readonly WorkspacePackage[], importer: URL): string[] {
  const problems: string[] = []
  const specifiers: string[] = []

  for (const workspacePackage of packages) {
    const { manifest } = workspacePackage
    const entries = listPublicTypeEntries(manifest)

    if (entries.length === 0) {
      continue
    }

    problems.push(...findTypesFieldProblems(manifest, entries), ...findMissingTypeFiles(workspacePackage, entries))

    if (existsSync(new URL(`node_modules/${manifest.name}/package.json`, importer))) {
      specifiers.push(...entries.map((entry) => entry.specifier))
    } else {
      problems.push(
        `${manifest.name} has public types but isn't installed where they're type-checked: ${importer.href}`,
      )
    }
  }

  if (specifiers.length > 0) {
    for (const resolution of Object.keys(resolutions) as (keyof typeof resolutions)[]) {
      problems.push(...typeCheckImports(importer, specifiers, resolution))
    }
  }

  return problems
}
