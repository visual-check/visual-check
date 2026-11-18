import { dirname, posix, relative, resolve, sep } from 'node:path'
import {
  baselineStemOf,
  shortenedHashLength,
  shortenedPrefixBytes,
  stemOfFileName,
} from '../baselines/baseline-files.js'

/**
 * What the rules for a changed file read besides the file itself.
 */
export interface ChangedFileContext {
  /**
   * The project root that the changed files are relative to, an absolute path.
   */
  root: string
  /**
   * visual-check's config file, an absolute path.
   */
  configPath: string
  /**
   * Globs relative to the config file's folder. A changed file that matches selects every story.
   */
  selectAll: readonly string[]
  /**
   * Globs relative to the config file's folder. A changed file that matches selects nothing.
   */
  ignore: readonly string[]
  /**
   * The baselines folder of each Storybook, absolute paths.
   */
  baselinesFolders: readonly string[]
}

/**
 * A changed baseline.
 */
export interface ChangedBaseline {
  /**
   * The baselines folder that holds it, an absolute path.
   */
  folder: string
  /**
   * Its file name without `.png`, in NFC.
   */
  stem: string
}

/**
 * Which rule a changed file falls under.
 */
export type ChangedFileRule =
  | {
      /**
       * It matches `affected.ignore`, so it selects nothing, whatever else it is.
       */
      kind: 'ignored'
    }
  | {
      /**
       * It selects every story of every Storybook: the config file, a lockfile, `pnpm-workspace.yaml` or a match for
       * `affected.selectAll`.
       */
      kind: 'every-story'
    }
  | ({
      /**
       * It's a baseline, which selects the stories its stem names in the Storybook that keeps it.
       */
      kind: 'baseline'
    } & ChangedBaseline)
  | {
      /**
       * It's a package's config, such as `package.json`, `tsconfig.json` or `.env`, which selects every story of the
       * Storybooks whose graph reaches its package, whether the graph holds it or not.
       */
      kind: 'package'
    }
  | {
      /**
       * It's an image, a font or a JSON file that isn't config, which selects like `package` when the graph doesn't
       * hold it, and what the graph says when it does.
       */
      kind: 'asset'
    }
  | {
      /**
       * Any other file, which selects what the graph says: nothing when the graph doesn't hold it.
       */
      kind: 'graph'
    }

/**
 * The lockfiles of the package managers, by file name.
 */
const lockfileNames = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
])

/**
 * The starts of the file names of a package's config: TypeScript, Vite, PostCSS, Tailwind, Next and `.env` files.
 */
const packageConfigPrefixes = [
  'tsconfig',
  'jsconfig',
  'vite.config.',
  'postcss.config.',
  '.postcssrc',
  'tailwind.config.',
  'next.config.',
  '.env',
]

/**
 * The extensions of images and fonts.
 */
const assetExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.apng',
  '.svg',
  '.ico',
  '.bmp',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
])

/**
 * The file names of JSON files that configure a tool rather than hold data.
 */
const configJsonNames = new Set(['biome.json', 'biome.jsonc', 'turbo.json', 'renovate.json', 'lerna.json', 'nx.json'])

/**
 * Gives an absolute path relative to the root, `/`-separated. Only the platform's separator is replaced, so a POSIX
 * file name holding a literal `\` keeps it.
 */
export function rootRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

/**
 * Tells whether a root-relative path matches one of the globs, which are relative to the config file's folder. A glob
 * that starts with `./` matches as it would without it, since the path it's matched against never starts so.
 */
function matchesAny(file: string, globs: readonly string[], context: ChangedFileContext): boolean {
  if (globs.length === 0) {
    return false
  }

  const fromConfigFolder = rootRelative(dirname(context.configPath), resolve(context.root, file))

  return globs.some((glob) => posix.matchesGlob(fromConfigFolder, glob.replace(/^(\.\/)+/, '')))
}

/**
 * Tells whether a file name, lowercased, is a package's config.
 */
function isPackageConfig(name: string): boolean {
  return name === 'package.json' || packageConfigPrefixes.some((prefix) => name.startsWith(prefix))
}

/**
 * Tells whether a root-relative file, lowercased, is an image, a font or a JSON file that isn't config. A JSON file is
 * config when a folder of its path or its own name starts with `.`, or when a known tool reads it.
 */
