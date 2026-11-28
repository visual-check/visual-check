import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { visualCheck } from '../.storybook/visual-check.ts'

/**
 * What a note shows.
 */
interface NoteProps {
  /**
   * The note's text.
   */
  children: ReactNode
}

/**
 * A plain bordered note, as the readiness stories show their results in.
 */
function Note({ children }: NoteProps) {
  return (
    <div
      style={{
        width: 400,
        padding: 16,
        border: '1px solid #a1a1aa',
        borderRadius: 6,
        background: '#f4f4f5',
        fontFamily: 'sans-serif',
        fontSize: 16,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  )
}

/**
 * How tall the fixed header is, in px.
 */
const headerHeight = 56

/**
 * The bands below the hero: four of 320 px, so with the 720 px hero the page is 2000 px tall.
 */
const bands = [
  { label: 'Band 1 of 4', background: '#fef3c7' },
  { label: 'Band 2 of 4', background: '#dcfce7' },
  { label: 'Band 3 of 4', background: '#fce7f3' },
  { label: 'Band 4 of 4', background: '#e0e7ff' },
]

/**
 * How tall each band is, in px.
 */
const bandHeight = 320

/**
 * A page with a fixed header, a hero one viewport tall and four bands below it, 2000 px tall in all at the default
 * 720 px viewport, and a modal dialog portaled to `document.body`, which the story's `play` opens.
 */
function FullPageScene() {
  return (
    <div style={{ fontFamily: 'sans-serif', fontSize: 16 }}>
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: headerHeight,
          padding: '0 24px',
          lineHeight: `${headerHeight}px`,
          background: '#1e3a8a',
          color: '#ffffff',
        }}
      >
        Fixed header
      </header>
      <section
        style={{
          boxSizing: 'border-box',
          height: '100vh',
          padding: `${headerHeight + 24}px 24px 24px`,
          background: '#bfdbfe',
        }}
      >
        Hero, 100vh tall
      </section>
      {bands.map((band) => (
        <section
          key={band.label}
          style={{ boxSizing: 'border-box', height: bandHeight, padding: 24, background: band.background }}
        >
          {band.label}
        </section>
      ))}
      {createPortal(
        <dialog
          data-full-page-dialog
          style={{
            width: 360,
            padding: 24,
            border: '1px solid #a1a1aa',
            borderRadius: 0,
            outline: 'none',
            background: '#ffffff',
            fontFamily: 'sans-serif',
            fontSize: 16,
          }}
        >
          A modal dialog in the top layer
        </dialog>,
        document.body,
      )}
    </div>
  )
}

/**
 * How tall each section of the page that grows the viewport is, in px: five of them make it 2000 px tall above its save
 * bar.
 */
const growSectionHeight = 400

/**
 * How tall the sticky save bar is, in px.
 */
const saveBarHeight = 64

/**
 * A page 2064 px tall: five sections of 400 px and a save bar that sticks to the viewport's bottom, as a form's does,
 * with a badge fixed 96 px above the viewport's bottom right corner.
 */
function StickyBarScene() {
  return (
    <div style={{ fontFamily: 'sans-serif', fontSize: 16 }}>
      {['Section 1 of 5', 'Section 2 of 5', 'Section 3 of 5', 'Section 4 of 5', 'Section 5 of 5'].map(
        (label, index) => (
          <section
            key={label}
            style={{
              boxSizing: 'border-box',
              height: growSectionHeight,
              padding: 24,
              background: index % 2 === 0 ? '#fef3c7' : '#dcfce7',
            }}
          >
            {label}
          </section>
        ),
      )}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          height: saveBarHeight,
          padding: '0 24px',
          lineHeight: `${saveBarHeight}px`,
          background: '#1e3a8a',
          color: '#ffffff',
        }}
      >
        Sticky save bar
      </div>
      <div
        style={{
          position: 'fixed',
          right: 24,
          bottom: 96,
          width: 160,
          height: 48,
          lineHeight: '48px',
          textAlign: 'center',
          background: '#be123c',
          color: '#ffffff',
        }}
      >
        Fixed badge
      </div>
    </div>
  )
}

/**
 * Opens the full page's modal dialog, which sits in `document.body`, outside the story's canvas.
 */
function openDialog(canvasElement: HTMLElement): void {
  const dialog = canvasElement.ownerDocument.querySelector('[data-full-page-dialog]')

  if (!(dialog instanceof HTMLDialogElement)) {
    throw new Error('visual-check: the full page has no dialog')
  }

  dialog.showModal()
}

