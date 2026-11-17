import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { vi } from 'vitest'

/**
 * What a temporary project holds.
 */
interface ProjectSetup {
  /**
   * The root's `package.json`: an object written as JSON with two spaces and a trailing newline, or the text as it is.
   * Left out, there's no `package.json`.
   */
  manifest?: Record<string, unknown> | string
  /**
   * Other files, each a path relative to the root mapped to its content.
   */
  files?: Record<string, string>
  /**
   * The `storybook` version installed in the root's `node_modules`. Left out, none is installed.
   */
  storybookVersion?: string
  /**
   * Whether the root is a git repo. `true` when not given. Without one, git is kept from looking above the root.
   */
  git?: boolean
}

/**
 * The temporary projects made since the last `removeProjects`.
 */
const projects: string[] = []

/**
 * Writes `content` at `path`, creating the parent folders.
 */
function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/**
 * Makes a temporary project and returns its real path. `removeProjects` removes it.
 */
export function makeProject({ manifest, files = {}, storybookVersion, git = true }: ProjectSetup): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-init-')))

  projects.push(root)
  if (git) {
    execFileSync('git', ['init', '-q'], { cwd: root })
  } else {
    vi.stubEnv('GIT_CEILING_DIRECTORIES', dirname(root))
  }
  if (manifest !== undefined) {
    writeFile(
      join(root, 'package.json'),
      typeof manifest === 'string' ? manifest : `${JSON.stringify(manifest, null, 2)}\n`,
    )
  }
  if (storybookVersion !== undefined) {
    writeFile(
      join(root, 'node_modules', 'storybook', 'package.json'),
      JSON.stringify({ name: 'storybook', version: storybookVersion }),
    )
  }
  for (const [path, content] of Object.entries(files)) {
    writeFile(join(root, path), content)
  }

  return root
}

/**
 * Removes the projects `makeProject` made, and lets git look above folders again.
 *
 * @public
 */
export function removeProjects(): void {
  vi.unstubAllEnvs()
  for (const root of projects.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
}

/**
 * The folders `snapshotFiles` skips.
 */
const skippedFolders = new Set(['node_modules', '.git'])

/**
 * Hashes every file under `root`, except in `node_modules` and `.git` folders. Gives each file's path, relative to
 * the root and `/` separated, mapped to the SHA-256 of its bytes, in path order.
 */
export function snapshotFiles(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {}
  const entries = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .filter((path) => !path.split(sep).some((part) => skippedFolders.has(part)))
    .sort()

  for (const path of entries) {
    snapshot[path.split(sep).join('/')] = createHash('sha256')
      .update(readFileSync(join(root, path)))
      .digest('hex')
  }

  return snapshot
}

/**
 * Makes a pnpm project with one Storybook in `.storybook`, started by `storybook dev -p 6006`, and storybook 10.6.7
 * installed. `manifest` is merged into its `package.json`, and `files` added to its files.
 *
 * @public
 */
export function pnpmProject(
  options: { manifest?: Record<string, unknown>; files?: Record<string, string>; storybookVersion?: string } = {},
): string {
  return makeProject({
    manifest: {
      name: 'web-app',
      private: true,
      packageManager: 'pnpm@9.12.3',
      scripts: { storybook: 'storybook dev -p 6006' },
      ...options.manifest,
    },
    files: { '.storybook/main.ts': 'export default {}\n', ...options.files },
    storybookVersion: options.storybookVersion ?? '10.6.7',
  })
}

/**
 * Reads a file of a project as text.
 */
export function readText(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}
