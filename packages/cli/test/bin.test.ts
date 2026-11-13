import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const binaryPath = fileURLToPath(new URL('../dist/bin.js', import.meta.url))
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * Runs the built binary with the given command-line arguments and returns the spawned process's result.
 */
const run = (...commandLineArguments: string[]) =>
  spawnSync(process.execPath, [binaryPath, ...commandLineArguments], { encoding: 'utf8' })

describe('visual-check binary', () => {
  it('prints the package version for --version', () => {
    const result = run('--version')
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`${version}\n`)
  })

  it('exits 2 with usage on stderr for an unknown flag', () => {
    const result = run('--nope')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Usage: visual-check --version')
  })
})
