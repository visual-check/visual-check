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

try {
  const result = await runCli(process.argv.slice(2), process.env, process.cwd(), {
    progress: (text) => {
      process.stderr.write(text)
    },
  })

  // The progress written so far goes out first.
  await flushed(process.stderr, '')
  await flushed(process.stdout, result.stdout)
  await flushed(process.stderr, result.stderr)

  // The report line comes last, after both streams, so it is the run's last line.
  if (result.reportLine !== undefined) {
    const stream = result.reportLine.stream === 'stdout' ? process.stdout : process.stderr

    await flushed(stream, `${result.reportLine.text}\n`)
  }

  process.exitCode = result.exitCode
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? String(error)) : String(error)}\n`)
  process.exitCode = 2
}