/**
 * How far down the page the card is, in px.
 */
const cardTop = 1500

/**
 * A note, then a spacer that puts the card 1500 px down and 24 px in, then the card, 320 × 160 px, then a band below
 * it, so the page goes on past the card.
 */
function CardFarDown() {
  return (
    <div style={{ fontFamily: 'sans-serif', fontSize: 16 }}>
      <div style={{ boxSizing: 'border-box', height: cardTop, padding: 24 }}>
        <Note>The card is 1500 px down the page</Note>
      </div>
      <div
        data-capture-me
        style={{
          boxSizing: 'border-box',
          width: 320,
          height: 160,
          marginLeft: 24,
          padding: 16,
          border: '4px solid #15803d',
          borderRadius: 6,
          background: '#dcfce7',
        }}
      >
        The card to capture
      </div>
      <div style={{ height: 300, marginTop: 24, background: '#fef3c7' }} />
    </div>
  )
}

/**
 * How tall the too-tall story is, in px: over the 32,767 device px a capture can be at scale 1.
 */
const tooTallHeight = 33_000

/**
 * A note at the top of a 33,000 px tall block.
 */
function TooTallBlock() {
  return (
    <div style={{ boxSizing: 'border-box', height: tooTallHeight, padding: 24 }}>
      <Note>This story is 33,000 px tall</Note>
    </div>
  )
}

/**
 * A note 24 px in from the page's edges, then an empty `div`, which has no height.
 */
function EmptyElementBelowNote() {
  return (
    <div style={{ padding: 24 }}>
      <Note>The element below is empty</Note>
      <div data-zero-size />
    </div>
  )
}

/**
 * How wide the wide page is, in px: 220 px wider than the default 1280 px viewport.
 */
const widePageWidth = 1500

/**
 * What the wide page shows.
 */
interface WidePageProps {
  /**
   * Whether `body` clips what's past the viewport's right edge with `overflow-x: hidden`.
   */
  clipped?: boolean
}

/**
 * A page 1500 px wide and 200 px tall: three bands of 500 px, each labelled, so a capture cut at the viewport's
 * right edge shows the third band 280 px wide. `clipped` puts `overflow-x: hidden` on `body` with a stylesheet that
 * goes with the story.
 */
function WidePage({ clipped = false }: WidePageProps) {
  return (
    <div style={{ display: 'flex', width: widePageWidth, height: 200, fontFamily: 'sans-serif', fontSize: 16 }}>
      {clipped ? <style>{'body { overflow-x: hidden; }'}</style> : null}
      {['#dbeafe', '#dcfce7', '#fee2e2'].map((background, index) => (
        <div key={background} style={{ boxSizing: 'border-box', width: 500, padding: 24, background }}>
          Band {index + 1} of 3
        </div>
      ))}
    </div>
  )
}

/**
 * What the spilling card shows.
 */
interface SpillingCardProps {
  /**
   * The card's `overflow`: `visible`, so its content spills, or a value that clips it.
   */
  overflow?: 'visible' | 'hidden'
  /**
   * How far left of its place the card sits, in px, past the page's left edge: 0 by default.
   */
  shiftLeft?: number
}

/**
 * A card, 320 × 160 px, 24 px down and in, holding a bar 400 px wide, 80 px past the card's right edge, and 200 px
 * tall, 40 px past its bottom edge. With `overflow: 'hidden'` the card clips the bar. `shiftLeft` moves the card that
 * far left, past the page's left edge, and its content with it.
 */
function SpillingCard({ overflow = 'visible', shiftLeft = 0 }: SpillingCardProps) {
  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', fontSize: 16 }}>
      <div
        data-spilling-card
        style={{
          boxSizing: 'border-box',
          width: 320,
          height: 160,
          marginLeft: -shiftLeft,
          overflow,
          border: '4px solid #1d4ed8',
          background: '#dbeafe',
        }}
      >
        <div style={{ boxSizing: 'border-box', width: 396, height: 196, padding: 16, background: '#fde68a' }}>
          The bar inside the card
        </div>
      </div>
    </div>
  )
}

/**
 * A card, 320 × 160 px, 24 px down and in, drawn at 95% of its size from its top left corner, holding a bar that fills
 * it: its layout says the bar is 320 px wide while its box is drawn 304 px wide, so measuring one against the other
 * would make a spill that isn't there.
 */
