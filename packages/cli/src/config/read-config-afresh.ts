import { ConfigError } from './config-error.js'
import { askConfigThread } from './config-thread.js'
import type { Config } from './define-config.js'
import { displayPathOf, loadErrorOf } from './load-config.js'

/**
 * Reads a config as `readConfig` does, in a thread of its own. Node's own loader keeps the first version of a file for
 * the life of a thread, so every file the config imports is read as it is now, also in a process that lives for hours.
 * What the config does stays in the thread: a timer it starts ends with it and, unlike with `loadConfig`, a change it
 * makes to `process.env` doesn't reach this process.
 *
 * @throws {ConfigError} As `readConfig` does, with the same message, and when the config stops its thread, waits for a
 * promise that never settles or throws outside its own run.
 * @throws {unknown} The signal's reason, when it aborts first. The thread is stopped then, even one that spins.
 */
export async function readConfigAfresh(path: string, cwd: string, signal?: AbortSignal): Promise<Config> {
  signal?.throwIfAborted()

  const reply = await askConfigThread(path, cwd, signal).catch((error: unknown) => {
    signal?.throwIfAborted()
    throw loadErrorOf(error, path, displayPathOf(path, cwd))
  })

  if ('unsettled' in reply) {
    throw loadErrorOf('it waits for a promise that never settles.', path, displayPathOf(path, cwd))
  }

  if ('error' in reply) {
    throw reply.error.isConfigError ? new ConfigError(reply.error.message) : new Error(reply.error.message)
  }

  return reply.config
}
