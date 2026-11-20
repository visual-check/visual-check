// A fake Storybook for the runner script's tests:
// `fake-storybook.mjs -p <port> --name <name> [--fail [--orphan]] [--wait <ms>]`, plus the flags the script adds. It
// records its start, then:
//
// - with `--fail`, prints `line 1` to `line 30` and exits 1. With `--orphan` too, it first starts a grandchild in a
//   process group of its own, which outlives it and holds its stdout and stderr open, as a process left behind on
//   Windows does;
// - else, after `--wait` milliseconds (none when not given), listens on 127.0.0.1 at the port (the last `-p` wins, as
//   Storybook's CLI takes it; 0 lets the system pick one). When the port is taken, it prints Storybook's EADDRINUSE
//   error and exits 1. Once listening, it serves an empty Storybook index at `/index.json`, starts a grandchild that
//   runs until the fake's tree stops, and prints a Storybook 10 started banner that names the port it got.
//
// FAKE_STORYBOOK_STARTS is the JSON-lines file it appends `{ name, argv, pid, parentPid }` to, and
// `{ name, port, childPid }` once it listens. `parentPid` is the keeper outside Windows, and `cmd.exe` on Windows.

import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'

/**
 * The fake's environment.
 */
const environment = process.env

/**
 * The JSON-lines file the fake records its starts in.
 */
const startsPath = environment.FAKE_STORYBOOK_STARTS ?? 'fake-storybook-starts.jsonl'

/**
 * The fake's arguments.
 */
const args = process.argv.slice(2)

/**
 * The value of the last `flag` in the arguments.
 *
 * @param {string} flag The flag, such as `-p`.
 * @returns {string | undefined}
 */
function lastValueOf(flag) {
  const index = args.lastIndexOf(flag)

  return index === -1 ? undefined : args[index + 1]
}

/**
 * Appends `entry` to the starts file.
 *
 * @param {Record<string, unknown>} entry The record.
 */
function record(entry) {
  appendFileSync(startsPath, `${JSON.stringify(entry)}\n`)
}

/**
 * The fake's config name.
 */
const name = lastValueOf('--name') ?? 'storybook'

/**
 * The port the fake listens on.
 */
const requestedPort = Number(lastValueOf('-p') ?? '6006')

/**
 * The box border colour of Storybook 10's banner.
 */
const border = '\x1b[38;2;255;71;133m│\x1b[39m'

record({ name, argv: args, pid: process.pid, parentPid: process.ppid })

if (args.includes('--fail')) {
  if (args.includes('--orphan')) {
    const orphan = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'inherit' })

    record({ name, childPid: orphan.pid })
    orphan.unref()
  }

  for (let line = 1; line <= 30; line += 1) {
    process.stdout.write(`line ${line}\n`)
  }

  process.exitCode = 1
} else {
  const server = createServer((request, response) => {
    if (request.url === '/index.json') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ v: 5, entries: {} }))
    } else {
      response.writeHead(404)
      response.end()
    }
  })

  server.on('error', (/** @type {NodeJS.ErrnoException} */ error) => {
    process.stderr.write(
      error.code === 'EADDRINUSE'
        ? `Error: listen EADDRINUSE: address already in use 127.0.0.1:${requestedPort}\n`
        : `Error: ${error.message}\n`,
    )
    process.exit(1)
  })

  /**
   * Listens on the port, then starts the grandchild and prints the banner.
   */
  const listen = () => {
    server.listen(requestedPort, '127.0.0.1', () => {
      const address = server.address()
      const port = address !== null && typeof address === 'object' ? address.port : requestedPort
      const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })

      record({ name, port, childPid: grandchild.pid })
      process.stdout.write(`│ ${border}   Storybook ready!   ${border}\n`)
      process.stdout.write(
        `│ ${border}   - Local:                http://127.0.0.1:${port}/                           ${border}\n`,
      )
    })
  }

  setTimeout(listen, Number(lastValueOf('--wait') ?? '0'))
}
