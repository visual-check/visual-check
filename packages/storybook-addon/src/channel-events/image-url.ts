/**
 * The path images are served under, relative to the Storybook's address.
 *
 * @public
 */
export const imagesPath = '__visual-check/images'

/**
 * A URL under that path, with whatever path is in front. The group is the part after it.
 */
const imagePattern = new RegExp(`^(?:[^?#]*?/)??${imagesPath}/([^?#]*)`)

/**
 * Decodes a segment of a URL's path, or gives `undefined` when it doesn't decode, is empty, or is `.` or `..`.
 */
function decodeSegment(segment: string): string | undefined {
  try {
    const decoded = decodeURIComponent(segment)

    return ['', '.', '..'].includes(decoded) ? undefined : decoded
  } catch {
    return undefined
  }
}

/**
 * Gives the URL of a result's image, by the path its snapshot lists. It's relative to the Storybook's address, so it
 * works behind a path prefix.
 *
 * @public
 */
export function imageUrlOf(resultId: string, path: string): string {
  return [imagesPath, ...[resultId, ...path.split('/')].map(encodeURIComponent)].join('/')
}

/**
 * Whether the URL of a request is under the images' path, whatever path prefix is in front.
 *
 * @public
 */
export function isImageUrl(url: string): boolean {
  return imagePattern.test(url)
}

/**
 * Reads the result's ID and the image's path from the URL of a request, whatever path prefix is in front. Gives
 * `undefined` for a URL `imageUrlOf` can't have made: one that isn't under the images' path, or with a segment that
 * doesn't decode, is empty, or is `.` or `..`.
 *
 * @public
 */
export function readImageUrl(url: string): { id: string; path: string } | undefined {
  const segments = imagePattern.exec(url)?.[1]?.split('/').map(decodeSegment) ?? []
  const [id, ...path] = segments.filter((segment) => segment !== undefined)

  if (id === undefined || path.length === 0 || segments.includes(undefined)) {
    return undefined
  }

  return { id, path: path.join('/') }
}
