import { closeSync, openSync, readFileSync, readSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'
import { foldersUp, isFile } from '../config/find-config.js'
import { isInsideRoot, type ListFiles, orderWithFirst, relativePathOf } from './find-storybooks.js'
import {
  isBerryLockfile,
  isJsonObject,
  type Manifest,
  type PackageManager,
  rushPackageManagerOf,
  yarnBerryOf,
} from './package-manager.js'
import { tidyFolder } from './storybook-scripts.js'

/**
 * What lists a workspace's packages: `pnpm-workspace.yaml`, `package.json#workspaces` (npm, Yarn and Bun),
 * `lerna.json`, Nx's `nx.json` or `rush.json`. `single` is a lone package with no such list.
 */
export type WorkspaceKind = 'pnpm' | 'workspaces' | 'lerna' | 'nx' | 'rush' | 'single'

/**
 * The lists of packages a workspace root holds that a package manager reads itself, whatever the workspace's kind: the
 * package folders each one's globs match, relative to the root, or `undefined` when the root holds no such list.
 */
export interface PackageManagerLists {
  /**
   * The folders `pnpm-workspace.yaml`'s `packages` lists, which pnpm reads: none when it lists no `packages`, and
   * `undefined` only without the file.
   */
  pnpm: string[] | undefined
  /**
   * The folders `package.json#workspaces` lists, which npm, Yarn and Bun read.
   */
  workspaces: string[] | undefined
}

/**
 * Returns the list of packages `packageManager` reads itself: `pnpm-workspace.yaml`'s for pnpm,
 * `package.json#workspaces` for npm, Yarn and Bun. `undefined` when the root holds none.
 */
export function packageManagerListOf(
  lists: PackageManagerLists,
  packageManager: PackageManager,
): readonly string[] | undefined {
  return packageManager === 'pnpm' ? lists.pnpm : lists.workspaces
}

/**
 * A workspace `init` found: a root folder and its packages.
 */
export interface Workspace {
  /**
   * The absolute root folder, which holds the file that lists the packages, or the lone package's `package.json`.
   */
  root: string
  /**
   * What lists the packages.
   */
  kind: WorkspaceKind
  /**
   * The package folders, relative to the root: `/` separated, `.` for the root, `.` first, then by path. The root is
   * one when it holds a `package.json`.
   */
  packageDirs: string[]
  /**
   * The lists of packages the root holds that a package manager reads itself. An Nx or Lerna workspace may have them
   * too, and they may leave out packages that only Nx, Lerna or Rush finds.
   */
  packageManagerLists: PackageManagerLists
  /**
   * The root's files, as `listFiles` gave them: relative to the root and `/` separated.
   */
  files: string[]
  /**
   * The package manager the workspace's own config names: `rush.json`'s for Rush. `undefined` for every other kind,
   * whose root `package.json` and lockfiles show it.
   */
  packageManager: PackageManager | undefined
  /**
   * Whether the root shows Yarn 2 or later: a `.yarnrc.yml`, a `yarn.lock` in Yarn 2's format, or a Yarn version of 2
   * or more declared in its `package.json`. It means something only when the package manager is Yarn.
   */
  yarnBerry: boolean
}

/**
 * Reads a file of a workspace: gives the content of a path relative to the root, `/` separated, or `undefined` when
 * there's no such file.
 */
type ReadFile = (path: string) => string | undefined

/**
 * The files that show a workspace kind in a folder, in the order `init` tries them. A `package.json` with
 * `workspaces` comes after them all.
 */
const workspaceFiles: readonly (readonly [string, WorkspaceKind])[] = [
  ['rush.json', 'rush'],
  ['nx.json', 'nx'],
  ['lerna.json', 'lerna'],
  ['pnpm-workspace.yaml', 'pnpm'],
]

/**
 * The packages Lerna reads when `lerna.json` and the package manager list none.
 */
const lernaDefaultPackages = ['packages/*']

/**
 * Parses JSON, or gives `undefined` for missing or invalid text.
 */
function parseJson(text: string | undefined): unknown {
  if (text === undefined) {
    return undefined
  }

  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * A JSON string, which may hold `//`, `/*`, `,` and escaped quotes.
 */
const jsonString = String.raw`"(?:[^"\\]|\\.)*"`

/**
 * A JSON string, kept in group 1, or a `//` or `/* *\/` comment.
 */
const jsonStringOrComment = new RegExp(String.raw`(${jsonString})|//[^\n]*|/\*[\s\S]*?\*/`, 'g')

/**
 * A JSON string, kept in group 1, or a comma before a `}` or `]`, which is kept in group 2.
 */
const jsonStringOrTrailingComma = new RegExp(String.raw`(${jsonString})|,(\s*[}\]])`, 'g')

/**
 * Parses JSON with comments, the way Rush writes `rush.json`: drops `//` and `/* *\/` comments outside strings, and a
 * comma before a `}` or `]`. Gives `undefined` for missing or invalid text.
 */
function parseJsonWithComments(text: string | undefined): unknown {
  const json = text
    ?.replace(jsonStringOrComment, (_, string: string | undefined) => string ?? '')
    .replace(
      jsonStringOrTrailingComma,
      (_, string: string | undefined, closing: string | undefined) => string ?? closing ?? '',
    )

  return parseJson(json)
}

/**
 * Returns the text items of `value` when it is an array, or `undefined` when it isn't one.
 */
function textsOf(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}

/**
 * Parses a `package.json`, or gives `undefined` for missing or invalid text, or JSON that isn't an object.
 */
function manifestOf(text: string | undefined): Manifest | undefined {
  const manifest = parseJson(text)

  return isJsonObject(manifest) ? manifest : undefined
}

/**
 * Reads `package.json#workspaces`: an array of globs, or Yarn 1's object holding them in `packages`. Gives
 * `undefined` when the manifest is missing or has no such field.
 */
function manifestWorkspacesOf(manifest: Manifest | undefined): string[] | undefined {
  const workspaces = manifest?.workspaces

  return textsOf(isJsonObject(workspaces) ? workspaces.packages : workspaces)
}

/**
 * A `'single'` or `"double"` quoted YAML scalar, which may hold `#`, `,` and `]`.
 */
const yamlQuoted = String.raw`'(?:[^']|'')*'|"(?:[^"\\]|\\.)*"`

/**
 * A quoted YAML scalar, kept in group 1, or a comment: a `#` that starts the line or follows a space, to the line's
 * end.
 */
const yamlQuotedOrComment = new RegExp(String.raw`(${yamlQuoted})|(?:^|\s)#.*$`, 'g')

/**
 * Cuts a YAML comment off a line, leaving `#` in quotes.
 */
function withoutYamlComment(line: string): string {
  return line.replace(yamlQuotedOrComment, (_, quoted: string | undefined) => quoted ?? '')
}

/**
 * Reads a YAML scalar: the text of a `'single'` or `"double"` quoted one, or a plain one trimmed.
 */
function yamlScalarOf(text: string): string {
  const trimmed = text.trim()

  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'")
  }

  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(.)/g, '$1')
  }

  return trimmed
}

