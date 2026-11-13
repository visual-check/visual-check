import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A file under a package's `src/` folder.
 *
 * @public
 */
export interface SourceFile {
  /**
   * The path from the repository root, with forward slashes, such as `packages/cli/src/commands/run-cli.ts`.
   */
  path: string
  /**
   * The file's text.
   */
  content: string
}

/**
 * A Fallow boundary zone: a named set of files.
 */
interface FallowZone {
  /**
   * The zone name, `<package folder>/<module path>`.
   */
  name: string
  /**
   * The globs of the files in the zone.
   */
  patterns: string[]
}

/**
 * A Fallow boundary rule: which zones a zone may import.
 */
interface FallowRule {
  /**
   * The name of the zone the rule restricts.
   */
  from: string
  /**
   * The names of the zones it may import.
   */
  allow: string[]
}

/**
 * The slice of `.fallowrc.json` › `boundaries` that the layout check reads.
 *
 * @public
 */
export interface FallowBoundaries {
  /**
   * One zone per module.
   */
  zones: FallowZone[]
  /**
   * One rule per zone.
   */
  rules: FallowRule[]
}

/**
 * Folder names that say nothing about the domain.
 */
const catchAllFolderNames = new Set([
  'utils',
  'util',
  'helpers',
  'helper',
  'common',
  'shared',
  'lib',
  'types',
  'services',
  'models',
  'misc',
])

/**
 * Matches every form of re-export: braces (also over several lines), star, star with a namespace name, each
 * optionally type-only.
 */
const reExportPattern = /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]/

/**
 * Matches a Biome suppression comment (plain, `-all` or `-start`) that names a layout rule.
 */
const biomeSuppressionPattern = new RegExp(
  `${'biome'}-ignore(?:-all|-start)?\\b[^\\n]*\\b(?:noPrivateImports|noBarrelFile|noReExportAll|useBlockStatements)\\b`,
)

/**
 * Matches a Fallow suppression comment that names a layout rule, or names none and so silences every rule.
 */
const fallowSuppressionPattern = new RegExp(
  `${'fallow'}-ignore(?:-next-line|-file)?(?![\\w-])(?:[^\\n]*\\b(?:boundary-violation|boundary-coverage|boundary-call-violation|circular-dependency)\\b|[ \\t]*(?:\\*/|$))`,
  'm',
)

/**
 * Reads every file under each package's `src/` folder, recursively, whatever its extension.
 *
 * @public
 */
export function readSourceFiles(root: URL): SourceFile[] {
  const packagesDirectory = new URL('packages/', root)
  const files: SourceFile[] = []
  for (const packageEntry of readdirSync(packagesDirectory, { withFileTypes: true })) {
    const sourceDirectory = new URL(`${packageEntry.name}/src/`, packagesDirectory)
    if (!packageEntry.isDirectory() || !existsSync(sourceDirectory)) {
      continue
    }
    const sourcePath = fileURLToPath(sourceDirectory)
    for (const entry of readdirSync(sourceDirectory, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) {
        const pathInSource = relative(sourcePath, `${entry.parentPath}${sep}${entry.name}`).split(sep).join('/')
        files.push({
          path: `packages/${packageEntry.name}/src/${pathInSource}`,
          content: readFileSync(new URL(`${packageEntry.name}/src/${pathInSource}`, packagesDirectory), 'utf8'),
        })
      }
    }
  }
  return files
}

/**
 * Reads the `boundaries` section of `.fallowrc.json`.
 *
 * @public
 */
export function readFallowBoundaries(root: URL): FallowBoundaries {
  const config = JSON.parse(readFileSync(new URL('.fallowrc.json', root), 'utf8')) as { boundaries: FallowBoundaries }
  return config.boundaries
}

/**
 * Lists where the source layout breaks a rule that Biome and Fallow do not enforce, one message per problem.
 *
 * @public
 */
export function findSourceLayoutProblems(files: readonly SourceFile[], boundaries: FallowBoundaries): string[] {
  return [
    ...findModulesWithoutZone(files, boundaries),
    ...findMalformedZones(files, boundaries),
    ...findZonesWithoutRule(boundaries),
    ...findReExports(files),
    ...findSuppressions(files),
    ...findCatchAllFolders(files),
  ]
}

