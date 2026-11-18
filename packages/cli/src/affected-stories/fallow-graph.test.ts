import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { failureLineOf, findReachedFilesWithFallow, readFallowGraph } from './fallow-graph.js'
import { ignoredFile, keepFallowOffSystemCertificates, makeFallowProject } from './fallow-project.fixture.js'

// The tests run the real Fallow or a fake one in Node, which a machine busy with the other test files can slow to
// seconds.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })

/**
 * The project Fallow reads, made once for every test.
 */
let project: string

/**
 * The folder the fake Fallow scripts live in.
 */
let fakes: string

beforeAll(() => {
  keepFallowOffSystemCertificates()
  project = makeFallowProject()
  fakes = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-fake-fallow-')))
})

afterAll(() => {
  vi.unstubAllEnvs()
  rmSync(project, { recursive: true, force: true })
  rmSync(fakes, { recursive: true, force: true })
})

/**
 * Writes a fake Fallow with the given source and returns a resolver that gives its path.
 */
function fakeFallow(name: string, source: string): () => string {
  const path = join(fakes, `${name}.cjs`)

  writeFileSync(path, source)

  return () => path
}

describe('findReachedFilesWithFallow', () => {
  it('reaches the importers of a changed file, through re-exports and Storybook config', async () => {
    const result = await findReachedFilesWithFallow(project, ['src/tokens.ts'])

    expect(result).toMatchObject({
      reached: new Set([
        'src/tokens.ts',
        'src/re-export-all.ts',
        'src/re-export-named.ts',
        'src/button.ts',
        'src/button.stories.ts',
        '.storybook/preview.ts',
      ]),
    })
  })

  it("keeps a file the project's own Fallow config ignores", async () => {
    const result = await findReachedFilesWithFallow(project, [ignoredFile])

    expect(result).toMatchObject({ reached: new Set([ignoredFile, 'src/button.ts', 'src/button.stories.ts']) })
  })

  it('reaches nothing from a changed file outside the graph', async () => {
    const result = await findReachedFilesWithFallow(project, ['README.md'])

    expect(result).toMatchObject({ reached: new Set() })
  })

  it('reaches the files under a folder and their importers, from the same graph, once asked', async () => {
    const result = await findReachedFilesWithFallow(project, [])

    if ('cantAnswer' in result) {
      throw new Error(`Fallow couldn't answer: ${result.cantAnswer}`)
    }

    expect(result.reached).toEqual(new Set())
    expect(result.reachedFromFolders(['src/nested'])).toEqual(
      new Set(['src/nested/deep/deep.ts', 'src/with space/ünïcode file.ts', 'src/button.stories.ts']),
    )
    expect(result.reachedFromFolders([])).toEqual(new Set())
  })

  it("can't answer when the project folder is gone", async () => {
    const result = await findReachedFilesWithFallow(join(fakes, 'missing'), ['src/tokens.ts'])

    expect(result).toEqual({ cantAnswer: expect.stringMatching(/^Fallow couldn't start: /) })
  })
})

describe('readFallowGraph', () => {
  it("can't answer when Fallow isn't installed", async () => {
    const resolveBin = () => {
      throw new Error("Cannot find module 'fallow/bin/fallow'")
    }

    expect(await readFallowGraph(project, { resolveBin })).toEqual({ cantAnswer: "Fallow isn't installed" })
  })

  it("can't answer when Fallow can't start", async () => {
    const result = await readFallowGraph(project, { resolveBin: () => 'fallow\0bin' })

    expect(result).toEqual({ cantAnswer: expect.stringMatching(/^Fallow couldn't start: /) })
  })

  it("can't answer when Fallow's script is missing", async () => {
    const result = await readFallowGraph(project, { resolveBin: () => join(fakes, 'missing.cjs') })

    expect(result).toEqual({ cantAnswer: expect.stringMatching(/^Fallow failed: Error: Cannot find module /) })
  })

  it("names Fallow's error when it fails", async () => {
    const resolveBin = fakeFallow(
      'fails',
      "process.stderr.write('WARN no node_modules\\nError: invalid root path\\n  hint: pass --root\\n\\n')\n" +
        'process.exit(2)\n',
    )

    expect(await readFallowGraph(project, { resolveBin })).toEqual({
      cantAnswer: 'Fallow failed: Error: invalid root path',
    })
  })

  it('names the exit code when Fallow fails without a word', async () => {
    const resolveBin = fakeFallow('fails-silently', 'process.exit(3)\n')

    expect(await readFallowGraph(project, { resolveBin })).toEqual({ cantAnswer: 'Fallow failed with exit code 3' })
  })

  it("can't answer when Fallow prints something that isn't a graph", async () => {
    const resolveBin = fakeFallow('prints-garbage', "console.log('not a graph')\n")

    expect(await readFallowGraph(project, { resolveBin })).toEqual({
      cantAnswer: "Fallow's graph has no digraph header",
    })
  })

  it.skipIf(process.platform === 'win32')("can't answer when Fallow is killed", async () => {
    const resolveBin = fakeFallow('killed', "process.kill(process.pid, 'SIGKILL')\n")

    expect(await readFallowGraph(project, { resolveBin })).toEqual({
      cantAnswer: 'Fallow was stopped by SIGKILL, which happens when it runs out of memory',
    })
  })

  it("can't answer when Fallow's binary is killed, which its launcher reports as 128 plus the signal", async () => {
    const resolveBin = fakeFallow('binary-killed', 'process.exit(137)\n')

    expect(await readFallowGraph(project, { resolveBin })).toEqual({
      cantAnswer: 'Fallow was stopped by SIGKILL, which happens when it runs out of memory',
    })
  })

  it("can't answer when Fallow doesn't finish in time", async () => {
    const resolveBin = fakeFallow('hangs', 'setInterval(() => undefined, 1000)\n')

    expect(await readFallowGraph(project, { resolveBin, timeoutMs: 200 })).toEqual({
      cantAnswer: "Fallow didn't finish within 0.2 s",
    })
  })

  it('stops Fallow when its graph turns unreadable midway', async () => {
    const resolveBin = fakeFallow(
      'bad-edge',
      "require('node:fs').writeFileSync(__filename + '.pid', String(process.pid))\n" +
        'console.log(\'digraph fallow {\\n  n0 [label="a.ts"];\\n  n0 -> n9;\')\n' +
        'setInterval(() => undefined, 1000)\n',
    )

    const result = await readFallowGraph(project, { resolveBin })
    const pid = Number(readFileSync(`${resolveBin()}.pid`, 'utf8'))

    expect(result).toEqual({ cantAnswer: "Fallow's graph has an edge naming the undeclared node n9" })
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow())
  })

  it('reads a graph larger than a default exec buffer', async () => {
    const resolveBin = fakeFallow(
      'large',
      "const lines = ['digraph fallow {']\n" +
        'for (let index = 0; index < 40000; index += 1) {\n' +
        "  lines.push('  n' + index + ' [label=\"src/some/rather/long/folder/name/file-' + index + '.ts\"];')\n" +
        '}\n' +
        "lines.push('  n1 -> n0;', '}')\n" +
        "process.stdout.write(lines.join('\\n') + '\\n')\n",
    )

    const graph = await readFallowGraph(project, { resolveBin })

    expect('files' in graph && graph.files.size).toBe(40000)
    expect('importersOf' in graph && graph.importersOf.get('src/some/rather/long/folder/name/file-0.ts')).toEqual([
      'src/some/rather/long/folder/name/file-1.ts',
    ])
  })
})

describe('failureLineOf', () => {
  it('gives the last line that starts with Error', () => {
    expect(failureLineOf(['WARN a', 'Error: first', 'Error: second', '  hint: b'])).toBe('Error: second')
  })

  it('gives the last non-empty line when none starts with Error', () => {
    expect(failureLineOf(['WARN a', '  panicked here  ', '   '])).toBe('panicked here')
  })

  it('gives nothing for no lines', () => {
    expect(failureLineOf(['', ' '])).toBeUndefined()
  })
})