/**
 * The inside of a YAML flow sequence: from its `[` to its `]`, which quotes may hold.
 */
const yamlFlowSequence = new RegExp(String.raw`^\[((?:${yamlQuoted}|[^'"\]])*)\]`)

/**
 * One item of a YAML flow sequence: quoted scalars and other text, up to a `,` outside quotes.
 */
const yamlFlowItem = new RegExp(`(?:${yamlQuoted}|[^,'"])+`, 'g')

/**
 * Reads a YAML flow sequence, such as `[apps/*, 'libs/*']`, from the `[` that `text` starts with to its `]`. Its
 * comments must already be cut. Gives `undefined` when the `]` is missing.
 */
function yamlFlowSequenceOf(text: string): string[] | undefined {
  const inside = yamlFlowSequence.exec(text)?.[1]

  if (inside === undefined) {
    return undefined
  }

  return (inside.match(yamlFlowItem) ?? []).map(yamlScalarOf).filter((item) => item !== '')
}

/**
 * The top-level `packages` key of `pnpm-workspace.yaml`, quoted or not.
 */
const pnpmPackagesKey = /^(['"]?)packages\1\s*:/

/**
 * Reads the `packages` of `pnpm-workspace.yaml`: a block sequence of `- glob` lines or a flow sequence. Only that key
 * is read. Gives `undefined` when the file has no `packages`, or it isn't a sequence, or its flow sequence never
 * closes.
 */
function pnpmPackagesOf(yaml: string): string[] | undefined {
  const lines = yaml.split(/\r?\n/).map(withoutYamlComment)
  const keyIndex = lines.findIndex((line) => pnpmPackagesKey.test(line))
  const keyLine = lines[keyIndex]

  if (keyLine === undefined) {
    return undefined
  }

  const value = keyLine.replace(pnpmPackagesKey, '').trim()
  const following = lines.slice(keyIndex + 1)

  if (value.startsWith('[')) {
    return yamlFlowSequenceOf([value, ...following].join('\n'))
  }

  if (value !== '') {
    return undefined
  }

  const items: string[] = []

  for (const line of following.filter((entry) => entry.trim() !== '')) {
    const item = /^\s*-\s+(.*)$/.exec(line)?.[1]

    if (item === undefined) {
      break
    }

    items.push(yamlScalarOf(item))
  }

  return items
}

/**
 * Returns the folders, relative to the root, that hold a listed file named `name`, leaving out any in a
 * `node_modules`.
 */
function foldersHolding(files: readonly string[], name: string): string[] {
  return files
    .filter((path) => posix.basename(path) === name)
    .map((path) => posix.dirname(path))
    .filter((folder) => !folder.split('/').includes('node_modules'))
}

/**
 * Returns the folders whose `package.json` matches `<glob>/package.json` for a glob of `globs` and for no `!glob` of
 * them, matched with `path.matchesGlob`. Matching the file, as pnpm and npm do, lets `apps/**` match `apps` too.
 */
function foldersMatching(folders: readonly string[], globs: readonly string[]): string[] {
  const manifestGlobsOf = (list: readonly string[]) => list.map((glob) => `${tidyFolder(glob)}/package.json`)
  const included = manifestGlobsOf(globs.filter((glob) => !glob.startsWith('!')))
  const excluded = manifestGlobsOf(globs.filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1)))
  const matchesAny = (path: string, list: readonly string[]) => list.some((glob) => posix.matchesGlob(path, glob))

  return folders.filter((folder) => {
    const path = posix.join(folder, 'package.json')

    return matchesAny(path, included) && !matchesAny(path, excluded)
  })
}

