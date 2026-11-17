import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { waitFor } from 'storybook/test'

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
 * A plain bordered note, the box each hazard story shows its result in.
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
 * Calls `alert()` as it renders, then says the call returned.
 */
function AlertResult() {
  alert('visual-check accepts an alert.')

  return <Note>alert() returned</Note>
}

/**
 * Calls `confirm()` as it renders, then shows what it returned.
 */
function ConfirmResult() {
  const answer = confirm('visual-check dismisses a confirm.')

  return <Note>confirm() returned {JSON.stringify(answer)}</Note>
}

/**
 * Calls `prompt()` with a default answer as it renders, then shows what it returned.
 */
function PromptResult() {
  const answer = prompt('visual-check dismisses a prompt.', 'accepted')

  return <Note>prompt() returned {JSON.stringify(answer)}</Note>
}

/**
 * Asks to stay on the page when it unloads, as a form with unsaved changes does.
 */
function holdPage(event: BeforeUnloadEvent): void {
  event.preventDefault()
  // Older browsers ask only when `returnValue` is set.
  event.returnValue = 'Leave the page?'
}

/**
 * Adds a `beforeunload` handler once it has rendered, and never removes it, so it holds the page until it unloads.
 */
function UnloadGuard() {
  useEffect(() => {
    window.addEventListener('beforeunload', holdPage)
  }, [])

  return <Note>A beforeunload handler holds this page</Note>
}

/**
 * Opens a popup, then waits up to 5 s for it to be closed. Throws when the popup was blocked or is still open, which
 * makes the story broken: Storybook reports a loader that throws as an error, but a `play` that throws as a success.
 */
async function openPopupUntilClosed(): Promise<void> {
  const popup = window.open('about:blank', '_blank')

  if (popup === null) {
    throw new Error('window.open() was blocked.')
  }

  await waitFor(
    () => {
      if (!popup.closed) {
        throw new Error('The popup is still open.')
      }
    },
    { timeout: 5_000 },
  )
}

/**
 * Says that `window.open()` opened a popup.
 */
function PopupNote() {
  return <Note>window.open() opened a popup</Note>
}

/**
 * A note saying the story's `play` allocates until the page runs out of memory.
 */
function MemoryHog() {
  return <Note>play allocates until the page runs out of memory</Note>
}

/**
 * Keeps arrays of 50,000 numbers, each about 400 KB, until the page reaches V8's heap limit, about 3.8 GB, and its
 * renderer crashes. That takes 1 to 4 s on a Mac but 14 to 19 s on CI's runners, so the end-to-end check gives the
 * hazards case a longer `readyTimeout`. Arrays of plain numbers fill the heap a little faster than larger ones V8 keeps
 * as dictionaries.
 */
function allocateForever(): never {
  const kept: number[][] = []

  for (;;) {
    kept.push(new Array(50_000).fill(Math.random()))
  }
}

/**
 * A link to a text file in a `blob:` URL, with the `download` attribute, that it clicks once it has rendered. Its colour
 * is set, so it looks the same visited or not.
 */
function DownloadLink() {
  const link = useRef<HTMLAnchorElement>(null)
  const [href] = useState(() => URL.createObjectURL(new Blob(['A download visual-check denies.\n'])))

  useEffect(() => {
    link.current?.click()
  }, [])

  return (
    <Note>
      Clicked{' '}
      <a ref={link} href={href} download="hazard.txt" style={{ color: '#1d4ed8' }}>
        hazard.txt
      </a>
    </Note>
  )
}

/**
 * What the page's permission requests gave.
 */
interface PermissionAnswers {
  /**
   * What `Notification.requestPermission()` resolved with, such as `denied`.
   */
  notification: NotificationPermission
  /**
   * What `navigator.geolocation.getCurrentPosition()` gave: a position, or an error with its code.
   */
  geolocation: string
}

/**
 * The name of each `GeolocationPositionError` code.
 */
const geolocationErrors: Record<number, string> = {
  1: 'PERMISSION_DENIED',
  2: 'POSITION_UNAVAILABLE',
  3: 'TIMEOUT',
}

/**
 * Asks for the page's position, giving up after 1 s, and resolves with what it got: a position, or an error's code and
 * name.
 */
function locate(): Promise<string> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve('a position'),
      (error) => resolve(`error ${error.code} ${geolocationErrors[error.code] ?? ''}`.trim()),
      { timeout: 1_000 },
    )
  })
}

/**
 * Asks for the notification and geolocation permissions at once, and resolves with both answers.
 */
async function askForPermissions(): Promise<{ answers: PermissionAnswers }> {
  const [notification, geolocation] = await Promise.all([Notification.requestPermission(), locate()])

  return { answers: { notification, geolocation } }
}

/**
 * What the permission story shows.
 */
interface PermissionNoteProps {
  /**
   * What the page's permission requests gave.
   */
  answers: PermissionAnswers
}

/**
 * Shows what each permission request gave, one per line.
 */
