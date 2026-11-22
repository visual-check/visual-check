import { readFileSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'
import { type AddonChild, createAddonChild } from './addon-child/addon-child.js'
import type { AddonMessage } from './addon-child/protocol.js'

/**
 * How long closing the child may take before the process exits anyway, in milliseconds.
 */
const closeTimeout = 10_000

/**
 * Reads the version from the CLI's `package.json`.
 */
function readVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

  return manifest.version
}

/**
 * Sends a message to the process that forked this one, unless the channel to it has closed.
 */
function send(message: AddonMessage): void {
  if (process.connected) {
    // With a callback, a channel that breaks meanwhile raises no error. Its `disconnect` follows.
    process.send?.(message, undefined, undefined, () => undefined)
  }
}

/**
 * Runs the child over the process's IPC channel until a signal asks it to stop or the channel closes, which it also
 * does when the process that forked this one is killed. Closing the child then takes 10 s at most. A channel that closed
 * while this process started delivers nothing, so the process ends on its own.
 */
function runOverIpc(): void {
  let child: AddonChild | undefined
  let closing = false

  const shutDown = async (): Promise<void> => {
    if (closing) {
      return
    }

    closing = true

    try {
      await Promise.race([child?.close(), setTimeout(closeTimeout)])
    } finally {
      process.exit(0)
    }
  }

  // All of this is set up before the child says it's ready, which is when the other side may stop it.
  process.on('disconnect', shutDown)

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, shutDown)
  }

  // The pipe breaks when the process that reads it dies.
  process.stderr.on('error', () => undefined)

  child = createAddonChild({ send, version: readVersion(), cwd: process.cwd(), environment: process.env })
  process.on('message', child.receive)
}

if (process.send === undefined) {
  process.stderr.write("This is visual-check's internal entry, which its Storybook addon starts.\n")
  process.exitCode = 2
} else {
  runOverIpc()
}
