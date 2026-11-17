import { createHash } from 'node:crypto'
import { cpSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CantAnswer } from './fallow-graph.js'
import { type ChangedFiles, changedFilesOf, InvalidBaseError } from './git-changes.js'
import {
  commit,
  git,
  isolateGit,
  makeFolder,
  makeRepo,
  removeRepos,
  removeSharedRepos,
  setRemoteBranch,
  setRemoteHead,
  writeFiles,
} from './git-repo.fixture.js'

// The tests run git several times each, which a machine busy with the other test files can slow to seconds.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })

beforeEach(() => {
  isolateGit()
})

afterEach(() => {
  vi.unstubAllEnvs()
  removeRepos()
})

/**
 * Runs `changedFilesOf` in `cwd` with no `--base` and no environment, unless given.
 */
function changesIn(
  cwd: string,
  options: { baseRef?: string; environment?: Record<string, string | undefined> } = {},
): Promise<ChangedFiles | CantAnswer> {
  return changedFilesOf({ baseRef: options.baseRef, environment: options.environment ?? {}, cwd })
}

/**
 * Runs `changedFilesOf` and gives the changed files, failing the test when it can't answer.
 */
async function answerIn(
  cwd: string,
  options: { baseRef?: string; environment?: Record<string, string | undefined> } = {},
): Promise<ChangedFiles> {
  const result = await changesIn(cwd, options)

  if ('cantAnswer' in result) {
    throw new Error(result.cantAnswer)
  }

  return result
}

/**
 * Deletes a ref itself, never the ref a symbolic one points at.
 */
function deleteRef(repo: string, ref: string): void {
  git(repo, 'update-ref', '--no-deref', '-d', ref)
}

describe('the base', () => {
  /**
   * The repository each test works in: a copy of `source`, where each base candidate points at a different commit on
   * one line of history, so the merge base names the candidate that won.
   */
  let repo: string

  /**
   * The repository built once, which the tests never change.
   */
  let source: string

  /**
   * The line's commits, oldest first. `HEAD` is on branch `work`, one commit after the last.
   */
  let commits: string[]

  beforeAll(() => {
    isolateGit()
    source = makeRepo({ shared: true })
    commits = Array.from({ length: 7 }, (_, index) => commit(source, { 'file.ts': `${index}\n` }))
    git(source, 'checkout', '-q', '-b', 'work')
    commit(source, { 'file.ts': 'work\n' })
    git(source, 'tag', 'v0', commits[0] as string)
    git(source, 'branch', '-f', 'main', commits[1] as string)
    git(source, 'branch', 'master', commits[2] as string)
    setRemoteBranch(source, 'master', commits[3] as string)
    setRemoteBranch(source, 'main', commits[4] as string)
    setRemoteBranch(source, 'develop', commits[5] as string)
    setRemoteHead(source, 'develop')
    setRemoteBranch(source, 'feature', commits[6] as string)
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    removeSharedRepos()
  })

  beforeEach(() => {
    repo = makeFolder()
    cpSync(source, repo, { recursive: true })
  })

  it('is the commit --base names, before everything else', async () => {
    const changes = await answerIn(repo, { baseRef: 'v0', environment: { GITHUB_BASE_REF: 'feature' } })

    expect(changes.base).toBe(commits[0])
  })

  it('is origin/$GITHUB_BASE_REF before origin/HEAD', async () => {
    const changes = await answerIn(repo, { environment: { GITHUB_BASE_REF: 'feature' } })

    expect(changes.base).toBe(commits[6])
  })

  it('ignores an empty GITHUB_BASE_REF', async () => {
    const changes = await answerIn(repo, { environment: { GITHUB_BASE_REF: '' } })

    expect(changes.base).toBe(commits[5])
  })

  it('goes on to origin/HEAD when GITHUB_BASE_REF names a missing branch', async () => {
    const changes = await answerIn(repo, { environment: { GITHUB_BASE_REF: 'gone' } })

    expect(changes.base).toBe(commits[5])
  })

  it('is origin/HEAD before origin/main', async () => {
    const changes = await answerIn(repo)

    expect(changes.base).toBe(commits[5])
  })

  it('is origin/main before origin/master', async () => {
    deleteRef(repo, 'refs/remotes/origin/HEAD')

    const changes = await answerIn(repo)

    expect(changes.base).toBe(commits[4])
  })

  it('is origin/master before the local main', async () => {
    deleteRef(repo, 'refs/remotes/origin/HEAD')
    deleteRef(repo, 'refs/remotes/origin/main')

    const changes = await answerIn(repo)

    expect(changes.base).toBe(commits[3])
  })

  it('is the local main before the local master', async () => {
    for (const branch of ['HEAD', 'main', 'master', 'develop', 'feature']) {
      deleteRef(repo, `refs/remotes/origin/${branch}`)
    }

    const changes = await answerIn(repo)

    expect(changes.base).toBe(commits[1])
  })

  it('is the local master when nothing else resolves', async () => {
    for (const branch of ['HEAD', 'main', 'master', 'develop', 'feature']) {
      deleteRef(repo, `refs/remotes/origin/${branch}`)
    }

    git(repo, 'branch', '-D', 'main')

    const changes = await answerIn(repo)

    expect(changes.base).toBe(commits[2])
  })

  it("is the merge base, so a file changed only on the base branch after the fork isn't listed", async () => {
    const fork = commit(repo, { 'shared.ts': 'shared\n' })

    git(repo, 'checkout', '-q', '-b', 'topic')
    commit(repo, { 'topic.ts': 'topic\n' })
    git(repo, 'checkout', '-q', 'work')
    setRemoteBranch(repo, 'main', commit(repo, { 'main-only.ts': 'main\n' }))
    git(repo, 'checkout', '-q', 'topic')
    deleteRef(repo, 'refs/remotes/origin/HEAD')

    const changes = await answerIn(repo)

    expect(changes).toEqual({ root: repo, base: fork, files: ['topic.ts'] })
  })
})

