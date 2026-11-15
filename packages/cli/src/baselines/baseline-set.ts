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
 * the file system's call, made when the orphans are deleted. The keys of a story whose stories file didn't load are
 * unknown, so names are compared with its ID folded to NFC and lower case, and any file that could be one of its keys
 * is kept. Gives the orphans in the order given.
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
