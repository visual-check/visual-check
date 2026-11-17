#!/usr/bin/env node
import { runCli } from './commands/run-cli.js'

/**
 * Writes `text` to the stream and waits until it is flushed. Writes to a pipe are asynchronous on macOS, so a write to
 * the other stream could otherwise overtake it when both share one pipe, as with `2>&1`.
 */
function flushed(stream: NodeJS.WriteStream, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(text, (error) => {
      if (error) {
        reject(error)

        return
      }

      resolve()
    })
  })
}

/**
 * The writes made so far, the progress and the run's lines, each waiting until the one before is flushed, so their
 * order holds across the two streams.
 */
let written: Promise<void> = Promise.resolve()

/**
 * Writes `text` to the stream once every earlier write is flushed.
 */
function writeInOrder(stream: NodeJS.WriteStream, text: string): void {
  written = written.then(() => flushed(stream, text))
  // A failed write rejects the chain's tail, which the exit awaits; this keeps it from being an unhandled rejection.
  written.catch(() => undefined)
}

try {
  const result = await runCli(process.argv.slice(2), process.env, process.cwd(), {
    progress: (text) => {
      writeInOrder(process.stderr, text)
    },
    write: (stream, text) => {
      writeInOrder(process[stream], text)
    },
  })

  // The progress and lines written so far go out first.
  await written
  await flushed(process.stdout, result.stdout)
  await flushed(process.stderr, result.stderr)

  // The report line comes last, after both streams, so it is the run's last line.
  if (result.reportLine !== undefined) {
    const stream = result.reportLine.stream === 'stdout' ? process.stdout : process.stderr

    await flushed(stream, `${result.reportLine.text}\n`)
  }

  process.exitCode = result.exitCode
} catch (error) {
  // The lines queued so far go out before the error.
  await written.catch(() => undefined)
  process.stderr.write(`${error instanceof Error ? (error.stack ?? String(error)) : String(error)}\n`)
  process.exitCode = 2
}
