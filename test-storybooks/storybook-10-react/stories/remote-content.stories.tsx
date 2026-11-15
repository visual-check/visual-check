import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode, SyntheticEvent } from 'react'
import { waitFor } from 'storybook/test'
import { visualCheck } from '../.storybook/visual-check.ts'
import { remoteOrigin, remoteSquare, squarePath } from './remote-origin.ts'

/**
 * The teal square from the story page's own origin.
 */
const sameOriginSquare = `${location.origin}${squarePath}`

/**
 * A 48 × 48 violet square as a `data:` URL.
 */
const dataSquare = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#7c3aed"/></svg>',
)}`

/**
 * A font file from the remote origin, one Storybook's build ships. The server sends no CORS headers, so the browser
 * refuses it and the text shows in the fallback font, but its `@font-face` names a remote URL all the same.
 */
const remoteFont = `${remoteOrigin}/sb-common-assets/nunito-sans-regular.woff2`

/**
 * The page the cross-origin iframe shows, from the remote origin.
 */
const remoteFrame = `${remoteOrigin}/remote-content/frame.html`

/**
 * The page the service worker story's iframe shows, inside the worker's scope.
 */
const serviceWorkerFrame = '/sw-scope/frame.html'

/**
 * The size of each tile's content, in px.
 */
const contentSize = 48

/**
 * The styles the stories can't set inline: the `::before` image, the remote font and the list marker.
 */
const remoteStyles = `
  .remote-before::before { content: url("${remoteSquare}"); }
  @font-face { font-family: 'Remote Font'; src: url("${remoteFont}") format('woff2'); }
  .remote-font { font-family: 'Remote Font', sans-serif; }
`

/**
 * The document of the `srcdoc` iframe: the remote square placed so it overflows the frame's bottom right corner, which
 * clips it.
 */
const overflowingSrcdoc = `<style>
  html { overflow: hidden; }
  body { margin: 0; }
  img { position: absolute; left: 32px; top: 24px; width: 48px; height: 48px; }
