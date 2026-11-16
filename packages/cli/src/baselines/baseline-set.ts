import {
  baselineFileNameOf,
  foldedFileNameOf,
  shortenedHashLength,
  shortenedPrefixBytes,
  stemOfFileName,
} from './baseline-files.js'

/**
 * The fewest bytes a shortened key's kept start has: 223, less the 3 bytes a character of up to 4 bytes can leave
 * unused when it doesn't fit.
 */
const shortestKeptStartBytes = shortenedPrefixBytes - 3

/**
 * Matches a shortened file key, `<kept start>-<16 hex characters>`, once folded, and captures the kept start.
 */
const shortenedKeyPattern = new RegExp(`^(.+)-[0-9a-f]{${shortenedHashLength}}$`, 'su')

/**
 * One Storybook's baselines folder and what its stories and config call for.
 */
interface BaselineSet {
  /**
   * The name of each baseline in the folder as listed, each ending in `.png`.
   */
  fileNames: readonly string[]
  /**
   * The keys of every snapshot the Storybook's stories and config call for, selected or not.
   */
  expectedKeys: readonly string[]
  /**
   * The IDs of the stories whose stories file failed to load or didn't load within readyTimeout. Their modes are
   * unknown.
   */
  unloadedStoryIds: readonly string[]
}

/**
 * Gives the kept start of a folded file key that has a shortened key's shape: 220 to 223 bytes, then `-` and 16 hex
 * characters. Gives `undefined` for any other key.
 */
function keptStartOf(fileKey: string): string | undefined {
  const keptStart = shortenedKeyPattern.exec(fileKey)?.[1]

  if (keptStart === undefined) {
    return undefined
  }

  const bytes = Buffer.byteLength(keptStart, 'utf8')

  return bytes >= shortestKeptStartBytes && bytes <= shortenedPrefixBytes ? keptStart : undefined
}

/**
 * Whether a folded file key could be one of a story's keys, folded too: its default capture's, the story ID, one of its
 * modes', `<story-id>.<mode>`, or either of them shortened. A shortened key keeps `<story-id>.` whole when the story ID
 * is short, which the first check catches, and otherwise keeps a start of `<story-id>.`. A key that merely starts with
 * the story ID, such as `button-group` for the story `button`, isn't.
 */
function couldBeKeyOf(fileKey: string, storyId: string): boolean {
  const modeStart = `${storyId}.`

  if (fileKey === storyId || fileKey.startsWith(modeStart)) {
    return true
  }

  const keptStart = keptStartOf(fileKey)

  return keptStart !== undefined && modeStart.startsWith(keptStart)
}

/**
 * Finds the orphans among the baselines of one Storybook's folder: each file name that isn't exactly an expected key's
 * file name and that no story whose stories file didn't load could own. A name that differs from an expected one only
 * in case or in how an accented letter is encoded is an orphan here. Whether it's that baseline under another name is
 * the file system's call, made when the orphans are planned and again when they are deleted. The keys of a story whose
 * stories file didn't load are unknown, so names are compared with its ID folded for case and encoding, and any file
 * that could be one of its keys is kept. Gives the orphans in the order given.
 *
 * @public
 */
export function orphansOf({ fileNames, expectedKeys, unloadedStoryIds }: BaselineSet): string[] {
  const expected = new Set(expectedKeys.map((key) => baselineFileNameOf(key)))
  const unloaded = unloadedStoryIds.map(foldedFileNameOf)

  return fileNames.filter((fileName) => {
    const fileKey = stemOfFileName(foldedFileNameOf(fileName))

    return !expected.has(fileName) && !unloaded.some((storyId) => couldBeKeyOf(fileKey, storyId))
  })
}

/**
 * Gives the stories that could own a baseline, by its folded file key, from the stories' IDs grouped by their folded
 * form. It's `couldBeKeyOf`'s rule without a scan of every story: a key that isn't shortened could only be a story ID
 * or start with `<story-id>.`, so the whole key and each start of it that ends just before a `.` are looked up. Only a
 * key with a shortened key's shape is checked against every story.
 */
function ownersOf(fileKey: string, storyIdsByFoldedId: ReadonlyMap<string, readonly string[]>): string[] {
  if (keptStartOf(fileKey) !== undefined) {
    return [...storyIdsByFoldedId]
      .filter(([foldedId]) => couldBeKeyOf(fileKey, foldedId))
      .flatMap(([, storyIds]) => storyIds)
  }

  const owners = [...(storyIdsByFoldedId.get(fileKey) ?? [])]

  for (let dot = fileKey.indexOf('.'); dot !== -1; dot = fileKey.indexOf('.', dot + 1)) {
    owners.push(...(storyIdsByFoldedId.get(fileKey.slice(0, dot)) ?? []))
  }

  return owners
}

/**
 * Counts the baselines each story of one Storybook could own, by their file names in its baselines folder. A baseline
 * counts for a story when its name, folded for case and encoding, could be one of the story's keys, folded too: the
 * story ID, `<story-id>.<mode>`, or either of them shortened. A key that merely starts with the story ID, such as
 * `button-group` for the story `button`, doesn't count, and an orphan counts for no story. A baseline counts for every
 * story that could own it, so it can count for more than one, such as for two story IDs that fold the same. Gives a
 * count, 0 included, for every story ID given.
 *
 * @public
 */
export function baselineCountsOf(fileNames: readonly string[], storyIds: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  const storyIdsByFoldedId = new Map<string, string[]>()

  for (const storyId of new Set(storyIds)) {
    const foldedId = foldedFileNameOf(storyId)

    const sameFoldedId = storyIdsByFoldedId.get(foldedId)

    counts.set(storyId, 0)

    if (sameFoldedId === undefined) {
      storyIdsByFoldedId.set(foldedId, [storyId])
    } else {
      sameFoldedId.push(storyId)
    }
  }

  for (const fileName of fileNames) {
    for (const storyId of ownersOf(stemOfFileName(foldedFileNameOf(fileName)), storyIdsByFoldedId)) {
      counts.set(storyId, (counts.get(storyId) ?? 0) + 1)
    }
  }

  return counts
}
