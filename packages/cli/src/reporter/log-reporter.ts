import type { RunEvent, RunReporter } from './run-event.js'

/**
 * Builds the `log` reporter, which appends and never redraws: at `planned` it writes the header, then a shard's notes,
 * and as each snapshot finishes its line, so lines come in the order the snapshots finish. Each ends with a newline.
 * It writes nothing when a snapshot starts, and nothing at the end.
 *
 * @public
 */
export function logReporterOf(write: (text: string) => void): RunReporter {
  return {
    event: (event: RunEvent) => {
      if (event.kind === 'planned') {
        for (const line of [event.header, ...event.notes]) {
          write(`${line}\n`)
        }
      }

      if (event.kind === 'finished') {
        write(`${event.line}\n`)
      }
    },
    finish: async () => undefined,
  }
}
