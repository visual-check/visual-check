import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The fake browser's script. It writes a line to stdout and one to stderr, copies its fd 3 to its fd 4, and exits 0
 * once fd 3 has ended and everything is copied.
 */
const fakeBrowserScript = `#!/usr/bin/env node
const fs = require('node:fs')
console.log('to stdout')
console.error('to stderr')
const input = fs.createReadStream(null, { fd: 3 })
const output = fs.createWriteStream(null, { fd: 4 })
input.pipe(output)
output.on('finish', () => process.exit(0))
`

/**
 * The lines that make the fake browser start a grandchild, as Chromium's helper processes are, which inherits its
 * stdout and stderr and sleeps for 30 s.
 */
const grandchildScript = `require('node:child_process').spawn('sleep', ['30'], { stdio: 'inherit' }).unref()
`

/**
 * What the fake browser does besides copying its CDP pipe.
 */
export interface FakeBrowserOptions {
  /**
   * Whether the browser starts a grandchild that inherits its stdout and stderr and sleeps for 30 s. False by default.
   */
  withGrandchild?: boolean
}

/**
 * A fake browser executable and the profile folder its start names.
 */
export interface FakeBrowser {
  /**
   * The path of the fake browser's executable.
   */
  executable: string
  /**
   * A profile folder with a file in it, which exists until the starter removes it.
   */
  profileDir: string
  /**
   * Removes the temporary folder that holds the executable and the profile folder.
   */
  remove: () => void
}

/**
 * Writes a fake browser executable in a new temporary folder, with a profile folder beside it.
 */
export function createFakeBrowser(options: FakeBrowserOptions = {}): FakeBrowser {
  const folder = mkdtempSync(join(tmpdir(), 'visual-check-fake-browser-'))
  const executable = join(folder, 'fake-browser')
  const profileDir = join(folder, 'profile')

  writeFileSync(
    executable,
    options.withGrandchild === true
      ? fakeBrowserScript.replace('const fs', `${grandchildScript}const fs`)
      : fakeBrowserScript,
  )
  chmodSync(executable, 0o755)
  mkdirSync(profileDir)
  writeFileSync(join(profileDir, 'Preferences'), '{}')

  return { executable, profileDir, remove: () => rmSync(folder, { recursive: true, force: true }) }
}
