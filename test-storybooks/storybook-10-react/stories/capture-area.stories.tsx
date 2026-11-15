import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
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
 * `element: null` captures the full page: the viewport's width by the content's height, 1280 × 2000. `play` opens the
 * modal dialog, so the snapshot shows the hero 720 px tall, the fixed header once at the top, and the dialog over the
 * first viewport. A rounded fixed element over a translucent fixed layer rasterizes its antialiased corners ±1 level
 * differently between captures (measured: 17 px, about 1 run in 4), which tolerance absorbs once the visual diff
 * lands, so the dialog keeps square corners until then.
 */
export const FullPage: Story = {
  parameters: { ...visualCheck({ element: null }) },
  render: () => <FullPageScene />,
  play: ({ canvasElement }) => {
    openDialog(canvasElement)
  },
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