describe("when it can't work out the base", () => {
  it('throws InvalidBaseError for a --base that names no commit', async () => {
    const repo = makeRepo()

    commit(repo, { 'file.ts': 'file\n' })

    await expect(changesIn(repo, { baseRef: 'nope' })).rejects.toThrow(
      new InvalidBaseError("--base names nope, which isn't a commit in this repository."),
    )
  })

  it('throws InvalidBaseError for a --base that looks like an option', async () => {
    const repo = makeRepo()

    commit(repo, { 'file.ts': 'file\n' })

    await expect(changesIn(repo, { baseRef: '--all' })).rejects.toBeInstanceOf(InvalidBaseError)
  })

  it('names every branch it tried when none resolves', async () => {
    const repo = makeRepo()

    commit(repo, { 'file.ts': 'file\n' })
    git(repo, 'branch', '-m', 'work')

    expect(await changesIn(repo)).toEqual({
      cantAnswer: 'no base branch found (tried origin/HEAD, origin/main, origin/master, main and master)',
    })
    expect(await changesIn(repo, { environment: { GITHUB_BASE_REF: 'release' } })).toEqual({
      cantAnswer:
        'no base branch found (tried origin/release, origin/HEAD, origin/main, origin/master, main and master)',
    })
  })

  it("can't answer when HEAD and the base share no history", async () => {
    const repo = makeRepo()

    commit(repo, { 'file.ts': 'file\n' })

    const unrelated = git(repo, 'commit-tree', git(repo, 'rev-parse', 'HEAD^{tree}'), '-m', 'unrelated')

    setRemoteBranch(repo, 'main', unrelated)

    expect(await changesIn(repo)).toEqual({
      cantAnswer: "there's no merge base with origin/main, as in a shallow clone or with unrelated history",
    })
  })

  it("can't answer in a shallow clone that lacks the merge base, rather than guess a base", async () => {
    const origin = makeRepo()

    commit(origin, { 'file.ts': 'fork\n' })
    git(origin, 'checkout', '-q', '-b', 'work')
    commit(origin, { 'file.ts': 'work\n' })
    git(origin, 'checkout', '-q', 'main')
    commit(origin, { 'file.ts': 'main\n' })

    const clone = makeFolder()

    git(clone, 'clone', '-q', '--depth', '1', '--branch', 'work', pathToFileURL(origin).href, '.')
    git(clone, 'fetch', '-q', '--depth', '1', 'origin', 'main:refs/remotes/origin/main')

    expect(git(clone, 'rev-parse', '--is-shallow-repository')).toBe('true')
    expect(await changesIn(clone)).toEqual({
      cantAnswer: "there's no merge base with origin/main, as in a shallow clone or with unrelated history",
    })
  })

  it("can't answer, with git's own reason, when git fails for another reason", async () => {
    const bare = makeFolder()

    git(bare, 'init', '-q', '--bare')

    expect(await changesIn(bare)).toEqual({ cantAnswer: 'git failed: this operation must be run in a work tree' })
  })

  it("can't answer when the folder doesn't exist", async () => {
    expect(await changesIn(join(makeFolder(), 'missing'))).toEqual({ cantAnswer: "the folder doesn't exist" })
  })

  it("can't answer outside a git repository", async () => {
    expect(await changesIn(makeFolder())).toEqual({ cantAnswer: "the folder isn't in a git repository" })
  })

  it("can't answer in a repository with no commits", async () => {
    expect(await changesIn(makeRepo())).toEqual({ cantAnswer: 'the repository has no commits yet' })
  })

  it("can't answer when git isn't installed", async () => {
    const repo = makeRepo()

    commit(repo, { 'file.ts': 'file\n' })
    vi.stubEnv('PATH', makeFolder())

    expect(await changesIn(repo)).toEqual({ cantAnswer: "git isn't installed" })
  })
})