/**
 * Reads `rush.json`'s `projects[].projectFolder`, each tidied. A project without a text folder, and a folder that is
 * the root or outside it, are left out.
 */
function rushProjectFoldersOf(rush: unknown): string[] {
  const projects = isJsonObject(rush) && Array.isArray(rush.projects) ? rush.projects : []

  return projects
    .flatMap((project) =>
      isJsonObject(project) && typeof project.projectFolder === 'string' ? [tidyFolder(project.projectFolder)] : [],
    )
    .filter((folder) => folder !== '.' && isInsideRoot(folder))
}

/**
 * What a workspace's config files say, each read and parsed once.
 */
interface WorkspaceConfig {
  /**
   * What lists the packages.
   */
  kind: WorkspaceKind
  /**
   * The root's parsed `package.json`, or `undefined` when it is missing, invalid or not a JSON object.
   */
  manifest: Manifest | undefined
  /**
   * Whether the root holds a `package.json`, valid or not. Such a root is a package.
   */
  hasManifest: boolean
  /**
   * The glob lists whose matches are packages. Each list's `!glob` leaves out only its own matches.
   */
  globLists: string[][]
  /**
   * Package folders listed as they are: Rush's projects.
   */
  folders: string[]
  /**
   * Whether every folder holding a `project.json` is a package, as in Nx.
   */
  readsProjectJson: boolean
  /**
   * The package manager the config names: `rush.json`'s for Rush, else `undefined`.
   */
  packageManager: PackageManager | undefined
  /**
   * The globs of the lists of packages the root holds that a package manager reads itself.
   */
  packageManagerGlobs: PackageManagerGlobs
}

