import { BrowserDownloadError } from './browser-download-error.js'

/**
 * The port a URL connects to: the one it names, or its scheme's default.
 */
export function portOf(url: URL): number {
  if (url.port !== '') {
    return Number(url.port)
  }

  return url.protocol === 'https:' ? 443 : 80
}

/**
 * The value of the first variable that is set and not empty, with its name.
 */
function firstSet(
  environment: Record<string, string | undefined>,
  names: string[],
): { name: string; value: string } | undefined {
  for (const name of names) {
    const value = environment[name]

    if (value !== undefined && value !== '') {
      return { name, value }
    }
  }

  return undefined
}

/**
 * A host without the brackets a URL puts around an IPv6 address, as Node's sockets take it, so `[::1]` and `::1`
 * compare equal.
 */
export function unbracketed(host: string): string {
  return host.replace(/^\[(.*)\]$/, '$1')
}

/**
 * Whether one `NO_PROXY` entry, already trimmed and lower-cased, covers the host and port. `*` covers every host. A
 * name covers itself and its subdomains, with or without a leading dot. A `:port` limits the entry to that port.
 */
function covers(entry: string, host: string, port: number): boolean {
  if (entry === '*') {
    return true
  }

  // A port follows a name or a bracketed IPv6 address. A bare IPv6 address has colons of its own and no port.
  const withPort = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(entry)
  const name = unbracketed(withPort?.[1] ?? entry).replace(/^\./, '')

  if (withPort?.[2] !== undefined && Number(withPort[2]) !== port) {
    return false
  }

  return host === name || host.endsWith(`.${name}`)
}

/**
 * Whether the text decodes as percent-encoding, as a proxy's user name and password must for its `Proxy-Authorization`.
 */
function decodes(text: string): boolean {
  try {
    decodeURIComponent(text)

    return true
  } catch {
    return false
  }
}

/**
 * Reads a proxy variable's value as a URL. A value without a scheme is read as `http://<value>`.
 *
 * @throws {BrowserDownloadError} Naming the variable, when the value isn't an `http://` URL, or its user name or
 * password has a `%` that isn't encoded. The value itself isn't printed, since it can hold credentials.
 */
function proxyUrlOf(name: string, value: string): URL {
  const text = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`
  const proxy = URL.canParse(text) ? new URL(text) : undefined

  if (proxy?.protocol !== 'http:') {
    throw new BrowserDownloadError(
      `The proxy in ${name} must be an http:// URL, such as http://proxy.example.com:3128.`,
    )
  }

  if (!decodes(proxy.username) || !decodes(proxy.password)) {
    throw new BrowserDownloadError(
      `The proxy in ${name} has a % in its user name or password that isn't encoded. Write it as %25.`,
    )
  }

  return proxy
}

/**
 * Gives the proxy a download from the URL goes through, from the environment. An https URL uses `HTTPS_PROXY`, else
 * `https_proxy`, unless `NO_PROXY`, else `no_proxy`, covers its host. An http URL, only ever a local mirror or a test,
 * goes directly. An empty variable counts as unset.
 *
 * @throws {BrowserDownloadError} Naming the variable, when the proxy it holds isn't an `http://` URL or has a `%` in
 * its credentials that isn't encoded.
 */
export function proxyFor(url: URL, environment: Record<string, string | undefined>): URL | undefined {
  if (url.protocol !== 'https:') {
    return undefined
  }

  const variable = firstSet(environment, ['HTTPS_PROXY', 'https_proxy'])

  if (variable === undefined) {
    return undefined
  }

  const host = unbracketed(url.hostname.toLowerCase())
  const port = portOf(url)
  const entries = (firstSet(environment, ['NO_PROXY', 'no_proxy'])?.value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '')

  if (entries.some((entry) => covers(entry, host, port))) {
    return undefined
  }

  return proxyUrlOf(variable.name, variable.value)
}
