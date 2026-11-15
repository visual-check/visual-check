import { runInNewContext, runInThisContext } from 'node:vm'
import { optionsEncoderSource } from './options-encoding.js'
import type { StoriesFile } from './options-read.js'
import { stateGlobal } from './preview-script.js'

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
       * Each story's ID and options, in order, each with the globals it pins, none when not given.
       */
      stories: { id: string; options: unknown; pinnedGlobals?: string[] }[]
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
 * Builds what the options read in the page answers once it read these stories files, as it crosses to Node: the
 * Storybook's declared globals, `null` (unknown) when not given, and each loaded file's options encoded by the page's
 * own encoder, and passed through JSON.
 *
 * @public
 */
export function optionsReadAnswer(
  files: readonly FileRead[],
  declaredGlobals: readonly string[] | null = null,
): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify({
      outcome: 'read',
      declaredGlobals,
      files: files.map((file) =>
        'stories' in file
          ? {
              importPath: file.importPath,
              outcome: 'loaded',
              stories: file.stories.map(({ id, options, pinnedGlobals = [] }) => ({
                id,
                options: encode(options),
                pinnedGlobals,
              })),
            }
          : file,
      ),
    }),
  )
}

/**
 * Answers the options read as the page would where every file loads, no story has options or pins a global, and the
 * Storybook's declared globals can't be read.
 */
function everyFileLoaded(files: readonly StoriesFile[]): Record<string, unknown> {
  return optionsReadAnswer(
    files.map(({ importPath, storyIds }) => ({
      importPath,
      stories: storyIds.map((id) => ({ id, options: undefined })),
    })),
  )
}

/**
 * Answers an options read expression by running the real expression against a page script whose read gives what
 * `answer` builds from the files the expression asks for. By default it answers as the page would where every file
 * loads, no story has options or pins a global, and the Storybook's declared globals can't be read.
 *
 * @public
 */
export async function answerOptionsReadExpression(
  expression: string,
  answer: (files: StoriesFile[]) => unknown = everyFileLoaded,
): Promise<unknown> {
  const state = {
    readOptions: async (files: StoriesFile[]) => answer(files),
  }

  return await runInNewContext(expression, { [stateGlobal]: state })
}
