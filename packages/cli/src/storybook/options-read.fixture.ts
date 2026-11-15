import { runInThisContext } from 'node:vm'
import { optionsEncoderSource } from './options-encoding.js'

/**
 * The page's own encoder, run in this realm, so the plain objects a test builds count as plain, as the page's own do
 * in the page.
 */
const encode = runInThisContext(optionsEncoderSource) as (value: unknown) => unknown

/**
 * One stories file as a test describes what the page read of it: its stories' options as JS values when it loaded,
 * or how it went otherwise.
 */
type FileRead =
  | {
      /**
       * The path of the stories file.
       */
      importPath: string
      /**
       * Each story's ID and options, in order.
       */
      stories: { id: string; options: unknown }[]
    }
  | {
      /**
       * The path of the stories file.
       */
      importPath: string
      /**
       * The file failed to load.
       */
      outcome: 'failed'
      /**
       * One line saying why.
       */
      message: string
    }
  | {
      /**
       * The path of the stories file.
       */
      importPath: string
      /**
       * The file's stories didn't load within the time limit.
       */
      outcome: 'timed-out'
    }

/**
 * Builds what the options read in the page answers once it read these stories files, as it crosses to Node: each
 * loaded file's options encoded by the page's own encoder, and passed through JSON.
 *
 * @public
 */
export function optionsReadAnswer(files: readonly FileRead[]): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify({
      outcome: 'read',
      files: files.map((file) =>
        'stories' in file
          ? {
              importPath: file.importPath,
              outcome: 'loaded',
              stories: file.stories.map(({ id, options }) => ({ id, options: encode(options) })),
            }
          : file,
      ),
    }),
  )
}
