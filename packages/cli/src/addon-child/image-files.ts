import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CheckImages } from '../commands/check-story.js'
import { type AddonImageFolder, addonImageFolders } from '../config/addon-image-folders.js'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import type { ReportImages } from '../report/report-document.js'
import { ReportError, type ReportImageBytes } from '../report/report-folder.js'

/**
 * The images of a snapshot, in the order they are written.
 */
const imageKinds = ['baseline', 'snapshot', 'diff'] as const

/**
 * Gives the folder the images' paths are relative to: `.visual-check` in the folder Storybook runs in.
 */
function folderOf({ dir }: ResolvedStorybook): string {
  return join(dir, '.visual-check')
}

/**
 * Gives an image's path relative to that folder, with `/` on every OS: `snapshots/<storybook>/<stem>.snapshot.png`,
 * `snapshots/<storybook>/<stem>.baseline.png` or `diffs/<storybook>/<stem>.png`. The suffixes keep a mode called
 * `baseline` apart from the default capture.
 */
function imagePathOf({ name }: ResolvedStorybook, stem: string, kind: keyof ReportImageBytes): string {
  const folder: AddonImageFolder = kind === 'diff' ? 'diffs' : 'snapshots'
  const fileName = kind === 'diff' ? `${stem}.png` : `${stem}.${kind}.png`

  return `${folder}/${name}/${fileName}`
}

/**
 * Gives the files of a story's images: each one's bytes, by its absolute path.
 */
function filesOf(
  storybook: ResolvedStorybook,
  images: ReadonlyMap<string, Partial<ReportImageBytes>>,
): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()

  for (const [stem, bytes] of images) {
    for (const kind of imageKinds) {
      const image = bytes[kind]

      if (image !== undefined) {
        files.set(join(folderOf(storybook), imagePathOf(storybook, stem, kind)), image)
      }
    }
  }

  return files
}

/**
 * Removes an image, or a folder with everything in it when `recursive`. A missing one is already removed.
 *
 * @throws {ReportError} When it's there but can't be removed.
 */
async function remove(path: string, recursive: boolean): Promise<void> {
  try {
    await rm(path, { recursive, force: true })
  } catch (error) {
    throw new ReportError('clear', path, error)
  }
}

/**
 * Writes an image, making its folder first.
 *
 * @throws {ReportError} When the folder or the image can't be written.
 */
async function writeImage(path: string, bytes: Uint8Array): Promise<void> {
  const folder = dirname(path)

  try {
    await mkdir(folder, { recursive: true })
  } catch (error) {
    throw new ReportError('write', folder, error)
  }

  try {
    await writeFile(path, bytes)
  } catch (error) {
    throw new ReportError('write', path, error)
  }
}

/**
 * Writes images in place of those at `last`, the new ones first, so a failure leaves as many as it can.
 *
 * @throws {ReportError} When a new image can't be written or an old one can't be removed.
 */
async function replaceFiles(last: readonly string[], files: ReadonlyMap<string, Uint8Array>): Promise<void> {
  for (const [path, bytes] of files) {
    await writeImage(path, bytes)
  }

  for (const path of last.filter((path) => !files.has(path))) {
    await remove(path, false)
  }
}

/**
 * Places the images of checks in `.visual-check` in each Storybook's folder, apart from every other Storybook's: the
 * snapshots and the baselines they were compared with in `snapshots/<storybook>/`, and the visual diffs in
 * `diffs/<storybook>/`.
 *
 * A Storybook's first replacement empties its two folders, since an earlier process may have left images there. Each
 * later one replaces the images the story's last check wrote.
 */
export function createImageFiles(): CheckImages {
  // For each Storybook whose folders were emptied, by its snapshots folder, the paths each story's images may be at.
  const pathsByStorybook = new Map<string, Map<string, string[]>>()

  /**
   * Gives the paths each story's images may be at, emptying the Storybook's folders the first time.
   *
   * @throws {ReportError} When a folder can't be removed. The next call tries again.
   */
  const pathsByStoryOf = async (storybook: ResolvedStorybook): Promise<Map<string, string[]>> => {
    const imagesIn = (folder: AddonImageFolder): string => join(folderOf(storybook), folder, storybook.name)
    const key = imagesIn('snapshots')
    const known = pathsByStorybook.get(key)

    if (known !== undefined) {
      return known
    }

    for (const folder of addonImageFolders) {
      await remove(imagesIn(folder), true)
    }

    const pathsByStory = new Map<string, string[]>()

    pathsByStorybook.set(key, pathsByStory)

    return pathsByStory
  }

  return {
    folderOf,
    pathsOf: (storybook, stem, images) => {
      const paths: ReportImages = { baseline: null, snapshot: null, diff: null, compared: null }

      for (const kind of imageKinds) {
        if (images[kind] !== undefined) {
          paths[kind] = imagePathOf(storybook, stem, kind)
        }
      }

      return paths
    },
    replace: async (storybook, storyId, images) => {
      const pathsByStory = await pathsByStoryOf(storybook)
      const files = filesOf(storybook, images)
      const last = pathsByStory.get(storyId) ?? []

      // Until the replacement is done, images of both checks may be there.
      pathsByStory.set(storyId, [...new Set([...last, ...files.keys()])])
      await replaceFiles(last, files)
      pathsByStory.set(storyId, [...files.keys()])
    },
  }
}