function ScaledCard() {
  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', fontSize: 16 }}>
      <div
        data-spilling-card
        style={{
          boxSizing: 'border-box',
          width: 320,
          height: 160,
          border: '4px solid #1d4ed8',
          background: '#dbeafe',
          transform: 'scale(0.95)',
          transformOrigin: '0 0',
        }}
      >
        <div style={{ boxSizing: 'border-box', width: 312, height: 152, padding: 16, background: '#fde68a' }}>
          The bar fills the card
        </div>
      </div>
    </div>
  )
}

/**
 * Every story is laid out with no padding, so the page is as tall as its content. The meta captures the card, which
 * `Element` inherits; every other story sets an element of its own, or `null` for the full page.
 */
const meta = {
  title: 'Capture Area',
  parameters: {
    layout: 'fullscreen',
    ...visualCheck({ element: '[data-capture-me]' }),
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * `element: null` captures the full page: the viewport's width by the content's height, 1280 × 2000. `growViewport:
 * false` keeps the viewport 720 px tall, and `play` opens the modal dialog, so the snapshot shows the hero 720 px tall, the fixed header once at the top, and the dialog over the
 * first viewport. A rounded fixed element over a translucent fixed layer rasterizes its antialiased corners ±1 level
 * differently between captures (measured: 17 px, about 1 run in 4). Tolerance absorbs that in `test`, but `update`
 * would then write a baseline that isn't byte-identical to the committed one, so the dialog keeps square corners.
 */
export const FullPage: Story = {
  parameters: { ...visualCheck({ element: null, growViewport: false }) },
  render: () => <FullPageScene />,
  play: ({ canvasElement }) => {
    openDialog(canvasElement)
  },
}

/**
 * How tall the scroll-spy rail is, in px.
 */
const railHeight = 56

/**
 * The labels of the scroll-spy page's sections, one rail item each.
 */
const spySections = ['Section 1 of 5', 'Section 2 of 5', 'Section 3 of 5', 'Section 4 of 5', 'Section 5 of 5']

/**
 * A page with a rail on top and five 400 px sections below it, 2056 px tall in all. An `IntersectionObserver` marks the
 * rail item of every section wholly in view, as a scroll spy does: in a 720 px viewport only the first, and once the
 * viewport grew to the page, all five. Each mark waits an animation frame after the observer's callback, as a scroll
 * spy that batches its updates does, so the page reacts to the new size over two rendering updates.
 */
function ScrollSpyScene() {
  const sections = useRef<(HTMLElement | null)[]>([])
  const [inView, setInView] = useState<ReadonlySet<number>>(new Set())

  useEffect(() => {
    let frame = 0
    const observer = new IntersectionObserver(
      (entries) => {
        const changes = entries.map((entry) => ({
          index: spySections.indexOf(entry.target.getAttribute('data-section') ?? ''),
          visible: entry.isIntersecting,
        }))

        frame = requestAnimationFrame(() =>
          setInView((current) => {
            const next = new Set(current)

            for (const { index, visible } of changes) {
              if (visible) {
                next.add(index)
              } else {
                next.delete(index)
              }
            }

            return next
          }),
        )
      },
      { threshold: 1 },
    )

    for (const section of sections.current) {
      if (section !== null) {
        observer.observe(section)
      }
    }

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return (
    <div style={{ fontFamily: 'sans-serif', fontSize: 16 }}>
      <nav style={{ display: 'flex', gap: 8, height: railHeight, padding: '12px 24px', boxSizing: 'border-box' }}>
        {spySections.map((label, index) => (
          <span
            key={label}
            style={{
              padding: '0 12px',
              lineHeight: '32px',
              borderRadius: 16,
              background: inView.has(index) ? '#1e3a8a' : '#e4e4e7',
              color: inView.has(index) ? '#ffffff' : '#3f3f46',
            }}
          >
            {label}
          </span>
        ))}
      </nav>
      {spySections.map((label, index) => (
        <section
          key={label}
          ref={(section) => {
            sections.current[index] = section
          }}
          data-section={label}
          style={{
            boxSizing: 'border-box',
            height: growSectionHeight,
            padding: 24,
            background: index % 2 === 0 ? '#fef3c7' : '#dcfce7',
          }}
        >
          {label}
        </section>
      ))}
    </div>
  )
}

/**
 * Sets `element: null` and leaves the viewport's growth on, so the viewport grows to the page, 2064 px, before the
 * capture: the snapshot shows the save bar at the page's bottom, below the fifth section, and the badge 96 px above the
 * page's bottom, not mid-page where they sit in a 720 px viewport.
 */
export const FullPageGrows: Story = {
  parameters: { ...visualCheck({ element: null }) },
  render: () => <StickyBarScene />,
}

/**
 * Sets `element: null` and leaves the viewport's growth on, on a page whose scroll spy reacts to the grown viewport.
 * Frames pass once the viewport grew, so the snapshot, 1280 × 2056, shows every rail item marked. Without them the
 * capture would show only the first marked, and the page would change in the second after it.
 */
export const FullPageGrowsReacts: Story = {
  parameters: { ...visualCheck({ element: null }) },
  render: () => <ScrollSpyScene />,
}

/**
 * How long the pages whose `wait` hook changes their height take to swap their loading content for the loaded content,
 * in ms: long after the viewport first grows, which follows Storybook's report that the story finished.
 */
const loadDelay = 1500

/**
 * How long their `wait` hooks look for the loaded content before they give up, in ms: well past `loadDelay`, and within
 * visual-check's default `readyTimeout` of 10 s.
 */
const loadTimeout = 5000

/**
 * Whether the page's content has loaded: false at first, true `loadDelay` ms after it renders.
 */
function useLoaded(): boolean {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), loadDelay)

    return () => clearTimeout(timer)
  }, [])

  return loaded
}

