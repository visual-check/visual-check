import { describe, expect, it } from 'vitest'
import { type Reporter, reporterOf } from './reporter-choice.js'

describe('reporterOf', () => {
  const flags: Reporter[] = ['json', 'log', 'live']

  it.each(flags.flatMap((flag) => [true, false].flatMap((ci) => [true, false].map((tty) => ({ flag, ci, tty })))))(
    'gives the flag $flag with ci $ci and tty $tty',
    ({ flag, ci, tty }) => {
      expect(reporterOf(flag, { ci, tty })).toBe(flag)
    },
  )

  it.each([
    { ci: true, tty: true, expected: 'log' },
    { ci: true, tty: false, expected: 'log' },
    { ci: false, tty: false, expected: 'log' },
    { ci: false, tty: true, expected: 'live' },
  ])('gives $expected with no flag, ci $ci and tty $tty', ({ ci, tty, expected }) => {
    expect(reporterOf(undefined, { ci, tty })).toBe(expected)
  })
})
