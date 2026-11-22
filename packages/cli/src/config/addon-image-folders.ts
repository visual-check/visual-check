/**
 * The folders in a Storybook's `.visual-check` where the Storybook addon writes its images. Only the addon uses them.
 *
 * @public
 */
export const addonImageFolders = ['snapshots', 'diffs'] as const

/**
 * One of those folders.
 *
 * @public
 */
export type AddonImageFolder = (typeof addonImageFolders)[number]
