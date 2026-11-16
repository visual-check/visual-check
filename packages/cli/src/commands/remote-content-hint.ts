/**
 * The address of visual-check's docs site, which hints link to.
 */
const docsBaseUrl = 'https://visual-check.vercel.app'

/**
 * Names the hosts in order: `a.com`, `a.com and b.com`, or `a.com, b.com and c.com`.
 */
function hostListOf(hosts: readonly string[]): string {
  const last = hosts.at(-1) ?? ''

  if (hosts.length <= 1) {
    return last
  }

  return `${hosts.slice(0, -1).join(', ')} and ${last}`
}

/**
 * Gives the hint for a snapshot that differs only inside remote content from `hosts`: the hosts, why a CDN can make it
 * differ, one host mask line per host in order, and the docs page, as lines with no indentation.
 */
export function remoteContentHintOf(hosts: readonly string[]): string[] {
  return [
    `hint: Differs only inside remote content from ${hostListOf(hosts)}. ` +
      'A CDN can serve different bytes to different machines. Mask it by host:',
    ...hosts.map((host) => `  { host: '${host}' }`),
    `See ${docsBaseUrl}/docs/remote-content`,
  ]
}