function PermissionNote({ answers }: PermissionNoteProps) {
  return (
    <Note>
      <div>Notification permission: {answers.notification}</div>
      <div>Geolocation: {answers.geolocation}</div>
    </Note>
  )
}

/**
 * The text the srcdoc iframe's own document shows, which the story waits for.
 */
const srcdocText = 'Inside a srcdoc iframe'

/**
 * The srcdoc iframe's document: one coloured paragraph.
 */
const srcdoc = `<!doctype html>
<html>
  <body style="margin: 0; font-family: sans-serif; font-size: 16px">
    <p style="margin: 0; padding: 16px; background: #e0f2fe">${srcdocText}</p>
  </body>
</html>`

/**
 * An iframe whose document comes from its `srcdoc` attribute, with a fixed size and border.
 */
function SrcdocFrame() {
  return (
    <iframe
      title="srcdoc"
      srcDoc={srcdoc}
      style={{ display: 'block', width: 400, height: 80, border: '1px solid #0369a1' }}
    />
  )
}

/**
 * Whether the iframe shows its srcdoc document, fully loaded. Its first document, an empty `about:blank`, is complete
 * at once, so only the srcdoc's own text tells them apart.
 */
function showsSrcdoc(frame: HTMLIFrameElement | null): boolean {
  const document = frame?.contentDocument

  return document?.readyState === 'complete' && document.body?.textContent?.includes(srcdocText) === true
}

/**
 * A link to a page outside Storybook, which the story's `play` follows.
 */
function BurgersLink() {
  return (
    <Note>
      <a href="/categories/burgers" style={{ color: '#1d4ed8' }}>
        Burgers
      </a>
    </Note>
  )
}

const meta = {
  title: 'Hazards',
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * An `alert()` blocks the page until it's answered. visual-check accepts it, so the story renders and passes.
 */
export const Alert: Story = {
  render: () => <AlertResult />,
}

/**
 * A `confirm()` blocks the page until it's answered. visual-check dismisses it, so it returns `false`.
 */
export const Confirm: Story = {
  render: () => <ConfirmResult />,
}

/**
 * A `prompt()` blocks the page until it's answered. visual-check dismisses it, so it returns `null`.
 */
export const Prompt: Story = {
  render: () => <PromptResult />,
}

/**
 * Leaves a `beforeunload` handler that asks to stay, so the next story's `goto` on the same page opens a dialog.
 * visual-check accepts it, so with 1 worker the story after this one loads and passes. Dismissing it would cancel that
 * navigation and break that story.
 */
export const BeforeUnload: Story = {
  render: () => <UnloadGuard />,
}

/**
 * Opens a popup, a page of its own in the story's browser context, in a loader that waits for it to be closed.
 * visual-check closes it, so the story passes; a popup left open makes the loader throw and the story broken.
 */
export const Popup: Story = {
  loaders: [openPopupUntilClosed],
  render: () => <PopupNote />,
}

/**
 * Runs its page out of memory, so its renderer crashes. The story is broken, `crashed`, and isn't retried; with 1
 * worker, the story after this one gets a fresh page and passes. Its committed baseline, which `test` needs to capture
 * it at all, is the story without its `play`, since `update` never writes a broken story's.
 */
export const Crashes: Story = {
  render: () => <MemoryHog />,
  play: allocateForever,
}

/**
 * Starts a download. visual-check denies every download, and the story passes. The page can't tell a denied download
 * from an allowed one, so this only checks that a download doesn't hold up the capture.
 */
export const Download: Story = {
  render: () => <DownloadLink />,
}

/**
 * Asks for the notification and geolocation permissions before it renders. visual-check denies every permission, so
 * the snapshot shows `denied` and geolocation's PERMISSION_DENIED error.
 */
export const Permissions: Story = {
  loaders: [askForPermissions],
  render: (_args, { loaded }) => <PermissionNote answers={loaded.answers} />,
}

/**
 * An iframe with a document of its own, which visual-check captures as part of the page. `play` waits until that
 * document has loaded, so the snapshot always shows it. Should the wait give up, Storybook still reports the story a
 * success, and its snapshot differs instead.
 */
export const SrcdocIframe: Story = {
  render: () => <SrcdocFrame />,
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        if (!showsSrcdoc(canvasElement.querySelector('iframe'))) {
          throw new Error("The srcdoc iframe's document hasn't loaded yet.")
        }
      },
      { timeout: 5_000 },
    )
  },
}

/**
 * Logs a warning, then follows a link out of Storybook in `play` and waits forever, so its document always leaves
 * before Storybook reports the story finished. The story is broken, `navigated-away`, after visual-check loads it 3
 * times, and its report entry keeps the warning, logged in the document it left. Like `Crashes`, its committed baseline
 * is the story without its `play`.
 */
export const NavigatesAway: Story = {
  render: () => <BurgersLink />,
  play: async ({ canvasElement }) => {
    console.warn('Following the burgers link')
    canvasElement.querySelector('a')?.click()
    await new Promise<never>(() => undefined)
  },
}
