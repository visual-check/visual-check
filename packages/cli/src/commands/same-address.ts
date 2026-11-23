/**
 * A host name that always means the machine itself, as `URL` writes it: `localhost`, `127.*` or `[::1]`.
 */
const loopbackName = /^(localhost|127(\.\d+){3}|\[::1\])$/

/**
 * Whether two hosts, as `URL` writes them, are the same, or both mean the machine itself.
 */
function isSameHost(one: string, other: string): boolean {
  return one === other || (loopbackName.test(one) && loopbackName.test(other))
}

/**
 * Gives a URL's path without a trailing slash, as one Storybook answers with and without it.
 */
function pathOf(url: URL): string {
  return url.pathname.replace(/\/$/, '')
}

/**
 * Whether two URLs are one address: the same protocol, port and path, whether or not it ends with a slash, and the same
 * host or two loopback names. A URL that doesn't parse is no address, so it's different from any other.
 */
export function isSameAddress(one: string, other: string): boolean {
  if (!URL.canParse(one) || !URL.canParse(other)) {
    return false
  }

  const first = new URL(one)
  const second = new URL(other)

  return (
    first.protocol === second.protocol &&
    first.port === second.port &&
    pathOf(first) === pathOf(second) &&
    isSameHost(first.hostname, second.hostname)
  )
}
