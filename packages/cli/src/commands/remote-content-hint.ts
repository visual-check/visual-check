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
 * Says what a snapshot differs only inside, and why a CDN can make it differ.
 */
function remoteContentCauseOf(hosts: readonly string[]): string {
  return (
    `Differs only inside remote content from ${hostListOf(hosts)}. ` +
    'A CDN can serve different bytes to different machines.'
  )
}

/**
 * Gives a host's mask, as the config writes it: `{ host: 'a.com' }`.
 */
function hostMaskOf(host: string): string {
  return `{ host: '${host}' }`
}

/**
 * The docs page about remote content.
 */
const remoteContentDocsUrl = `${docsBaseUrl}/docs/remote-content`

/**
 * Gives the hint for a snapshot that differs only inside remote content from `hosts`: the hosts, why a CDN can make it
 * differ, one host mask line per host in order, and the docs page, as lines with no indentation.
 */
export function remoteContentHintOf(hosts: readonly string[]): string[] {
  return [
    `hint: ${remoteContentCauseOf(hosts)} Mask it by host:`,
    ...hosts.map((host) => `  ${hostMaskOf(host)}`),
    `See ${remoteContentDocsUrl}`,
  ]
}

/**
 * Gives the same hint as {@link remoteContentHintOf} in one line, for the report: the hosts, why a CDN can make it
 * differ, the host masks in order and the docs page.
 */
export function remoteContentHintMessageOf(hosts: readonly string[]): string {
  const masks = hosts.map(hostMaskOf).join(', ')

  return `${remoteContentCauseOf(hosts)} Mask it by host: ${masks}. See ${remoteContentDocsUrl}`
}