/**
 * The globs of the lists of packages a workspace root holds that a package manager reads itself.
 */
interface PackageManagerGlobs {
  /**
   * `pnpm-workspace.yaml`'s `packages`: none when it lists none, and `undefined` without the file.
   */
  pnpm: string[] | undefined
  /**
   * `package.json#workspaces`, or `undefined` for none.
   */
  workspaces: string[] | undefined
}

/**
 * The glob lists the workspace's configs give.
 */
interface GlobSources {
  /**
   * `pnpm-workspace.yaml`'s `packages`, or `undefined` for none.
   */
  pnpm: string[] | undefined
  /**
   * `package.json#workspaces`, or `undefined` for none.
   */
  workspaces: string[] | undefined
  /**
   * Lerna's packages, or `undefined` without a `lerna.json`.
   */
  lerna: string[] | undefined
}

/**
 * For each workspace kind, picks the glob lists whose matches are packages. The package manager's workspaces are
 * `pnpm-workspace.yaml`'s `packages`, else `package.json#workspaces`. Nx also reads every `project.json`, and Lerna's
 * packages when a `lerna.json` sits beside `nx.json`.
 */
const globListsByKind: Record<WorkspaceKind, (sources: GlobSources) => string[][]> = {
  pnpm: ({ pnpm }) => [pnpm ?? []],
  workspaces: ({ workspaces }) => [workspaces ?? []],
  lerna: ({ lerna }) => [lerna ?? []],
  nx: ({ pnpm, workspaces, lerna }) => [pnpm ?? workspaces ?? [], lerna ?? []],
  rush: () => [],
  single: () => [],
}

/**
 * Returns Lerna's packages: `lerna.json`'s `packages`, else the package manager's workspaces, else `packages/*`. Gives
 * `undefined` without a `lerna.json`.
 */
function lernaGlobsOf(lernaText: string | undefined, packageManagerGlobs: string[] | undefined): string[] | undefined {
  if (lernaText === undefined) {
    return undefined
  }

  const lerna = parseJson(lernaText)

  return textsOf(isJsonObject(lerna) ? lerna.packages : undefined) ?? packageManagerGlobs ?? lernaDefaultPackages
}

/**
 * Returns the kind of workspace whose root holds the files `read` gives: the first of `rush.json`, `nx.json`,
 * `lerna.json` and `pnpm-workspace.yaml` there, then a `package.json` with `workspaces`. Gives `undefined` for a
 * folder with none. A `turbo.json` changes nothing: Turbo uses the package manager's workspaces.
 */
function workspaceKindOf(read: ReadFile, workspaces: string[] | undefined): WorkspaceKind | undefined {
  const fromFile = workspaceFiles.find(([name]) => read(name) !== undefined)?.[1]

  return fromFile ?? (workspaces === undefined ? undefined : 'workspaces')
}

/**
 * Reads the workspace config in the root the files `read` gives. Gives `undefined` for a folder with none, which is
 * at most a lone package.
 */
