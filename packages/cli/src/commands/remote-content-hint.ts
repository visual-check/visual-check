import { docsUrlOf } from '../docs-site/docs-url.js'

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
const remoteContentDocsUrl = docsUrlOf('remote-content')

/**
 * Gives the hint for a snapshot that differs only inside remote content from `hosts`, in one line, for the report and
 * `test`'s end block: the hosts, why a CDN can make it differ, the host masks in order and the docs page.
 */
export function remoteContentHintMessageOf(hosts: readonly string[]): string {
  const masks = hosts.map(hostMaskOf).join(', ')

  return `${remoteContentCauseOf(hosts)} Mask it by host: ${masks}. See ${remoteContentDocsUrl}`
}