function isAsset(lowercased: string): boolean {
  const extension = posix.extname(lowercased)

  if (extension !== '.json') {
    return assetExtensions.has(extension)
  }

  return (
    !lowercased.split('/').some((segment) => segment.startsWith('.')) &&
    !configJsonNames.has(posix.basename(lowercased))
  )
}

/**
 * Gives the baselines folder a root-relative file is a baseline in: a `.png` directly in one of them. Gives
 * `undefined` for any other file.
 */
function baselinesFolderOf(file: string, context: ChangedFileContext): string | undefined {
  if (!file.toLowerCase().endsWith('.png')) {
    return undefined
  }

  const folder = dirname(resolve(context.root, file))

  return context.baselinesFolders.find((baselines) => baselines === folder)
}

/**
 * Gives the rule a changed file falls under, by its path relative to the root, `/`-separated. In order: a match for
 * `affected.ignore` is ignored; the config file, a lockfile at any depth, `pnpm-workspace.yaml` and a match for
 * `affected.selectAll` select every story; a `.png` directly in a baselines folder is a baseline; a package's config is
 * `package`; an image, a font or a JSON file that isn't config is an `asset`; anything else is left to the graph.
 * The names of lockfiles, `pnpm-workspace.yaml`, package configs and config JSON files, and the extensions, are compared
 * lowercased, since the file system may not tell them apart. The config file's path is compared as it is, and the
 * globs match as `path.matchesGlob` does, which ignores case only on macOS and Windows.
 */
export function changedFileRuleOf(file: string, context: ChangedFileContext): ChangedFileRule {
  if (matchesAny(file, context.ignore, context)) {
    return { kind: 'ignored' }
  }

  const lowercased = file.toLowerCase()
  const name = posix.basename(lowercased)

  if (
    file === rootRelative(context.root, context.configPath) ||
    lockfileNames.has(name) ||
    name === 'pnpm-workspace.yaml' ||
    matchesAny(file, context.selectAll, context)
  ) {
    return { kind: 'every-story' }
  }

  const baselinesFolder = baselinesFolderOf(file, context)

  if (baselinesFolder !== undefined) {
    return {
      kind: 'baseline',
      folder: baselinesFolder,
      stem: stemOfFileName(posix.basename(file)).normalize('NFC'),
    }
  }

  if (isPackageConfig(name)) {
    return { kind: 'package' }
  }

  return isAsset(lowercased) ? { kind: 'asset' } : { kind: 'graph' }
}

/**
 * The end of a shortened stem: `-` and the start of the full key's SHA-256 in hex.
 */
const shortenedHashPattern = new RegExp(`-[0-9a-f]{${shortenedHashLength}}$`)

/**
 * Gives the start a shortened stem keeps of its key, or `undefined` when the stem isn't shortened: a shortened stem is
 * the key's first 223 bytes in whole characters, then `-` and 16 hex characters.
 */
function keptStartOf(stem: string): string | undefined {
  if (!shortenedHashPattern.test(stem)) {
    return undefined
  }

  const start = stem.slice(0, -(shortenedHashLength + 1))
  const bytes = Buffer.byteLength(start, 'utf8')

  // A start in whole characters is at most 3 bytes short of the limit, since a character takes up to 4 bytes.
  return bytes > shortenedPrefixBytes - 4 && bytes <= shortenedPrefixBytes ? start : undefined
}

/**
 * Tells whether a changed baseline's stem names a story's snapshot: the story's default capture, `<id>`, or one of its
 * modes, `<id>.<mode>`. A shortened stem, which keeps only the start of its key, also names every story whose ID that
 * start begins, or that begins `<id>.`, so it may name more stories than the one it's for.
 */
export function baselineNamesStory(stem: string, storyId: string): boolean {
  const idStem = baselineStemOf(storyId)

  if (stem === idStem || stem.startsWith(`${idStem}.`)) {
    return true
  }

  const keptStart = keptStartOf(stem)

  if (keptStart === undefined) {
    return false
  }

  const id = storyId.normalize('NFC')

  return id.startsWith(keptStart) || keptStart.startsWith(`${id}.`)
}
