import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { visualCheck } from '../.storybook/visual-check.ts'

declare global {
  /**
   * `true` when the end-to-end check's grow case widens `Grows`'s masked element, through a script the check's server
   * adds to every story page before Storybook imports any stories file.
   */
  var __visualCheckE2eGrow: boolean | undefined
}

/**
 * The origin the stories load remote content from: `localhost` on the story page's own port. Served on `127.0.0.1`, as
 * the end-to-end check serves it, that's another origin than the page's, so it's remote; on `localhost` it's the same
 * origin, so nothing is remote.
 */
const remoteOrigin = `${location.protocol}//localhost:${location.port}`

/**
 * A 48 × 48 teal square served from the remote origin.
 */
const remoteSquare = `${remoteOrigin}/remote-content/square.png`

/**
 * What a dialog shows.
 */
interface MaskedDialogProps {
  /**
   * The dialog's content.
   */
  children: ReactNode
}

/**
 * A modal dialog portaled to `document.body`, which the story's `play` opens, over a note that names the story. Its
 * corners are square, since rounded ones over the translucent backdrop rasterize ±1 level differently between captures.
 */
function MaskedDialog({ children }: MaskedDialogProps) {
  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', fontSize: 16 }}>
      Behind the dialog
      {createPortal(
        <dialog
          data-masks-dialog
          style={{
            width: 320,
            padding: 24,
            border: '1px solid #a1a1aa',
            borderRadius: 0,
            outline: 'none',
            background: '#ffffff',
            fontFamily: 'sans-serif',
            fontSize: 16,
          }}
        >
          {children}
        </dialog>,
        document.body,
      )}
    </div>
  )
}

/**
 * Opens the story's modal dialog, which sits in `document.body`, outside the story's canvas.
 */
function openDialog(canvasElement: HTMLElement): void {
  const dialog = canvasElement.ownerDocument.querySelector('[data-masks-dialog]')

  if (!(dialog instanceof HTMLDialogElement)) {
    throw new Error('visual-check: the story has no dialog')
  }

  dialog.showModal()
}

/**
 * How wide `Grows`'s masked element is, in px: 300 when the end-to-end check's grow case asks, else 200.
 */
function grownWidth(): number {
  return globalThis.__visualCheckE2eGrow === true ? 300 : 200
}

const meta = {
  title: 'Masks',
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * A modal dialog that `play` opens holds a clock, which the mask `clock` covers by its selector. The masks sit in the
 * top layer above the dialog, so the snapshot shows the dialog with a magenta box over the clock.
 */
export const SelectorOverDialog: Story = {
  parameters: { ...visualCheck({ masks: { clock: { selector: '[data-clock]' } } }) },
  render: () => (
    <MaskedDialog>
      The time is <span data-clock>12:34:56</span>
    </MaskedDialog>
  ),
  play: ({ canvasElement }) => {
    openDialog(canvasElement)
  },
}

/**
 * A modal dialog that `play` opens holds an image from the remote origin, which the mask `remote` covers by its host,
 * `localhost`. The snapshot shows the dialog with a magenta box over the image.
 */
export const HostOverDialog: Story = {
  parameters: { ...visualCheck({ masks: { remote: { host: 'localhost' } } }) },
  render: () => (
    <MaskedDialog>
      <img src={remoteSquare} alt="" width={48} height={48} style={{ display: 'block' }} />
    </MaskedDialog>
  ),
  play: ({ canvasElement }) => {
    openDialog(canvasElement)
  },
}

/**
 * The mask `grows` covers a bar 200 px wide, or 300 px when the end-to-end check's grow case asks, so the mask grows
 * with it and the snapshot differs.
 */
export const Grows: Story = {
  parameters: { ...visualCheck({ masks: { grows: { selector: '[data-grows]' } } }) },
  render: () => (
    <div style={{ padding: 24 }}>
      <div data-grows style={{ width: grownWidth(), height: 40, background: '#bfdbfe' }} />
    </div>
  ),
}
