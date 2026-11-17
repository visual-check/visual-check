#!/usr/bin/env node
import { runCli } from './commands/run-cli.js'

try {
  const result = await runCli(process.argv.slice(2), process.env, process.cwd(), {
    progress: (text) => {
      process.stderr.write(text)
    },
  })

  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)

  // The report line comes last, after both streams, so it is the run's last line.
  if (result.reportLine !== undefined) {
    const stream = result.reportLine.stream === 'stdout' ? process.stdout : process.stderr

    stream.write(`${result.reportLine.text}\n`)
  }

  process.exitCode = result.exitCode
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? String(error)) : String(error)}\n`)
  process.exitCode = 2
}
