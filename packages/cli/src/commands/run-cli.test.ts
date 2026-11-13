import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runCli } from './run-cli.js'

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string
}

describe('runCli', () => {
  it('prints the package version for --version', () => {
    expect(runCli(['--version'], {})).toEqual({ exitCode: 0, stdout: `${version}\n`, stderr: '' })
  })

  it('exits 2 with usage when no command is given', () => {
    expect(runCli([], {})).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: 'No command given.\nUsage: visual-check --version\n',
    })
  })

  it('exits 2 with the parse error and usage for an unknown flag', () => {
    const result = runCli(['--nope'], {})
    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain("Unknown option '--nope'")
    expect(result.stderr.endsWith('Usage: visual-check --version\n')).toBe(true)
  })
})
