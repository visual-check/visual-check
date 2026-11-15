import type { StoryHosts } from '../capture/capture-session.js'

/**
 * The stories shown in a host's line, before the line ends the list with `, …`.
 */
const listedStoryCount = 3

/**
 * What one captured snapshot reached: its Storybook's name, its story's ID and the hosts it reached. A story's modes
 * are snapshots of their own, each with its own entry.
 */
interface TakenHosts {
  /**
   * The name of the snapshot's Storybook.
   */
  storybook: string
  /**
   * The snapshot's story ID.
   */
  storyId: string
  /**
   * The hosts the snapshot reached.
   */
  hosts: StoryHosts
}

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
 * Gives the stories of each host, once per Storybook and story, in the order the snapshots come in, each as its ID or,
 * with `labelled`, as its Storybook's name and ID. Hosts in `silenceHosts` are left out.
 */
function storiesByHostOf(
  taken: readonly TakenHosts[],
  labelled: boolean,
  hostsOf: (hosts: StoryHosts) => string[],
  silenceHosts: readonly string[],
): Map<string, Map<string, string>> {
  const byHost = new Map<string, Map<string, string>>()

  for (const { storybook, storyId, hosts } of taken) {
    for (const host of hostsOf(hosts)) {
      if (silenceHosts.some((entry) => silences(entry, host))) {
        continue
      }

      const stories = byHost.get(host) ?? new Map<string, string>()

      stories.set(JSON.stringify([storybook, storyId]), labelled ? `${storybook} ${storyId}` : storyId)
      byHost.set(host, stories)
    }
  }

  return byHost
}

/**
 * Builds one line for each host, sorted by host name, ending each with a newline. A line gives the host, how many
 * stories reach it, the first three of them, `, …` when there are more, and what `sentenceOf` says about them.
 */
function linesOf(
  byHost: ReadonlyMap<string, ReadonlyMap<string, string>>,
  sentenceOf: (count: number) => string,
): string {
  return [...byHost.entries()]
    .sort(([first], [second]) => (first < second ? -1 : 1))
    .map(([host, stories]) => {
      const listed = [...stories.values()]
      const shown = listed.slice(0, listedStoryCount).join(', ')
      const more = listed.length > listedStoryCount ? ', …' : ''
      const count = `${listed.length} ${listed.length === 1 ? 'story' : 'stories'}`

      return `${host}: ${count} (${shown}${more})${sentenceOf(listed.length)}\n`
    })
    .join('')
}

/**
 * Builds the warnings that end a finished `update`: first a line for each host the stories sent real network requests
 * to, then a line for each host whose remote content they show, each kind sorted by host name. A line counts the
 * distinct stories, a Storybook's name with a story ID, so a story's modes count once and the same ID in two Storybooks
 * counts twice. It names the first three stories in the order the snapshots come in, each by its ID, or, when the
 * snapshots come from more than one Storybook, by its Storybook's name and ID, such as `web a--a`. The hosts in
 * `silenceHosts` get no line. Each line ends with a newline. Gives an empty string when no host is left.
 */
export function networkWarningOf(taken: readonly TakenHosts[], silenceHosts: readonly string[]): string {
  const labelled = new Set(taken.map(({ storybook }) => storybook)).size > 1
  const requests = storiesByHostOf(taken, labelled, (hosts) => hosts.requests, silenceHosts)
  const remoteContent = storiesByHostOf(taken, labelled, (hosts) => hosts.remoteContent, silenceHosts)

  return (
    linesOf(
      requests,
      (count) =>
        `. ${count === 1 ? 'This story makes' : 'These stories make'} real network requests and may be unreliable.`,
    ) +
    linesOf(
      remoteContent,
      (count) =>
        ` ${count === 1 ? 'shows' : 'show'} remote content. ` +
        'A CDN can serve it differently on another machine, so CI may fail.',
    )
  )
}
