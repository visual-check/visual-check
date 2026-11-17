/**
 * Writes a duration for people: `142 ms` under a second, `12.3s` under a minute, then `3m 12s`. The milliseconds are
 * rounded, a negative duration counts as none, and the tenths and seconds are cut, never rounded up.
 *
 * @public
 */
export function durationOf(ms: number): string {
  const rounded = Math.max(0, Math.round(ms))

  if (rounded < 1000) {
    return `${rounded} ms`
  }

  if (rounded < 60_000) {
    return `${(Math.floor(rounded / 100) / 10).toFixed(1)}s`
  }

  const seconds = Math.floor(rounded / 1000)

  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