function workspaceConfigOf(read: ReadFile): WorkspaceConfig | undefined {
  const manifestText = read('package.json')
  const manifest = manifestOf(manifestText)
  const workspaces = manifestWorkspacesOf(manifest)
  const kind = workspaceKindOf(read, workspaces)

  if (kind === undefined) {
    return undefined
  }

  const pnpmText = read('pnpm-workspace.yaml')
  const pnpm = pnpmPackagesOf(pnpmText ?? '')
  const lerna = lernaGlobsOf(read('lerna.json'), pnpm ?? workspaces)
  const rush = kind === 'rush' ? parseJsonWithComments(read('rush.json')) : undefined

  return {
    kind,
    manifest,
    hasManifest: manifestText !== undefined,
    globLists: globListsByKind[kind]({ pnpm, workspaces, lerna }),
    folders: rushProjectFoldersOf(rush),
    readsProjectJson: kind === 'nx',
    packageManager: rushPackageManagerOf(rush),
    packageManagerGlobs: { pnpm: pnpmText === undefined ? undefined : (pnpm ?? []), workspaces },
  }
}

/**
 * Returns the config of a lone package whose root holds the files `read` gives.
 */
function singlePackageConfigOf(read: ReadFile): WorkspaceConfig {
  return {
    kind: 'single',
    manifest: manifestOf(read('package.json')),
    hasManifest: true,
    globLists: [],
    folders: [],
    readsProjectJson: false,
    packageManager: undefined,
    packageManagerGlobs: { pnpm: undefined, workspaces: undefined },
  }
}

/**
 * Lists the package folders of a workspace from its config and the root's listed `files`: the folders the glob lists
 * match among those holding a listed `package.json`, Rush's folders, and for Nx every folder holding a listed
 * `project.json`. The root is a package too when it holds a `package.json`. Gives folders relative to the root, `.`
 * first, then by path.
 */
function packageDirsOf(config: WorkspaceConfig, files: readonly string[]): string[] {
  const manifestFolders = foldersHolding(files, 'package.json')
  const folders = new Set([
    ...config.globLists.flatMap((globs) => foldersMatching(manifestFolders, globs)),
    ...config.folders,
    ...(config.readsProjectJson ? foldersHolding(files, 'project.json') : []),
  ])

  if (config.hasManifest) {
    folders.add('.')
  }

  return [...folders].sort(orderWithFirst('.'))
}

/**
 * Lists the package folders each package manager's own list matches among the folders holding a listed `package.json`,
 * relative to the root. A list the root doesn't hold gives `undefined`.
 */
function packageManagerListsOf(globs: PackageManagerGlobs, files: readonly string[]): PackageManagerLists {
  const manifestFolders = foldersHolding(files, 'package.json')
  const matching = (list: string[] | undefined) =>
    list === undefined ? undefined : foldersMatching(manifestFolders, list)

  return { pnpm: matching(globs.pnpm), workspaces: matching(globs.workspaces) }
}

/**
 * Returns the kind and packages of the workspace whose root holds the listed `files` and the files `read` gives. Gives
 * `undefined` for a root with no workspace config. See `WorkspaceKind` for what lists the packages:
 *
 * - `pnpm`: `pnpm-workspace.yaml`'s `packages`. Without that field, the root is the only package.
 * - `workspaces`: `package.json#workspaces`, an array or Yarn 1's `{ packages }`.
 * - `lerna`: `lerna.json`'s `packages`, else the package manager's workspaces, else `packages/*`.
 * - `nx`: every folder holding a listed `project.json`, plus the package manager's workspaces, plus Lerna's packages
 *   when a `lerna.json` sits beside `nx.json`.
 * - `rush`: `rush.json`'s `projects[].projectFolder`, leaving out the root and folders outside it.
 *
 * The package manager's workspaces are `pnpm-workspace.yaml`'s `packages`, else `package.json#workspaces`. A glob
 * matches the folders whose listed `package.json` matches `<glob>/package.json`, and a `!glob` leaves folders out of
 * its own list. Nx's `project.json` folders and Rush's folders aren't globs, so they are taken as they are. The root is
 * a package too when it holds a `package.json`. Gives folders relative to the root, `.` first, then by path.
 */
