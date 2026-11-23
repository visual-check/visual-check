import { describe, expect, it } from 'vitest'
import { versionProblemOf } from './version-mismatch.js'

/**
 * The sentence every problem starts with, for these versions.
 */
function opening(addon: string, cli: string): string {
  return (
    `The Storybook addon is @visual-check/storybook-addon ${addon} and runs @visual-check/cli ${cli}, ` +
    'but they run only at one version.'
  )
}

describe('versionProblemOf', () => {
  it('finds no problem in one version', () => {
    expect(versionProblemOf('1.2.3', '1.2.3')).toBeUndefined()
    expect(versionProblemOf('0.1.0-local.20261123090507', '0.1.0-local.20261123090507')).toBeUndefined()
  })

  it('names the CLI when it is older', () => {
    expect(versionProblemOf('1.3.0', '1.2.3')).toBe(
      `${opening('1.3.0', '1.2.3')} Upgrade @visual-check/cli to 1.3.0, then restart Storybook.`,
    )
  })

  it('names the addon when it is older', () => {
    expect(versionProblemOf('1.2.0', '1.2.3')).toBe(
      `${opening('1.2.0', '1.2.3')} Upgrade @visual-check/storybook-addon to 1.2.3, then restart Storybook.`,
    )
  })

  it.each([
    { older: '1.2.3-beta.1', newer: '1.2.3' },
    { older: '1.2.3-beta.2', newer: '1.2.3-beta.10' },
    { older: '1.2.3-1', newer: '1.2.3-alpha' },
    { older: '1.2.3-alpha', newer: '1.2.3-alpha.1' },
    { older: '1.2.3-alpha.beta', newer: '1.2.3-beta' },
    { older: '1.9.9', newer: '1.10.0' },
    { older: '0.1.0-local.20261123090507', newer: '0.1.0-local.20261123090508' },
  ])('orders $older before $newer', ({ older, newer }) => {
    expect(versionProblemOf(newer, older)).toMatch(/Upgrade @visual-check\/cli to /)
    expect(versionProblemOf(older, newer)).toMatch(/Upgrade @visual-check\/storybook-addon to /)
  })

  it.each([
    { addon: '1.2.3+a', cli: '1.2.3+b' },
    { addon: '1.2.3', cli: 'junk' },
    { addon: '1.2', cli: '1.2.3' },
    { addon: '01.2.3', cli: '1.2.3' },
  ])('says to install one version when $addon and $cli can not be ordered', ({ addon, cli }) => {
    expect(versionProblemOf(addon, cli)).toBe(
      `${opening(addon, cli)} Install one version of both, then restart Storybook.`,
    )
  })
})
