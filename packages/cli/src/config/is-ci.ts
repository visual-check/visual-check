/**
 * Whether the `CI` environment variable says this is a CI run: it is set and not empty, `0` or `false` (any case).
 *
 * @public
 */
export function isCi(environment: Record<string, string | undefined>): boolean {
  const value = environment.CI

  return value !== undefined && !['', '0', 'false'].includes(value.toLowerCase())
}