/**
 * How tall the loading block of the page that gets shorter is, in px.
 */
const loadingBlockHeight = 2400

/**
 * The labels of the sections that replace the loading block, 400 px each, so 1200 px in all.
 */
const shortSections = ['Loaded section 1 of 3', 'Loaded section 2 of 3', 'Loaded section 3 of 3']

/**
 * A page that shows a loading block 2400 px tall, then, `loadDelay` ms after it renders, three 400 px sections in its
 * place, 1200 px in all.
 */
function ShrinksWhileLoadingScene() {
  const loaded = useLoaded()

  if (!loaded) {
    return (
      <div
        style={{
          boxSizing: 'border-box',
          height: loadingBlockHeight,
          padding: 24,
          background: '#e4e4e7',
          fontFamily: 'sans-serif',
          fontSize: 16,
        }}
      >
        Loading
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'sans-serif', fontSize: 16 }}>
      {shortSections.map((label, index) => (
        <section
          key={label}
          style={{
            boxSizing: 'border-box',
            height: growSectionHeight,
            padding: 24,
            background: index % 2 === 0 ? '#fef3c7' : '#dcfce7',
          }}
        >
          {label}
        </section>
      ))}
    </div>
  )
}

/**
 * A page that shows a short note saying it's loading, which fits the 720 px viewport, then, `loadDelay` ms after it
 * renders, `StickyBarScene`, 2064 px tall.
 */
function GrowsWhileLoadingScene() {
  const loaded = useLoaded()

  if (!loaded) {
    return (
      <div style={{ padding: 24 }}>
        <Note>Loading</Note>
      </div>
    )
  }

  return <StickyBarScene />
}

/**
 * Sets `element: null` and leaves the viewport's growth on, on a page whose loading block, 2400 px tall, becomes three
 * 400 px sections while its `wait` hook waits for the third. The page is measured again after the hook, so the
 * snapshot, 1280 × 1200, ends with the third section. Measured only before the hook, it was 1280 × 2400, with a blank
 * band below the sections.
 */
export const FullPageShrinksWhileWaiting: Story = {
  parameters: {
    ...visualCheck({
      element: null,
      wait: async ({ canvas }) => {
        await canvas.findByText('Loaded section 3 of 3', undefined, { timeout: loadTimeout })
      },
    }),
  },
  render: () => <ShrinksWhileLoadingScene />,
}

/**
 * Sets `element: null` and leaves the viewport's growth on, on a page whose short loading note, which fits the 720 px
 * viewport, becomes `FullPageGrows`'s 2064 px page while its `wait` hook waits for the save bar. The page is measured
 * again after the hook, so the snapshot, 1280 × 2064, shows the save bar at the page's bottom. Measured only before the
 * hook, the page was captured beyond the 720 px viewport, with the save bar and the badge mid-page.
 */
export const FullPageGrowsWhileWaiting: Story = {
  parameters: {
    ...visualCheck({
      element: null,
      wait: async ({ canvas }) => {
        await canvas.findByText('Sticky save bar', undefined, { timeout: loadTimeout })
      },
    }),
  },
  render: () => <GrowsWhileLoadingScene />,
}

