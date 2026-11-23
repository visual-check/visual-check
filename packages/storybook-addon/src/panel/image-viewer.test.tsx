import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ComparedImages, ImageViewer } from './image-viewer.js'
import type { SnapshotRow } from './snapshot-row.js'

const imagesOfDiff: SnapshotRow['images'] = {
  baseline: 'snapshots/web/a.dark.baseline.png',
  snapshot: 'snapshots/web/a.dark.snapshot.png',
  diff: 'diffs/web/a.dark.png',
}

/**
 * Renders the viewer of a row with the images.
 */
function render(images: SnapshotRow['images']): string {
  return renderToStaticMarkup(
    <ImageViewer storyName="Card / Default" resultId="click-1" row={{ label: 'dark', images }} />,
  )
}

/**
 * Renders a baseline, a snapshot and a visual diff at the view and the position.
 */
function renderCompared(view: 'slider' | 'diff', position: number): string {
  return renderToStaticMarkup(
    <ComparedImages
      baseline={{ url: 'baseline.png', alt: 'baseline' }}
      snapshot={{ url: 'snapshot.png', alt: 'snapshot' }}
      diff={{ url: 'diff.png', alt: 'diff' }}
      view={view}
      position={position}
      showView={() => undefined}
      moveTo={() => undefined}
    />,
  )
}

/**
 * Gives the opening tags that have the name.
 */
function tagsOf(markup: string, name: string): string[] {
  return markup.match(new RegExp(`<[^>]* data-visual-check="${name}"[^>]*>`, 'g')) ?? []
}

/**
 * Gives the text of each caption.
 */
function captionsOf(markup: string): string[] {
  return [...markup.matchAll(/<figcaption[^>]*>(.*?)<\/figcaption>/g)].map(([, inner = '']) =>
    inner.replace(/<[^>]*>/g, ''),
  )
}

/**
 * Gives the caption of each view of a visual diff, and whether the view is hidden.
 */
function viewsOf(markup: string): { caption: string | undefined; hidden: boolean }[] {
  return [...markup.matchAll(/<div( hidden="")?>(<figure>.*?<\/figure>)/g)].map(([, hidden, figure = '']) => ({
    caption: captionsOf(figure)[0],
    hidden: hidden !== undefined,
  }))
}

describe('ImageViewer', () => {
  it('wipes between the baseline and the snapshot of a visual diff, half of each at first', () => {
    const markup = render(imagesOfDiff)

    expect(markup.match(/<img[^>]*>/g)).toEqual([
      '<img data-visual-check="image-baseline" src="__visual-check/images/click-1/snapshots/web/a.dark.baseline.png"' +
        ' alt="Card / Default, dark: baseline"/>',
      '<img data-visual-check="image-snapshot" src="__visual-check/images/click-1/snapshots/web/a.dark.snapshot.png"' +
        ' alt="Card / Default, dark: snapshot"/>',
      '<img data-visual-check="image-diff" src="__visual-check/images/click-1/diffs/web/a.dark.png"' +
        ' alt="Card / Default, dark: visual diff"/>',
    ])
    expect(viewsOf(markup)).toEqual([
      { caption: 'Left: baseline Right: snapshot', hidden: false },
      { caption: 'Visual diff', hidden: true },
    ])
    expect(tagsOf(markup, 'views')[0]).toContain('<fieldset aria-label="Image view"')
    expect(tagsOf(markup, 'view-slider')[0]).toContain('aria-pressed="true"')
    expect(tagsOf(markup, 'view-diff')[0]).toContain('aria-pressed="false"')
    expect(tagsOf(markup, 'slider')[0]).toContain('aria-valuetext="Baseline 50%, snapshot 50%"')
  })

  it.each<[name: string, images: SnapshotRow['images']]>([
    ['nothing else', { ...imagesOfDiff, baseline: null, diff: null }],
    ['no visual diff', { ...imagesOfDiff, diff: null }],
    ['no baseline', { ...imagesOfDiff, baseline: null }],
  ])('shows the snapshot alone with %s', (_name, images) => {
    const markup = render(images)

    expect(markup.match(/<img[^>]*>/g)).toEqual([
      '<img data-visual-check="image-snapshot" src="__visual-check/images/click-1/snapshots/web/a.dark.snapshot.png"' +
        ' alt="Card / Default, dark: snapshot"/>',
    ])
    expect(captionsOf(markup)).toEqual(['Snapshot'])
    expect(markup).not.toMatch(/<button|<input/)
  })

  it('shows nothing without a snapshot', () => {
    expect(render({ baseline: null, snapshot: null, diff: null })).toBe('')
  })
})

describe('ComparedImages', () => {
  it('clips the snapshot and puts the line at the position, for everybody', () => {
    const markup = renderCompared('slider', 60)
    const [slider] = tagsOf(markup, 'slider')

    expect(tagsOf(markup, 'layer-snapshot')[0]).toContain('style="clip-path:inset(0 0 0 60%)"')
    expect(tagsOf(markup, 'divider')[0]).toContain('style="left:60%"')

    for (const attribute of [
      'type="range"',
      'min="0"',
      'max="100"',
      'step="1"',
      'value="60"',
      'aria-label="Wipe between the baseline and the snapshot"',
      'aria-valuetext="Baseline 60%, snapshot 40%"',
    ]) {
      expect(slider).toContain(attribute)
    }
  })

  it('shows the visual diff alone', () => {
    const markup = renderCompared('diff', 60)

    expect(viewsOf(markup)).toEqual([
      { caption: 'Left: baseline Right: snapshot', hidden: true },
      { caption: 'Visual diff', hidden: false },
    ])
    expect(tagsOf(markup, 'image-diff')).toEqual(['<img data-visual-check="image-diff" src="diff.png" alt="diff"/>'])
    expect(tagsOf(markup, 'view-slider')[0]).toContain('aria-pressed="false"')
    expect(tagsOf(markup, 'view-diff')[0]).toContain('aria-pressed="true"')
  })
})
