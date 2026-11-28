import type { Meta, StoryObj } from '@storybook/react-vite'
import { waitFor } from 'storybook/test'
import { registerMockingWorker } from './mocking-worker.ts'
import { frameBodyOf, Note } from './network-parts.tsx'
import { remoteOrigin, remoteSquare, squarePath } from './remote-origin.ts'

/**
 * The page the mocked fetch story's iframe shows, inside the mocking worker's scope.
 */
const mockedFetchFrame = '/sw-scope/fetch.html'

/**
 * Fetches the teal square from the remote origin, which sends no CORS headers, so the fetch asks for an opaque
 * response, `no-cors`. Gives what came back: an opaque response always has the status 0.
 */
async function fetchRemoteSquare(): Promise<{ fetched: string }> {
  const response = await fetch(`${remoteOrigin}${squarePath}`, { mode: 'no-cors' })

  return { fetched: `fetched: ${response.type} response, status ${response.status}` }
}

/**
 * The stories set no mask, so remote content shows as it is.
 */
const meta = {
  title: 'Network',
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * A loader fetches the teal square from the remote origin, a real network request, and the story shows only that it
 * did: `fetched: opaque response, status 0`. It shows no remote content.
 */
export const RealFetch: Story = {
  loaders: [fetchRemoteSquare],
  render: (_args, { loaded }) => <Note text={loaded.fetched} />,
}

/**
 * A loader registers the mocking service worker for `/sw-scope/` and waits until it's active, then the story shows
 * `/sw-scope/fetch.html`, which the worker controls, in an iframe. The frame fetches a URL of the remote origin with
 * the mocked marker, which the worker answers with a response it made, so nothing goes over the network. The server
 * sends no CORS headers, so the fetch succeeds only when the worker answers it. `play` waits until the frame says what
 * came back, and throws when the fetch failed. The snapshot shows `Mocked fetch answered 200, image/png`.
 */
export const MockedFetch: Story = {
  loaders: [registerMockingWorker],
  render: () => (
    <iframe
      title="mocked fetch"
      src={mockedFetchFrame}
      style={{ display: 'block', width: 360, height: 48, border: '2px solid #a1a1aa' }}
    />
  ),
  play: async ({ canvasElement }) => {
    const body = await waitFor(
      () => {
        const frameBody = frameBodyOf(canvasElement)

        if (frameBody?.dataset.result === undefined) {
          throw new Error("The mocked fetch frame hasn't fetched yet.")
        }

        return frameBody
      },
      { timeout: 5_000 },
    )

    if (body.dataset.result !== 'answered') {
      throw new Error(`visual-check: the mocked fetch wasn't answered by the worker: ${body.textContent?.trim()}`)
    }
  },
}

/**
 * The teal square from the remote origin in an `<img>`, which no mask covers. `play` waits until it has loaded. An
 * image's request isn't a real network request, but the image is remote content, so the snapshot shows the square.
 */
export const RemoteImage: Story = {
  render: () => <img src={remoteSquare} alt="" width={48} height={48} style={{ display: 'block' }} />,
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const image = canvasElement.querySelector('img')

        if (image === null || !image.complete || image.naturalWidth === 0) {
          throw new Error("The remote image hasn't loaded yet.")
        }
      },
      { timeout: 5_000 },
    )
  },
}