</style>
<img src="${remoteSquare}" alt="">`

/**
 * What a tile shows.
 */
interface TileProps {
  /**
   * What the tile's content is, shown above it.
   */
  label: string
  /**
   * The tile's content.
   */
  children: ReactNode
}

/**
 * A labelled tile, 120 px wide, its label above its content.
 */
function Tile({ label, children }: TileProps) {
  return (
    <div style={{ width: 120, fontFamily: 'sans-serif', fontSize: 12 }}>
      <div style={{ height: 32 }}>{label}</div>
      {children}
    </div>
  )
}

/**
 * What a row of tiles shows.
 */
interface TilesProps {
  /**
   * The tiles.
   */
  children: ReactNode
}

/**
 * The tiles in rows that wrap, with the styles the stories can't set inline.
 */
function Tiles({ children }: TilesProps) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, width: 960 }}>
      <style>{remoteStyles}</style>
      {children}
    </div>
  )
}

/**
 * Marks an iframe loaded, so `play` can wait for it.
 */
function markLoaded(event: SyntheticEvent<HTMLIFrameElement>): void {
  event.currentTarget.setAttribute('data-loaded', '')
}

/**
 * Waits until every iframe in the canvas has loaded.
 */
async function waitForFrames(canvasElement: HTMLElement): Promise<void> {
  await waitFor(
    () => {
      if (canvasElement.querySelector('iframe:not([data-loaded])') !== null) {
        throw new Error("An iframe hasn't loaded yet.")
      }
    },
    { timeout: 5_000 },
  )
}

/**
 * Every kind of remote content, each in a tile.
 */
function EveryKindTiles() {
  const box = { width: contentSize, height: contentSize }

  return (
    <Tiles>
      <Tile label="<img>">
        <img src={remoteSquare} alt="" {...box} style={{ display: 'block' }} />
      </Tile>
      <Tile label="<picture> srcset">
        <picture>
          <source srcSet={remoteSquare} />
          <img src={dataSquare} alt="" {...box} style={{ display: 'block' }} />
        </picture>
      </Tile>
      <Tile label="SVG <image>">
        <svg {...box} style={{ display: 'block' }}>
          <title>SVG image</title>
          <image href={remoteSquare} {...box} />
        </svg>
      </Tile>
      <Tile label="video poster">
        <video poster={remoteSquare} preload="none" {...box} style={{ display: 'block' }} />
      </Tile>
      <Tile label="background-image">
        <div style={{ ...box, backgroundImage: `url("${remoteSquare}")` }} />
      </Tile>
      <Tile label="mask-image">
        <div style={{ ...box, background: '#7c3aed', maskImage: `url("${remoteSquare}")` }} />
      </Tile>
      <Tile label="border-image">
        <div
          style={{
            boxSizing: 'border-box',
            ...box,
            border: '12px solid #000000',
            borderImage: `url("${remoteSquare}") 12`,
          }}
        />
      </Tile>
      <Tile label="list-style-image">
        <ul
          style={{
            boxSizing: 'border-box',
            width: 96,
            height: contentSize,
            margin: 0,
            paddingLeft: 56,
            listStyleImage: `url("${remoteSquare}")`,
          }}
        >
          <li style={{ height: contentSize, lineHeight: `${contentSize}px` }}>item</li>
        </ul>
      </Tile>
      <Tile label="::before content">
        <div className="remote-before" style={{ ...box, overflow: 'hidden' }} />
      </Tile>
      <Tile label="cross-origin iframe">
        <iframe
          title="cross-origin"
          src={remoteFrame}
          onLoad={markLoaded}
          style={{ display: 'block', width: 96, height: contentSize, border: '2px solid #a1a1aa' }}
        />
      </Tile>
      <Tile label="srcdoc iframe">
        <iframe
          title="srcdoc"
          srcDoc={overflowingSrcdoc}
          onLoad={markLoaded}
          style={{ display: 'block', width: 64, height: contentSize, border: '2px solid #a1a1aa' }}
        />
      </Tile>
    </Tiles>
  )
}

/**
 * What the excluded kinds show.
 */
interface ExcludedKindsTilesProps {
  /**
   * The teal square from the story page's own origin, as a `blob:` URL.
   */
  blobSquare: string
}

/**
 * Content that isn't remote, or isn't shown, each in a tile.
 */
function ExcludedKindsTiles({ blobSquare }: ExcludedKindsTilesProps) {
  const box = { width: contentSize, height: contentSize }

  return (
    <Tiles>
      <Tile label="data: image">
        <img src={dataSquare} alt="" {...box} style={{ display: 'block' }} />
      </Tile>
      <Tile label="blob: image">
        <img src={blobSquare} alt="" {...box} style={{ display: 'block' }} />
      </Tile>
      <Tile label="same-origin image">
        <img src={sameOriginSquare} alt="" {...box} style={{ display: 'block' }} />
      </Tile>
      <Tile label="hidden remote, same-origin">
        <div style={{ display: 'flex', gap: 8 }}>
          <img src={remoteSquare} alt="" {...box} style={{ display: 'block', visibility: 'hidden' }} />
          <img src={sameOriginSquare} alt="" {...box} style={{ display: 'block' }} />
        </div>
      </Tile>
      <Tile label="remote font">
        <div className="remote-font" style={{ fontSize: 16 }}>
          Remote font
        </div>
      </Tile>
    </Tiles>
  )
}

/**
 * Fetches the same-origin teal square and gives it as a `blob:` URL.
 */
async function loadBlobSquare(): Promise<{ blobSquare: string }> {
  const response = await fetch(sameOriginSquare)

  return { blobSquare: URL.createObjectURL(await response.blob()) }
}

/**
 * Promises that a service worker has activated.
 */
function activated(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (worker.state === 'activated') {
        resolve()
      }
    }

    worker.addEventListener('statechange', check)
    check()
  })
}

/**
 * Registers the mocking service worker with the scope `/sw-scope/`, and waits until it's active, so it controls the
 * frame the story then renders. The story page itself is outside the scope, so the worker never controls it.
 */
async function registerMockingWorker(): Promise<void> {
  const registration = await navigator.serviceWorker.register('/sw-scope/sw.js', { scope: '/sw-scope/' })
  const worker = registration.installing ?? registration.waiting ?? registration.active

  if (worker === null) {
    throw new Error('visual-check: the mocking service worker has no worker')
  }

  await activated(worker)
}

/**
 * The images in the document of the canvas's iframe, or none while that document isn't reachable.
 */
function frameImagesOf(canvasElement: HTMLElement): HTMLImageElement[] {
  return Array.from(canvasElement.querySelector('iframe')?.contentDocument?.images ?? [])
}

/**
 * Whether an image has loaded.
 */
function isLoaded(image: HTMLImageElement): boolean {
  return image.complete && image.naturalWidth > 0
}

/**
 * The meta's mask `remote` covers everything from the remote origin's host, `localhost`.
 */
const meta = {
  title: 'Remote Content',
  parameters: {
    ...visualCheck({ masks: { remote: { host: 'localhost' } } }),
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * Every kind of remote content the search finds, each in a labelled tile: an `<img>`, a `<picture>` whose `srcset`
 * picks the remote square, an SVG `<image>`, a video's poster, `background-image`, `mask-image`, `border-image`,
 * `list-style-image`, `content: url()` on `::before`, a cross-origin iframe, and a `srcdoc` iframe whose remote image
 * overflows the frame's bottom right corner. `play` waits for both iframes. The snapshot shows every tile's content
 * magenta, the `srcdoc` one only where its image shows inside the frame.
 */
export const EveryKind: Story = {
  render: () => <EveryKindTiles />,
  play: async ({ canvasElement }) => {
    await waitForFrames(canvasElement)
  },
}

/**
 * Content the search leaves out: a `data:` image, a `blob:` image of a same-origin fetch, a same-origin image, a
 * remote image with `visibility: hidden` next to a same-origin one, and text in a remote `@font-face` font. The
 * snapshot shows none of it masked.
 */
export const ExcludedKinds: Story = {
  loaders: [loadBlobSquare],
  render: (_args, { loaded }) => <ExcludedKindsTiles blobSquare={loaded.blobSquare} />,
}

/**
 * A loader registers a service worker for `/sw-scope/` and waits until it's active, then the story shows
 * `/sw-scope/frame.html`, which the worker controls, in an iframe. The frame shows two remote squares: the worker
 * answers the one with the mocked marker with its own orange square, in a response it made, and passes the other
 * through. `play` waits until both have loaded. Only the passed-through one is remote, so the snapshot shows the
 * orange square and a magenta box.
 */
export const ServiceWorkerMocked: Story = {
  loaders: [registerMockingWorker],
  render: () => (
    <iframe
      title="service worker"
      src={serviceWorkerFrame}
      style={{ display: 'block', width: 280, height: 96, border: '2px solid #a1a1aa' }}
    />
  ),
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const images = frameImagesOf(canvasElement)

        if (images.length !== 2 || !images.every(isLoaded)) {
          throw new Error("The service worker frame hasn't loaded both images yet.")
        }
      },
      { timeout: 5_000 },
    )
  },
}
