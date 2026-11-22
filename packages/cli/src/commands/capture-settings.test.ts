import { describe, expect, it } from 'vitest'
import { captureSettingsOf } from './capture-settings.js'

/**
 * The config's fields a session's settings come from.
 */
const config = {
  readyTimeout: 12_000,
  timezone: 'Europe/Warsaw',
  locale: 'pl-PL',
  colorScheme: 'dark',
  maskColor: '#00FF00',
} as const

describe('captureSettingsOf', () => {
  it("takes the settings from the config, with the time limit of a broken story's image", () => {
    expect(captureSettingsOf(config, false)).toEqual({
      readyTimeoutMs: 12_000,
      timezone: 'Europe/Warsaw',
      locale: 'pl-PL',
      colorScheme: 'dark',
      maskColor: '#00FF00',
      listHosts: false,
      brokenImageTimeLimitMs: 5_000,
    })
  })

  it('lists the hosts a story reaches when asked to', () => {
    expect(captureSettingsOf(config, true).listHosts).toBe(true)
  })
})
