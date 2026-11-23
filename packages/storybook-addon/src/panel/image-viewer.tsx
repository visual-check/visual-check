import React, { type ReactNode, useState } from 'react'
import { imageUrlOf } from '../channel-events/image-url.js'
import { layoutOf, type Size } from './image-layout.js'
import type { SnapshotRow } from './snapshot-row.js'
import { clipPathOf, valueTextOf } from './wipe.js'

/**
 * What the viewer of a visual diff shows: the baseline and the snapshot under the slider, or the visual diff alone.
 */
type View = 'slider' | 'diff'

/**
 * An image as the viewer loads it.
 */
interface ViewerImage {
  /**
   * Its URL.
   */
  url: string
  /**
   * Its alternative text.
   */
  alt: string
}

/**
 * What `ImageViewer` takes.
 */
interface ImageViewerProps {
  /**
   * The story's title and name, such as `Card / Default`.
   */
  storyName: string
  /**
   * The ID of the result the row is of.
   */
  resultId: string
  /**
   * The row, of which the viewer needs these.
   */
  row: Pick<SnapshotRow, 'label' | 'images'>
}

/**
 * What `SingleImage` takes.
 */
interface SingleImageProps {
  /**
   * Which image it is.
   */
  kind: 'snapshot' | 'diff'
  /**
   * The image.
   */
  image: ViewerImage
}

/**
 * What `WipeSlider` takes.
 */
interface WipeSliderProps {
  /**
   * The baseline.
   */
  baseline: ViewerImage
  /**
   * The snapshot.
   */
  snapshot: ViewerImage
  /**
   * Where the line is, from 0 to 100. The baseline shows left of it, the snapshot right of it.
   */
  position: number
  /**
   * Moves the line.
   */
  moveTo: (position: number) => void
}

/**
 * What `ComparedImages` takes.
 */
interface ComparedImagesProps extends WipeSliderProps {
  /**
   * The visual diff.
   */
  diff: ViewerImage
  /**
   * What shows.
   */
  view: View
  /**
   * Shows the other.
   */
  showView: (view: View) => void
}

/**
 * The caption of an image that shows alone.
 */
const captions = { snapshot: 'Snapshot', diff: 'Visual diff' } as const

/**
 * Gives the size of an image that has loaded.
 */
function sizeOf({ naturalWidth, naturalHeight }: HTMLImageElement): Size {
  return { width: naturalWidth, height: naturalHeight }
}

/**
 * What shows in place of an image that doesn't load.
 */
function ImageGone(): ReactNode {
  return (
    <p role="alert" data-visual-check="gone">
      This image is gone. Check again.
    </p>
  )
}

/**
 * One image with its caption.
 */
function SingleImage({ kind, image: { url, alt } }: SingleImageProps): ReactNode {
  // By the URL, so the next check's image gets its own try.
  const [goneUrl, setGoneUrl] = useState<string>()

  if (goneUrl === url) {
    return <ImageGone />
  }

  return (
    <figure>
      <figcaption data-visual-check="caption">{captions[kind]}</figcaption>
      <img data-visual-check={`image-${kind}`} src={url} alt={alt} onError={() => setGoneUrl(url)} />
    </figure>
  )
}

/**
 * The baseline and the snapshot on top of each other, under a slider that moves the line between them.
 */