/**
 * Lists the top-level module folders of every package that no zone is named for.
 */
function findModulesWithoutZone(files: readonly SourceFile[], boundaries: FallowBoundaries): string[] {
  const zoneNames = new Set(boundaries.zones.map((zone) => zone.name))
  const modules = new Set<string>()
  for (const file of files) {
    const match = /^packages\/([^/]+)\/src\/([^/]+)\//.exec(file.path)
    if (match) {
      modules.add(`${match[1]}/${match[2]}`)
    }
  }
  return [...modules]
    .filter((moduleName) => !zoneNames.has(moduleName))
    .map((moduleName) => {
      const [packageName, moduleFolder] = moduleName.split('/')
      return `packages/${packageName}/src/${moduleFolder}/ is a module with no zone: add zone "${moduleName}" with pattern "packages/${packageName}/src/${moduleFolder}/**" to .fallowrc.json boundaries`
    })
}

/**
 * Lists the zones whose name is not `<package>/<path>`, whose pattern is not exactly that folder, or whose folder
 * holds no files.
 */
function findMalformedZones(files: readonly SourceFile[], boundaries: FallowBoundaries): string[] {
  const problems: string[] = []
  for (const zone of boundaries.zones) {
    const separatorIndex = zone.name.indexOf('/')
    if (separatorIndex <= 0 || separatorIndex === zone.name.length - 1) {
      problems.push(`Zone "${zone.name}" must be named "<package>/<path>", for example "cli/commands"`)
      continue
    }
    const folder = `packages/${zone.name.slice(0, separatorIndex)}/src/${zone.name.slice(separatorIndex + 1)}/`
    const expectedPatterns = [`${folder}**`]
    if (zone.patterns.length !== 1 || zone.patterns[0] !== expectedPatterns[0]) {
      problems.push(
        `Zone "${zone.name}" must have exactly the pattern ${JSON.stringify(expectedPatterns)}, found ${JSON.stringify(zone.patterns)}`,
      )
    } else if (!files.some((file) => file.path.startsWith(folder))) {
      problems.push(`Zone "${zone.name}" is stale: ${folder} has no files, remove the zone and its rule`)
    }
  }
  return problems
}

/**
 * Lists the zones that no rule restricts, because Fallow lets an unruled zone import anything.
 */
function findZonesWithoutRule(boundaries: FallowBoundaries): string[] {
  return boundaries.zones
    .filter((zone) => !boundaries.rules.some((rule) => rule.from === zone.name))
    .map(
      (zone) =>
        `Zone "${zone.name}" has no rule: add { "from": "${zone.name}", "allow": [...] } to .fallowrc.json boundaries.rules, an unruled zone may import anything`,
    )
}

/**
 * Lists the files that re-export from another file, which would carry a symbol past Biome's visibility check.
 */
function findReExports(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => reExportPattern.test(file.content))
    .map(
      (file) =>
        `${file.path} re-exports from another file: import what you publish, then export it, and import symbols from the file that defines them`,
    )
}

/**
 * Lists the files with a comment that switches off a layout rule in Biome or Fallow.
 */
function findSuppressions(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => biomeSuppressionPattern.test(file.content) || fallowSuppressionPattern.test(file.content))
    .map(
      (file) =>
        `${file.path} suppresses a layout rule with a comment: remove it and fix the import or the layout instead`,
    )
}

/**
 * Lists the folders, at any depth, named like a catch-all.
 */
function findCatchAllFolders(files: readonly SourceFile[]): string[] {
  const folders = new Set<string>()
  for (const file of files) {
    const segments = file.path.split('/')
    for (let depth = 4; depth < segments.length; depth += 1) {
      if (catchAllFolderNames.has(segments[depth - 1] as string)) {
        folders.add(`${segments.slice(0, depth).join('/')}/`)
      }
    }
  }
  return [...folders].map(
    (folder) =>
      `${folder} is a catch-all folder: name it for what it does in the domain, or move its files into the module that owns them`,
  )
}
