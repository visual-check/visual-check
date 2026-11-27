import { dirname, join } from 'node:path'
import type { Platform } from '../config/define-config.js'
import { isJsonObject, type Manifest, scriptsOf } from '../init/package-manager.js'
import { readJsonFile } from '../init/workspace.js'
import type { LocalUpdate } from '../step-summary/step-summary.js'

/**
 * The command a script must run, after trimming, to be the one the step summary names.
 */
const updateCommand = 'visual-check update'

/**
 * What a script's name must not hold for the step summary to name it: a backtick or a line break, the only characters
 * that break a Markdown code span.
 */
const codeSpanBreaker = /[`\r\n]/

/**
 * Gives the name of the manifest's first script, in order, whose command is exactly `visual-check update` after
 * trimming and whose name holds no backtick or line break, so it fits in a code span as written, or `undefined` when
 * none is.
 *
 * @public
 */
export function updateScriptOf(manifest: Manifest): string | undefined {
  const found = Object.entries(scriptsOf(manifest)).find(([name, command]) => {
    return command.trim() === updateCommand && !codeSpanBreaker.test(name)
  })

  return found?.[0]
}

/**
 * Gives how the person updates the baselines on their machine: the script in the `package.json` beside the config
 * that runs `visual-check update`, none when that file is missing or isn't valid JSON, and whether the browser runs in
 * Docker, which it does on every platform but `host`. For a setup `init` made, that `package.json` is the workspace
 * root's, where `init` wrote the scripts. With `--config` naming a config in a subfolder, or a config above the
 * workspace root, it usually holds no such script, and the summary names plain `visual-check update`.
 *
 * @public
 */
export function localUpdateOf(configPath: string, platform: Platform): LocalUpdate {
  const manifest = readJsonFile(join(dirname(configPath), 'package.json'))

  return { script: isJsonObject(manifest) ? updateScriptOf(manifest) : undefined, docker: platform !== 'host' }
}
