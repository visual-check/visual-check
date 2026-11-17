import { describe, expect, it } from 'vitest'
import type { ImportGraph } from './import-graph.js'
import { filesReachedFrom } from './walk-back.js'

/**
 * Builds a graph from `[importer, imported]` pairs, with every file the pairs name in it.
 */
function graphOf(edges: readonly (readonly [string, string])[], extraFiles: readonly string[] = []): ImportGraph {
  const files = new Set<string>(extraFiles)
  const importersOf = new Map<string, string[]>()

  for (const [importer, imported] of edges) {
    files.add(importer)
    files.add(imported)
    importersOf.set(imported, [...(importersOf.get(imported) ?? []), importer])
  }

  return { files, importersOf }
}

describe('filesReachedFrom', () => {
  it('reaches a direct importer and the seed itself', () => {
    const graph = graphOf([['story.ts', 'button.ts']])

    expect(filesReachedFrom(graph, ['button.ts'])).toEqual(new Set(['button.ts', 'story.ts']))
  })

  it('reaches importers through a chain', () => {
    const graph = graphOf([
      ['story.ts', 'button.ts'],
      ['button.ts', 'theme.ts'],
      ['theme.ts', 'tokens.ts'],
    ])

    expect(filesReachedFrom(graph, ['tokens.ts'])).toEqual(new Set(['tokens.ts', 'theme.ts', 'button.ts', 'story.ts']))
  })

  it('reaches a file once when two paths lead to it', () => {
    const graph = graphOf([
      ['top.ts', 'left.ts'],
      ['top.ts', 'right.ts'],
      ['left.ts', 'base.ts'],
      ['right.ts', 'base.ts'],
    ])

    expect(filesReachedFrom(graph, ['base.ts'])).toEqual(new Set(['base.ts', 'left.ts', 'right.ts', 'top.ts']))
  })

  it('stops on a cycle', () => {
    const graph = graphOf([
      ['a.ts', 'b.ts'],
      ['b.ts', 'c.ts'],
      ['c.ts', 'a.ts'],
    ])

    expect(filesReachedFrom(graph, ['a.ts'])).toEqual(new Set(['a.ts', 'b.ts', 'c.ts']))
  })

  it('leaves out a seed that is not in the graph', () => {
    const graph = graphOf([['a.ts', 'b.ts']])

    expect(filesReachedFrom(graph, ['unknown.ts'])).toEqual(new Set())
  })

  it('includes a seed in the graph that nothing imports', () => {
    const graph = graphOf([], ['lonely.ts'])

    expect(filesReachedFrom(graph, ['lonely.ts'])).toEqual(new Set(['lonely.ts']))
  })

  it('joins what several seeds reach', () => {
    const graph = graphOf([
      ['a-story.ts', 'a.ts'],
      ['b-story.ts', 'b.ts'],
      ['c-story.ts', 'c.ts'],
    ])

    expect(filesReachedFrom(graph, ['a.ts', 'b.ts', 'unknown.ts'])).toEqual(
      new Set(['a.ts', 'a-story.ts', 'b.ts', 'b-story.ts']),
    )
  })
})
