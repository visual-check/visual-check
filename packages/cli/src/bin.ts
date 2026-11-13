#!/usr/bin/env node
import { runCli } from './commands/run-cli.js'

const result = runCli(process.argv.slice(2), process.env)
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
process.exitCode = result.exitCode
