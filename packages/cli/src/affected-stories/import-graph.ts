/**
 * Which project files import which, as Fallow's graph gives them.
 */
export interface ImportGraph {
  /**
   * Every file in the graph, as a path relative to the project root, `/`-separated.
   */
  files: ReadonlySet<string>
  /**
   * For each file that something imports, the files that import it directly. A file nothing imports has no entry.
   */
  importersOf: ReadonlyMap<string, readonly string[]>
}

/**
 * Builds an import graph from the lines of Fallow's DOT output, given one at a time.
 */
export interface DotReader {
  /**
   * Reads one line of the DOT output. Throws when an edge names a node no earlier line declared.
   */
  readLine(line: string): void
  /**
   * Gives the graph. Meant to be called once every line is read: the graph holds the reader's own set and map, not a
   * copy, so lines read afterwards show up in it. Throws when none of the lines read was a `digraph` header.
   */
  graph(): ImportGraph
}

/**
 * Matches the `digraph` header line.
 */
const headerPattern = /^\s*digraph\b/

/**
 * Matches a node line such as `n0 [label="src/a.ts", ...];`, capturing the node's ID and its escaped label.
 */
const nodePattern = /^\s*(n\d+)\s+\[label="((?:[^"\\]|\\.)*)"/

/**
 * Matches an edge line such as `n0 -> n1;`, capturing the importer's and the imported file's node IDs.
 */
const edgePattern = /^\s*(n\d+)\s*->\s*(n\d+)\s*;?\s*$/

/**
 * Turns a DOT label's escapes, `\"` and `\\`, back into the characters they stand for.
 */
function unescapeLabel(label: string): string {
  return label.replace(/\\(["\\])/g, '$1')
}

/**
 * Reads the lines of one DOT graph into the files and importers it names.
 */
class DotReaderState implements DotReader {
  /**
   * The path each declared node's label gives, by node ID.
   */
  private readonly pathOfNode = new Map<string, string>()
  /**
   * Every file declared so far.
   */
  private readonly files = new Set<string>()
  /**
   * The direct importers of each imported file, in the order their edges came.
   */
  private readonly importersOf = new Map<string, string[]>()
  /**
   * Whether a `digraph` header line came.
   */
  private sawHeader = false

  /**
   * Reads one line of the DOT output, as `DotReader.readLine` describes.
   */
  readLine(line: string): void {
    if (headerPattern.test(line)) {
      this.sawHeader = true

      return
    }

    const [, nodeId, label] = nodePattern.exec(line) ?? []

    if (nodeId !== undefined && label !== undefined) {
      this.declare(nodeId, unescapeLabel(label))

      return
    }

    const [, importerId, importedId] = edgePattern.exec(line) ?? []

    if (importerId !== undefined && importedId !== undefined) {
      this.connect(importerId, importedId)
    }
  }

  /**
   * Gives the reader's own files and importers, as `DotReader.graph` describes.
   */
  graph(): ImportGraph {
    if (!this.sawHeader) {
      throw new Error("Fallow's graph has no digraph header.")
    }

    return { files: this.files, importersOf: this.importersOf }
  }

  /**
   * Records that the node is the file at the path.
   */
  private declare(nodeId: string, path: string): void {
    this.pathOfNode.set(nodeId, path)
    this.files.add(path)
  }

  /**
   * Records that the importer's file imports the imported node's file. Throws when either node is undeclared.
   */
  private connect(importerId: string, importedId: string): void {
    const importer = this.pathOfNode.get(importerId)
    const imported = this.pathOfNode.get(importedId)

    if (importer === undefined || imported === undefined) {
      const undeclaredId = importer === undefined ? importerId : importedId

      throw new Error(`Fallow's graph has an edge naming the undeclared node ${undeclaredId}.`)
    }

    const importers = this.importersOf.get(imported)

    if (importers) {
      importers.push(importer)
    } else {
      this.importersOf.set(imported, [importer])
    }
  }
}

/**
 * Starts a reader with an empty graph. The reader ignores every line that is not a node or an edge, and expects each
 * node line before the edges that name it, as Fallow writes them.
 */
export function createDotReader(): DotReader {
  return new DotReaderState()
}
