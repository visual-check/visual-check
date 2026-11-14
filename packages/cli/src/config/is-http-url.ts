/**
 * Whether a value is a string that parses as an `http:` or `https:` URL.
 *
 * @public
 */
export function isHttpUrl(value: unknown): boolean {
  return typeof value === 'string' && URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol)
}
