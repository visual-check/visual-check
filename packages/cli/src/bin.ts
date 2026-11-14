#!/usr/bin/env node
import { runCli } from './commands/run-cli.js'

try {
  const result = await runCli(process.argv.slice(2), process.env, process.cwd())
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? String(error)) : String(error)}\n`)
  process.exitCode = 2
}
