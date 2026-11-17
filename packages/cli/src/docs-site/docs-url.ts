/**
 * The address of visual-check's docs site. Every link to a docs page starts with it.
 */
const docsSiteUrl = 'https://visual-check.vercel.app'

/**
 * Returns the address of a docs page, such as `https://visual-check.vercel.app/docs/ci` for `ci`.
 *
 * @public
 */
export function docsUrlOf(page: string): string {
  return `${docsSiteUrl}/docs/${page}`
}
