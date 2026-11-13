import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const binPath = fileURLToPath(new URL('../dist/bin.js', import.meta.url))
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

const run = (...args: string[]) => spawnSync(process.execPath, [binPath, ...args], { encoding: 'utf8' })

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
