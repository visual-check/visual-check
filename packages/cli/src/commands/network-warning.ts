import type { StoryHosts } from '../capture/capture-session.js'
import type { ReportStoryRef, ReportWarning } from '../report/report-document.js'

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
 * A story that reached a host: its Storybook's name and ID, and how a warning's line names it.
 */
interface ReachingStory {
  /**
   * The story, as the report names it.
   */
  ref: ReportStoryRef
  /**
   * How the line names it: its ID, or its Storybook's name and ID.
   */
  label: string
}

/**
 * Gives the stories of each host, once per Storybook and story, in the order the snapshots come in, each named by its
 * ID or, with `labelled`, by its Storybook's name and ID. Hosts in `silenceHosts` are left out.
 */
function storiesByHostOf(
  taken: readonly TakenHosts[],
  labelled: boolean,
  hostsOf: (hosts: StoryHosts) => string[],
  silenceHosts: readonly string[],
): Map<string, Map<string, ReachingStory>> {
  const byHost = new Map<string, Map<string, ReachingStory>>()

  for (const { storybook, storyId, hosts } of taken) {
    for (const host of hostsOf(hosts)) {
      if (silenceHosts.some((entry) => silences(entry, host))) {
        continue
      }

      const stories = byHost.get(host) ?? new Map<string, ReachingStory>()

      stories.set(JSON.stringify([storybook, storyId]), {
        ref: { storybook, story: storyId },
        label: labelled ? `${storybook} ${storyId}` : storyId,
      })
      byHost.set(host, stories)
    }
  }

  return byHost
}

/**
 * Builds one warning of `kind` for each host, sorted by host name, with every story that reached it. Its message gives
 * the host, how many stories reach it, the first three of them, `, …` when there are more, and what `sentenceOf` says
 * about them.
 */
function warningsOf(
  kind: ReportWarning['kind'],
  byHost: ReadonlyMap<string, ReadonlyMap<string, ReachingStory>>,
  sentenceOf: (count: number) => string,
): ReportWarning[] {
  return [...byHost.entries()]
    .sort(([first], [second]) => (first < second ? -1 : 1))
    .map(([host, reaching]) => {
      const stories = [...reaching.values()]
      const shown = stories
        .slice(0, listedStoryCount)
        .map(({ label }) => label)
        .join(', ')
      const more = stories.length > listedStoryCount ? ', …' : ''
      const count = `${stories.length} ${stories.length === 1 ? 'story' : 'stories'}`

      return {
        kind,
        host,
        stories: stories.map(({ ref }) => ref),
        message: `${host}: ${count} (${shown}${more})${sentenceOf(stories.length)}`,
      }
    })
}

/**
 * Builds the warnings that end a finished `update`: first one for each host the stories sent real network requests
 * to, then one for each host whose remote content they show, each kind sorted by host name. A warning lists every
 * distinct story, a Storybook's name with a story ID, so a story's modes count once and the same ID in two Storybooks
 * counts twice. Its message counts them and names the first three in the order the snapshots come in, each by its ID,
 * or, when the snapshots come from more than one Storybook, by its Storybook's name and ID, such as `web a--a`. The
 * hosts in `silenceHosts` get no warning.
 */
export function networkWarningsOf(taken: readonly TakenHosts[], silenceHosts: readonly string[]): ReportWarning[] {
  const labelled = new Set(taken.map(({ storybook }) => storybook)).size > 1
  const requests = storiesByHostOf(taken, labelled, (hosts) => hosts.requests, silenceHosts)
  const remoteContent = storiesByHostOf(taken, labelled, (hosts) => hosts.remoteContent, silenceHosts)

  return [
    ...warningsOf(
      'real-requests',
      requests,
      (count) =>
        `. ${count === 1 ? 'This story makes' : 'These stories make'} real network requests and may be unreliable.`,
    ),
    ...warningsOf(
      'remote-content',
      remoteContent,
      (count) =>
        ` ${count === 1 ? 'shows' : 'show'} remote content. ` +
        'A CDN can serve it differently on another machine, so CI may fail.',
    ),
  ]
}

/**
 * Writes the warnings as stderr ends a finished `update` with them: each message on a line of its own, ending with a
 * newline. Gives an empty string for none.
 */
export function warningsTextOf(warnings: readonly ReportWarning[]): string {
  return warnings.map(({ message }) => `${message}\n`).join('')
}
