import { logger } from 'storybook/internal/node-logger'
import type { Options } from 'storybook/internal/types'
import { storybookNameKey } from './static-commands.js'

/**
 * Names the Storybook of a config folder, as `storybookNameOf` of the CLI does.
 */
type NameOf = (options: { configDir: string; cwd: string; signal: AbortSignal }) => Promise<string>

/**
 * How long reading the config may take.
 */
const nameTimeoutMs = 30_000

/**
 * The names being read, by config folder. Storybook applies `env` several times in one build.
 */
const names = new Map<string, Promise<string>>()

/**
 * Names the Storybook with the installed CLI, which it loads only when a static build needs it.
 */
const defaultNameOf: NameOf = async (options) =>
  (await import('@visual-check/cli/internal/addon-build')).storybookNameOf(options)

/**
 * Gives the Storybook's name, or `''` when it has none or its config can't be read, which it warns about once.
 */
function nameIn(configDir: string, nameOf: NameOf): Promise<string> {
  let name = names.get(configDir)

  if (name === undefined) {
    name = nameOf({ configDir, cwd: process.cwd(), signal: AbortSignal.timeout(nameTimeoutMs) }).catch(
      (error: unknown) => {
        logger.warn(
          "visual-check couldn't name this Storybook from its config, so the static build's panel will say to run " +
            `visual-check init: ${error instanceof Error ? error.message : String(error)}`,
        )

        return ''
      },
    )
    names.set(configDir, name)
  }

  return name
}

/**
 * Gives the environment of a Storybook's manager. A static build gets the Storybook's name from visual-check's config
 * as `VISUAL_CHECK_STORYBOOK`, `''` when there is none; `storybook dev` gets the config unchanged.
 *
 * @public
 */
export async function storybookNameEnvOf(
  config: Record<string, string>,
  { configType, configDir }: Pick<Options, 'configType' | 'configDir'>,
  nameOf: NameOf = defaultNameOf,
): Promise<Record<string, string>> {
  if (configType !== 'PRODUCTION') {
    return config
  }

  return { ...config, [storybookNameKey]: await nameIn(configDir, nameOf) }
}
