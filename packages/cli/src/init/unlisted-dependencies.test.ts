import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  fallowFailureOf,
  fallowFailureWarningOf,
  findUnlistedDependencies,
  unlistedDependenciesOf,
  unlistedDependenciesWarningOf,
} from './unlisted-dependencies.js'

/**
 * The temporary folders the tests made, removed after each test.
 */
const temporaryFolders: string[] = []

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

describe('unlistedDependenciesOf', () => {
  it('reads one dependency', () => {
    const document = { unlisted_dependencies: [{ package_name: 'a', imported_from: [{ path: 'x.js', line: 1 }] }] }

    expect(unlistedDependenciesOf(document)).toEqual([{ name: 'a', paths: ['x.js'] }])
  })

  it('reads several dependencies with several paths', () => {
    const document = {
      unlisted_dependencies: [
        { package_name: 'a', imported_from: [{ path: 'x.js' }, { path: 'y.js' }] },
        { package_name: '@s/b', imported_from: [{ path: 'z/w.ts' }] },
      ],
    }

    expect(unlistedDependenciesOf(document)).toEqual([
      { name: 'a', paths: ['x.js', 'y.js'] },
      { name: '@s/b', paths: ['z/w.ts'] },
    ])
  })

  it('reads none', () => {
    expect(unlistedDependenciesOf({ unlisted_dependencies: [] })).toEqual([])
  })

  it.each([
    [null, "Fallow's output has no unlisted_dependencies list."],
    [[], "Fallow's output has no unlisted_dependencies list."],
    [{}, "Fallow's output has no unlisted_dependencies list."],
    [{ unlisted_dependencies: 'a' }, "Fallow's output has no unlisted_dependencies list."],
    [
      { unlisted_dependencies: [{ package_name: 1 }] },
      "Fallow's output holds an unlisted dependency in a shape visual-check can't read.",
    ],
    [
      { unlisted_dependencies: [{ package_name: 'a', imported_from: [] }] },
      "Fallow's output holds an unlisted dependency without the files that import it.",
    ],
    [
      { unlisted_dependencies: [{ package_name: 'a', imported_from: [{ path: 'x.js' }, {}] }] },
      "Fallow's output holds an unlisted dependency without the files that import it.",
    ],
  ])('throws on the malformed document %j', (document, message) => {
    expect(() => unlistedDependenciesOf(document)).toThrow(new Error(message))
  })
})

describe('unlistedDependenciesWarningOf', () => {
  it('says nothing for none', () => {
    expect(unlistedDependenciesWarningOf([])).toBeUndefined()
  })

  it('names one package with its first path', () => {
    expect(unlistedDependenciesWarningOf([{ name: 'a', paths: ['x.js', 'y.js'] }])).toBe(
      "Warning: package.json doesn't list a, imported in x.js. visual-check can't tell which stories it affects.",
    )
  })

  it('names several packages', () => {
    expect(
      unlistedDependenciesWarningOf([
        { name: 'a', paths: ['x.js'] },
        { name: 'b', paths: ['z.js'] },
        { name: 'c', paths: ['w.js'] },
      ]),
    ).toBe(
      "Warning: package.json doesn't list a, b and c, which your code imports. visual-check can't tell which stories they affect.",
    )
  })
})

describe('fallowFailureOf', () => {
  it('names the timeout when the process was killed', () => {
    expect(fallowFailureOf({ killed: true, stderr: 'x', code: 1 })).toBe("Fallow didn't finish within 120 s.")
  })

  it('gives the first non-empty line of stderr', () => {
    expect(fallowFailureOf({ stderr: '\n  \n boom \nmore\n', code: 2 })).toBe('boom')
  })

  it('gives the exit code when stderr is empty', () => {
    expect(fallowFailureOf({ stderr: '', code: 2 })).toBe('exit code 2')
  })

  it('gives the message, or a fallback, when there is no exit code', () => {
    expect(fallowFailureOf({ code: 'ENOENT', message: 'spawn failed' })).toBe('spawn failed')
    expect(fallowFailureOf({})).toBe('it failed')
  })
})

describe('fallowFailureWarningOf', () => {
  it('words an error and a thrown text', () => {
    expect(fallowFailureWarningOf(new Error('boom'))).toBe("Warning: Fallow couldn't check the imports: boom")
    expect(fallowFailureWarningOf('bang')).toBe("Warning: Fallow couldn't check the imports: bang")
  })
})

/**
 * Makes a git repo in a temporary folder with a `package.json` and `a.js` that imports `leftpad-zz`.
 */
function createProject(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-fallow-')))

  temporaryFolders.push(root)
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  writeFileSync(join(root, 'package.json'), '{"name":"x","version":"1.0.0","type":"module","main":"a.js"}')
  writeFileSync(join(root, 'a.js'), "import 'leftpad-zz'\n")

  return root
}

describe('findUnlistedDependencies', () => {
  it('runs Fallow on a project and leaves no .fallow folder', async () => {
    const root = createProject()

    expect(await findUnlistedDependencies(root)).toEqual([{ name: 'leftpad-zz', paths: ['a.js'] }])
    expect(existsSync(join(root, '.fallow'))).toBe(false)
  }, 60_000)

  it("throws Fallow's own message when its config is broken", async () => {
    const root = createProject()

    writeFileSync(join(root, '.fallowrc.json'), '{ nope')

    await expect(findUnlistedDependencies(root)).rejects.toThrow(/Failed to parse config file/)
  }, 60_000)
})
