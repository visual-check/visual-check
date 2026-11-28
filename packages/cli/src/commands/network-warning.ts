import type { StoryHosts } from '../capture/capture-session.js'
import { isSilenced } from '../real-network-requests/silenced-hosts.js'
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
      if (isSilenced(host, silenceHosts)) {
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