/**
 * Inherits the meta's `element`, so the snapshot is the card's box alone, 320 × 160, though the card is 1500 px down
 * the page.
 */
export const Element: Story = {
  render: () => <CardFarDown />,
}

/**
 * The same page as `Element`, but `element: null` overrides the meta's, so the snapshot is the full page, with the
 * card 1500 px down.
 */
export const ElementOff: Story = {
  parameters: { ...visualCheck({ element: null }) },
  render: () => <CardFarDown />,
}

/**
 * Its element selector matches nothing, so the story is broken, `element-missing`, and its line says the selector
 * matched nothing. Its committed baseline is the story with `element: null`, the full page.
 */
export const ElementMissing: Story = {
  parameters: { ...visualCheck({ element: '[data-not-there]' }) },
  render: () => (
    <div style={{ padding: 24 }}>
      <Note>No element here matches the selector</Note>
    </div>
  ),
}

/**
 * Its element selector matches an empty `div`, which has no height, so the story is broken, `element-missing`, and its
 * line says the box is of zero size. Its committed baseline is the story with `element: null`, the full page.
 */
export const ElementZeroSize: Story = {
  parameters: { ...visualCheck({ element: '[data-zero-size]' }) },
  render: () => <EmptyElementBelowNote />,
}

/**
 * The full page is 33,000 px tall, over the 32,767 device px a capture can be, so the story is broken, `too-tall`, and
 * its line says to set `element`. Its committed baseline is the story 1000 px tall.
 */
export const TooTall: Story = {
  parameters: { ...visualCheck({ element: null }) },
  render: () => <TooTallBlock />,
}

/**
 * The full page is 1500 px wide, 220 px wider than the 1280 px viewport, so the capture would cut it: the story is
 * broken, `overflows`, with `details.overflow.right` of 220, and its line says the content reaches past the viewport's
 * right edge. Its committed baseline is `AllowsOverflow`'s, the page cut at the viewport's right edge.
 */
export const WiderThanViewport: Story = {
  parameters: { ...visualCheck({ element: null }) },
  render: () => <WidePage />,
}

/**
 * The same page as `WiderThanViewport`, but `body` clips it with `overflow-x: hidden`, so the page cuts it itself and
 * the story passes. Its baseline is byte-identical to `AllowsOverflow`'s.
 */
export const WiderThanViewportClipped: Story = {
  parameters: { ...visualCheck({ element: null }) },
  render: () => <WidePage clipped />,
}

/**
 * The same page as `WiderThanViewport`, with `allowOverflow: true`, so the cut is intended and the story passes: the
 * snapshot is the page cut at the viewport's right edge, 1280 × 720, as the viewport doesn't shrink to the 200 px page.
 */
export const AllowsOverflow: Story = {
  parameters: { ...visualCheck({ element: null, allowOverflow: true }) },
  render: () => <WidePage />,
}

/**
 * The card's bar spills 80 px past its right edge and 40 px past its bottom edge, which the card doesn't clip, so the
 * capture would cut it: the story is broken, `overflows`, with `details.overflow` of 80 right and 40 bottom. Its
 * committed baseline is the card's box with `allowOverflow: true`, 320 × 160.
 */
export const ElementSpills: Story = {
  parameters: { ...visualCheck({ element: '[data-spilling-card]' }) },
  render: () => <SpillingCard />,
}

/**
 * The same card as `ElementSpills`, but with `overflow: hidden`, so the card clips its bar and the story passes. Its
 * snapshot is the card's box, 320 × 160.
 */
export const ElementClips: Story = {
  parameters: { ...visualCheck({ element: '[data-spilling-card]' }) },
  render: () => <SpillingCard overflow="hidden" />,
}

/**
 * The card, which clips its bar, sits 64 px left of its place, 40 px past the page's left edge, so the capture would
 * cut it: the story is broken, `overflows`, with `details.overflow.left` of 40. Its committed baseline is the card's
 * box with `allowOverflow: true`, the 280 px of it on the page.
 */
export const ElementPastLeftEdge: Story = {
  parameters: { ...visualCheck({ element: '[data-spilling-card]' }) },
  render: () => <SpillingCard overflow="hidden" shiftLeft={64} />,
}

/**
 * A card drawn at 95% of its size, whose bar fills it, so nothing spills and the story passes. Its snapshot is the
 * card's drawn box, 304 × 152.
 */
export const ElementScaled: Story = {
  parameters: { ...visualCheck({ element: '[data-spilling-card]' }) },
  render: () => <ScaledCard />,
}
