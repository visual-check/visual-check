import { describe, expect, it } from 'vitest'
import { createDotReader } from './import-graph.js'

/**
 * Reads the lines into a fresh reader and gives the graph it built.
 */
function graphOf(lines: readonly string[]) {
  const reader = createDotReader()

  for (const line of lines) {
    reader.readLine(line)
  }

  return reader.graph()
}

describe('createDotReader', () => {
  it('skips the header, attribute lines, blank lines and the closing brace', () => {
    const graph = graphOf([
      'digraph fallow {',
      '  rankdir=LR;',
      '  node [shape=box, style=filled];',
      '',
      '  n0 [label="src/a.ts", fillcolor="#30a46c", fontcolor="#eeeeec"];',
      '}',
    ])

    expect(new Set(graph.files)).toEqual(new Set(['src/a.ts']))
    expect(graph.importersOf.size).toBe(0)
  })

  it('unescapes quotes and backslashes in labels and keeps spaces and unicode', () => {
    const graph = graphOf([
      'digraph fallow {',
      '  n0 [label="src/q\\"uote.ts", fillcolor="#62605b"];',
      '  n1 [label="src\\\\back.ts", fillcolor="#62605b"];',
      '  n2 [label="src/we ird/sp ace ü.ts", fillcolor="#62605b"];',
      '}',
    ])

    expect(new Set(graph.files)).toEqual(new Set(['src/q"uote.ts', 'src\\back.ts', 'src/we ird/sp ace ü.ts']))
  })

  it('records the importer of the file an edge points to', () => {
    const graph = graphOf([
      'digraph fallow {',
      '  n0 [label="a.ts"];',
      '  n1 [label="b.ts"];',
      '  n2 [label="c.ts"];',
      '  n0 -> n2;',
      '  n1 -> n2;',
      '}',
    ])

    expect(graph.importersOf.get('c.ts')).toEqual(['a.ts', 'b.ts'])
    expect(graph.importersOf.has('a.ts')).toBe(false)
  })

  it('reads a graph one line at a time', () => {
    const reader = createDotReader()

    reader.readLine('digraph fallow {')
    reader.readLine('  n0 [label="a.ts"];')

    expect(new Set(reader.graph().files)).toEqual(new Set(['a.ts']))

    reader.readLine('  n1 [label="b.ts"];')
    reader.readLine('  n0 -> n1;')

    expect(reader.graph().importersOf.get('b.ts')).toEqual(['a.ts'])
  })

  it('reads lines that end in a carriage return', () => {
    const graph = graphOf([
      'digraph fallow {\r',
      '  n0 [label="a.ts"];\r',
      '  n1 [label="b.ts"];\r',
      '  n0 -> n1;\r',
      '}\r',
    ])

    expect(new Set(graph.files)).toEqual(new Set(['a.ts', 'b.ts']))
    expect(graph.importersOf.get('b.ts')).toEqual(['a.ts'])
  })

  it('keeps a label holding ], ; and an arrow as a node, never an edge', () => {
    const graph = graphOf(['digraph fallow {', '  n0 [label="src/a] -> b;.ts"];', '  n1 [label="c.ts"];', '}'])

    expect(new Set(graph.files)).toEqual(new Set(['src/a] -> b;.ts', 'c.ts']))
    expect(graph.importersOf.size).toBe(0)
  })

  it('reads an edge without a trailing semicolon', () => {
    const graph = graphOf(['digraph fallow {', '  n0 [label="a.ts"];', '  n1 [label="b.ts"];', '  n0 -> n1', '}'])

    expect(graph.importersOf.get('b.ts')).toEqual(['a.ts'])
  })

  it('throws when no digraph header was seen', () => {
    const reader = createDotReader()

    reader.readLine('  n0 [label="a.ts"];')

    expect(() => reader.graph()).toThrow(/digraph/)
  })

  it('throws on an edge naming an undeclared node', () => {
    const reader = createDotReader()

    reader.readLine('digraph fallow {')
    reader.readLine('  n0 [label="a.ts"];')

    expect(() => reader.readLine('  n0 -> n9;')).toThrow('n9')
  })
})
