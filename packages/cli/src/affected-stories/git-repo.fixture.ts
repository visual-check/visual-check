import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { vi } from 'vitest'

/**
 * The temporary folders made since the last `removeRepos`.
 */
const folders: string[] = []

/**
 * The shared temporary folders made since the last `removeSharedRepos`.
 */
const sharedFolders: string[] = []

/**
 * Makes a temporary folder and returns its real path. `removeRepos` removes it, or `removeSharedRepos` when it's
 * shared, which is for a repository built once in `beforeAll` and copied for each test.
 */
export function makeFolder(options: { shared?: boolean } = {}): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-git-')))

  ;(options.shared ? sharedFolders : folders).push(folder)

  return folder
}

/**
 * Keeps git in the tests from the user's own config and from any repository above the temporary folders, and gives
 * commits a fixed author. It stubs `process.env`, so `vi.unstubAllEnvs` undoes it.
 */
export function isolateGit(): void {
  const configFolder = makeFolder()
  const emptyConfig = join(configFolder, 'empty.gitconfig')

  writeFileSync(emptyConfig, '')
  vi.stubEnv('GIT_CONFIG_GLOBAL', emptyConfig)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  vi.stubEnv('GIT_CEILING_DIRECTORIES', dirname(configFolder))
  vi.stubEnv('GIT_AUTHOR_NAME', 'Test')
  vi.stubEnv('GIT_AUTHOR_EMAIL', 'test@example.com')
  vi.stubEnv('GIT_COMMITTER_NAME', 'Test')
  vi.stubEnv('GIT_COMMITTER_EMAIL', 'test@example.com')

  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) {
    vi.stubEnv(name, undefined)
  }
}

/**
 * Removes the temporary folders made since the last call.
 */
export function removeRepos(): void {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
}

/**
 * Removes the shared temporary folders made since the last call.
 */
export function removeSharedRepos(): void {
  for (const folder of sharedFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
}

/**
 * Runs git in `repo` and returns its output without the final newline.
 */
export function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).replace(/\n$/, '')
}

/**
 * Makes a temporary repository on branch `main`, with no commits, and returns its real path. A shared one outlives
 * `removeRepos`.
 */
export function makeRepo(options: { shared?: boolean } = {}): string {
  const repo = makeFolder(options)

  git(repo, 'init', '-q', '-b', 'main')

  return repo
}

/**
 * Writes each file, a path relative to the repository mapped to its content, creating the parent folders.
 */
export function writeFiles(repo: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), content)
  }
}

/**
 * Writes the files, commits every change in the repository and returns the new commit's SHA.
 */
export function commit(repo: string, files: Record<string, string> = {}): string {
  writeFiles(repo, files)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'change')

  return git(repo, 'rev-parse', 'HEAD')
}

/**
 * Points a remote-tracking branch, `refs/remotes/origin/<branch>`, at a commit, as a fetch would.
 */
export function setRemoteBranch(repo: string, branch: string, sha: string): void {
  git(repo, 'update-ref', `refs/remotes/origin/${branch}`, sha)
}

/**
 * Points `origin/HEAD` at a remote-tracking branch, as a clone does.
 */
export function setRemoteHead(repo: string, branch: string): void {
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${branch}`)
}
