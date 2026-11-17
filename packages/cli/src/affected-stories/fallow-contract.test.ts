import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFallowGraph } from './fallow-graph.js'
import {
  ignoredFile,
  keepFallowOffSystemCertificates,
  makeFallowProject,
  projectSourceFiles,
  quotedFile,
} from './fallow-project.fixture.js'
import type { ImportGraph } from './import-graph.js'
import { filesReachedFrom } from './walk-back.js'

// The hook and the walk-back test run the real Fallow, which a machine busy with the other test files can slow to
// seconds.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })

/**
 * The project Fallow reads.
 */
let project: string

/**
 * The graph `fallow viz` gave for the project.
 */
let graph: ImportGraph

beforeAll(async () => {
  keepFallowOffSystemCertificates()
  project = makeFallowProject()

  const result = await readFallowGraph(project)

  if ('cantAnswer' in result) {
    throw new Error(result.cantAnswer)
  }

  graph = result
})

afterAll(() => {
  vi.unstubAllEnvs()
  rmSync(project, { recursive: true, force: true })
})

/**
 * Asks Fallow's own per-file query for the files that import `file`, directly or not, with visual-check's config.
 */
function impactClosureOf(file: string): Set<string> {
  const bin = createRequire(import.meta.url).resolve('fallow/bin/fallow')
  const config = fileURLToPath(new URL('../../fallow-graph.json', import.meta.url))
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [bin, 'dead-code', '--impact-closure', file, '--format', 'json', '--no-cache', '-c', config, '--root', project],
    { cwd: project, encoding: 'utf8', windowsHide: true },
  )

  if (status !== 0) {
    throw new Error(stderr)
  }

  const document: { affected_not_shown: string[] } = JSON.parse(stdout)

  return new Set(document.affected_not_shown)
}

describe("Fallow's graph", () => {
  it('holds every source file, the one with a quote and the one the project ignores included', () => {
    expect([...graph.files].sort()).toEqual([...projectSourceFiles].sort())
    expect(graph.files.has(ignoredFile)).toBe(true)
    expect(graph.files.has(quotedFile)).toBe(process.platform !== 'win32')
  })

  it("walks back from each file to what Fallow's impact closure gives", { timeout: 60_000 }, () => {
    for (const file of graph.files) {
      const reached = filesReachedFrom(graph, [file])

      reached.delete(file)

      expect({ file, reached }).toEqual({ file, reached: impactClosureOf(file) })
    }
  })
})