export function workspaceLayoutOf(
  files: readonly string[],
  read: ReadFile,
): { kind: WorkspaceKind; packageDirs: string[] } | undefined {
  const config = workspaceConfigOf(read)

  return config === undefined ? undefined : { kind: config.kind, packageDirs: packageDirsOf(config, files) }
}

/**
 * The byte order mark some editors write at the start of a UTF-8 file.
 */
const byteOrderMark = /^\uFEFF/

/**
 * Reads a text file, without a leading byte order mark.
 *
 * @throws When the file can't be read.
 */
export function readTextFile(path: string): string {
  return readFileSync(path, 'utf8').replace(byteOrderMark, '')
}

/**
 * Reads and parses a JSON file, without a leading byte order mark. Gives `undefined` when it can't be read or parsed.
 *
 * @public
 */
export function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readTextFile(path))
  } catch {
    return undefined
  }
}

/**
 * Returns a reader of the files in `folder`, without a leading byte order mark. A file that can't be read gives
 * `undefined`.
 */
function readerIn(folder: string): ReadFile {
  return (path) => {
    try {
      return readTextFile(join(folder, path))
    } catch {
      return undefined
    }
  }
}

/**
 * Returns whether `folder` holds a `package.json`.
 */
function holdsManifest(folder: string): boolean {
  return isFile(join(folder, 'package.json'))
}

/**
 * How many bytes of `yarn.lock` `init` reads to tell its format, enough for the comment and `__metadata:` at its top.
 */
const lockfileHeadBytes = 4096

/**
 * Returns whether the root's files show Yarn 2 or later: a `.yarnrc.yml`, or a `yarn.lock` whose first few KB hold
 * Yarn 2's `__metadata:` entry.
 */
function filesShowBerryIn(root: string): boolean {
  if (isFile(join(root, '.yarnrc.yml'))) {
    return true
  }

  try {
    const descriptor = openSync(join(root, 'yarn.lock'), 'r')

    try {
      const head = Buffer.alloc(lockfileHeadBytes)
      const length = readSync(descriptor, head, 0, lockfileHeadBytes, 0)

      return isBerryLockfile(head.toString('utf8', 0, length))
    } finally {
      closeSync(descriptor)
    }
  } catch {
    return false
  }
}

/**
 * Builds the workspace at `root` from its config, packages and listed files.
 */
function workspaceOf(root: string, config: WorkspaceConfig, packageDirs: string[], files: string[]): Workspace {
  return {
    root,
    kind: config.kind,
    packageDirs,
    packageManagerLists: packageManagerListsOf(config.packageManagerGlobs, files),
    files,
    packageManager: config.packageManager,
    yarnBerry: yarnBerryOf(config.manifest ?? {}, filesShowBerryIn(root)),
  }
}

/**
 * Finds the workspace `startDir` is in. Walks up from `startDir`, as `foldersUp` does. The first folder with a
 * workspace config wins when its packages include the package `startDir` is in (the nearest `package.json` below that
 * folder), or when `startDir` is in no package below it. Else the nearest `package.json` is a lone package. Returns
 * `undefined` when there's neither. Without git, `listFiles` gives no files, so a workspace collapses to its root
 * package.
 */
export async function findWorkspace(startDir: string, listFiles: ListFiles): Promise<Workspace | undefined> {
  const folders = foldersUp(resolve(startDir))

  for (const [index, root] of folders.entries()) {
    const config = workspaceConfigOf(readerIn(root))

    if (config === undefined) {
      continue
    }

    // Each config's packages need its own file list, so the folders are tried one after another.
    const files = await listFiles(root)
    const packageDirs = packageDirsOf(config, files)
    const startPackage = folders.slice(0, index).find(holdsManifest)

    if (startPackage === undefined || packageDirs.includes(relativePathOf(root, startPackage))) {
      return workspaceOf(root, config, packageDirs, files)
    }
  }

  const root = folders.find(holdsManifest)

  return root === undefined
    ? undefined
    : workspaceOf(root, singlePackageConfigOf(readerIn(root)), ['.'], await listFiles(root))
}
