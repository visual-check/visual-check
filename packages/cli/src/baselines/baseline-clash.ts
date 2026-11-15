import { baselineFileNameOf, foldedFileNameOf } from './baseline-files.js'

/**
 * Two snapshots whose baselines would be one file, and that file's name.
 *
 * @public
 */
export interface BaselineClash<Snapshot> {
  /**
   * The snapshot that comes first in the order given.
   */
  first: Snapshot
  /**
   * The later snapshot whose baseline would be the first one's file.
   */
  second: Snapshot
  /**
   * The first snapshot's baseline file name, shortened when its key is long.
   */
  fileName: string
}

/**
 * Finds the first two snapshots of one Storybook whose baselines would be one file: their file names, shortened when
 * long, are equal once folded for case and for how an accented letter is encoded, as macOS and Windows fold them. Gives
 * the clash whose later snapshot comes first in the order given, or `undefined` when every snapshot has a file of its
 * own.
 *
 * @public
 */
export function findBaselineClash<Snapshot extends { key: string }>(
  snapshots: readonly Snapshot[],
): BaselineClash<Snapshot> | undefined {
  const byFileName = new Map<string, { snapshot: Snapshot; fileName: string }>()

  for (const snapshot of snapshots) {
    const fileName = baselineFileNameOf(snapshot.key)
    const folded = foldedFileNameOf(fileName)
    const first = byFileName.get(folded)

    if (first !== undefined) {
      return { first: first.snapshot, second: snapshot, fileName: first.fileName }
    }

    byFileName.set(folded, { snapshot, fileName })
  }

  return undefined
}
