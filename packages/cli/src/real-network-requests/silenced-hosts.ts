/**
 * Whether the entry silences the host. Both are compared in lower case. An exact entry silences the host it names, with
 * or without a port: it matches the host as a page reports it, such as `localhost:6006`, and its hostname, such as
 * `localhost`. `*.example.com` silences the subdomains of `example.com` at any depth, by the host or its hostname, so
 * `*.example.com:8443` works too, but not `example.com` itself or a host that only ends the same, such as
 * `badexample.com`.
 */
function silences(entry: string, host: string): boolean {
  const lowerEntry = entry.toLowerCase()
  const lowerHost = host.toLowerCase()
  const hostname = lowerHost.replace(/:\d+$/, '')

  if (lowerEntry.startsWith('*.')) {
    const suffix = lowerEntry.slice(1)

    return lowerHost.endsWith(suffix) || hostname.endsWith(suffix)
  }

  return lowerEntry === lowerHost || lowerEntry === hostname
}

/**
 * Whether any entry of the config's `silenceHosts` silences the host, such as `api.example.com` or `localhost:6006`. An
 * exact entry matches the host with or without its port, and `*.example.com` the subdomains of `example.com` at any
 * depth but not `example.com` itself, all in any case.
 *
 * @public
 */
export function isSilenced(host: string, silenceHosts: readonly string[]): boolean {
  return silenceHosts.some((entry) => silences(entry, host))
}
