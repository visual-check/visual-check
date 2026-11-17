import type { ImportGraph } from './import-graph.js'

/**
 * Gives the files that changing the given files can alter: each changed file in the graph plus every file that
 * imports one of them, directly or through other files. A changed file the graph doesn't hold is left out. Visits each
 * file once, so import cycles end.
 */
export function filesReachedFrom(graph: ImportGraph, changedFiles: Iterable<string>): Set<string> {
  const reached = new Set<string>()
  const queue: string[] = []

  for (const file of changedFiles) {
    if (graph.files.has(file) && !reached.has(file)) {
      reached.add(file)
      queue.push(file)
    }
  }

  // Iterating an array visits the files pushed during the loop, which makes the queue.
  for (const file of queue) {
    for (const importer of graph.importersOf.get(file) ?? []) {
      if (!reached.has(importer)) {
        reached.add(importer)
        queue.push(importer)
      }
    }
  }

  return reached
}
