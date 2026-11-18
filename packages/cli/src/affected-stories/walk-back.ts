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

/**
 * Gives the files that changing any file under the given folders can alter: every graph file under one of the folders,
 * plus every file that imports one of them, directly or through other files. A folder covers whole path segments, so
 * `packages/ui` covers `packages/ui/a.ts` but not `packages/ui-kit/a.ts`. Folders are relative to the project root,
 * `/`-separated, without a trailing slash. It makes one pass over the graph's files.
 */
export function filesReachedFromFolders(graph: ImportGraph, folders: readonly string[]): Set<string> {
  if (folders.length === 0) {
    return new Set()
  }

  const prefixes = folders.map((folder) => `${folder}/`)
  const filesUnder: string[] = []

  for (const file of graph.files) {
    if (prefixes.some((prefix) => file.startsWith(prefix))) {
      filesUnder.push(file)
    }
  }

  return filesReachedFrom(graph, filesUnder)
}
