import type { Meta, StoryContext, StoryObj } from '@storybook/react-vite'
import { visualCheck } from '../.storybook/visual-check.ts'
import { Note } from './network-parts.tsx'
import { remoteOrigin, squarePath } from './remote-origin.ts'

declare global {
  /**
   * `true` when the end-to-end check's real network requests cases run, through a script the check's server adds to
   * every `iframe.html` before Storybook imports any stories file. Each story here fetches the remote origin only then,
   * so every other run, `update`'s network warning included, sees no real network request from them.
   */
  var __visualCheckE2eRealRequests: boolean | undefined
}

/**
 * Gives a loader that fetches the teal square from the remote origin, a real network request, when the real network
 * requests cases run this page and `fetches` says so for the story's context, and does nothing otherwise. The server
 * sends no CORS headers, so the fetch asks for an opaque response, `no-cors`. A loader finishes before the story
 * renders, so the request is made well before visual-check captures it. The story shows the same either way.
 */
function fetchingWhenAsked(fetches: (context: StoryContext) => boolean = () => true) {
  return async (context: StoryContext): Promise<Record<string, never>> => {
    if (globalThis.__visualCheckE2eRealRequests === true && fetches(context)) {
      await fetch(`${remoteOrigin}${squarePath}`, { mode: 'no-cors' })
    }

    return {}
  }
}

/**
 * The stories each fetch the remote origin, as `network--real-fetch` does, with a `realRequests` of their own.
 */
const meta = {
  title: 'Real Requests',
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * Fetches the remote origin with `realRequests: 'warn'`, so it's listed without failing `test` whatever the config's
 * `realRequests` says.
 */
export const Warn: Story = {
  loaders: [fetchingWhenAsked()],
  render: () => <Note text="real requests: warn" />,
  parameters: { ...visualCheck({ realRequests: 'warn' }) },
}

/**
 * Fetches the remote origin with `realRequests: 'off'`, so it's never listed, whatever the config's `realRequests`
 * says.
 */
export const Off: Story = {
  loaders: [fetchingWhenAsked()],
  render: () => <Note text="real requests: off" />,
  parameters: { ...visualCheck({ realRequests: 'off' }) },
}

/**
 * Lists the `dark` mode and fetches the remote origin only when its `theme` global is `dark`, so only
 * `real-requests--two-modes.dark` has a real network request. It takes the config's `realRequests`.
 */
export const TwoModes: Story = {
  loaders: [fetchingWhenAsked(({ globals }) => globals.theme === 'dark')],
  render: () => <Note text="real requests: two modes" />,
  parameters: { ...visualCheck({ modes: ['dark'] }) },
}