function WipeSlider({ baseline, snapshot, position, moveTo }: WipeSliderProps): ReactNode {
  const [baselineSize, setBaselineSize] = useState<Size>()
  const [snapshotSize, setSnapshotSize] = useState<Size>()
  const [goneUrl, setGoneUrl] = useState<string>()

  /**
   * Remembers an image that doesn't load, and no size, so the next check's images are measured anew.
   */
  const lose = (url: string): void => {
    setGoneUrl(url)
    setBaselineSize(undefined)
    setSnapshotSize(undefined)
  }

  if (goneUrl === baseline.url || goneUrl === snapshot.url) {
    return <ImageGone />
  }

  // The images load while the area is hidden, until their sizes are known.
  const layout = baselineSize && snapshotSize && layoutOf(baselineSize, snapshotSize)

  return (
    <figure>
      <figcaption data-visual-check="caption">
        <span>Left: baseline</span> <span>Right: snapshot</span>
      </figcaption>
      <div
        data-visual-check="stage"
        hidden={layout === undefined}
        style={{ width: layout?.width, aspectRatio: layout?.aspectRatio }}
      >
        <div data-visual-check="layer-baseline">
          <img
            data-visual-check="image-baseline"
            src={baseline.url}
            alt={baseline.alt}
            style={{ width: layout?.baselineWidth }}
            onLoad={(event) => setBaselineSize(sizeOf(event.currentTarget))}
            onError={() => lose(baseline.url)}
          />
        </div>
        <div data-visual-check="layer-snapshot" style={{ clipPath: clipPathOf(position) }}>
          <img
            data-visual-check="image-snapshot"
            src={snapshot.url}
            alt={snapshot.alt}
            style={{ width: layout?.snapshotWidth }}
            onLoad={(event) => setSnapshotSize(sizeOf(event.currentTarget))}
            onError={() => lose(snapshot.url)}
          />
        </div>
        <div data-visual-check="divider" style={{ left: `${position}%` }} />
        <input
          type="range"
          data-visual-check="slider"
          min={0}
          max={100}
          step={1}
          value={position}
          aria-label="Wipe between the baseline and the snapshot"
          aria-valuetext={valueTextOf(position)}
          onChange={(event) => moveTo(event.currentTarget.valueAsNumber)}
        />
      </div>
    </figure>
  )
}

/**
 * The images of a visual diff, and the buttons that choose between them. The ones that don't show are hidden, so they
 * stay loaded.
 */
export function ComparedImages({ diff, view, showView, ...slider }: ComparedImagesProps): ReactNode {
  return (
    <div data-visual-check="viewer">
      <fieldset aria-label="Image view" data-visual-check="views">
        <button
          type="button"
          data-visual-check="view-slider"
          aria-pressed={view === 'slider'}
          onClick={() => showView('slider')}
        >
          Slider
        </button>
        <button
          type="button"
          data-visual-check="view-diff"
          aria-pressed={view === 'diff'}
          onClick={() => showView('diff')}
        >
          Visual diff
        </button>
      </fieldset>
      <div hidden={view !== 'slider'}>
        <WipeSlider {...slider} />
      </div>
      <div hidden={view !== 'diff'}>
        <SingleImage kind="diff" image={diff} />
      </div>
    </div>
  )
}

/**
 * The images of a row: the baseline and the snapshot under a slider or the visual diff, or else the snapshot alone.
 * Shows nothing without a snapshot.
 */
export function ImageViewer({ storyName, resultId, row: { label, images } }: ImageViewerProps): ReactNode {
  const [view, setView] = useState<View>('slider')
  const [position, setPosition] = useState(50)

  /**
   * Gives one of the row's images.
   */
  const imageOf = (path: string, name: string): ViewerImage => ({
    url: imageUrlOf(resultId, path),
    alt: `${storyName}, ${label}: ${name}`,
  })

  const { baseline, snapshot, diff } = images

  if (snapshot === null) {
    return null
  }

  if (baseline === null || diff === null) {
    return (
      <div data-visual-check="viewer">
        <SingleImage kind="snapshot" image={imageOf(snapshot, 'snapshot')} />
      </div>
    )
  }

  return (
    <ComparedImages
      baseline={imageOf(baseline, 'baseline')}
      snapshot={imageOf(snapshot, 'snapshot')}
      diff={imageOf(diff, 'visual diff')}
      view={view}
      showView={setView}
      position={position}
      moveTo={setPosition}
    />
  )
}