describe('the changed files', () => {
  /**
   * The repository each test works in: a copy of `source`.
   */
  let repo: string

  /**
   * The repository built once, which the tests never change: its `origin/main` is its first commit, with `HEAD` on
   * branch `work`.
   */
  let source: string

  /**
   * The first commit, the base.
   */
  let base: string

  beforeAll(() => {
    isolateGit()
    source = makeRepo({ shared: true })
    base = commit(source, {
      '.gitignore': 'ignored/\n*.log\n',
      'src/committed.ts': 'committed\n',
      'src/staged.ts': 'staged\n',
      'src/unstaged.ts': 'unstaged\n',
      'src/both.ts': 'both\n',
      'src/deleted.ts': 'deleted\n',
      'src/renamed-from.ts': 'a file long enough for git to see the rename\n',
      'src/staged-rename-from.ts': 'another file long enough for git to see the rename\n',
      'src/unchanged.ts': 'unchanged\n',
    })
    setRemoteBranch(source, 'main', base)
    git(source, 'checkout', '-q', '-b', 'work')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    removeSharedRepos()
  })

  beforeEach(() => {
    repo = makeFolder()
    cpSync(source, repo, { recursive: true })
  })

  it('lists committed, staged, unstaged, untracked and deleted files, and both paths of a rename, each once', async () => {
    git(repo, 'mv', 'src/renamed-from.ts', 'src/renamed-to.ts')
    commit(repo, { 'src/committed.ts': 'committed, changed\n' })
    writeFiles(repo, { 'src/staged.ts': 'staged, changed\n', 'src/both.ts': 'both, staged\n' })
    git(repo, 'add', 'src/staged.ts', 'src/both.ts')
    git(repo, 'mv', 'src/staged-rename-from.ts', 'src/staged-rename-to.ts')
    writeFiles(repo, {
      'src/unstaged.ts': 'unstaged, changed\n',
      'src/both.ts': 'both, staged, then changed\n',
      'src/untracked.ts': 'untracked\n',
      'ignored/file.ts': 'ignored\n',
      'debug.log': 'ignored\n',
    })
    rmSync(join(repo, 'src/deleted.ts'))

    expect(await answerIn(repo)).toEqual({
      root: repo,
      base,
      files: [
        'src/both.ts',
        'src/committed.ts',
        'src/deleted.ts',
        'src/renamed-from.ts',
        'src/renamed-to.ts',
        'src/staged-rename-from.ts',
        'src/staged-rename-to.ts',
        'src/staged.ts',
        'src/unstaged.ts',
        'src/untracked.ts',
      ],
    })
  })

  it('lists a file that git rm staged for deletion', async () => {
    git(repo, 'rm', '-q', 'src/deleted.ts')

    expect((await answerIn(repo)).files).toEqual(['src/deleted.ts'])
  })

  it('lists a file that a commit since the base deleted', async () => {
    git(repo, 'rm', '-q', 'src/deleted.ts')
    git(repo, 'commit', '-q', '-m', 'delete')

    expect((await answerIn(repo)).files).toEqual(['src/deleted.ts'])
  })

  it('still lists a file a commit changed and the working tree then restored to the base content', async () => {
    commit(repo, { 'src/committed.ts': 'committed, changed\n' })
    writeFiles(repo, { 'src/committed.ts': 'committed\n' })

    // The file matches the base again, but the commits since the base still touched it, so it stays listed: git
    // status can't see it and diff-tree reads commits only. Listing too many files only covers more stories.
    expect((await answerIn(repo)).files).toEqual(['src/committed.ts'])
  })

  it('gives paths relative to the top level when run in a subfolder', async () => {
    writeFiles(repo, { 'src/unstaged.ts': 'unstaged, changed\n', 'other/untracked.ts': 'untracked\n' })

    expect(await answerIn(join(repo, 'src'))).toEqual({
      root: repo,
      base,
      files: ['other/untracked.ts', 'src/unstaged.ts'],
    })
  })

  it('gives names with spaces, non-ASCII letters and quotes as they are', async () => {
    const quotesInNames = process.platform !== 'win32'
    const tracked = {
      'src/with space/ünïcode file.ts': 'spaced\n',
      ...(quotesInNames ? { 'src/q"uote.ts': 'quoted\n' } : {}),
    }

    setRemoteBranch(repo, 'main', commit(repo, tracked))
    writeFiles(repo, {
      ...Object.fromEntries(Object.keys(tracked).map((path) => [path, 'changed\n'])),
      'src/ñew file.ts': 'untracked\n',
    })

    expect((await answerIn(repo)).files).toEqual([...Object.keys(tracked), 'src/ñew file.ts'].sort())
  })

  it('gives no files when nothing changed', async () => {
    expect(await answerIn(repo)).toEqual({ root: repo, base, files: [] })
  })

  it("leaves git's state as it was", async () => {
    writeFiles(repo, { 'src/staged.ts': 'staged, changed\n' })
    git(repo, 'add', 'src/staged.ts')
    writeFiles(repo, { 'src/unstaged.ts': 'unstaged, changed\n', 'src/untracked.ts': 'untracked\n' })
    // An unchanged file with a new modified time makes the index's cached stat stale, which a refresh would rewrite.
    utimesSync(join(repo, 'src/unchanged.ts'), new Date(), new Date(Date.now() + 60_000))

    /**
     * Captures what a write to git's state would change.
     */
    const stateOf = () => {
      const index = join(repo, '.git', 'index')

      return {
        status: git(repo, '--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all'),
        head: git(repo, 'rev-parse', 'HEAD'),
        refs: git(repo, 'for-each-ref'),
        indexHash: createHash('sha256').update(readFileSync(index)).digest('hex'),
        indexModified: statSync(index).mtimeMs,
      }
    }

    const before = stateOf()
    const changes = await answerIn(repo)

    await answerIn(repo, { baseRef: base })

    expect(stateOf()).toEqual(before)
    expect(changes.files).toEqual(['src/staged.ts', 'src/unstaged.ts', 'src/untracked.ts'])
  })
})

describe('InvalidBaseError', () => {
  it('names itself', () => {
    expect(new InvalidBaseError('message').name).toBe('InvalidBaseError')
  })
})
